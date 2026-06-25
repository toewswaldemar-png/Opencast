//go:build windows

package wsclient

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
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
	StreamID     string `json:"streamId"`
	DeviceID     string `json:"deviceId"`
	IngestURL    string `json:"ingestUrl"`
	Format       string `json:"format"`
	Bitrate      int    `json:"bitrate"`
	SampleRate   uint32 `json:"sampleRate"`
	ChannelLeft  uint16 `json:"channelLeft"`
	ChannelRight uint16 `json:"channelRight"`
}

// CmdStopPayload tells the client to stop a stream.
type CmdStopPayload struct {
	StreamID string `json:"streamId"`
}

// CmdMonitorPayload for monitor start/stop.
type CmdMonitorPayload struct {
	MonitorID    string `json:"monitorId"`  // card entry ID — used to route level updates back
	DeviceID     string `json:"deviceId"`
	SampleRate   uint32 `json:"sampleRate"`
	ChannelLeft  uint16 `json:"channelLeft"`
	ChannelRight uint16 `json:"channelRight"`
}

// Handlers are the callbacks invoked when the server sends commands.
type Handlers struct {
	OnStart        func(CmdStartPayload)
	OnStop         func(CmdStopPayload)
	OnMonitorStart func(CmdMonitorPayload)
	OnMonitorStop  func()
	OnAsioPanel    func(deviceID string)
	OnConnected    func()
	OnDisconnected func()
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
	if c.handlers.OnConnected != nil {
		c.handlers.OnConnected()
	}

	// Send device list immediately on connect
	c.sendDevices()

	// Read loop
	connDone := make(chan struct{})
	defer func() {
		close(connDone)
		c.mu.Lock()
		c.conn = nil
		c.mu.Unlock()
		conn.Close()
		log.Println("[ws] Verbindung getrennt")
		if c.handlers.OnDisconnected != nil {
			c.handlers.OnDisconnected()
		}
	}()

	// Heartbeat: keep the server's 90s read deadline alive when the client is idle.
	// The server only resets its deadline on TEXT messages — Pong control frames don't count.
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				c.Send("heartbeat", nil)
			case <-connDone:
				return
			case <-ctx.Done():
				return
			}
		}
	}()

	conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	// Server sends pings every 30s; reset our read deadline on each ping so we don't time out.
	conn.SetPingHandler(func(msg string) error {
		conn.SetReadDeadline(time.Now().Add(90 * time.Second))
		return conn.WriteControl(websocket.PongMessage, []byte(msg), time.Now().Add(5*time.Second))
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
	log.Printf("[ws] cmd: %s payload=%s", cmd.Type, string(cmd.Payload))
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
// The mutex is held for the entire write because gorilla/websocket does not
// allow concurrent WriteMessage calls.
func (c *Client) Send(msgType string, payload any) {
	data, err := json.Marshal(map[string]any{"type": msgType, "payload": payload})
	if err != nil {
		return
	}
	c.mu.Lock()
	conn := c.conn
	if conn != nil {
		conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		conn.WriteMessage(websocket.TextMessage, data)
	}
	c.mu.Unlock()
}

func (c *Client) sendDevices() {
	devs, err := audio.EnumerateInputDevices()
	if err != nil {
		log.Printf("[ws] Geräteliste: %v", err)
		devs = []audio.Device{}
	}
	c.Send("devices", devs)
}

// SendDevices re-enumerates audio devices and pushes the updated list to the server.
// Call this after an ASIO control panel is closed so changed channel counts are reflected.
func (c *Client) SendDevices() {
	c.sendDevices()
}

// SendLevel sends a VU level update to the server.
func (c *Client) SendLevel(streamID string, lvl audio.LevelUpdate) {
	c.Send("stream:level", map[string]any{
		"streamId": streamID,
		"left":     lvl.Left,
		"right":    lvl.Right,
	})
}

// SendMonitorLevel sends a monitor VU level update tagged with the card ID.
func (c *Client) SendMonitorLevel(monitorID string, lvl audio.LevelUpdate) {
	c.Send("monitor:level", map[string]any{
		"monitorId": monitorID,
		"left":      lvl.Left,
		"right":     lvl.Right,
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

// ingestClient is a dedicated HTTP client for PUT /ingest requests.
// DisableKeepAlives forces a fresh TCP connection per stream — prevents the
// ~11 s startup delay that http.DefaultClient's keep-alive pool caused when
// Windows took up to 11 s to signal a stale connection's TCP RST.
var ingestClient = &http.Client{
	Transport: &http.Transport{
		DisableKeepAlives: true,
		DialContext:       (&net.Dialer{Timeout: 30 * time.Second}).DialContext,
	},
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
		buf := make([]byte, 32*1024)
		for {
			n, rerr := src.Read(buf)
			if n > 0 {
				if _, werr := pw.Write(buf[:n]); werr != nil {
					pw.CloseWithError(werr)
					done <- werr
					return
				}
			}
			if rerr != nil {
				pw.CloseWithError(rerr)
				if rerr == io.EOF {
					rerr = nil
				}
				done <- rerr
				return
			}
		}
	}()

	t0 := time.Now()
	resp, err := ingestClient.Do(req)
	if err != nil {
		pr.CloseWithError(err)
		<-done
		return fmt.Errorf("ingest PUT: %w", err)
	}
	log.Printf("[ingest] PUT %s → HTTP %d (nach %v)", ingestURL, resp.StatusCode, time.Since(t0).Round(time.Millisecond))
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		var je struct{ Error string `json:"error"` }
		errMsg := fmt.Sprintf("HTTP %d", resp.StatusCode)
		if json.Unmarshal(body, &je) == nil && je.Error != "" {
			errMsg = je.Error
		}
		pr.CloseWithError(fmt.Errorf("%s", errMsg))
		<-done
		return fmt.Errorf("%s", errMsg)
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
