# Research: Ardours ASIO-Pfad im Quelltext

Geprüft wurden lokale Shallow-Klone (nur lesend): **Ardour** `f39f9d8` ("Add additional boot messages", 2026-10-04)
und **PortAudio** `873e3c8` (2026-10-02). Zeilenangaben beziehen sich auf diese Commits.
Ardours `ardour/ardour` und PortAudios `portaudio/portaudio` stehen nicht im Repository-Scope dieser Sitzung; sie wurden per öffentlichem, anonymem Git-Lesezugriff geklont.

## 1. Architektur
```
Ardour GUI (gtk2_ardour/engine_dialog.cc)
  └ AudioBackend "PortAudio" (libs/backends/portaudio/portaudio_backend.cc)
      └ PortAudioIO (portaudio_io.cc)  ── #ifdef WITH_ASIO ── PaAsio_* (pa_asio.h)
          └ PortAudio ASIO-Host (src/hostapi/asio/pa_asio.cpp)
              └ Steinberg SDK-Host (AsioDrivers, asio.cpp) ─ COM ─▶ ASIO-Treiber
```
- **Ardour hat keinen eigenen ASIO-Host.** `WITH_ASIO` wird nur gesetzt, wenn der Header `pa_asio.h` vorhanden ist
  (`libs/backends/portaudio/wscript:14`, `conf.check(header_name='pa_asio.h', define_name='WITH_ASIO', mandatory=False)`).
- Der Windows-Build aktiviert das PortAudio-Backend nur, wenn das Dependency-Stack `pa_asio.h` enthält
  (`tools/x-win/compile.sh:27-31`). Der Stack wird **außerhalb** des Repos gebaut (`tools/x-win/README`: "ardour-build-tools/win/x-mingw.sh").
  Version von PortAudio und Handhabung des ASIO SDK der offiziellen Binaries sind daher aus dem Ardour-Repo **nicht** ableitbar.

## 2. Ardour-eigener Code (ASIO-relevant)
| Thema | Fundstelle | Verhalten |
|---|---|---|
| Control-Panel | `portaudio_io.cc:81-93` | `PaAsio_ShowControlPanel(device_id, NULL)` — Fenster-Handle **NULL**; Fehler nur als Debug-Log |
| Samplerates | `portaudio_io.cc:114-119` | Für ASIO feste Liste (8 k … 192 k), **kein** Probing am Treiber |
| Puffergrößen | `portaudio_io.cc:170-289` | `PaAsio_GetAvailableBufferSizes`; Potenzen von 2 bei `granularity <= 0` oder Zweierpotenz-Min/Granularität; sonst höchstens 8 Werte; `min==max==preferred` → nur `preferred` |
| Kein Re-Probe im Betrieb | `portaudio_io.cc:564-581` | `update_devices()` bricht bei offenem Stream ab (`if (_stream != NULL) return false;`), sonst `pa_deinitialize()` + `pa_initialize()` |
| Kein "None"-Gerät bei ASIO | `portaudio_io.cc:574-578` | "ASIO doesn't support separate input/output devices" |
| Alle Kanäle öffnen | `portaudio_io.cc:694-706, 730-743` | `channelCount = maxInputChannels/maxOutputChannels`, Float32, interleaved |
| Latenz | `portaudio_io.cc:767-771` | Nur bei ASIO: `suggestedLatency = samples_per_period / sample_rate` |
| Sample-Rate-Abgleich | `portaudio_backend.cc` (`_start`, nach `open_*_stream`) | Weicht die tatsächliche Rate ab: `engine.sample_rate_change()` + Warnung |
| Keine Änderung im Lauf | `portaudio_backend.cc:256-266` | `can_change_sample_rate_when_running()` und `can_change_buffer_size_when_running()` → `false` |
| Modus | `portaudio_backend.cc:81` | `_use_blocking_api(false)` → Callback-Modus Standard; "Buffered I/O" optional |
| Xruns | `portaudio_backend.cc:757-765` | aus PortAudio-Status-Flags (`paInput/OutputOver/Underflow`) → `engine.Xrun()` |
| Thread-Prioritäten | `portaudio_backend.cc:1049-1105` | MMCSS "Pro Audio" nur für **Ardours eigene** Prozess-Threads, nicht für Treiber-Threads |
| UI-Reihenfolge | `engine_dialog.cc:1551` | "device name must be set FIRST so ASIO can populate buffersizes and the control panel button" |

