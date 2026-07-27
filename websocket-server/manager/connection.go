package manager

import (
	"encoding/json"
	"log"
	"sync"
	"time"
	"websocket-server/models"
	"websocket-server/pubsub"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 512 * 1024
)

type Client struct {
	ID       string
	Username string
	Conn     *websocket.Conn
	Send     chan []byte
	Manager  *ConnectionManager
	Groups   map[string]bool
	mu       sync.RWMutex
}

type ConnectionManager struct {
	clients    map[string]*Client
	groups     map[string]map[string]*Client
	Register   chan *Client
	Unregister chan *Client
	Broadcast  chan []byte
	mu         sync.RWMutex
	pubsub     *pubsub.RedisPubSub
}

func NewConnectionManager(ps *pubsub.RedisPubSub) *ConnectionManager {
	cm := &ConnectionManager{
		clients:    make(map[string]*Client),
		groups:     make(map[string]map[string]*Client),
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
		Broadcast:  make(chan []byte, 256),
		pubsub:     ps,
	}

	go cm.run()
	return cm
}

func (cm *ConnectionManager) run() {
	for {
		select {
		case client := <-cm.Register:
			cm.registerClient(client)
		case client := <-cm.Unregister:
			cm.unregisterClient(client)
		case message := <-cm.Broadcast:
			cm.broadcastMessage(message)
		}
	}
}

func (cm *ConnectionManager) registerClient(client *Client) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	client.Groups = make(map[string]bool)
	cm.clients[client.ID] = client
	log.Printf("Client registered: %s (Total: %d)", client.Username, len(cm.clients))

	// Publish user online status to Redis
	cm.publishUserStatus(client.ID, client.Username, "online")
}

func (cm *ConnectionManager) unregisterClient(client *Client) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	if _, ok := cm.clients[client.ID]; ok {
		// Remove from all groups
		client.mu.RLock()
		for groupID := range client.Groups {
			if groupClients, exists := cm.groups[groupID]; exists {
				delete(groupClients, client.ID)
				if len(groupClients) == 0 {
					delete(cm.groups, groupID)
				}
			}
		}
		client.mu.RUnlock()

		close(client.Send)
		delete(cm.clients, client.ID)
		log.Printf("Client unregistered: %s (Total: %d)", client.Username, len(cm.clients))

		// Publish user offline status to Redis
		cm.publishUserStatus(client.ID, client.Username, "offline")
	}
}

// publishUserStatus publishes user online/offline status to Redis
func (cm *ConnectionManager) publishUserStatus(userID, username, status string) {
	statusMsg := map[string]interface{}{
		"type": "user_status",
		"data": map[string]interface{}{
			"user_id":   userID,
			"username":  username,
			"status":    status,
			"timestamp": time.Now().Format(time.RFC3339),
		},
	}

	msgBytes, err := json.Marshal(statusMsg)
	if err != nil {
		log.Printf("Failed to marshal user status: %v", err)
		return
	}

	if err := cm.pubsub.Publish("messaging_events", msgBytes); err != nil {
		log.Printf("Failed to publish user status: %v", err)
		return
	}

	log.Printf("📡 Published user status: %s is %s", username, status)
}

// GetOnlineUsers returns a list of currently online user IDs
func (cm *ConnectionManager) GetOnlineUsers() []string {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	users := make([]string, 0, len(cm.clients))
	for userID := range cm.clients {
		users = append(users, userID)
	}
	return users
}

// IsUserOnline checks if a specific user is online
func (cm *ConnectionManager) IsUserOnline(userID string) bool {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	_, exists := cm.clients[userID]
	return exists
}

func (cm *ConnectionManager) broadcastMessage(message []byte) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	for _, client := range cm.clients {
		select {
		case client.Send <- message:
		default:
			close(client.Send)
			delete(cm.clients, client.ID)
		}
	}
}

func (cm *ConnectionManager) SubscribeToGroup(client *Client, groupID string) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	if cm.groups[groupID] == nil {
		cm.groups[groupID] = make(map[string]*Client)
	}
	cm.groups[groupID][client.ID] = client

	client.mu.Lock()
	client.Groups[groupID] = true
	client.mu.Unlock()

	log.Printf("Client %s subscribed to group %s", client.Username, groupID)
}

