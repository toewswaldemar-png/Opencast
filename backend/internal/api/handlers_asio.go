//go:build windows && asio

package api

import (
	"net/http"
	"strings"

	"opencast/internal/audio"
)

// HandleASIOPanel opens the ASIO driver's control panel window.
// POST /api/asio/panel   body: {"deviceId": "asio:{clsid}"}
func (s *Server) HandleASIOPanel(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DeviceID string `json:"deviceId"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body: "+err.Error())
		return
	}
	if !strings.HasPrefix(req.DeviceID, "asio:") {
		writeError(w, http.StatusBadRequest, "kein ASIO-Gerät")
		return
	}
	clsid := strings.TrimPrefix(req.DeviceID, "asio:")
	audio.OpenASIOControlPanel(clsid)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
