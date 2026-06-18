package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

// Config mirrors the frontend types exactly so it round-trips through JSON without conversion.
type Config struct {
	Server   ServerConfig  `json:"server"`
	Encoder  EncoderConfig `json:"encoder"`
	DeviceID string        `json:"deviceId"`
	Token    string        `json:"token"`
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

type EncoderConfig struct {
	Format     string `json:"format"`
	Bitrate    int    `json:"bitrate"`
	SampleRate uint32 `json:"sampleRate"`
	Channels   uint16 `json:"channels"`
}

var defaults = Config{
	Server: ServerConfig{
		Host:       "localhost",
		Port:       8000,
		Password:   "hackme",
		MountPoint: "/stream",
		Protocol:   "icecast2",
		Name:       "Opencast Stream",
	},
	Encoder: EncoderConfig{
		Format:     "mp3",
		Bitrate:    192,
		SampleRate: 44100,
		Channels:   2,
	},
}

// Store is a thread-safe persistent config store backed by a JSON file.
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
	_ = s.load() // missing file on first run is not an error
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
	base, err := os.UserConfigDir() // %APPDATA% on Windows
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "Opencast")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return filepath.Join(dir, "config.json"), nil
}
