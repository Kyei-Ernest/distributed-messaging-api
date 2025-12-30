package models

import "time"

// MessageType represents the type of message
type MessageType string

const (
	MessageTypeGroup   MessageType = "group"
	MessageTypePrivate MessageType = "private"
	MessageTypeSystem  MessageType = "system"
)

// EventType represents WebSocket event types
type EventType string

const (
	EventGroupMessage    EventType = "group_message"
	EventPrivateMessage  EventType = "private_message"
	EventUserJoined      EventType = "user_joined"
	EventUserLeft        EventType = "user_left"
	EventUserRemoved     EventType = "user_removed"
	EventMessageDeleted  EventType = "message_deleted"
	EventTypingIndicator EventType = "typing_indicator"
	EventError           EventType = "error"
	EventConnected       EventType = "connected"
	EventPing            EventType = "ping"
	EventPong            EventType = "pong"
)

// WebSocketMessage represents incoming WebSocket messages
type WebSocketMessage struct {
	Type      EventType              `json:"type"`
	Data      map[string]interface{} `json:"data,omitempty"`
	Timestamp time.Time              `json:"timestamp"`
}

// OutgoingMessage represents messages sent to clients
type OutgoingMessage struct {
	Type      EventType              `json:"type"`
	Data      map[string]interface{} `json:"data,omitempty"`
	Timestamp string                 `json:"timestamp"`
}

// GroupMessage represents a group chat message
type GroupMessage struct {
	MessageID      string `json:"message_id"`
	SenderID       string `json:"sender_id"`
	SenderUsername string `json:"sender_username"`
	GroupID        string `json:"group_id"`
	GroupName      string `json:"group_name"`
	Content        string `json:"content"`
	Timestamp      string `json:"timestamp"`
	MessageType    string `json:"message_type"`
}

// PrivateMessage represents a private chat message
type PrivateMessage struct {
	MessageID         string `json:"message_id"`
	SenderID          string `json:"sender_id"`
	SenderUsername    string `json:"sender_username"`
	RecipientID       string `json:"recipient_id"`
	RecipientUsername string `json:"recipient_username"`
	Content           string `json:"content"`
	Timestamp         string `json:"timestamp"`
	MessageType       string `json:"message_type"`
}

// UserEvent represents user join/leave events
type UserEvent struct {
	UserID    string `json:"user_id"`
	Username  string `json:"username"`
	GroupID   string `json:"group_id,omitempty"`
	GroupName string `json:"group_name,omitempty"`
	IsAdmin   bool   `json:"is_admin,omitempty"`
}

// TypingIndicator represents typing status
type TypingIndicator struct {
	UserID    string `json:"user_id"`
	Username  string `json:"username"`
	GroupID   string `json:"group_id,omitempty"`
	IsTyping  bool   `json:"is_typing"`
	Timestamp string `json:"timestamp"`
}

// MessageDeleted represents a deleted message event
type MessageDeleted struct {
	MessageID string `json:"message_id"`
	DeletedBy string `json:"deleted_by"`
}

// ErrorMessage represents an error response
type ErrorMessage struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
