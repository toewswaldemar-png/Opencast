# Tasks

## 1. Server
- [ ] 1.1 Token erzeugen/laden (Umgebung `OPENCAST_TOKEN` oder `server.json`), beim Start ins Log schreiben
- [ ] 1.2 `WithAuth` für `/api/*`, `/ws`, `/ws/client` einbinden; Ingest mit einmaligem Geheimnis
- [ ] 1.3 CORS und `CheckOrigin` auf konfigurierte Origins beschränken
- [ ] 1.4 `GET /api/config` ohne Passwörter; `PUT` behält Passwort bei leerem Feld; `server.json` mit 0600 schreiben
- [ ] 1.5 Tests: 401 ohne Token, kein Passwort im Body, Client-Verdrängung nur mit Token

## 2. Client
- [ ] 2.1 Token in `client.json`, Verbindung mit `?token=`
- [ ] 2.2 Geräte-ID-Allowlist in `registry.Hub`, `StartStream`, `Subscribe`, `OnAsioPanel`
- [ ] 2.3 CLSID-Format prüfen, bevor `CoCreateInstance` aufgerufen wird

## 3. Frontend
- [ ] 3.1 `TokenGate` in `App.tsx` einbinden, Token in `sessionStorage`
- [ ] 3.2 `apiFetch` sendet `Authorization`, `wsUrl` hängt `?token=` an

## 4. Dokumentation
- [ ] 4.1 README: Token, Umgebungsvariablen, HTTPS-Hinweis