func (cm *ConnectionManager) UnsubscribeFromGroup(client *Client, groupID string) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	if groupClients, exists := cm.groups[groupID]; exists {
		delete(groupClients, client.ID)
		if len(groupClients) == 0 {
			delete(cm.groups, groupID)
		}
	}

	client.mu.Lock()
	delete(client.Groups, groupID)
	client.mu.Unlock()

	log.Printf("Client %s unsubscribed from group %s", client.Username, groupID)
}

func (cm *ConnectionManager) BroadcastToGroup(groupID string, message []byte) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	if groupClients, exists := cm.groups[groupID]; exists {
		for _, client := range groupClients {
			select {
			case client.Send <- message:
			default:
				log.Printf("Failed to send to client %s", client.Username)
			}
		}
		log.Printf("Broadcasted to group %s (%d clients)", groupID, len(groupClients))
	}
}

func (cm *ConnectionManager) SendToUser(userID string, message []byte) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	if client, exists := cm.clients[userID]; exists {
		select {
		case client.Send <- message:
			log.Printf("Message sent to user %s", client.Username)
		default:
			log.Printf("Failed to send to user %s", client.Username)
		}
	}
}

func (cm *ConnectionManager) HandleRedisMessage(channel string, payload []byte) {
	var message map[string]interface{}
	if err := json.Unmarshal(payload, &message); err != nil {
		log.Printf("Failed to unmarshal Redis message: %v", err)
		return
	}

	eventType, ok := message["type"].(string)
	if !ok {
		log.Println("Missing or invalid event type in Redis message")
		return
	}

	log.Printf("📨 Received Redis event: %s", eventType)

	switch eventType {
	case "group_message":
		cm.handleGroupMessage(message)
	case "private_message", "private_message_handler":
		cm.handlePrivateMessage(message)
	case "user_joined", "user_left", "user_removed":
		cm.handleUserEvent(message)
	case "member_promoted":
		cm.handleMemberPromoted(message)
	case "message_deleted":
		cm.handleMessageDeleted(message)
	case "message_read":
		cm.handleMessageRead(message)
	case "typing_indicator":
		cm.handleTypingIndicator(message)
	case "unread_count_update":
		cm.handleUnreadCountUpdate(message)
	case "user_status":
		cm.handleUserStatus(message)
	case "request_online_users":
		cm.handleOnlineUsersRequest(message)
	default:
		log.Printf("Unknown event type: %s", eventType)
	}
}

// handleUserStatus broadcasts user online/offline status
func (cm *ConnectionManager) handleUserStatus(message map[string]interface{}) {
	data, ok := message["data"].(map[string]interface{})
	if !ok {
		log.Println("Invalid data format in user status")
		return
	}

	outMsg := models.OutgoingMessage{
		Type:      "user_status",
		Data:      data,
		Timestamp: time.Now().Format(time.RFC3339),
	}

	msgBytes, err := json.Marshal(outMsg)
	if err != nil {
		log.Printf("Failed to marshal user status: %v", err)
		return
	}

	// Broadcast to all connected clients
	cm.broadcastMessage(msgBytes)

	userID, _ := data["user_id"].(string)
	status, _ := data["status"].(string)
	log.Printf("✅ User status broadcasted: %s is %s", userID, status)
}

// handleOnlineUsersRequest sends the list of online users to requester
func (cm *ConnectionManager) handleOnlineUsersRequest(message map[string]interface{}) {
	data, ok := message["data"].(map[string]interface{})
	if !ok {
		log.Println("Invalid data format in online users request")
		return
	}

	requesterID, ok := data["requester_id"].(string)
	if !ok {
		log.Println("Missing requester_id in online users request")
		return
	}

	onlineUsers := cm.GetOnlineUsers()

	outMsg := models.OutgoingMessage{
		Type: "online_users_list",
		Data: map[string]interface{}{
			"online_users": onlineUsers,
			"count":        len(onlineUsers),
		},
		Timestamp: time.Now().Format(time.RFC3339),
	}

	msgBytes, err := json.Marshal(outMsg)
	if err != nil {
		log.Printf("Failed to marshal online users list: %v", err)
		return
	}

	cm.SendToUser(requesterID, msgBytes)
	log.Printf("✅ Online users list sent to %s (%d users)", requesterID, len(onlineUsers))
}

// manager/connection.go - MODIFICATIONS for E2EE pass-through
// Only showing the modified sections

