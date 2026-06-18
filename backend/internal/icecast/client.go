package icecast

import (
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"strings"
	"time"
)

type Protocol string

const (
	ProtocolIcecast2  Protocol = "icecast2"
	ProtocolShoutcast Protocol = "shoutcast"
)

// ServerConfig contains all parameters needed to connect to an Icecast/Shoutcast server.
type ServerConfig struct {
	Host        string
	Port        int
	Password    string
	MountPoint  string
	Protocol    Protocol
	UseSSL      bool
	ContentType string

	// Stream metadata
	Name        string
	Description string
	Genre       string
	URL         string
	Public      bool
}

// Client manages a connection to an Icecast source.
type Client struct {
	cfg       ServerConfig
	conn      net.Conn
	connected bool
	bytesSent int64
	startTime time.Time
}

// NewClient creates a new Icecast client.
func NewClient(cfg ServerConfig) *Client {
	return &Client{cfg: cfg}
}

// Connect establishes a connection and sends the source headers.
func (c *Client) Connect() error {
	addr := fmt.Sprintf("%s:%d", c.cfg.Host, c.cfg.Port)
	conn, err := net.DialTimeout("tcp", addr, 10*time.Second)
	if err != nil {
		return fmt.Errorf("dial %s: %w", addr, err)
	}
	c.conn = conn

	if c.cfg.Protocol == ProtocolShoutcast {
		err = c.handshakeShoutcast()
	} else {
		err = c.handshakeIcecast2()
	}
	if err != nil {
		c.conn.Close()
		c.conn = nil
		return err
	}

	c.connected = true
	c.startTime = time.Now()
	return nil
}

func (c *Client) handshakeIcecast2() error {
	mount := c.cfg.MountPoint
	if !strings.HasPrefix(mount, "/") {
		mount = "/" + mount
	}

	creds := base64.StdEncoding.EncodeToString([]byte("source:" + c.cfg.Password))

	headers := fmt.Sprintf(
		"PUT %s HTTP/1.0\r\n"+
			"Host: %s:%d\r\n"+
			"Authorization: Basic %s\r\n"+
			"Content-Type: %s\r\n"+
			"Ice-Name: %s\r\n"+
			"Ice-Description: %s\r\n"+
			"Ice-Genre: %s\r\n"+
			"Ice-URL: %s\r\n"+
			"Ice-Public: %d\r\n"+
			"Expect: 100-continue\r\n"+
			"\r\n",
		mount,
		c.cfg.Host, c.cfg.Port,
		creds,
		c.cfg.ContentType,
		c.cfg.Name,
		c.cfg.Description,
		c.cfg.Genre,
		c.cfg.URL,
		boolToInt(c.cfg.Public),
	)

	if _, err := fmt.Fprint(c.conn, headers); err != nil {
		return fmt.Errorf("send headers: %w", err)
	}

	c.conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	buf := make([]byte, 512)
	n, err := c.conn.Read(buf)
	c.conn.SetReadDeadline(time.Time{})
	if err != nil {
		return fmt.Errorf("read server response: %w", err)
	}

	resp := string(buf[:n])
	if !strings.Contains(resp, "100") && !strings.Contains(resp, "200") {
		return fmt.Errorf("server rejected connection: %s", strings.TrimSpace(resp))
	}

	return nil
}

func (c *Client) handshakeShoutcast() error {
	mount := c.cfg.MountPoint
	if !strings.HasPrefix(mount, "/") {
		mount = "/" + mount
	}

	headers := fmt.Sprintf(
		"SOURCE %s ICE/1.0\r\n"+
			"ice-password: %s\r\n"+
			"Content-Type: %s\r\n"+
			"ice-name: %s\r\n"+
			"ice-description: %s\r\n"+
			"ice-genre: %s\r\n"+
			"ice-url: %s\r\n"+
			"ice-public: %d\r\n"+
			"\r\n",
		mount,
		c.cfg.Password,
		c.cfg.ContentType,
		c.cfg.Name,
		c.cfg.Description,
		c.cfg.Genre,
		c.cfg.URL,
		boolToInt(c.cfg.Public),
	)

	if _, err := fmt.Fprint(c.conn, headers); err != nil {
		return fmt.Errorf("send SOURCE headers: %w", err)
	}

	c.conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	buf := make([]byte, 256)
	n, err := c.conn.Read(buf)
	c.conn.SetReadDeadline(time.Time{})
	if err != nil {
		return fmt.Errorf("read server response: %w", err)
	}

	resp := string(buf[:n])
	if !strings.Contains(resp, "OK") && !strings.Contains(resp, "200") {
		return fmt.Errorf("server rejected connection: %s", strings.TrimSpace(resp))
	}

	return nil
}

// Write sends encoded audio data to the Icecast server.
func (c *Client) Write(p []byte) (int, error) {
	if !c.connected || c.conn == nil {
		return 0, fmt.Errorf("not connected")
	}
	n, err := c.conn.Write(p)
	c.bytesSent += int64(n)
	return n, err
}

// Disconnect closes the connection to the server.
func (c *Client) Disconnect() {
	if c.conn != nil {
		c.conn.Close()
		c.conn = nil
	}
	c.connected = false
}

// IsConnected reports whether the client is currently connected.
func (c *Client) IsConnected() bool {
	return c.connected
}

// Stats returns connection statistics.
func (c *Client) Stats() Stats {
	if !c.connected {
		return Stats{}
	}
	return Stats{
		Connected: true,
		Uptime:    time.Since(c.startTime),
		BytesSent: c.bytesSent,
	}
}

// StreamTo reads from src and writes to the Icecast connection until src is exhausted or an error occurs.
func (c *Client) StreamTo(src io.Reader) error {
	buf := make([]byte, 4096)
	for {
		n, err := src.Read(buf)
		if n > 0 {
			if _, werr := c.Write(buf[:n]); werr != nil {
				return fmt.Errorf("write to icecast: %w", werr)
			}
		}
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
	}
}

type Stats struct {
	Connected bool
	Uptime    time.Duration
	BytesSent int64
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
