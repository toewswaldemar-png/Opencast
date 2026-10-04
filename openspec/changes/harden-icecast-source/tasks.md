# Tasks

## 1. Tests zuerst
- [ ] 1.1 `repro/server_deep_test.go.txt` (S-2, S-3, R-1, C-1) als reguläre Tests übernehmen (rot)

## 2. Umsetzung
- [ ] 2.1 Validierung der Header-Werte und des Mountpunkts (API und Handshake)
- [ ] 2.2 TLS für Source-Verbindung bei `UseSSL`; Konfigfeld für Zertifikats-Opt-out
- [ ] 2.3 Mutex im Icecast-Client, lokale `net.Conn` in der Drain-Goroutine
- [ ] 2.4 `sync.Once` für `stopCh`; `Unregister` idempotent
- [ ] 2.5 `ICECAST_ALLOWED_HOSTS`

## 3. Abnahme
- [ ] 3.1 Alle Tests grün, `go test -race ./...` sauber