// ✅ UPDATE handleGroupMessage to pass through encryption fields:
func (cm *ConnectionManager) handleGroupMessage(message map[string]interface{}) {
	data, ok := message["data"].(map[string]interface{})
	if !ok {
		log.Println("Invalid data format in group message")
		return
	}

	groupID, ok := data["group_id"].(string)
	if !ok {
		log.Println("Missing group_id in group message")
		return
	}

	// ✅ Extract encryption fields if present
	isEncrypted, _ := data["is_encrypted"].(bool)

	outData := map[string]interface{}{
		"message_id":      data["message_id"],
		"sender_id":       data["sender_id"],
		"sender_username": data["sender_username"],
		"group_id":        groupID,
		"group_name":      data["group_name"],
		"timestamp":       data["timestamp"],
		"message_type":    "group",
		"is_encrypted":    isEncrypted,
	}

	// ✅ Pass through encrypted or plain content
	if isEncrypted {
		outData["encrypted_content"] = data["encrypted_content"]
		outData["encrypted_keys"] = data["encrypted_keys"]
		outData["iv"] = data["iv"]
	} else {
		outData["content"] = data["content"]
	}

	outMsg := models.OutgoingMessage{
		Type:      models.EventGroupMessage,
		Data:      outData,
		Timestamp: time.Now().Format(time.RFC3339),
	}

	msgBytes, err := json.Marshal(outMsg)
	if err != nil {
		log.Printf("Failed to marshal group message: %v", err)
		return
	}

	cm.BroadcastToGroup(groupID, msgBytes)

	if isEncrypted {
		log.Printf("✅ Encrypted group message broadcasted to group %s", groupID)
	} else {
		log.Printf("✅ Group message broadcasted to group %s", groupID)
	}
}

// ✅ UPDATE handlePrivateMessage to pass through encryption fields:
func (cm *ConnectionManager) handlePrivateMessage(message map[string]interface{}) {
	data, ok := message["data"].(map[string]interface{})
	if !ok {
		log.Println("Invalid data format in private message")
		return
	}

	senderID, _ := data["sender_id"].(string)
	recipientID, _ := data["recipient_id"].(string)
	isEncrypted, _ := data["is_encrypted"].(bool)

	outData := map[string]interface{}{
		"message_id":         data["message_id"],
		"sender_id":          senderID,
		"sender_username":    data["sender_username"],
		"recipient_id":       recipientID,
		"recipient_username": data["recipient_username"],
		"timestamp":          data["timestamp"],
		"message_type":       "private",
		"is_encrypted":       isEncrypted,
	}

	// ✅ Pass through encrypted or plain content
	if isEncrypted {
		outData["encrypted_content"] = data["encrypted_content"]
		outData["encrypted_key"] = data["encrypted_key"]
		outData["encrypted_key_self"] = data["encrypted_key_self"]
		outData["iv"] = data["iv"]
	} else {
		outData["content"] = data["content"]
	}

	outMsg := models.OutgoingMessage{
		Type:      models.EventPrivateMessage,
		Data:      outData,
		Timestamp: time.Now().Format(time.RFC3339),
	}

	msgBytes, err := json.Marshal(outMsg)
	if err != nil {
		log.Printf("Failed to marshal private message: %v", err)
		return
	}

	cm.SendToUser(senderID, msgBytes)
	cm.SendToUser(recipientID, msgBytes)

	if isEncrypted {
		log.Printf("✅ Encrypted private message sent from %s to %s", senderID, recipientID)
	} else {
		log.Printf("✅ Private message sent from %s to %s", senderID, recipientID)
	}
}

// No other changes needed in Go server - it just passes through the encrypted data!

func (cm *ConnectionManager) handleUserEvent(message map[string]interface{}) {
	data, ok := message["data"].(map[string]interface{})
	if !ok {
		log.Println("Invalid data format in user event")
		return
	}

	groupID, ok := data["group_id"].(string)
	if !ok {
		log.Println("Missing group_id in user event")
		return
	}

	eventType := message["type"].(string)
	var event models.EventType

	switch eventType {
	case "user_joined":
		event = models.EventUserJoined
	case "user_left":
		event = models.EventUserLeft
	case "user_removed":
		event = models.EventUserRemoved
	}

	outMsg := models.OutgoingMessage{
		Type:      event,
		Data:      data,
		Timestamp: time.Now().Format(time.RFC3339),
	}

	msgBytes, err := json.Marshal(outMsg)
	if err != nil {
		log.Printf("Failed to marshal user event: %v", err)
		return
	}

	cm.BroadcastToGroup(groupID, msgBytes)
	log.Printf("✅ User event (%s) broadcasted to group %s", event, groupID)
}

