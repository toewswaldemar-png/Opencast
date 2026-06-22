package main

import (
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"server/internal/api"
	"server/internal/config"
	"server/internal/ingest"
)

//go:embed dist
var staticFiles embed.FS

func main() {
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
	clientHub := api.NewClientHub(hub)
	relay := ingest.NewRelay()
	srv := api.NewServer(store, hub, clientHub, relay, baseURL)

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
