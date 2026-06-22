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
	IcecastCfg    icecast.ServerConfig
	ContentType   string
	AutoReconnect bool
	Bitrate       int // configured bitrate in kbps, for status reporting
}

// StatusUpdate is sent to the registered callback when a stream's status changes.
type StatusUpdate struct {
	StreamID     string
	Connected    bool
	Reconnecting bool
	BytesSent    int64
	Uptime       time.Duration
	Listeners    int
	Bitrate      int
}

// Relay accepts audio streams from the Windows client and relays them to Icecast.
type Relay struct {
	mu       sync.Mutex
	pending  map[string]StreamConfig
	active   map[string]*activeStream
	statusCb func(StatusUpdate)
}

type activeStream struct {
	ice          *icecast.Client
	cfg          StreamConfig
	startedAt    time.Time
	bytesSent    int64
	reconnecting bool // protected by relay mu
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
// If no PUT /ingest arrives within 10 s, the entry is removed automatically.
func (r *Relay) Register(streamID string, cfg StreamConfig) {
	r.mu.Lock()
	r.pending[streamID] = cfg
	r.mu.Unlock()

	go func() {
		time.Sleep(30 * time.Second)
		r.mu.Lock()
		if _, still := r.pending[streamID]; still {
			delete(r.pending, streamID)
			log.Printf("[ingest/%s] pending timed out — kein PUT vom Client empfangen", streamID)
		}
		r.mu.Unlock()
	}()
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

// UpdateMetadata sends a now-playing title to Icecast for an active stream.
func (r *Relay) UpdateMetadata(streamID, title string) error {
	r.mu.Lock()
	as := r.active[streamID]
	r.mu.Unlock()
	if as == nil {
		return fmt.Errorf("stream %q not active", streamID)
	}
	return as.ice.UpdateMetadata(title)
}

// HandleIngest is the HTTP handler for PUT /ingest/{streamId}.
func (r *Relay) HandleIngest(w http.ResponseWriter, req *http.Request) {
	streamID := streamIDFromPath(req.URL.Path)
	log.Printf("[ingest/%s] PUT empfangen um %s", streamID, time.Now().Format("15:04:05.000"))
	if streamID == "" {
		http.Error(w, "missing streamId", http.StatusBadRequest)
		return
	}

	r.mu.Lock()
	cfg, ok := r.pending[streamID]
	if ok {
		delete(r.pending, streamID)
	}
	r.mu.Unlock()
	if !ok {
		http.Error(w, fmt.Sprintf("stream %q not registered", streamID), http.StatusNotFound)
		return
	}

	// Accept immediately so the Windows client starts sending audio right away.
	// Icecast is connected lazily on the first audio chunk — this eliminates the
	// startup gap between source-connect and first data that triggers source-timeout.
	w.WriteHeader(http.StatusOK)
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}

	// Reader goroutine: continuously drains req.Body → dataCh.
	// Non-blocking send prevents back-pressure on the Windows client during reconnects.
	dataCh := make(chan []byte, 32)
	go func() {
		defer close(dataCh)
		buf := make([]byte, 4096)
		for {
			n, err := req.Body.Read(buf)
			if n > 0 {
				chunk := make([]byte, n)
				copy(chunk, buf[:n])
				select {
				case dataCh <- chunk:
				default:
					// channel full (reconnecting) — discard to prevent back-pressure
				}
			}
			if err != nil {
				return
			}
		}
	}()

	// Wait for the first audio chunk, then connect to Icecast.
	// Icecast sees an active source from the very first write — no silent startup gap.
	t0 := time.Now()
	firstChunk, open := <-dataCh
	if !open {
		log.Printf("[ingest/%s] client disconnected before sending data", streamID)
		return
	}
	log.Printf("[ingest/%s] erster Chunk nach %v (%d Bytes)", streamID, time.Since(t0).Round(time.Millisecond), len(firstChunk))

	iceCfg := cfg.IcecastCfg
	iceCfg.ContentType = cfg.ContentType
	ice := icecast.NewClient(iceCfg)

	t1 := time.Now()
	if err := ice.Connect(); err != nil {
		log.Printf("[ingest/%s] Icecast connect failed: %v", streamID, err)
		return
	}
	log.Printf("[ingest/%s] Icecast connect: %v", streamID, time.Since(t1).Round(time.Millisecond))

	as := &activeStream{ice: ice, cfg: cfg, startedAt: time.Now()}
	r.mu.Lock()
	r.active[streamID] = as
	r.mu.Unlock()

	log.Printf("[ingest/%s] relay started → %s:%d%s", streamID, iceCfg.Host, iceCfg.Port, iceCfg.MountPoint)
	r.notify(StatusUpdate{StreamID: streamID, Connected: true, Bitrate: cfg.Bitrate})

	// Status ticker goroutine: broadcasts bytesSent/uptime/listeners every 5 s.
	tickDone := make(chan struct{})
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				r.mu.Lock()
				bs := as.bytesSent
				isReconnecting := as.reconnecting
				r.mu.Unlock()

				listeners := 0
				if !isReconnecting {
					listeners, _ = ice.ListenerCount()
				}
				r.notify(StatusUpdate{
					StreamID:     streamID,
					Connected:    !isReconnecting,
					Reconnecting: isReconnecting,
					BytesSent:    bs,
					Uptime:       time.Since(as.startedAt),
					Listeners:    listeners,
					Bitrate:      cfg.Bitrate,
				})
			case <-tickDone:
				return
			}
		}
	}()

	// writeChunk sends one chunk to Icecast with optional auto-reconnect.
	// Returns false if the stream should stop.
	retryDelay := time.Second
	writeChunk := func(chunk []byte) bool {
		for {
			_, writeErr := ice.Write(chunk)
			if writeErr == nil {
				r.mu.Lock()
				as.bytesSent += int64(len(chunk))
				wasReconnecting := as.reconnecting
				as.reconnecting = false
				r.mu.Unlock()
				if wasReconnecting {
					retryDelay = time.Second
					log.Printf("[ingest/%s] reconnected to Icecast", streamID)
					r.notify(StatusUpdate{
						StreamID:  streamID,
						Connected: true,
						BytesSent: as.bytesSent,
						Uptime:    time.Since(as.startedAt),
						Bitrate:   cfg.Bitrate,
					})
				}
				return true
			}

			if !cfg.AutoReconnect {
				log.Printf("[ingest/%s] icecast write error: %v", streamID, writeErr)
				return false
			}

			r.mu.Lock()
			if !as.reconnecting {
				as.reconnecting = true
				r.mu.Unlock()
				ice.Disconnect()
				log.Printf("[ingest/%s] icecast disconnected (%v), reconnecting in %s", streamID, writeErr, retryDelay)
				r.notify(StatusUpdate{
					StreamID:     streamID,
					Reconnecting: true,
					BytesSent:    as.bytesSent,
					Uptime:       time.Since(as.startedAt),
					Bitrate:      cfg.Bitrate,
				})
			} else {
				r.mu.Unlock()
			}

			select {
			case <-time.After(retryDelay):
			case <-req.Context().Done():
				return false
			}
			if retryDelay < 30*time.Second {
				retryDelay *= 2
			}

			if err := ice.Connect(); err != nil {
				log.Printf("[ingest/%s] reconnect attempt failed: %v", streamID, err)
			}
		}
	}

	// Send firstChunk immediately (Icecast just connected), then stream the rest.
	if writeChunk(firstChunk) {
		for chunk := range dataCh {
			if !writeChunk(chunk) {
				break
			}
		}
	}

	close(tickDone)
	ice.Disconnect()

	r.mu.Lock()
	delete(r.active, streamID)
	r.mu.Unlock()

	log.Printf("[ingest/%s] relay stopped", streamID)
	r.notify(StatusUpdate{StreamID: streamID, Connected: false})
}

// AllActiveStats returns current statistics for all active streams.
func (r *Relay) AllActiveStats() []StatusUpdate {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]StatusUpdate, 0, len(r.active))
	for id, as := range r.active {
		out = append(out, StatusUpdate{
			StreamID:     id,
			Connected:    !as.reconnecting,
			Reconnecting: as.reconnecting,
			BytesSent:    as.bytesSent,
			Uptime:       time.Since(as.startedAt),
			Bitrate:      as.cfg.Bitrate,
		})
	}
	return out
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
		Connected: !as.reconnecting,
		BytesSent: as.bytesSent,
		Uptime:    time.Since(as.startedAt),
		Bitrate:   as.cfg.Bitrate,
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
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' {
			return path[i+1:]
		}
	}
	return path
}
