package api

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type MessageType string

const (
	MsgLevel  MessageType = "level"
	MsgStatus MessageType = "status"
	MsgError  MessageType = "error"
)

type WSMessage struct {
	Type    MessageType `json:"type"`
	Payload any         `json:"payload"`
}

// Hub manages all WebSocket connections and broadcasts messages to them.
type Hub struct {
	mu      sync.RWMutex
	clients map[*wsClient]struct{}
}

type wsClient struct {
	conn   *websocket.Conn
	send   chan []byte
	closed chan struct{}
}

func NewHub() *Hub {
	return &Hub{clients: make(map[*wsClient]struct{})}
}

// ServeWS upgrades an HTTP connection to WebSocket and registers the client.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws upgrade: %v", err)
		return
	}

	client := &wsClient{
		conn:   conn,
		send:   make(chan []byte, 64),
		closed: make(chan struct{}),
	}

	h.mu.Lock()
	h.clients[client] = struct{}{}
	h.mu.Unlock()

	go client.writePump()
	go client.readPump(func() {
		h.mu.Lock()
		delete(h.clients, client)
		h.mu.Unlock()
	})
}

// Broadcast sends a message to all connected clients.
func (h *Hub) Broadcast(msgType MessageType, payload any) {
	msg := WSMessage{Type: msgType, Payload: payload}
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	for client := range h.clients {
		select {
		case client.send <- data:
		default:
		}
	}
}

func (c *wsClient) writePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
		close(c.closed)
	}()

	for {
		select {
		case msg, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, nil)
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *wsClient) readPump(onClose func()) {
	defer func() {
		onClose()
		c.conn.Close()
	}()

	c.conn.SetReadLimit(512)
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			break
		}
	}
}
