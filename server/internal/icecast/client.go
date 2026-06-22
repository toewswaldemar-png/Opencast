package icecast

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Protocol string

const (
	ProtocolIcecast2  Protocol = "icecast2"
	ProtocolShoutcast Protocol = "shoutcast"
)

type ServerConfig struct {
	Host        string
	Port        int
	Username    string // source username; defaults to "source" if empty
	Password    string
	MountPoint  string
	Protocol    Protocol
	UseSSL      bool
	ContentType string

	Name        string
	Description string
	Genre       string
	URL         string
	Public      bool
}

type Client struct {
	cfg       ServerConfig
	conn      net.Conn
	connected bool
	bytesSent int64
	startTime time.Time
}

func NewClient(cfg ServerConfig) *Client {
	return &Client{cfg: cfg}
}

func (c *Client) Connect() error {
	host := c.cfg.Host
	port := strconv.Itoa(c.cfg.Port)

	// Prefer IPv4 when resolving hostnames like "localhost" — many Icecast
	// installations only bind 127.0.0.1, not [::1], so dialing tcp with the
	// default resolver order (which picks IPv6 first on Windows) would fail.
	if addrs, err := net.LookupHost(host); err == nil {
		for _, a := range addrs {
			if net.ParseIP(a).To4() != nil {
				host = a
				break
			}
		}
	}

	addr := net.JoinHostPort(host, port)
	conn, err := net.DialTimeout("tcp", addr, 10*time.Second)
	if err != nil {
		return fmt.Errorf("dial %s:%s: %w", c.cfg.Host, port, err)
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

func (c *Client) username() string {
	if c.cfg.Username != "" {
		return c.cfg.Username
	}
	return "source"
}

func (c *Client) handshakeIcecast2() error {
	mount := c.cfg.MountPoint
	if !strings.HasPrefix(mount, "/") {
		mount = "/" + mount
	}

	creds := base64.StdEncoding.EncodeToString([]byte(c.username() + ":" + c.cfg.Password))

	// Icecast requires Expect: 100-continue so it sends "100 Continue" before
	// the source starts streaming. Without it, Icecast waits for body data before
	// responding → deadlock.  After "100 Continue" Icecast also sends "200 OK"
	// once the mount is ready. We must read BOTH so the TCP receive buffer stays
	// empty and Icecast considers the handshake complete (skipping "200 OK" was
	// the cause of the ~11 s source-timeout disconnect).
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

	// Read the first response. Icecast sends "HTTP/1.0 100 Continue" and then
	// starts accepting audio data immediately — it does NOT send a "200 OK"
	// before the source starts streaming.
	c.conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	code, err := readHTTPStatus(c.conn)
	c.conn.SetReadDeadline(time.Time{})
	if err != nil {
		return fmt.Errorf("read server response: %w", err)
	}
	if code != 100 && code != 200 {
		return fmt.Errorf("server rejected connection: HTTP %d", code)
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

	c.conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	code, err := readHTTPStatus(c.conn)
	c.conn.SetReadDeadline(time.Time{})
	if err != nil {
		return fmt.Errorf("read server response: %w", err)
	}
	if code != 200 {
		return fmt.Errorf("server rejected connection: HTTP %d", code)
	}
	return nil
}

func (c *Client) Write(p []byte) (int, error) {
	if !c.connected || c.conn == nil {
		return 0, fmt.Errorf("not connected")
	}
	n, err := c.conn.Write(p)
	c.bytesSent += int64(n)
	return n, err
}

func (c *Client) Disconnect() {
	if c.conn != nil {
		c.conn.Close()
		c.conn = nil
	}
	c.connected = false
}

type Stats struct {
	Connected bool
	Uptime    time.Duration
	BytesSent int64
}

func (c *Client) Stats() Stats {
	if !c.connected {
		return Stats{}
	}
	return Stats{Connected: true, Uptime: time.Since(c.startTime), BytesSent: c.bytesSent}
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// readHTTPStatus reads an HTTP response line by line until the blank line that
// terminates the headers, and returns the numeric status code.
// Reading byte-by-byte avoids over-reading into the audio stream that follows.
func readHTTPStatus(r io.Reader) (int, error) {
	buf := make([]byte, 1)
	var line []byte
	code := 0
	for {
		n, err := r.Read(buf)
		if n > 0 {
			if buf[0] == '\n' {
				l := strings.TrimRight(string(line), "\r")
				line = line[:0]
				if l == "" {
					break // blank line = end of response headers
				}
				fields := strings.Fields(l)
				if len(fields) >= 2 &&
					(strings.HasPrefix(fields[0], "HTTP/") || strings.HasPrefix(fields[0], "ICY")) {
					code, _ = strconv.Atoi(fields[1])
				}
			} else {
				line = append(line, buf[0])
			}
		}
		if err != nil {
			if err == io.EOF {
				break
			}
			return 0, err
		}
	}
	return code, nil
}

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

// UpdateMetadata sends a now-playing title update via Icecast's admin metadata endpoint.
// Uses the source credentials (username:password) for Basic auth.
func (c *Client) UpdateMetadata(title string) error {
	scheme := "http"
	if c.cfg.UseSSL {
		scheme = "https"
	}

	params := url.Values{}
	params.Set("mount", c.cfg.MountPoint)
	params.Set("mode", "updinfo")
	params.Set("song", title)

	reqURL := fmt.Sprintf("%s://%s:%d/admin/metadata?%s", scheme, c.cfg.Host, c.cfg.Port, params.Encode())

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return fmt.Errorf("build metadata request: %w", err)
	}
	req.SetBasicAuth(c.username(), c.cfg.Password)
	req.Header.Set("User-Agent", "Opencast/2.0")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("metadata request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("metadata update: HTTP %d", resp.StatusCode)
	}
	return nil
}

// icecastStatsSource is one source entry from Icecast's /status-json.xsl.
type icecastStatsSource struct {
	Listeners int    `json:"listeners"`
	Listenurl string `json:"listenurl"`
}

// ListenerCount queries Icecast's /status-json.xsl and returns the listener count
// for this client's mount point. Returns 0 (not an error) if the endpoint is
// unreachable or the mount is not listed.
func (c *Client) ListenerCount() (int, error) {
	scheme := "http"
	if c.cfg.UseSSL {
		scheme = "https"
	}
	reqURL := fmt.Sprintf("%s://%s:%d/status-json.xsl", scheme, c.cfg.Host, c.cfg.Port)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return 0, err
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	var raw struct {
		Icestats struct {
			Source json.RawMessage `json:"source"`
		} `json:"icestats"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return 0, err
	}

	// Icecast returns a single object when there's one source, array for multiple.
	var sources []icecastStatsSource
	if err := json.Unmarshal(raw.Icestats.Source, &sources); err != nil {
		var single icecastStatsSource
		if err := json.Unmarshal(raw.Icestats.Source, &single); err != nil {
			return 0, nil
		}
		sources = []icecastStatsSource{single}
	}

	mount := c.cfg.MountPoint
	if !strings.HasPrefix(mount, "/") {
		mount = "/" + mount
	}
	for _, src := range sources {
		if strings.HasSuffix(src.Listenurl, mount) {
			return src.Listeners, nil
		}
	}
	return 0, nil
}
