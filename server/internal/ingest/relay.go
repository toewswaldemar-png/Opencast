package ingest

import (
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"server/internal/icecast"
)

// StreamConfig is stored when a start command is issued.
type StreamConfig struct {
	IcecastCfg  icecast.ServerConfig
	ContentType string
}

// StatusUpdate is sent to the registered callback when a stream's ingest status changes.
type StatusUpdate struct {
	StreamID     string
	Connected    bool
	BytesSent    int64
	Uptime       time.Duration
}

// Relay accepts audio streams from the Windows client and relays them to Icecast.
type Relay struct {
	mu       sync.Mutex
	pending  map[string]StreamConfig
	active   map[string]*activeStream
	statusCb func(StatusUpdate)
}

type activeStream struct {
	ice       *icecast.Client
	startedAt time.Time
	bytesSent int64
}

func NewRelay() *Relay {
	return &Relay{
		pending: make(map[string]StreamConfig),
		active:  make(map[string]*activeStream),
	}
}

func (r *Relay) SetStatusCallback(cb func(StatusUpdate)) {
	r.mu.Lock()
	r.statusCb = cb
	r.mu.Unlock()
}

// IsRegistered reports whether a stream is pending or actively ingesting.
func (r *Relay) IsRegistered(streamID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	_, inPending := r.pending[streamID]
	_, inActive := r.active[streamID]
	return inPending || inActive
}

// Register stores a stream config, making it ready for an ingest connection.
func (r *Relay) Register(streamID string, cfg StreamConfig) {
	r.mu.Lock()
	r.pending[streamID] = cfg
	r.mu.Unlock()
}

// Unregister removes a pending or terminates an active ingest stream.
func (r *Relay) Unregister(streamID string) {
	r.mu.Lock()
	delete(r.pending, streamID)
	as := r.active[streamID]
	r.mu.Unlock()
	if as != nil {
		as.ice.Disconnect()
	}
}

// HandleIngest is the HTTP handler for PUT /ingest/{streamId}.
func (r *Relay) HandleIngest(w http.ResponseWriter, req *http.Request) {
	// Extract streamId from path (last segment)
	streamID := streamIDFromPath(req.URL.Path)
	if streamID == "" {
		http.Error(w, "missing streamId", http.StatusBadRequest)
		return
	}

	r.mu.Lock()
	cfg, ok := r.pending[streamID]
	r.mu.Unlock()
	if !ok {
		http.Error(w, fmt.Sprintf("stream %q not registered", streamID), http.StatusNotFound)
		return
	}

	iceCfg := cfg.IcecastCfg
	iceCfg.ContentType = cfg.ContentType
	ice := icecast.NewClient(iceCfg)

	if err := ice.Connect(); err != nil {
		log.Printf("[ingest/%s] Icecast connect failed: %v", streamID, err)
		http.Error(w, "icecast connect failed: "+err.Error(), http.StatusBadGateway)
		return
	}

	as := &activeStream{ice: ice, startedAt: time.Now()}
	r.mu.Lock()
	delete(r.pending, streamID)
	r.active[streamID] = as
	r.mu.Unlock()

	log.Printf("[ingest/%s] relay started → %s:%d%s", streamID, iceCfg.Host, iceCfg.Port, iceCfg.MountPoint)

	r.notify(StatusUpdate{StreamID: streamID, Connected: true})

	// Respond 200 OK so the client knows we're ready
	w.WriteHeader(http.StatusOK)
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}

	buf := make([]byte, 4096)
	for {
		n, err := req.Body.Read(buf)
		if n > 0 {
			if _, werr := ice.Write(buf[:n]); werr != nil {
				log.Printf("[ingest/%s] icecast write error: %v", streamID, werr)
				break
			}
			r.mu.Lock()
			as.bytesSent += int64(n)
			r.mu.Unlock()
		}
		if err != nil {
			break
		}
	}

	ice.Disconnect()

	r.mu.Lock()
	delete(r.active, streamID)
	r.mu.Unlock()

	log.Printf("[ingest/%s] relay stopped", streamID)
	r.notify(StatusUpdate{StreamID: streamID, Connected: false})
}

// ActiveStats returns current statistics for an active stream.
func (r *Relay) ActiveStats(streamID string) (StatusUpdate, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	as, ok := r.active[streamID]
	if !ok {
		return StatusUpdate{}, false
	}
	return StatusUpdate{
		StreamID:  streamID,
		Connected: true,
		BytesSent: as.bytesSent,
		Uptime:    time.Since(as.startedAt),
	}, true
}

func (r *Relay) notify(u StatusUpdate) {
	r.mu.Lock()
	cb := r.statusCb
	r.mu.Unlock()
	if cb != nil {
		cb(u)
	}
}

func streamIDFromPath(path string) string {
	// path is like /ingest/{streamId}
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' {
			return path[i+1:]
		}
	}
	return path
}
