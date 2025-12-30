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
	// Time allowed to write a message to the peer
	writeWait = 10 * time.Second

	// Time allowed to read the next pong message from the peer
	pongWait = 60 * time.Second

	// Send pings to peer with this period (must be less than pongWait)
	pingPeriod = (pongWait * 9) / 10

	// Maximum message size allowed from peer
	maxMessageSize = 512 * 1024 // 512 KB
)

// Client represents a WebSocket client
type Client struct {
	ID       string
	Username string
	Conn     *websocket.Conn
	Send     chan []byte
	Manager  *ConnectionManager
	Groups   map[string]bool // Group IDs the client is subscribed to
	mu       sync.RWMutex
}

// ConnectionManager manages all WebSocket connections
type ConnectionManager struct {
	clients    map[string]*Client    // userID -> Client
	groups     map[string]map[string]*Client // groupID -> (userID -> Client)
	Register   chan *Client
	Unregister chan *Client
	Broadcast  chan []byte
	mu         sync.RWMutex
	pubsub     *pubsub.RedisPubSub
}

// NewConnectionManager creates a new connection manager
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

// run handles client registration, unregistration, and broadcasting
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

// registerClient registers a new client
func (cm *ConnectionManager) registerClient(client *Client) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	client.Groups = make(map[string]bool)
	cm.clients[client.ID] = client
	log.Printf("Client registered: %s (Total: %d)", client.Username, len(cm.clients))
}

// unregisterClient removes a client
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

		// Close send channel and remove client
		close(client.Send)
		delete(cm.clients, client.ID)
		log.Printf("Client unregistered: %s (Total: %d)", client.Username, len(cm.clients))
	}
}

// broadcastMessage sends a message to all connected clients
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

// SubscribeToGroup subscribes a client to a group channel
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

// UnsubscribeFromGroup unsubscribes a client from a group
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

// BroadcastToGroup sends a message to all clients in a group
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

// SendToUser sends a message to a specific user
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

// HandleRedisMessage processes messages from Redis Pub/Sub
// HandleRedisMessage processes messages from Redis Pub/Sub
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

	switch eventType {
	case "group_message":
		cm.handleGroupMessage(message)

	case "private_message_handler":
		cm.handlePrivateMessage(message)

	case "user_joined", "user_left", "user_removed":
		cm.handleUserEvent(message)

	case "message_deleted":
		cm.handleMessageDeleted(message)

	default:
		log.Printf("Unknown event type: %s", eventType)
	}
}


// handleGroupMessage handles group messages from Redis
func (cm *ConnectionManager) handleGroupMessage(message map[string]interface{}) {
	data, ok := message["data"].(map[string]interface{})
	if !ok {
		return
	}

	groupID, ok := data["group_id"].(string)
	if !ok {
		return
	}

	outMsg := models.OutgoingMessage{
		Type:      models.EventGroupMessage,
		Data:      data,
		Timestamp: time.Now().Format(time.RFC3339),
	}

	msgBytes, _ := json.Marshal(outMsg)
	cm.BroadcastToGroup(groupID, msgBytes)
}

// handlePrivateMessage handles private messages from Redis
func (cm *ConnectionManager) handlePrivateMessage(message map[string]interface{}) {
	data, ok := message["data"].(map[string]interface{})
	if !ok {
		return
	}

	senderID, _ := data["sender_id"].(string)
	recipientID, _ := data["recipient_id"].(string)

	outMsg := models.OutgoingMessage{
		Type:      models.EventPrivateMessage,
		Data:      data,
		Timestamp: time.Now().Format(time.RFC3339),
	}

	msgBytes, _ := json.Marshal(outMsg)
	cm.SendToUser(senderID, msgBytes)
	cm.SendToUser(recipientID, msgBytes)
}

// handleUserEvent handles user join/leave events
func (cm *ConnectionManager) handleUserEvent(message map[string]interface{}) {
	data, ok := message["data"].(map[string]interface{})
	if !ok {
		return
	}

	groupID, ok := data["group_id"].(string)
	if !ok {
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

	msgBytes, _ := json.Marshal(outMsg)
	cm.BroadcastToGroup(groupID, msgBytes)
}

// handleMessageDeleted handles message deletion events
func (cm *ConnectionManager) handleMessageDeleted(message map[string]interface{}) {
	// Implementation similar to handleUserEvent
	// Broadcast to relevant clients
}

// Shutdown gracefully shuts down the connection manager
func (cm *ConnectionManager) Shutdown() {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	log.Println("Closing all client connections...")
	for _, client := range cm.clients {
		client.Conn.Close()
	}
	log.Println("All connections closed")
}

// ReadPump pumps messages from the WebSocket connection to the manager
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

		// Handle incoming message
		c.handleIncomingMessage(message)
	}
}

// WritePump pumps messages from the manager to the WebSocket connection
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

			// Add queued messages
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

// handleIncomingMessage processes incoming WebSocket messages
func (c *Client) handleIncomingMessage(message []byte) {
	var wsMsg models.WebSocketMessage
	if err := json.Unmarshal(message, &wsMsg); err != nil {
		log.Printf("Failed to unmarshal message: %v", err)
		return
	}

	switch wsMsg.Type {
	case models.EventPing:
		c.handlePing()
	case models.EventTypingIndicator:
		c.handleTypingIndicator(wsMsg.Data)
	case "subscribe_group":
		if groupID, ok := wsMsg.Data["group_id"].(string); ok {
			c.Manager.SubscribeToGroup(c, groupID)
		}
	case "unsubscribe_group":
		if groupID, ok := wsMsg.Data["group_id"].(string); ok {
			c.Manager.UnsubscribeFromGroup(c, groupID)
		}
	default:
		log.Printf("Unknown message type: %s", wsMsg.Type)
	}
}

// handlePing responds to ping with pong
func (c *Client) handlePing() {
	pongMsg := models.OutgoingMessage{
		Type:      models.EventPong,
		Timestamp: time.Now().Format(time.RFC3339),
	}
	c.SendMessage(pongMsg)
}

// handleTypingIndicator broadcasts typing status
func (c *Client) handleTypingIndicator(data map[string]interface{}) {
	groupID, ok := data["group_id"].(string)
	if !ok {
		return
	}

	isTyping, _ := data["is_typing"].(bool)

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
}

// SendMessage sends a message to the client
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