func (cm *ConnectionManager) handleMemberPromoted(message map[string]interface{}) {
	data, ok := message["data"].(map[string]interface{})
	if !ok {
		log.Println("Invalid data format in member promoted event")
		return
	}

	groupID, ok := data["group_id"].(string)
	if !ok {
		log.Println("Missing group_id in member promoted event")
		return
	}

	outMsg := models.OutgoingMessage{
		Type:      models.EventMemberPromoted,
		Data:      data,
		Timestamp: time.Now().Format(time.RFC3339),
	}

	msgBytes, err := json.Marshal(outMsg)
	if err != nil {
		log.Printf("Failed to marshal member promoted event: %v", err)
		return
	}

	cm.BroadcastToGroup(groupID, msgBytes)

	username, _ := data["username"].(string)
	log.Printf("✅ Member promotion broadcasted: %s in group %s", username, groupID)
}

func (cm *ConnectionManager) handleMessageDeleted(message map[string]interface{}) {
	data, ok := message["data"].(map[string]interface{})
	if !ok {
		log.Println("Invalid data format in message deleted event")
		return
	}

	messageType, _ := data["message_type"].(string)

	outMsg := models.OutgoingMessage{
		Type:      models.EventMessageDeleted,
		Data:      data,
		Timestamp: time.Now().Format(time.RFC3339),
	}

	msgBytes, err := json.Marshal(outMsg)
	if err != nil {
		log.Printf("Failed to marshal message deleted event: %v", err)
		return
	}

	if messageType == "group" {
		groupID, _ := data["group_id"].(string)
		cm.BroadcastToGroup(groupID, msgBytes)
		log.Printf("✅ Message deletion broadcasted to group %s", groupID)
	} else if messageType == "private" {
		senderID, _ := data["sender_id"].(string)
		recipientID, _ := data["recipient_id"].(string)
		cm.SendToUser(senderID, msgBytes)
		cm.SendToUser(recipientID, msgBytes)
		log.Printf("✅ Message deletion sent to sender and recipient")
	}
}

func (cm *ConnectionManager) handleMessageRead(message map[string]interface{}) {
	data, ok := message["data"].(map[string]interface{})
	if !ok {
		log.Println("Invalid data format in message read event")
		return
	}

	messageID, _ := data["message_id"].(string)
	readBy, _ := data["read_by"].(string)

	outMsg := models.OutgoingMessage{
		Type:      models.EventMessageRead,
		Data:      data,
		Timestamp: time.Now().Format(time.RFC3339),
	}

	msgBytes, err := json.Marshal(outMsg)
	if err != nil {
		log.Printf("Failed to marshal message read event: %v", err)
		return
	}

	cm.SendToUser(readBy, msgBytes)
	cm.broadcastMessage(msgBytes)
	log.Printf("✅ Read receipt broadcasted for message %s by user %s", messageID, readBy)
}

func (cm *ConnectionManager) handleUnreadCountUpdate(message map[string]interface{}) {
	data, ok := message["data"].(map[string]interface{})
	if !ok {
		log.Println("Invalid data format in unread count update")
		return
	}

	userID, ok := data["user_id"].(string)
	if !ok {
		log.Println("Missing user_id in unread count update")
		return
	}

	outMsg := models.OutgoingMessage{
		Type:      "unread_count_update",
		Data:      data,
		Timestamp: time.Now().Format(time.RFC3339),
	}

	msgBytes, err := json.Marshal(outMsg)
	if err != nil {
		log.Printf("Failed to marshal unread count update: %v", err)
		return
	}

	cm.SendToUser(userID, msgBytes)
	log.Printf("✅ Unread count update sent to user %s", userID)
}

