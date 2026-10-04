# packaging-release Specification

## Purpose
Beschreibt Build, Container-Image und Release-Artefakte.

## Requirements

### Requirement: Container-Image
Das Container-Image SHALL Frontend und Server in einem mehrstufigen Build erzeugen, auf Port 8765 lauschen und Einstellungen im Volume `/config` ablegen.

#### Scenario: docker compose
- **WHEN** `docker compose up -d` ausgeführt wird
- **THEN** ist die Web-UI unter Port 8765 erreichbar und Einstellungen bleiben im Host-Volume erhalten

### Requirement: Image-Veröffentlichung
Der Docker-Workflow SHALL bei Push auf `main` und Versions-Tags ein Image bauen und veröffentlichen, bei Pull Requests nur bauen.

#### Scenario: Pull Request
- **WHEN** ein Pull Request gegen `main` geöffnet wird
- **THEN** wird das Image gebaut, aber nicht veröffentlicht

### Requirement: Release-Artefakte
Ein Tag `v*` SHALL Server (Linux, Windows), den WASAPI-Client und den ASIO-Client `opencast-client-asio.exe` bauen und an ein GitHub-Release anhängen.

#### Scenario: Neuer Release
- **WHEN** ein Tag `v1.2.3` gepusht wird
- **THEN** enthält das Release alle genannten Binaries

### Requirement: ASIO-Build
Der ASIO-Client SHALL nur mit Build-Tag `asio`, MinGW und dem ASIO SDK gebaut werden; das SDK SHALL nicht im Repository liegen.

#### Scenario: Ohne SDK
- **WHEN** das SDK fehlt
- **THEN** wird nur der WASAPI-Client gebaut
