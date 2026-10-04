## 1. Icecast-Client
- [ ] 1.1 Mountpoint in `UpdateMetadata` normalisieren (gemeinsamer Helper mit Handshake/`ListenerCount`)
- [ ] 1.2 `charset=UTF-8` als Parameter ergänzen
- [ ] 1.3 Shoutcast: passenden Admin-Endpoint (`/admin.cgi?mode=updinfo&pass=…&song=…`) implementieren oder `ErrUnsupported` liefern
- [ ] 1.4 Unit-Tests mit `httptest` (Mount mit/ohne `/`, Umlaute/Sonderzeichen, Auth, SSL-Schema, Fehlerstatus, Timeout)

## 2. Server-API
- [ ] 2.1 `streamId` Pflicht, Titel trimmen und auf 255 Zeichen begrenzen, `http.MaxBytesReader`
- [ ] 2.2 Statuscodes: 400 ungültige Anfrage, 404 Stream nicht aktiv, 502 Icecast-Fehler
- [ ] 2.3 Handler-/Relay-Tests

## 3. Frontend
- [ ] 3.1 `nowPlaying` pro Stream in `App.tsx` halten, damit der Titel Ansichtswechsel überlebt
- [ ] 3.2 HTTP-Fehler (`!res.ok`) auswerten, Fehler in der Karte anzeigen
- [ ] 3.3 Wiederholung der Übermittlung beim Live-Gehen (z. B. 3 Versuche, 1/2/4 s), falls der Mount noch nicht bereit ist
- [ ] 3.4 Bei OGG-Format Eingabefeld deaktivieren und Hinweis anzeigen
- [ ] 3.5 `server/dist` neu bauen

## 4. Build
- [ ] 4.1 `Makefile` auf `server/` umstellen, `backend/` entfernen oder als veraltet kennzeichnen