## 3. PortAudio-ASIO-Host (`pa_asio.cpp`)
| Thema | Fundstelle | Verhalten |
|---|---|---|
| Zustandsfolge | `LoadAsioDriver` (~940-1000), `OpenStream`, `StartStream` (~3360), `StopStream` (3391) | Init → GetChannels → GetBufferSize → OutputReady-Probe → CreateBuffers → GetChannelInfo → GetLatencies → Start; Stop → DisposeBuffers → Exit |
| `asioMessages` | 3187-3265 | `kAsioSelectorSupported`: Reset, Engine, Resync, Latencies, TimeInfo, TimeCode, InputMonitor; `kAsioResetRequest` → **nur `return 1`**, Kommentar verweist auf PortAudio-Ticket #108 ("PA/ASIO ignores some driver notifications it probably shouldn't"); `kAsioBufferSizeChange` → 0; `kAsioSupportsTimeInfo` → 1 |
| `sampleRateChanged` | 3173-3185 | nur Log |
| Overload | — | kein `kAsioCanReportOverload`, kein `kAsioOverload`; Overload wird nur über Wiedereintritt erkannt |
| Wiedereintritt | 1623, 2954-2960, 3167 | `reenterCount` (atomar); bei Reentry werden `paInputOverflow`/`paOutputUnderflow` gesetzt |
| `ASIOOutputReady` | 988-991, 2737, 2984, 3135 | einmal abfragen (`postOutput`), danach nur bei `ASE_OK` aufrufen |
| Samplerate | `ValidateAndSetSampleRate` 1923-1980 | `ASIOCanSampleRate` → bei Fehler `paInvalidSampleRate`; `ASIOGetSampleRate`-Fehler → abbrechen; `ASIOSetSampleRate` nur bei abweichender Rate; Externer-Clock-Zweig mit `if( false )` deaktiviert (Treiber verhalten sich uneinheitlich) |
| Puffergröße | `SelectHostBufferSize` 1806ff | Granularität 0 / −1 / n; Fallback auf `preferredSize`, wenn `ASIOCreateBuffers` fehlschlägt (Hoontech DSP24, 2290-2314) |
| Sample-Typen | 336-425, 649-870 | alle LSB/MSB-PCM- und Float-Typen inkl. `Int32LSB/MSB16/18/20/24`; `Int32LSB24` → Linksschub 8 in `paInt32`; DSD → `paCustomFormat` (nicht unterstützt) |
| Typ je Kanal | 2394, 2415 | `FIXME: assume all channels use the same type` (nutzt Kanal 0), Ticket #106 |
| Ein Gerät gleichzeitig | 2032-2036, 2741, 2820 | `openAsioDeviceIndex`; zweites `OpenStream` → `paDeviceUnavailable` |
| Probe aller Treiber | 1262-1330 | beim Initialisieren; **Blacklist**: "ASIO DirectX Full Duplex Driver", "ASIO Multimedia Driver", `Premiere*`, `Adobe*`; "ASIO Digidesign Driver" nicht unter Debugger |
| Schutz vor schreibenden Treibern | 1019-1022 | `PaAsioDriverInfo` in 4096-Byte-Union ("drivers are free to write over data given to them (like M-Audio drivers f.i.)") |
| Nach `ASIOStop` | 3378-3388 | `EnsureCallbackHasCompleted`: bis zu 2 s warten, bis `reenterCount == -1` ("observed to happen on the Hoontech DSP24") |
| COM | 1186, 1204, 4027 | `PaWinUtil_CoInitialize` (toleriert Apartment-Konflikt, merkt sich Ergebnis), eigene Balance |
| `sysRef` | 1232 | `GetDesktopWindow()` |
| Control-Panel | 4014-4112 | lädt Treiber neu, nur wenn **kein** Stream offen (`paDeviceUnavailable`); Erfolgspfad ruft `ASIOExit()` und `return`, **ohne** `PaWinUtil_CoUninitialize` (nur der Fehlerpfad, 4107-4111) |

## 4. Was daraus nicht folgt
- Aussagen über das Laufzeitverhalten mit echten Treibern (nicht getestet).
- Aussagen zu Ardours offiziellen Binaries (PortAudio-Version, SDK-Lizenzweg liegen im externen Build-Stack).
- Ardours JACK-/WASAPI-Pfade sind nicht Gegenstand.

## 5. Korrektur zu 002
`002/research.md` nennt als Lücke "PortAudio-`asioMessages`-Funktionskörper nicht ausgewertet". Das ist jetzt geschlossen:
PortAudio **ignoriert** `kAsioResetRequest` (antwortet nur mit 1), kennt weder Overload noch Neustart. Die dort genannte
Praxis "Reset nach 500 ms" stammt aus **JUCE**, nicht aus PortAudio/Ardour.
