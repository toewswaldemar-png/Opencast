package api

import (
	"encoding/json"
	"fmt"
	"net/http"

	"server/internal/config"
	"server/internal/icecast"
	"server/internal/ingest"
)

// Server holds dependencies shared by all HTTP handlers.
type Server struct {
	store     *config.Store
	hub       *Hub
	clientHub *ClientHub
	relay     *ingest.Relay
	baseURL   string // e.g. "http://localhost:8765" — used to build ingest URLs for the client
}

func NewServer(store *config.Store, hub *Hub, clientHub *ClientHub, relay *ingest.Relay, baseURL string) *Server {
	return &Server{
		store:     store,
		hub:       hub,
		clientHub: clientHub,
		relay:     relay,
		baseURL:   baseURL,
	}
}

// GET /api/devices — returns device list from connected Windows client
func (s *Server) HandleDevices(w http.ResponseWriter, r *http.Request) {
	devs := s.clientHub.Devices()
	if devs == nil {
		devs = []any{}
	}
	writeJSON(w, http.StatusOK, devs)
}

// GET /api/status
func (s *Server) HandleStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"clientConnected": s.clientHub.IsConnected(),
		"streams":         s.clientHub.Status(),
	})
}

// POST /api/stream/start
type StartRequest struct {
	StreamID     string              `json:"streamId"`
	DeviceID     string              `json:"deviceId"`
	SampleRate   uint32              `json:"sampleRate"`
	ChannelLeft  uint16              `json:"channelLeft"`
	ChannelRight uint16              `json:"channelRight"`
	Format       string              `json:"format"`
	Bitrate      int                 `json:"bitrate"`
	Server       config.ServerConfig `json:"server"`
}

func (s *Server) HandleStart(w http.ResponseWriter, r *http.Request) {
	var req StartRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body: "+err.Error())
		return
	}
	if req.StreamID == "" {
		writeError(w, http.StatusBadRequest, "streamId erforderlich")
		return
	}
	if !s.clientHub.IsConnected() {
		writeError(w, http.StatusServiceUnavailable, "Windows-Client nicht verbunden")
		return
	}
	if s.relay.IsRegistered(req.StreamID) {
		writeError(w, http.StatusConflict, "stream läuft bereits")
		return
	}

	if req.SampleRate == 0 {
		req.SampleRate = 44100
	}
	if req.ChannelLeft == 0 {
		req.ChannelLeft = 1
	}
	if req.ChannelRight == 0 {
		req.ChannelRight = 2
	}
	if req.Bitrate == 0 {
		req.Bitrate = 192
	}
	if req.Format == "" {
		req.Format = "mp3"
	}

	contentType := formatContentType(req.Format)
	ingestURL := fmt.Sprintf("%s/ingest/%s", s.baseURL, req.StreamID)

	// Read global settings (autoReconnect) from stored config.
	storedCfg := s.store.Get()
	autoReconnect := storedCfg.AutoReconnect != nil && *storedCfg.AutoReconnect

	s.relay.Register(req.StreamID, ingest.StreamConfig{
		IcecastCfg: icecast.ServerConfig{
			Host:        req.Server.Host,
			Port:        req.Server.Port,
			Username:    req.Server.Username,
			Password:    req.Server.Password,
			MountPoint:  req.Server.MountPoint,
			Protocol:    icecast.Protocol(req.Server.Protocol),
			UseSSL:      req.Server.UseSSL,
			Name:        req.Server.Name,
			Description: req.Server.Description,
			Genre:       req.Server.Genre,
			URL:         req.Server.URL,
			Public:      req.Server.Public,
		},
		ContentType:   contentType,
		AutoReconnect: autoReconnect,
		Bitrate:       req.Bitrate,
	})

	sent := s.clientHub.Send(ClientCmd{
		Type: "cmd:start",
		Payload: CmdStartPayload{
			StreamID:     req.StreamID,
			DeviceID:     req.DeviceID,
			IngestURL:    ingestURL,
			Format:       req.Format,
			Bitrate:      req.Bitrate,
			SampleRate:   req.SampleRate,
			ChannelLeft:  req.ChannelLeft,
			ChannelRight: req.ChannelRight,
		},
	})
	if !sent {
		s.relay.Unregister(req.StreamID)
		writeError(w, http.StatusServiceUnavailable, "Windows-Client nicht erreichbar")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "started"})
}

