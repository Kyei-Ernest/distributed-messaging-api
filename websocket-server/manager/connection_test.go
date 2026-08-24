package manager

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"websocket-server/pubsub"
)

// waitFor polls cond until true or the timeout elapses (manager runs its own
// goroutine, so channel-driven state settles asynchronously).
func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatal("condition not reached within timeout")
}

func newTestManager(t *testing.T) *ConnectionManager {
	t.Helper()
	mr := miniredis.RunT(t)
	ps := pubsub.NewRedisPubSub("redis://" + mr.Addr())
	return NewConnectionManager(ps)
}

func makeClient(id, username string) *Client {
	return &Client{
		ID:       id,
		Username: username,
		Send:     make(chan []byte, 8),
	}
}

func TestSendToUserFansOutToAllDevices(t *testing.T) {
	cm := newTestManager(t)

	tab1 := makeClient("u1", "alice")
	tab2 := makeClient("u1", "alice") // same user, second device
	cm.Register <- tab1
	cm.Register <- tab2
	waitFor(t, func() bool { return len(cm.sessions["u1"]) == 2 })

	cm.SendToUser("u1", []byte(`{"ping":1}`))

	for i, c := range []*Client{tab1, tab2} {
		select {
		case <-c.Send:
		default:
			t.Fatalf("device %d did not receive message", i)
		}
	}
}

func TestPresenceRefCountAcrossDevices(t *testing.T) {
	cm := newTestManager(t)
	mr := miniredis.RunT(t)
	defer mr.Close()

	tab1 := makeClient("u2", "bob")
	tab2 := makeClient("u2", "bob")

	cm.Register <- tab1
	onlineCount := func() int {
		members, _ := cm.pubsub.GetOnlineUserIDs()
		return len(members)
	}
	waitFor(t, func() bool { return onlineCount() == 1 })

	cm.Register <- tab2
	waitFor(t, func() bool { return len(cm.sessions["u2"]) == 2 })

	cm.Unregister <- tab2
	waitFor(t, func() bool { return len(cm.sessions["u2"]) == 1 })
	if onlineCount() != 1 {
		t.Fatalf("presence lost while a device is still connected: %d", onlineCount())
	}

	cm.Unregister <- tab1
	waitFor(t, func() bool { return onlineCount() == 0 })
}

func TestIsUserOnlineReflectsSessions(t *testing.T) {
	cm := newTestManager(t)
	c := makeClient("u3", "carol")

	cm.Register <- c
	waitFor(t, func() bool { return cm.IsUserOnline("u3") })

	cm.Unregister <- c
	waitFor(t, func() bool { return !cm.IsUserOnline("u3") })
}

// capturingBroker records republished envelopes for W1 assertions.
type capturingBroker struct {
	Broker    // embed the manager-defined interface; only Publish is used
	published [][]byte
}

func (b *capturingBroker) Publish(channel string, message []byte) error {
	b.published = append(b.published, message)
	return nil
}

func TestRepublishedTargetedEventEnvelopeShape(t *testing.T) {
	// W1 contract: client-originated targeted events publish as {"type","data"}
	// envelopes that HandleRedisMessage already dispatches on every node.
	c := makeClient("u4", "dave")
	broker := &capturingBroker{}
	c.Manager = &ConnectionManager{pubsub: broker}

	c.handleMarkRead(map[string]interface{}{"message_id": "m-1"})
	c.handleTypingIndicator(map[string]interface{}{
		"group_id": "g-9", "is_typing": true,
	})

	if len(broker.published) != 2 {
		t.Fatalf("expected 2 republished envelopes, got %d", len(broker.published))
	}

	var readEnv map[string]interface{}
	if err := json.Unmarshal(broker.published[0], &readEnv); err != nil {
		t.Fatalf("mark_read envelope invalid JSON: %v", err)
	}
	if readEnv["type"] != "message_read" {
		t.Fatalf("envelope type = %v, want message_read", readEnv["type"])
	}
	data := readEnv["data"].(map[string]interface{})
	if data["message_id"] != "m-1" || data["read_by"] != "u4" {
		t.Fatalf("mark_read envelope data malformed: %v", data)
	}

	var typingEnv map[string]interface{}
	if err := json.Unmarshal(broker.published[1], &typingEnv); err != nil {
		t.Fatalf("typing envelope invalid JSON: %v", err)
	}
	if typingEnv["type"] != "typing_indicator" {
		t.Fatalf("envelope type = %v, want typing_indicator", typingEnv["type"])
	}
}