func (cm *ConnectionManager) handleTypingIndicator(message map[string]interface{}) {
	data, ok := message["data"].(map[string]interface{})
	if !ok {
		log.Println("Invalid data format in typing indicator")
		return
	}

	outMsg := models.OutgoingMessage{
		Type:      models.EventTypingIndicator,
		Data:      data,
		Timestamp: time.Now().Format(time.RFC3339),
	}

	msgBytes, err := json.Marshal(outMsg)
	if err != nil {
		log.Printf("Failed to marshal typing indicator: %v", err)
		return
	}

	if groupID, ok := data["group_id"].(string); ok {
		cm.BroadcastToGroup(groupID, msgBytes)
		username, _ := data["username"].(string)
		log.Printf("✅ Typing indicator broadcasted: %s in group %s", username, groupID)
	} else if recipientID, ok := data["recipient_id"].(string); ok {
		cm.SendToUser(recipientID, msgBytes)
		username, _ := data["username"].(string)
		log.Printf("✅ Typing indicator sent to user %s", username)
	}
}

func (cm *ConnectionManager) Shutdown() {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	log.Println("Closing all client connections...")
	for _, client := range cm.clients {
		client.Conn.Close()
	}
	log.Println("All connections closed")
}

func (c *Client) ReadPump() {
	defer func() {
		c.Manager.Unregister <- c
		c.Conn.Close()
	}()

	c.Conn.SetReadLimit(maxMessageSize)
	c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}

		c.handleIncomingMessage(message)
	}
}