// POST /api/stream/stop
type StopRequest struct {
	StreamID string `json:"streamId"`
}

func (s *Server) HandleStop(w http.ResponseWriter, r *http.Request) {
	var req StopRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.relay.Unregister(req.StreamID)
	s.clientHub.Send(ClientCmd{
		Type:    "cmd:stop",
		Payload: CmdStopPayload{StreamID: req.StreamID},
	})
	writeJSON(w, http.StatusOK, map[string]string{"status": "stopped"})
}

// POST /api/stream/metadata — sends now-playing title to Icecast
func (s *Server) HandleMetadata(w http.ResponseWriter, r *http.Request) {
	var req struct {
		StreamID string `json:"streamId"`
		Title    string `json:"title"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.relay.UpdateMetadata(req.StreamID, req.Title); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// POST /api/monitor/start
func (s *Server) HandleMonitorStart(w http.ResponseWriter, r *http.Request) {
	var cfg CmdMonitorPayload
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	// Block only if THIS card's stream is active (each card has its own monitor).
	// Fall back to the global guard when no monitorId is present (legacy/safety).
	blocked := false
	if cfg.MonitorID != "" {
		blocked = s.relay.IsRegistered(cfg.MonitorID)
	} else {
		blocked = s.relay.HasRegisteredStreams()
	}
	if !blocked {
		s.clientHub.Send(ClientCmd{Type: "cmd:monitor:start", Payload: cfg})
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// POST /api/monitor/stop
func (s *Server) HandleMonitorStop(w http.ResponseWriter, r *http.Request) {
	s.clientHub.Send(ClientCmd{Type: "cmd:monitor:stop", Payload: nil})
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// POST /api/asio/panel
func (s *Server) HandleAsioPanel(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DeviceID string `json:"deviceId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !s.clientHub.IsConnected() {
		writeError(w, http.StatusServiceUnavailable, "Windows-Client nicht verbunden")
		return
	}
	s.clientHub.Send(ClientCmd{Type: "cmd:asio:panel", Payload: map[string]string{"deviceId": req.DeviceID}})
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// GET /api/config
func (s *Server) HandleConfigGet(w http.ResponseWriter, r *http.Request) {
	cfg := s.store.Get()
	out := map[string]any{
		"servers": cfg.Servers,
	}
	if cfg.DeviceID != "" {
		out["deviceId"] = cfg.DeviceID
	}
	if cfg.Encoder != nil {
		out["encoder"] = cfg.Encoder
	}
	if cfg.AutoReconnect != nil {
		out["autoReconnect"] = *cfg.AutoReconnect
	}
	writeJSON(w, http.StatusOK, out)
}

// PUT /api/config
func (s *Server) HandleConfigPut(w http.ResponseWriter, r *http.Request) {
	var partial struct {
		Servers       []config.ServerEntry  `json:"servers"`
		DeviceID      string                `json:"deviceId"`
		Encoder       *config.EncoderConfig `json:"encoder"`
		AutoReconnect *bool                 `json:"autoReconnect"`
	}
	if err := json.NewDecoder(r.Body).Decode(&partial); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	cfg := s.store.Get()
	if len(partial.Servers) > 0 {
		cfg.Servers = partial.Servers
	}
	if partial.DeviceID != "" {
		cfg.DeviceID = partial.DeviceID
	}
	if partial.Encoder != nil {
		cfg.Encoder = partial.Encoder
	}
	if partial.AutoReconnect != nil {
		cfg.AutoReconnect = partial.AutoReconnect
	}
	if err := s.store.Set(cfg); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "saved"})
}

// GET /api/formats
func (s *Server) HandleFormats(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, []map[string]any{
		{"id": "mp3", "name": "MP3", "codec": "libmp3lame", "bitrates": []int{64, 96, 128, 192, 256, 320}},
		{"id": "aac", "name": "AAC", "codec": "aac", "bitrates": []int{64, 96, 128, 192, 256}},
		{"id": "ogg", "name": "OGG Vorbis", "codec": "libvorbis", "bitrates": []int{64, 96, 128, 192, 256}},
	})
}

func formatContentType(format string) string {
	switch format {
	case "mp3":
		return "audio/mpeg"
	case "aac":
		return "audio/aac"
	case "ogg":
		return "audio/ogg"
	default:
		return "audio/mpeg"
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
