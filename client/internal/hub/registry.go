//go:build windows

package hub

import (
	"log"
	"sync"
)

// Registry holds one Hub per device ID.
type Registry struct {
	mu   sync.Mutex
	hubs map[string]*Hub
}

func NewRegistry() *Registry {
	return &Registry{hubs: make(map[string]*Hub)}
}

// Hub returns the Hub for a device, creating it if necessary.
func (r *Registry) Hub(deviceID string) *Hub {
	r.mu.Lock()
	defer r.mu.Unlock()
	h, ok := r.hubs[deviceID]
	if !ok {
		h = newHub(deviceID)
		r.hubs[deviceID] = h
	}
	return h
}

// Unsubscribe removes a subscriber from whichever Hub it belongs to.
// Used when the frontend doesn't supply a deviceID (e.g. stream stop).
func (r *Registry) Unsubscribe(id string) {
	r.mu.Lock()
	hubs := make([]*Hub, 0, len(r.hubs))
	for _, h := range r.hubs {
		hubs = append(hubs, h)
	}
	r.mu.Unlock()
	for _, h := range hubs {
		h.mu.Lock()
		_, found := h.subs[id]
		h.mu.Unlock()
		if found {
			h.Unsubscribe(id)
			return
		}
	}
}

// UnsubscribeExcept removes a subscriber from every Hub except the one for keepDeviceID.
// Call this before subscribing to a new device so stale cross-hub subscriptions are cleaned up.
func (r *Registry) UnsubscribeExcept(id, keepDeviceID string) {
	r.mu.Lock()
	hubs := make([]*Hub, 0, len(r.hubs))
	for deviceID, h := range r.hubs {
		if deviceID != keepDeviceID {
			hubs = append(hubs, h)
		}
	}
	r.mu.Unlock()
	for _, h := range hubs {
		h.mu.Lock()
		_, found := h.subs[id]
		h.mu.Unlock()
		if found {
			log.Printf("[registry] %s: Gerätewechsel → entferne von %s", id, h.deviceID)
			h.Unsubscribe(id)
		}
	}
}

// StopMonitors stops monitor-only subscribers across all Hubs.
func (r *Registry) StopMonitors() {
	r.mu.Lock()
	hubs := make([]*Hub, 0, len(r.hubs))
	for _, h := range r.hubs {
		hubs = append(hubs, h)
	}
	r.mu.Unlock()
	for _, h := range hubs {
		h.StopMonitors()
	}
}

// StopAll stops every Hub.
func (r *Registry) StopAll() {
	r.mu.Lock()
	hubs := make([]*Hub, 0, len(r.hubs))
	for _, h := range r.hubs {
		hubs = append(hubs, h)
	}
	r.mu.Unlock()
	for _, h := range hubs {
		h.StopAll()
	}
}