func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			n := len(c.Send)
			for i := 0; i < n; i++ {
				w.Write([]byte{'\n'})
				w.Write(<-c.Send)
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// FIXED: Added case for "request_online_users"
func (c *Client) handleIncomingMessage(message []byte) {
	var wsMsg models.WebSocketMessage
	if err := json.Unmarshal(message, &wsMsg); err != nil {
		log.Printf("Failed to unmarshal message from %s: %v", c.Username, err)
		return
	}

	log.Printf("📨 Received message from %s: type=%s", c.Username, wsMsg.Type)

	switch wsMsg.Type {
	case models.EventPing:
		c.handlePing()

	case models.EventTypingIndicator:
		c.handleTypingIndicator(wsMsg.Data)

	case "subscribe_group":
		if groupID, ok := wsMsg.Data["group_id"].(string); ok {
			c.Manager.SubscribeToGroup(c, groupID)
			log.Printf("✅ %s subscribed to group %s", c.Username, groupID)
		}

	case "unsubscribe_group":
		if groupID, ok := wsMsg.Data["group_id"].(string); ok {
			c.Manager.UnsubscribeFromGroup(c, groupID)
			log.Printf("✅ %s unsubscribed from group %s", c.Username, groupID)
		}

	case "mark_read":
		c.handleMarkRead(wsMsg.Data)

	case "request_online_users":
		// ✅ FIXED: Added this case
		c.handleRequestOnlineUsers()
	case "load_older_messages":
		c.handleLoadOlderMessages(wsMsg.Data)

	case "private_message":
		c.handlePrivateMessageFromClient(wsMsg.Data)

	case "group_message":
		c.handleGroupMessageFromClient(wsMsg.Data)

	default:
		log.Printf("Unknown message type from %s: %s", c.Username, wsMsg.Type)
	}
}

func (c *Client) handlePrivateMessageFromClient(data map[string]interface{}) {
	recipientID, _ := data["recipient_id"].(string)
	content, _ := data["content"].(string)

	outData := map[string]interface{}{
		"message_id":      "tmp-" + time.Now().Format("20060102150405"),
		"sender_id":       c.ID,
		"sender_username": c.Username,
		"recipient_id":    recipientID,
		"content":         content,
		"timestamp":       time.Now().Format(time.RFC3339),
		"message_type":    "private",
	}

	outMsg := models.OutgoingMessage{
		Type:      models.EventPrivateMessage,
		Data:      outData,
		Timestamp: time.Now().Format(time.RFC3339),
	}

	msgBytes, _ := json.Marshal(outMsg)
	c.Manager.SendToUser(c.ID, msgBytes)
	c.Manager.SendToUser(recipientID, msgBytes)
	log.Printf("⚡ Direct Private Message from %s to %s", c.Username, recipientID)
}

func (c *Client) handleGroupMessageFromClient(data map[string]interface{}) {
	groupID, _ := data["group_id"].(string)
	content, _ := data["content"].(string)

	outData := map[string]interface{}{
		"message_id":      "tmp-" + time.Now().Format("20060102150405"),
		"sender_id":       c.ID,
		"sender_username": c.Username,
		"group_id":        groupID,
		"content":         content,
		"timestamp":       time.Now().Format(time.RFC3339),
		"message_type":    "group",
	}

	outMsg := models.OutgoingMessage{
		Type:      models.EventGroupMessage,
		Data:      outData,
		Timestamp: time.Now().Format(time.RFC3339),
	}

	msgBytes, _ := json.Marshal(outMsg)
	c.Manager.BroadcastToGroup(groupID, msgBytes)
	log.Printf("⚡ Direct Group Message from %s to group %s", c.Username, groupID)
}

func (c *Client) handlePing() {
	pongMsg := models.OutgoingMessage{
		Type:      models.EventPong,
		Timestamp: time.Now().Format(time.RFC3339),
	}
	c.SendMessage(pongMsg)
}

func (c *Client) handleTypingIndicator(data map[string]interface{}) {
	isTyping, _ := data["is_typing"].(bool)

	if groupID, ok := data["group_id"].(string); ok {
		indicator := models.OutgoingMessage{
			Type: models.EventTypingIndicator,
			Data: map[string]interface{}{
				"user_id":   c.ID,
				"username":  c.Username,
				"group_id":  groupID,
				"is_typing": isTyping,
			},
			Timestamp: time.Now().Format(time.RFC3339),
		}

		msgBytes, _ := json.Marshal(indicator)
		c.Manager.BroadcastToGroup(groupID, msgBytes)
		log.Printf("✅ Typing indicator from %s in group %s", c.Username, groupID)

	} else if recipientID, ok := data["recipient_id"].(string); ok {
		indicator := models.OutgoingMessage{
			Type: models.EventTypingIndicator,
			Data: map[string]interface{}{
				"user_id":      c.ID,
				"username":     c.Username,
				"recipient_id": recipientID,
				"is_typing":    isTyping,
			},
			Timestamp: time.Now().Format(time.RFC3339),
		}

		msgBytes, _ := json.Marshal(indicator)
		c.Manager.SendToUser(recipientID, msgBytes)
		log.Printf("✅ Private typing indicator from %s to %s", c.Username, recipientID)
	}
}

func (c *Client) handleMarkRead(data map[string]interface{}) {
	messageID, ok := data["message_id"].(string)
	if !ok {
		log.Printf("Missing message_id in mark_read from %s", c.Username)
		return
	}

	readReceipt := models.OutgoingMessage{
		Type: models.EventMessageRead,
		Data: map[string]interface{}{
			"message_id":       messageID,
			"read_by":          c.ID,
			"read_by_username": c.Username,
			"timestamp":        time.Now().Format(time.RFC3339),
		},
		Timestamp: time.Now().Format(time.RFC3339),
	}

	msgBytes, _ := json.Marshal(readReceipt)
	c.Manager.Broadcast <- msgBytes
	log.Printf("✅ Read receipt from %s for message %s", c.Username, messageID)
}

// handleRequestOnlineUsers sends the current online users list to the client
func (c *Client) handleRequestOnlineUsers() {
	onlineUsers := c.Manager.GetOnlineUsers()

	response := models.OutgoingMessage{
		Type: "online_users_list",
		Data: map[string]interface{}{
			"online_users": onlineUsers,
			"count":        len(onlineUsers),
		},
		Timestamp: time.Now().Format(time.RFC3339),
	}

	c.SendMessage(response)
	log.Printf("✅ Online users list sent to %s (%d users)", c.Username, len(onlineUsers))
}

func (c *Client) SendMessage(msg models.OutgoingMessage) {
	msgBytes, err := json.Marshal(msg)
	if err != nil {
		log.Printf("Failed to marshal message: %v", err)
		return
	}

	select {
	case c.Send <- msgBytes:
	default:
		log.Printf("Client %s send buffer full", c.Username)
	}
}

func (c *Client) handleLoadOlderMessages(data map[string]interface{}) {
	groupID, _ := data["group_id"].(string)
	page, _ := data["page"].(float64)
	pageSize, _ := data["page_size"].(float64)
	messageType, _ := data["message_type"].(string)

	response := models.OutgoingMessage{
		Type: "older_messages_response",
		Data: map[string]interface{}{
			"group_id":     groupID,
			"page":         int(page),
			"page_size":    int(pageSize), // ✅ Added page_size to response
			"message_type": messageType,
			"timestamp":    time.Now().Format(time.RFC3339),
		},
		Timestamp: time.Now().Format(time.RFC3339),
	}

	c.SendMessage(response)
	log.Printf("✅ Older messages request from %s for page %d (page size: %d)", c.Username, int(page), int(pageSize))
}
