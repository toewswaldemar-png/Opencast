//go:build windows && !asio

package api

import "net/http"

func (s *Server) HandleASIOPanel(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "ASIO nicht unterstützt in diesem Build")
}
