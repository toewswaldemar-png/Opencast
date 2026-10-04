# Tasks

## 1. Testbarkeit
- [ ] 1.1 Build-Tags entfernen, Stubs für Nicht-Windows
- [ ] 1.2 `go test -race ./...` unter Linux für `client/`

## 2. CI
- [ ] 2.1 `ci.yml` mit Jobs server, frontend, client-linux, client-windows, client-asio
- [ ] 2.2 `go vet` und `tsc --noEmit` als Pflichtprüfung

## 3. Tests
- [ ] 3.1 Konformitätstests des Servers übernehmen
- [ ] 3.2 Hub-Tests aus `specs/004` übernehmen

## 4. Lieferkette
- [ ] 4.1 ffmpeg-Pin mit SHA-256
- [ ] 4.2 `server/dist` aus Git entfernen, `make build` dokumentieren
