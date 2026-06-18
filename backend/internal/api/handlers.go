//go:build windows

package api

import (
	"encoding/json"
	"net/http"
	"time"

	"opencast/internal/audio"
	"opencast/internal/icecast"
	"opencast/internal/stream"
)

type Server struct {
	manager *stream.Manager
	monitor *stream.Monitor
	hub     *Hub
}

func NewServer(manager *stream.Manager, monitor *stream.Monitor, hub *Hub) *Server {
	s := &Server{manager: manager, monitor: monitor, hub: hub}

	manager.SetLevelCallback(func(lvl audio.LevelUpdate) {
		hub.Broadcast(MsgLevel, lvl)
	})
	monitor.SetLevelCallback(func(lvl audio.LevelUpdate) {
		hub.Broadcast(MsgLevel, lvl)
	})

	// Periodically broadcast stream status
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

// GET /api/status
func (s *Server) HandleStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.manager.Status())
}

// POST /api/stream/start
type StartRequest struct {
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

	cfg := stream.Config{
		DeviceID:   req.DeviceID,
		SampleRate: req.SampleRate,
		Channels:   req.Channels,
		Format:     req.Format,
		Bitrate:    req.Bitrate,
		Server:     req.Server,
	}

	s.monitor.Stop()

	if err := s.manager.Start(cfg); err != nil {
		// Resume monitoring on failure
		_ = s.monitor.Start(stream.MonitorConfig{
			DeviceID:   req.DeviceID,
			SampleRate: req.SampleRate,
			Channels:   req.Channels,
		})
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "started"})
}

// POST /api/stream/stop
func (s *Server) HandleStop(w http.ResponseWriter, r *http.Request) {
	s.manager.Stop()
	// Resume level monitoring after stream ends
	if s.monitor.HasLastConfig() {
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
	if s.manager.IsRunning() {
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
