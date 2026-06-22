package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

type ServerEntry struct {
	ID     string       `json:"id"`
	Label  string       `json:"label"`
	Config ServerConfig `json:"config"`
}

type ServerConfig struct {
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Password    string `json:"password"`
	MountPoint  string `json:"mountPoint"`
	Protocol    string `json:"protocol"`
	UseSSL      bool   `json:"useSSL"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Genre       string `json:"genre"`
	URL         string `json:"url"`
	Public      bool   `json:"public"`
}

type Config struct {
	Servers []ServerEntry `json:"servers,omitempty"`
	Token   string        `json:"token"`
}

var defaults = Config{}

type Store struct {
	mu   sync.RWMutex
	cfg  Config
	path string
}

func NewStore() (*Store, error) {
	p, err := configPath()
	if err != nil {
		return nil, err
	}
	s := &Store{path: p, cfg: defaults}
	_ = s.load()
	return s, nil
}

func (s *Store) Get() Config {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cfg
}

func (s *Store) Set(cfg Config) error {
	s.mu.Lock()
	s.cfg = cfg
	s.mu.Unlock()
	return s.save()
}

func (s *Store) load() error {
	data, err := os.ReadFile(s.path)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return json.Unmarshal(data, &s.cfg)
}

func (s *Store) save() error {
	data, err := json.MarshalIndent(s.cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, data, 0o644)
}

func configPath() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "Opencast")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return filepath.Join(dir, "server.json"), nil
}
