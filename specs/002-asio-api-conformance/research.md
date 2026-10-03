# Research: Offizielle ASIO-API und Referenz-Hosts

Recherche vom 2026-10-03. Primärquelle wurde im Volltext ausgewertet; Sekundärquellen sind als solche markiert.
Nicht erreichbar (Egress-Sperre der Sitzung): `steinberg.net`, `dspace.tul.cz`, `ccrma.stanford.edu`.

## Quellen
| # | Quelle | Art | Verwendet für |
|---|---|---|---|
| S1 | Steinberg *ASIO SDK 2.3* PDF, "Documentation Release #4", © 1997-2025 — Spiegel [audiosdk/asio](https://github.com/audiosdk/asio) (`Steinberg ASIO SDK 2.3.pdf`), 50 Seiten, per `pdftotext` im Volltext gelesen | **Primär (normativ)** | Zustandsautomat, Funktionsreferenz, Sample-Typen, Nachrichten, Anhänge D/G |
| S2 | `common/asio.h`, `common/iasiodrv.h` im selben Repo | Primär | Enum-Werte, `ASIOMessageSelectors`, Kommentare |
| S3 | `host/sample/hostsample.cpp`, `host/pc/asiolist.cpp`, `host/asiodrivers.cpp` | Primär (Referenz-Host) | Ablauf, Shutdown-Reihenfolge, COM-Laden |
| S4 | [PortAudio `pa_asio.cpp`](https://github.com/PortAudio/portaudio/blob/master/src/hostapi/asio/pa_asio.cpp) | Sekundär (Praxis) | Sample-Typen, ein Treiber gleichzeitig, Blacklist, `postOutput` |
| S5 | [JUCE `juce_ASIO_windows.cpp`](https://github.com/juce-framework/JUCE/blob/master/modules/juce_audio_devices/native/juce_ASIO_windows.cpp) | Sekundär (Praxis) | Reset-Behandlung, Watchdog, Treiber-Workarounds |
| S6 | [dechamps/ASIOUtil `BUFFERS.md`](https://github.com/dechamps/ASIOUtil/blob/master/BUFFERS.md) | Sekundär | Puffer-Gültigkeit, `ASIOOutputReady` |
| S7 | [cwASIO Issue #9](https://github.com/s13n/cwASIO/issues/9), [confluence Issue #5](https://github.com/kaislate/confluence/issues/5) | Sekundär | COM-Balance, STA-Pump |
| S8 | `LICENSE.txt` und `README.md` im SDK-Spiegel; Presse: [heise](https://www.heise.de/en/news/Steinberg-Releases-ASIO-and-VST-Audio-Interfaces-Under-Open-Source-Licenses-10963451.html), [KVR](https://www.kvraudio.com/news/steinberg-moves-vst-3-sdk-to-mit-open-source-license-asio-now-gplv3-65179) | Primär/Sekundär | Dual-Lizenz seit Oktober 2025 |

Hinweis: Der SDK-Spiegel `audiosdk/asio` ist eine Kopie, nicht das offizielle Steinberg-Repository.
Er enthält aber die Dokumentation mit dem Hinweis "Release #4" und der Lizenz von 2025.

## Normative Kernaussagen (wörtlich oder eng am Wortlaut)
1. **Zustandsautomat** (§II.2): LOADED → `INIT` → INITIALIZED → `CREATEBUFFERS` → PREPARED → `START` → RUNNING; zurück über `STOP`, `DISPOSEBUFFERS`, `EXIT`.
2. **`ASIOExit`** (§III.1): "implies ASIOStop() and ASIODisposeBuffers(), meaning that no host callbacks must be accessed after ASIOExit()." Unter COM entspricht `Release()` dem Exit (§App. E: "The destructor implies ASIOExit()").
3. **`ASIOStop`**: "On return from ASIOStop(), the driver must not call the hosts bufferSwitch() routine."
4. **Reset** (§II.7 Note): "A host application must defer processing of these notifications to a later 'secure' time … Especially on the kAsioResetRequest it is a bad idea to unload the driver during the asioMessage callback since the callback must return back into the driver." Und (§III.6): kAsioResetRequest "will close the driver (ASIOExit()) and re-open it again (ASIOInit() etc.) at the next 'safe' time … Return value is always 1L."
5. **`kAsioBufferSizeChange`**: Host darf ablehnen (0); dann "the driver should send kAsioResetRequest".
6. **`sampleRateDidChange`** (§III.6): "The host application usually will just store the information. Actual action of the host application is not specified." (→ Reset ist Praxis, nicht Pflicht.)
7. **Overload** (§III.5): Antwortet der Treiber auf `kAsioCanReportOverload` mit `ASE_SUCCESS`, "the host will switch off its own overload detection and solely relies on the driver's reports"; Meldung per `asioMessage(kAsioOverload)`.
8. **Sample-Typen** (§III.7): `ASIOSTInt32LSB16/18/20/24` = "32-bit data with N-bit sample data **right aligned**", "most significant bits should be sign extended". Gleiches für MSB. `ASIOSTInt24*` = gepacktes 3-Byte-Format. `ASIOSTInt32*` = linksbündig, "Lowest 8 bit should be reset or dithered".
9. **Sample-Typ je Kanal**: `ASIOChannelInfo.type` ist pro Kanal (§III.3).
10. **`ASIOGetSampleRate`**: "If sample rate is unknown, sampleRate will be 0 and ASE_NoClock will be returned." **`ASIOSetSampleRate`**: "If sampleRate == 0, enable external sync … If the current clock is external, and sampleRate is != 0, ASE_InvalidMode will be returned."
11. **`ASIOOutputReady`**: "Only if the above-mentioned scenario is given … should ASE_OK be returned. Otherwise (and usually) ASE_NotPresent should be returned in order to prevent further calls." Referenz-Host: einmal abfragen, danach nur bei `ASE_OK` aufrufen (`postOutput`).
12. **Windows** (§App. D): "ASIO bufferSwitch() is usually implemented in its own thread, created by the driver … An ASIO host shall by no means alter these priorities."
13. **64-Bit** (§App. G): 64-Bit-Hosts lesen `HKLM\Software\ASIO`.
14. **`bufferSwitchTimeInfo`** (§App. A): Host-Antwort `kAsioSupportsTimeInfo == 1` schaltet den Zeitinfo-Modus; "recommended … even if the ASIO device does not support timecode".
15. **Start-Verhalten** (§II.5/6): Vor dem eigentlichen Streaming kommen ein oder mehrere Callbacks mit Stille im Input; "the time information of the first few bufferSwitch callbacks must be ignored".
16. **`AsioDrivers`** (§IV): "the implementation is currently limited to one active driver"; Treibername ≤ 32 Zeichen.
17. **Callback-Wiedereintritt** (§III.3 `ASIOGetLatencies`): Host "expects the bufferSwitch() callback to be accessed for each time slice … possibly recursively".

## Was die Referenz-Hosts zusätzlich zeigen
| Thema | SDK-Hostsample | PortAudio | JUCE |
|---|---|---|---|
| `kAsioResetRequest` | setzt Stopp-Flag, kehrt mit 1 zurück | **nur `return 1`, Aktion fehlt** (Ticket #108; siehe 003) | **Timer 500 ms**, dann Neustart; nicht während Control-Panel |
| `BufferSizeChange` / `Resync` | Resync: 1 | — | beide → gleicher deferred Reset |
| `sampleRateDidChange` | leerer Handler | — | → Reset-Request |
| `kAsioSelectorSupported` | Reset, Engine, Resync, Latencies, TimeInfo, TimeCode, InputMonitor | — | Reset, Engine, Resync, Latencies, InputMonitor, **Overload** |
| `kAsioSupportsTimeInfo` | 1 | — | **0** |
| `OutputReady` | einmal prüfen → `postOutput` | gleich | `postOutput = (outputReady()==0)` |
| Sample-Typen | nur LSB-Nullen für Output | alle Int32*16..24, Int24/16, Float32/64 MSB/LSB; DSD nicht | alles außer LSB18/20 (unhandled) und DSD |
| Typ je Kanal | — | **Annahme "alle Kanäle gleich"** (FIXME, Issue #106) | je Kanal |
| Ein Treiber gleichzeitig | ja (global) | ja, zweites Gerät → `paDeviceUnavailable` | bis zu 16 Slots |
| `init(sysRef)` | Desktop/Fenster | `GetDesktopWindow()` | eigenes Message-Fenster |
| Watchdog | — | — | 3 s nach `start()` ohne Callback → Fehler |
| Blacklist | — | "ASIO DirectX Full Duplex", "ASIO Multimedia Driver", "Premiere", "Adobe" | Workarounds Digidesign, Denon DJ |
| COM | `CoInitialize(0)` | tolerant, eigene Balance | `CoInitialize` im Konstruktor |

**Konsequenz für Opencast**: `GetDesktopWindow()` als `sysRef` und die Annahme "Typ von Kanal 0" haben Präzedenz in PortAudio und sind
daher kein Befund erster Ordnung. Das 3-s-Watchdog-Muster entspricht JUCE (Opencast: 5 s).

## Lizenz (S8, kein Rechtsrat)
- Seit 15.10.2025 steht das ASIO SDK (2.3.4) **dual** unter der *Steinberg ASIO License* oder **GPLv3**.
- "Use of branding is not required under GPLv3 License, but if you choose to use it, trademark compliance is mandatory."
- Proprietäre Variante: Vereinbarung über das Steinberg-Developer-Portal, Nutzungsrichtlinien für Name/Logo.
- Opencast: kein `LICENSE` im Repo, Release-Workflow veröffentlicht `opencast-client-asio.exe` und holt das SDK aus dem Secret `ASIO_SDK_ZIP_B64`.
  Das SDK ist korrekt per `.gitignore` ausgeschlossen. Offen: Welche Lizenzvariante gilt, und gibt es Markenhinweise?

## Lücken dieser Recherche
- Kein Zugriff auf Steinberg-Webseite und die *Usage Guidelines* (PDF, nicht ausgewertet).
- PortAudio-`asioMessages` wurde inzwischen im Quelltext gelesen (siehe `specs/003-ardour-asio-review/research.md`): Reset wird nur mit 1 bestätigt, Overload fehlt. JUCE-Angaben stammen aus einer Zusammenfassung des Quelltextes, nicht aus eigenem Zeilenlesen.
- Kein Zugriff auf echte Treiber; Aussagen zu ReaRoute-Verhalten stammen aus `CLAUDE.md` und Code-Kommentaren.
