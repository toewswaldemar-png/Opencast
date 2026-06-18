//go:build windows

package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"opencast/internal/api"
	"opencast/internal/stream"
)

//go:embed dist
var staticFiles embed.FS

func main() {
	manager := stream.NewManager()
	monitor := stream.NewMonitor()
	hub := api.NewHub()
	srv := api.NewServer(manager, monitor, hub)

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(corsMiddleware)

	// WebSocket
	r.Get("/ws", hub.ServeWS)

	// REST API
	r.Route("/api", func(r chi.Router) {
		r.Get("/devices", srv.HandleDevices)
		r.Get("/status", srv.HandleStatus)
		r.Post("/stream/start", srv.HandleStart)
		r.Post("/stream/stop", srv.HandleStop)
		r.Get("/formats", srv.HandleFormats)
		r.Post("/asio/panel", srv.HandleASIOPanel)
		r.Post("/monitor/start", srv.HandleMonitorStart)
		r.Post("/monitor/stop", srv.HandleMonitorStop)
	})

	// Serve embedded frontend
	distFS, err := fs.Sub(staticFiles, "dist")
	if err != nil {
		log.Fatalf("embed sub: %v", err)
	}
	fileServer := http.FileServer(http.FS(distFS))
	r.Handle("/*", spaHandler(fileServer))

	log.Println("Opencast running on http://localhost:8765")
	log.Fatal(http.ListenAndServe(":8765", r))
}

func spaHandler(fs http.Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		fs.ServeHTTP(w, r)
	}
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
