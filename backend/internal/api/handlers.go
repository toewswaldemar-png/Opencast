//go:build windows

package api

import (
	"encoding/json"
	"net/http"
	"time"

	"opencast/internal/audio"
	"opencast/internal/config"
	"opencast/internal/icecast"
	"opencast/internal/stream"
)

type Server struct {
	manager *stream.Manager
	monitor *stream.Monitor
	hub     *Hub
	store   *config.Store
}

func NewServer(manager *stream.Manager, monitor *stream.Monitor, hub *Hub, store *config.Store) *Server {
	s := &Server{manager: manager, monitor: monitor, hub: hub, store: store}

	manager.SetLevelCallback(func(lvl audio.LevelUpdate) {
		hub.Broadcast(MsgLevel, lvl)
	})
	monitor.SetLevelCallback(func(lvl audio.LevelUpdate) {
		hub.Broadcast(MsgLevel, lvl)
	})

	// Broadcast all stream statuses every second.
	go func() {
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			hub.Broadcast(MsgStatus, manager.Status())
		}
	}()

	return s
}

// GET /api/devices
func (s *Server) HandleDevices(w http.ResponseWriter, r *http.Request) {
	devices, err := audio.EnumerateInputDevices()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, devices)
}

// GET /api/status — returns the full multi-stream status map.
func (s *Server) HandleStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.manager.Status())
}

// POST /api/stream/start
type StartRequest struct {
	StreamID   string               `json:"streamId"` // server-entry ID from frontend
	DeviceID   string               `json:"deviceId"`
	SampleRate uint32               `json:"sampleRate"`
	Channels   uint16               `json:"channels"`
	Format     audio.Format         `json:"format"`
	Bitrate    int                  `json:"bitrate"`
	Server     icecast.ServerConfig `json:"server"`
}

func (s *Server) HandleStart(w http.ResponseWriter, r *http.Request) {
	var req StartRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	if req.StreamID == "" {
		writeError(w, http.StatusBadRequest, "streamId erforderlich")
		return
	}
	if req.SampleRate == 0 {
		req.SampleRate = 44100
	}
	if req.Channels == 0 {
		req.Channels = 2
	}
	if req.Bitrate == 0 {
		req.Bitrate = 192
	}
	if req.Format == "" {
		req.Format = audio.FormatMP3
	}

	// Stop passive monitor for this device so capture isn't blocked.
	if s.monitor.LastConfig().DeviceID == req.DeviceID {
		s.monitor.Stop()
	}

	cfg := stream.Config{
		DeviceID:   req.DeviceID,
		SampleRate: req.SampleRate,
		Channels:   req.Channels,
		Format:     req.Format,
		Bitrate:    req.Bitrate,
		Server:     req.Server,
	}
	if err := s.manager.Start(req.StreamID, cfg); err != nil {
		// Restore monitor on failure if no other stream uses this device.
		if !s.manager.DeviceInUse(req.DeviceID) && s.monitor.HasLastConfig() {
			_ = s.monitor.Start(s.monitor.LastConfig())
		}
		writeError(w, http.StatusInternalServerError, err.Error())
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
	if req.StreamID == "" {
		writeError(w, http.StatusBadRequest, "streamId erforderlich")
		return
	}

	// Remember device before stopping so we can resume the monitor.
	deviceID := s.manager.DeviceIDFor(req.StreamID)
	s.manager.Stop(req.StreamID)

	// Resume passive monitor if nothing else is capturing this device.
	if deviceID != "" && !s.manager.DeviceInUse(deviceID) && s.monitor.HasLastConfig() {
		_ = s.monitor.Start(s.monitor.LastConfig())
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "stopped"})
}

// POST /api/monitor/start
func (s *Server) HandleMonitorStart(w http.ResponseWriter, r *http.Request) {
	var cfg stream.MonitorConfig
	if err := decodeJSON(r, &cfg); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	// Don't start monitor if the device is already captured by a running stream.
	if s.manager.DeviceInUse(cfg.DeviceID) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "streaming"})
		return
	}
	if err := s.monitor.Start(cfg); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// POST /api/monitor/stop
func (s *Server) HandleMonitorStop(w http.ResponseWriter, r *http.Request) {
	s.monitor.Stop()
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// GET /api/config
func (s *Server) HandleConfigGet(w http.ResponseWriter, r *http.Request) {
	cfg := s.store.Get()
	writeJSON(w, http.StatusOK, map[string]any{
		"server":   cfg.Server,
		"encoder":  cfg.Encoder,
		"deviceId": cfg.DeviceID,
		"servers":  cfg.Servers,
	})
}

// PUT /api/config
func (s *Server) HandleConfigPut(w http.ResponseWriter, r *http.Request) {
	var partial struct {
		Server   config.ServerConfig   `json:"server"`
		Encoder  config.EncoderConfig  `json:"encoder"`
		DeviceID string                `json:"deviceId"`
		Servers  []config.ServerEntry  `json:"servers"`
	}
	if err := decodeJSON(r, &partial); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	cfg := s.store.Get()
	cfg.Server = partial.Server
	cfg.Encoder = partial.Encoder
	cfg.DeviceID = partial.DeviceID
	if len(partial.Servers) > 0 {
		cfg.Servers = partial.Servers
	}
	if err := s.store.Set(cfg); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "saved"})
}

// GET /api/formats
func (s *Server) HandleFormats(w http.ResponseWriter, r *http.Request) {
	formats := []map[string]any{
		{"id": "mp3", "name": "MP3", "codec": "libmp3lame", "bitrates": []int{64, 96, 128, 192, 256, 320}},
		{"id": "aac", "name": "AAC", "codec": "aac", "bitrates": []int{64, 96, 128, 192, 256}},
		{"id": "ogg", "name": "OGG Vorbis", "codec": "libvorbis", "bitrates": []int{64, 96, 128, 192, 256}},
	}
	writeJSON(w, http.StatusOK, formats)
}

func decodeJSON(r *http.Request, v any) error {
	return json.NewDecoder(r.Body).Decode(v)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
