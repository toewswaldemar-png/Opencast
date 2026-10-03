#!/usr/bin/env bash
# Reproduziert die Befunde F-01, F-23, F-24 und F-22 unter Linux, ohne Windows/ASIO/MinGW.
#
# Technik: `go test -overlay` blendet die Dateien mit `//go:build windows` (hub, registry, ffmpeg-Resolver)
# ohne Tag ein und ergänzt einen Platzhalter für audio.NewCapturer. Der Hub-Code selbst bleibt unverändert,
# nur der Bridge-Aufruf (asio_bridge.go:63-79) wird im Test nachgebildet.
# Voraussetzungen: Go >= 1.22, ffmpeg im PATH (die vorhandenen Hub-Tests starten es), Internet für `go mod download`.
#
# Aufruf (aus dem Repo-Root):  specs/004-opencast-asio-deep-review/repro/run.sh [-run Muster]
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
C="$ROOT/client"
HERE="$ROOT/specs/004-opencast-asio-deep-review/repro"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

strip_tag() { mkdir -p "$T/$(dirname "$1")"; sed '1{/^\/\/go:build/d}' "$C/$1" > "$T/$1"; }
for f in internal/hub/hub.go internal/hub/hub_test.go internal/hub/registry.go internal/ffmpeg/resolve_windows.go; do strip_tag "$f"; done
cat > "$T/zz_stub.go" <<'GO'
package audio

// Linux-Overlay: Platzhalter, damit der Hub ohne WASAPI/ASIO kompiliert.
func NewCapturer(cfg CaptureConfig) Capturer { return nil }
GO
cp "$HERE/hub_deep_test.go.txt"        "$T/zz_deep_test.go"
cp "$HERE/pcmbuffer_drift_test.go.txt" "$T/zz_drift_test.go"

python3 - "$C" "$T" <<'PY'
import json, sys
C, T = sys.argv[1], sys.argv[2]
rep = {
  f"{C}/internal/hub/hub.go": f"{T}/internal/hub/hub.go",
  f"{C}/internal/hub/hub_test.go": f"{T}/internal/hub/hub_test.go",
  f"{C}/internal/hub/registry.go": f"{T}/internal/hub/registry.go",
  # Datei mit Suffix _windows.go wird von Go nach dem Dateinamen gefiltert -> unter anderem Namen einblenden
  f"{C}/internal/ffmpeg/resolve_windows.go": "",
  f"{C}/internal/ffmpeg/resolve_ov.go": f"{T}/internal/ffmpeg/resolve_windows.go",
  f"{C}/internal/audio/zz_stub_linux.go": f"{T}/zz_stub.go",
  f"{C}/internal/hub/zz_deep_test.go": f"{T}/zz_deep_test.go",
  f"{C}/internal/pcmbuffer/zz_drift_test.go": f"{T}/zz_drift_test.go",
}
json.dump({"Replace": rep}, open(f"{T}/overlay.json", "w"), indent=1)
PY

cd "$C"
echo "== 1. Bestehende Tests (Basislinie, mit Race-Detector) =="
go test -overlay="$T/overlay.json" -race -count=1 ./internal/hub/ ./internal/pcmbuffer/ ./internal/streamsession/ -skip 'TestDeep_|TestDriftSimulation' 2>&1 | grep -v '^go: downloading\|^20[0-9][0-9]/'
echo
echo "== 2. Tiefenprüfung: F-23, F-01 (erwartet FAIL), F-24, Race-Stress =="
go test -overlay="$T/overlay.json" -race -count=1 -v -run 'TestDeep_' ./internal/hub/ 2>&1 | grep -v '^go: downloading\|^20[0-9][0-9]/' || true
echo
echo "== 3. Drift-Simulation F-22 (virtuelle Zeit, 1 h je Zeile, ca. 10 s) =="
go test -overlay="$T/overlay.json" -count=1 -v -run TestDriftSimulation ./internal/pcmbuffer/ 2>&1 | grep -v '^go: downloading' || true
