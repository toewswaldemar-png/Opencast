package api

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// ClientCmd is a command sent from the server to the Windows client.
type ClientCmd struct {
	Type    string `json:"type"`
	Payload any    `json:"payload"`
}

// CmdStartPayload tells the client to start a stream.
type CmdStartPayload struct {
	StreamID   string `json:"streamId"`
	DeviceID   string `json:"deviceId"`
	IngestURL  string `json:"ingestUrl"`  // e.g. http://server:8765/ingest/{streamId}
	Format     string `json:"format"`
	Bitrate    int    `json:"bitrate"`
	SampleRate uint32 `json:"sampleRate"`
	Channels   uint16 `json:"channels"`
}

// CmdStopPayload tells the client to stop a stream.
type CmdStopPayload struct {
	StreamID string `json:"streamId"`
}

// CmdMonitorPayload tells the client to start/stop the VU monitor.
type CmdMonitorPayload struct {
	MonitorID  string `json:"monitorId"`  // card entry ID
	DeviceID   string `json:"deviceId"`
	SampleRate uint32 `json:"sampleRate"`
	Channels   uint16 `json:"channels"`
}

// clientMsg is an incoming message from the Windows client.
type clientMsg struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

// StreamUnregisterer is implemented by ingest.Relay; avoids an import cycle.
type StreamUnregisterer interface {
	Unregister(streamID string)
}

// ClientHub manages the single Windows client connection.
type ClientHub struct {
	mu      sync.RWMutex
	conn    *clientConn
	devices []any          // last device list reported by client
	status  map[string]any // last stream statuses reported by client

	hub   *Hub
	relay StreamUnregisterer // used to clean up pending entries on client error
}

type clientConn struct {
	ws   *websocket.Conn
	send chan []byte
	done chan struct{}
}

func NewClientHub(hub *Hub, relay StreamUnregisterer) *ClientHub {
	return &ClientHub{
		hub:    hub,
		relay:  relay,
		status: make(map[string]any),
	}
}

// ServeWS upgrades the Windows client connection.
func (ch *ClientHub) ServeWS(w http.ResponseWriter, r *http.Request) {
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("client ws upgrade: %v", err)
		return
	}

	c := &clientConn{ws: ws, send: make(chan []byte, 64), done: make(chan struct{})}

	ch.mu.Lock()
	if ch.conn != nil {
		ch.conn.ws.Close()
	}
	ch.conn = c
	ch.mu.Unlock()

	log.Println("[client] Windows-Client verbunden")
	ch.hub.Broadcast(MsgClientOnline, true)

	go c.writePump()
	ch.readPump(c)

	ch.mu.Lock()
	if ch.conn == c {
		ch.conn = nil
	}
	ch.mu.Unlock()

	log.Println("[client] Windows-Client getrennt")
	ch.hub.Broadcast(MsgClientOnline, false)
}

func (ch *ClientHub) readPump(c *clientConn) {
	defer c.ws.Close()
	c.ws.SetReadLimit(64 * 1024)
	c.ws.SetReadDeadline(time.Now().Add(90 * time.Second))
	c.ws.SetPongHandler(func(string) error {
		c.ws.SetReadDeadline(time.Now().Add(90 * time.Second))
		return nil
	})

	for {
		_, raw, err := c.ws.ReadMessage()
		if err != nil {
			break
		}
		c.ws.SetReadDeadline(time.Now().Add(90 * time.Second))

		var msg clientMsg
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}
		ch.handleClientMsg(msg)
	}
}

func (ch *ClientHub) handleClientMsg(msg clientMsg) {
	switch msg.Type {
	case "devices":
		var devs []any
		if err := json.Unmarshal(msg.Payload, &devs); err == nil {
			ch.mu.Lock()
			ch.devices = devs
			ch.mu.Unlock()
			ch.hub.Broadcast(MsgDevices, devs)
		}

	case "stream:level", "monitor:level":
		var lvl any
		if err := json.Unmarshal(msg.Payload, &lvl); err == nil {
			ch.hub.Broadcast(MsgLevel, lvl)
		}

	case "stream:status":
		var payload map[string]any
		if err := json.Unmarshal(msg.Payload, &payload); err == nil {
			if id, ok := payload["streamId"].(string); ok {
				ch.mu.Lock()
				ch.status[id] = payload
				ch.mu.Unlock()
			}
			ch.hub.Broadcast(MsgStatus, payload)
		}

	case "stream:error":
		var payload map[string]any
		if err := json.Unmarshal(msg.Payload, &payload); err == nil {
			// If the stream never started (still pending in relay), clean it up now
			// so the user can retry immediately instead of waiting for the 30 s timeout.
			if id, ok := payload["streamId"].(string); ok && ch.relay != nil {
				ch.relay.Unregister(id)
			}
			ch.hub.Broadcast(MsgError, payload)
		}
	}
}

// Send sends a command to the connected Windows client.
// Returns false if no client is connected.
func (ch *ClientHub) Send(cmd ClientCmd) bool {
	data, err := json.Marshal(cmd)
	if err != nil {
		return false
	}
	ch.mu.RLock()
	c := ch.conn
	ch.mu.RUnlock()
	if c == nil {
		return false
	}
	select {
	case c.send <- data:
		return true
	default:
		return false
	}
}

// IsConnected reports whether a Windows client is currently connected.
func (ch *ClientHub) IsConnected() bool {
	ch.mu.RLock()
	defer ch.mu.RUnlock()
	return ch.conn != nil
}

// Devices returns the last device list reported by the client.
func (ch *ClientHub) Devices() []any {
	ch.mu.RLock()
	defer ch.mu.RUnlock()
	return ch.devices
}

// Status returns the last stream status map reported by the client.
func (ch *ClientHub) Status() map[string]any {
	ch.mu.RLock()
	defer ch.mu.RUnlock()
	out := make(map[string]any, len(ch.status))
	for k, v := range ch.status {
		out[k] = v
	}
	return out
}

func (c *clientConn) writePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		c.ws.Close()
		close(c.done)
	}()
	for {
		select {
		case msg, ok := <-c.send:
			c.ws.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if !ok {
				c.ws.WriteMessage(websocket.CloseMessage, nil)
				return
			}
			if err := c.ws.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			c.ws.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if err := c.ws.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
