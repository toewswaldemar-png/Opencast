//go:build windows

package main

import (
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os/exec"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"opencast/internal/api"
	"opencast/internal/auth"
	"opencast/internal/config"
	"opencast/internal/stream"
)

//go:embed dist
var staticFiles embed.FS

func main() {
	store, err := config.NewStore()
	if err != nil {
		log.Fatalf("config store: %v", err)
	}

	// Generate token on first start; persist in config.json
	cfg := store.Get()
	if cfg.Token == "" {
		tok, err := auth.GenerateToken()
		if err != nil {
			log.Fatalf("generate token: %v", err)
		}
		cfg.Token = tok
		if err := store.Set(cfg); err != nil {
			log.Fatalf("save token: %v", err)
		}
	}
	log.Printf("Token: %s", cfg.Token)

	url := fmt.Sprintf("http://localhost:8765/?auth=%s", cfg.Token)
	log.Printf("Öffne Browser: %s", url)
	exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start() //nolint

	authenticator := auth.NewTokenAuth(cfg.Token)
	authMiddleware := api.WithAuth(authenticator)

	manager := stream.NewManager()
	monitor := stream.NewMonitor()
	hub := api.NewHub()
	srv := api.NewServer(manager, monitor, hub, store)

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(corsMiddleware)

	// WebSocket — protected
	r.With(authMiddleware).Get("/ws", hub.ServeWS)

	// REST API — all routes protected
	r.Route("/api", func(r chi.Router) {
		r.Use(authMiddleware)
		r.Get("/devices", srv.HandleDevices)
		r.Get("/status", srv.HandleStatus)
		r.Post("/stream/start", srv.HandleStart)
		r.Post("/stream/stop", srv.HandleStop)
		r.Get("/formats", srv.HandleFormats)
		r.Get("/config", srv.HandleConfigGet)
		r.Put("/config", srv.HandleConfigPut)
		r.Post("/asio/panel", srv.HandleASIOPanel)
		r.Post("/monitor/start", srv.HandleMonitorStart)
		r.Post("/monitor/stop", srv.HandleMonitorStop)
	})

	// Serve embedded frontend (no auth — HTML/JS contains no secrets)
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
