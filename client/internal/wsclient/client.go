//go:build windows

package wsclient

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"client/internal/audio"
	"github.com/gorilla/websocket"
)

// Cmd is a command received from the server.
type Cmd struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

// CmdStartPayload tells the client to start a stream.
type CmdStartPayload struct {
	StreamID   string `json:"streamId"`
	DeviceID   string `json:"deviceId"`
	IngestURL  string `json:"ingestUrl"`
	Format     string `json:"format"`
	Bitrate    int    `json:"bitrate"`
	SampleRate uint32 `json:"sampleRate"`
	Channels   uint16 `json:"channels"`
}

// CmdStopPayload tells the client to stop a stream.
type CmdStopPayload struct {
	StreamID string `json:"streamId"`
}

// CmdMonitorPayload for monitor start/stop.
type CmdMonitorPayload struct {
	DeviceID   string `json:"deviceId"`
	SampleRate uint32 `json:"sampleRate"`
	Channels   uint16 `json:"channels"`
}

// Handlers are the callbacks invoked when the server sends commands.
type Handlers struct {
	OnStart        func(CmdStartPayload)
	OnStop         func(CmdStopPayload)
	OnMonitorStart func(CmdMonitorPayload)
	OnMonitorStop  func()
	OnAsioPanel    func(deviceID string)
}

// Client manages a persistent WebSocket connection to the server.
type Client struct {
	serverURL string
	handlers  Handlers

	mu   sync.Mutex
	conn *websocket.Conn
}

func New(serverURL string, handlers Handlers) *Client {
	return &Client{serverURL: serverURL, handlers: handlers}
}

// Run connects to the server and reconnects on disconnect. Blocks until ctx is cancelled.
func (c *Client) Run(ctx context.Context) {
	for {
		if err := c.connect(ctx); err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Printf("[ws] Verbindung fehlgeschlagen: %v — Retry in 5s", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(5 * time.Second):
		}
	}
}

func (c *Client) connect(ctx context.Context) error {
	wsURL := strings.Replace(c.serverURL, "http://", "ws://", 1)
	wsURL = strings.Replace(wsURL, "https://", "wss://", 1)
	wsURL += "/ws/client"

	conn, _, err := websocket.DefaultDialer.DialContext(ctx, wsURL, nil)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}

	c.mu.Lock()
	c.conn = conn
	c.mu.Unlock()

	log.Printf("[ws] Verbunden mit %s", c.serverURL)

	// Send device list immediately on connect
	log.Printf("[ws] sendDevices: start")
	c.sendDevices()
	log.Printf("[ws] sendDevices: done")

	// Read loop
	defer func() {
		c.mu.Lock()
		c.conn = nil
		c.mu.Unlock()
		conn.Close()
		log.Println("[ws] Verbindung getrennt")
	}()

	conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(90 * time.Second))
		return nil
	})

	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return fmt.Errorf("read: %w", err)
		}
		conn.SetReadDeadline(time.Now().Add(90 * time.Second))

		var cmd Cmd
		if err := json.Unmarshal(raw, &cmd); err != nil {
			continue
		}
		c.handleCmd(cmd)
	}
}

func (c *Client) handleCmd(cmd Cmd) {
	switch cmd.Type {
	case "cmd:start":
		var p CmdStartPayload
		if err := json.Unmarshal(cmd.Payload, &p); err == nil && c.handlers.OnStart != nil {
			c.handlers.OnStart(p)
		}
	case "cmd:stop":
		var p CmdStopPayload
		if err := json.Unmarshal(cmd.Payload, &p); err == nil && c.handlers.OnStop != nil {
			c.handlers.OnStop(p)
		}
	case "cmd:monitor:start":
		var p CmdMonitorPayload
		if err := json.Unmarshal(cmd.Payload, &p); err == nil && c.handlers.OnMonitorStart != nil {
			c.handlers.OnMonitorStart(p)
		}
	case "cmd:monitor:stop":
		if c.handlers.OnMonitorStop != nil {
			c.handlers.OnMonitorStop()
		}
	case "cmd:asio:panel":
		var p struct {
			DeviceID string `json:"deviceId"`
		}
		if err := json.Unmarshal(cmd.Payload, &p); err == nil && c.handlers.OnAsioPanel != nil {
			c.handlers.OnAsioPanel(p.DeviceID)
		}
	}
}

// Send sends a message to the server.
func (c *Client) Send(msgType string, payload any) {
	data, err := json.Marshal(map[string]any{"type": msgType, "payload": payload})
	if err != nil {
		return
	}
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()
	if conn == nil {
		return
	}
	conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	conn.WriteMessage(websocket.TextMessage, data)
}

func (c *Client) sendDevices() {
	devs, err := audio.EnumerateInputDevices()
	if err != nil {
		log.Printf("[ws] Geräteliste: %v", err)
		devs = []audio.Device{}
	}
	c.Send("devices", devs)
}

// SendLevel sends a VU level update to the server.
func (c *Client) SendLevel(streamID string, lvl audio.LevelUpdate) {
	c.Send("stream:level", map[string]any{
		"streamId": streamID,
		"left":     lvl.Left,
		"right":    lvl.Right,
	})
}

// SendMonitorLevel sends a monitor VU level update.
func (c *Client) SendMonitorLevel(lvl audio.LevelUpdate) {
	c.Send("monitor:level", map[string]any{
		"left":  lvl.Left,
		"right": lvl.Right,
	})
}

// SendStatus sends a stream status update.
func (c *Client) SendStatus(streamID string, running, connected bool, bytesSent int64, uptime time.Duration) {
	c.Send("stream:status", map[string]any{
		"streamId":  streamID,
		"running":   running,
		"connected": connected,
		"bytesSent": bytesSent,
		"uptime":    uptime.Nanoseconds(),
	})
}

// SendError sends a stream error.
func (c *Client) SendError(streamID, msg string) {
	c.Send("stream:error", map[string]any{
		"streamId": streamID,
		"message":  msg,
	})
}

// PutIngest streams encoded audio to the server's ingest endpoint.
// It blocks until the stream ends (src closed, context cancelled, or network error).
func PutIngest(ctx context.Context, ingestURL, contentType string, src io.Reader) error {
	pr, pw := io.Pipe()

	req, err := http.NewRequestWithContext(ctx, http.MethodPut, ingestURL, pr)
	if err != nil {
		pr.CloseWithError(err)
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", contentType)

	done := make(chan error, 1)
	go func() {
		_, err := io.Copy(pw, src)
		pw.CloseWithError(err)
		done <- err
	}()

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		pr.CloseWithError(err)
		<-done
		return fmt.Errorf("ingest PUT: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		pr.CloseWithError(fmt.Errorf("server returned %d", resp.StatusCode))
		<-done
		return fmt.Errorf("ingest server returned %d", resp.StatusCode)
	}

	// Block until the stream ends: src exhausted (encoder closed), context
	// cancelled, or a network error — whichever comes first.
	if err := <-done; err != nil && ctx.Err() == nil {
		return err
	}
	return nil
}

// BuildIngestURL constructs the absolute ingest URL given a server base URL and stream ID.
func BuildIngestURL(serverURL, streamID string) string {
	u, err := url.Parse(serverURL)
	if err != nil {
		return serverURL + "/ingest/" + streamID
	}
	u.Path = "/ingest/" + streamID
	return u.String()
}
