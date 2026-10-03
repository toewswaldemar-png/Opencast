# Research: Ausgeführte Prüfungen (Ergebnisse und Methode)

Alle Ergebnisse stammen aus **Läufen in dieser Sitzung** (Linux, Go 1.24.7, ffmpeg vorhanden). Reproduktion: `repro/run.sh`.

## Methode
- `go test -overlay`: Dateien mit `//go:build windows` (`hub.go`, `hub_test.go`, `registry.go`, `ffmpeg/resolve_windows.go`) werden ohne Tag eingeblendet.
  Hinweis: Go filtert Dateien auch nach dem **Dateinamen-Suffix** `_windows.go`; deshalb wird der Resolver unter anderem Namen eingeblendet und das Original ausgeblendet.
- `audio.NewCapturer` wird für Linux durch einen Platzhalter ergänzt (der Hub-Test injiziert eigene Capturer).
- Der Hub-Code bleibt **unverändert**. Neu sind nur Tests (`hub_deep_test.go.txt`, `pcmbuffer_drift_test.go.txt`).

## 1. Basislinie (bestehende Tests, `-race`)
| Paket | Ergebnis |
|---|---|
| `internal/hub` | ok (9 Tests, u. a. Channel-Union, MultiLevel, FanOut, Recovery) |
| `internal/pcmbuffer` | ok (8 Tests) |
| `internal/streamsession` | ok (7 Tests) |

`go vet ./...` mit `GOOS=windows` (ohne ASIO-Tag) war bereits in 001 sauber. Der ASIO-Teil selbst (`-tags asio`, CGO) wurde **nicht** kompiliert.

## 2. Befund-Tests
| Test | Ergebnis | Aussage |
|---|---|---|
| `TestDeep_F23_UnsubscribeShiftsPositions` | **FAIL** | Nach `Unsubscribe("A")` zeigt B (Kanal 3/4) auf Position (0,1) statt (2,3); gemessener Pegel −30,3 dBFS statt −20,8 dBFS: B hört Kanal 1 |
| `TestDeep_F01_MonoStreamFrameCount` | **FAIL** | 12 ASIO-Callbacks à 256 Frames liefern **24** statt 12 PCMBuffer-Frames (Faktor 2,0) |
| `TestDeep_F24_AddMonitorRestartsCapturerDuringStream` | PASS (beschreibt Verhalten) | 2 Capturer-Starts, alter Capturer gestoppt, Stream-Session bleibt bestehen (füllt mit Stille) |
| `TestDeep_RaceStress` (5 Läufe, `-race`) | PASS, 5/5 | 6 Goroutinen Subscribe/StartStream/Unsubscribe + simulierter Treiberthread; keine Races, kein Panic — **unter der Spec-Zusage "nach Stop kein Callback"** |

Wichtige Einschränkung zum Race-Stress: In einer ersten Fassung stellte der Mock nach `Stop()` weiter Callbacks zu. Dann paniert
`ExtractChannelLevel` (`level.go:19`, `index out of range`), sobald der Hub `h.nativeCh` des **neuen** Capturers auf Puffer des **alten** anwendet.
In 2 von 3 Läufen trat das auf. Im Produktivbetrieb entspricht das nur dem Fall F-21 (Callback nach `ASIOStop`); es zeigt aber, dass der Hub die
Kanalzahl rät, statt sie vom Capturer zu bekommen (F-29).

## 3. Drift-Simulation (F-22)
Virtuelle Zeit, **echter** `PCMBuffer` (1024 Byte, Kapazität 50), 256 Stereo-Samples/Frame bei 48 kHz, Consumer-Tick alle 5,33 ms (±1 ms Jitter),
Producer liefert ASIO-Puffer (±0,3 ms Jitter), je Zeile 1 Stunde. "Drift +" = Interface langsamer als PC-Uhr.

| ASIO-Puffer | Drift | Vorfüllung | Underruns/h | Overflows/h | Pufferstand min–max |
|---|---|---|---|---|---|
| 512 | 0 ppm | 0 | 1 | 0 | 0–3 |
| 512 | 0 ppm | 4 | 0 | 0 | 3–6 |
| 512 | +20 | 0 | 14 | 0 | 0–3 |
| 512 | +50 | 0 | 34 | 0 | 0–3 |
| 512 | +50 | 4 | 30 | 0 | 0–6 |
| 512 | +100 | 0 | 68 | 0 | 0–3 |
| 512 | −50 | 0 | 1 | 0 | 0–36 (Latenz bis ≈190 ms) |
| 512 | −100 | 0 | 1 | 20 | 0–50 (Puffer voll, Frames verworfen) |
| 2048 | +50 | 0 | 34 | 0 | 0–9 |
| 2048 | −100 | 0 | 1 | 26 | 0–50 |

(Alle 42 Zeilen in `repro/run.sh`, Abschnitt 3.) Muster: Bei Drift "+" ein Underrun alle ≈ 106 s je 50 ppm (Stille für 5,3 ms);
bei Drift "−" wächst die Latenz bis ≈ 267 ms und danach werden Frames verworfen. **Vorfüllung ändert daran nichts**, weil nichts den Pufferstand regelt.
Die Rechnung stimmt mit der Theorie überein: 50 ppm × 48 000 Hz = 2,4 Samples/s → 1 Frame (256 Samples) je ≈ 107 s.

## 4. Zusätzlich gelesen (keine Ausführung)
`main_windows.go` (Tray, Panel), `wsclient/client.go` (Kommandos, Verbindungsaufbau), `hub/registry.go`, `streamsession/session.go`,
`audio/encoder.go`, `ffmpeg/resolve_windows.go`, `server/main.go`, `server/internal/api/server.go`, `server/internal/auth/*`,
`frontend/src/components/CardSettingsPanel.tsx` (Kanal-Dropdowns), `backend/` (Altbestand mit eigener ASIO-Kopie und eigener Auth).
