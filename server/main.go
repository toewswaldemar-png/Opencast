package main

import (
	"embed"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"server/internal/api"
	"server/internal/config"
	"server/internal/ingest"
)

//go:embed dist
var staticFiles embed.FS

func main() {
	if exe, err := os.Executable(); err == nil {
		logPath := filepath.Join(filepath.Dir(exe), "opencast-server.log")
		if f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644); err == nil {
			log.SetOutput(io.MultiWriter(os.Stdout, f))
		}
	}

	store, err := config.NewStore()
	if err != nil {
		log.Fatalf("config store: %v", err)
	}

	port := "8765"
	if p := os.Getenv("PORT"); p != "" {
		port = p
	}
	baseURL := fmt.Sprintf("http://localhost:%s", port)
	if ext := os.Getenv("BASE_URL"); ext != "" {
		baseURL = ext
	}

	hub := api.NewHub()
	relay := ingest.NewRelay()
	clientHub := api.NewClientHub(hub, relay)
	srv := api.NewServer(store, hub, clientHub, relay, baseURL)

	// When a new browser connects, push the current Windows-client state immediately
	// so the browser doesn't have to wait for the next state-change event.
	hub.SetOnNewClient(func(send func(api.MessageType, any)) {
		connected := clientHub.IsConnected()
		send(api.MsgClientOnline, connected)
		if connected {
			if devs := clientHub.Devices(); devs != nil {
				send(api.MsgDevices, devs)
			}
		}
		// Push current relay stream statuses so the browser is immediately in sync.
		for _, u := range relay.AllActiveStats() {
			send(api.MsgStatus, map[string]any{
				"streamId":     u.StreamID,
				"running":      u.Connected || u.Reconnecting,
				"connected":    u.Connected,
				"reconnecting": u.Reconnecting,
				"bytesSent":    u.BytesSent,
				"uptime":       u.Uptime.Nanoseconds(),
				"listeners":    u.Listeners,
				"bitrate":      u.Bitrate,
			})
		}
	})

	// Broadcast relay status updates (bytesSent, uptime, listeners, reconnect state) to all browsers.
	relay.SetStatusCallback(func(u ingest.StatusUpdate) {
		hub.Broadcast(api.MsgStatus, map[string]any{
			"streamId":     u.StreamID,
			"running":      u.Connected || u.Reconnecting,
			"connected":    u.Connected,
			"reconnecting": u.Reconnecting,
			"bytesSent":    u.BytesSent,
			"uptime":       u.Uptime.Nanoseconds(),
			"listeners":    u.Listeners,
			"bitrate":      u.Bitrate,
			"error":        u.Error,
		})
	})

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(corsMiddleware)

	r.Get("/ws", hub.ServeWS)
	r.Get("/ws/client", clientHub.ServeWS)
	r.Put("/ingest/{streamId}", relay.HandleIngest)

	r.Route("/api", func(r chi.Router) {
		r.Get("/devices", srv.HandleDevices)
		r.Get("/status", srv.HandleStatus)
		r.Post("/stream/start", srv.HandleStart)
		r.Post("/stream/stop", srv.HandleStop)
		r.Get("/formats", srv.HandleFormats)
		r.Get("/config", srv.HandleConfigGet)
		r.Put("/config", srv.HandleConfigPut)
		r.Post("/stream/metadata", srv.HandleMetadata)
		r.Post("/monitor/start", srv.HandleMonitorStart)
		r.Post("/monitor/stop", srv.HandleMonitorStop)
		r.Post("/asio/panel", srv.HandleAsioPanel)
	})

	distFS, err := fs.Sub(staticFiles, "dist")
	if err != nil {
		log.Fatalf("embed sub: %v", err)
	}
	fileServer := http.FileServer(http.FS(distFS))
	r.Handle("/*", spaHandler(fileServer))

	log.Printf("Opencast Server läuft auf http://0.0.0.0:%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
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
