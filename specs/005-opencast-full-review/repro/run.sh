#!/usr/bin/env bash
# Prüft Server-Befunde (S-1 … S-3, R-1, W-1, C-1) und die Szenarien der OpenSpec-Basisspezifikationen gegen den echten Server-Code.
# Technik: `go test -overlay` fügt die Tests als temporäres Paket server/internal/xtest ein; das Repository bleibt unverändert.
# Voraussetzungen: Go >= 1.22, Internet für `go mod download`.
#
# Aufruf (aus dem Repo-Root):  specs/005-opencast-full-review/repro/run.sh [spec|deep|all]
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
SV="$ROOT/server"
HERE="$ROOT/specs/005-opencast-full-review/repro"
T="$(mktemp -d)"
mkdir -p "$SV/internal/xtest"
trap 'rm -rf "$T"; rmdir "$SV/internal/xtest" 2>/dev/null || true' EXIT
cp "$HERE/server_deep_test.go.txt"        "$T/zz_server_deep_test.go"
cp "$HERE/server_conformance_test.go.txt" "$T/zz_conformance_test.go"
python3 - "$SV" "$T" <<'PY'
import json, sys
SV, T = sys.argv[1], sys.argv[2]
json.dump({"Replace": {
  f"{SV}/internal/xtest/zz_server_deep_test.go": f"{T}/zz_server_deep_test.go",
  f"{SV}/internal/xtest/zz_conformance_test.go": f"{T}/zz_conformance_test.go"}}, open(f"{T}/overlay.json", "w"))
PY
cd "$SV"
mode="${1:-all}"
if [[ "$mode" == spec || "$mode" == all ]]; then
  echo "== A. Spec-Konformität (openspec/specs/*), erwartet: alle PASS =="
  go test -overlay="$T/overlay.json" -count=1 -timeout 120s -v -run 'TestSpec_' ./internal/xtest/ 2>&1 | grep -E '^(--- |PASS|FAIL|ok)' || true
fi
if [[ "$mode" == deep || "$mode" == all ]]; then
  echo; echo "== B. Befund-Tests (erwartet: S1, S2, S3, W1 FAIL = Befund bestätigt) =="
  for t in TestS1 TestS2 TestS3 TestW1; do
    go test -overlay="$T/overlay.json" -count=1 -timeout 90s -v -run "$t" ./internal/xtest/ 2>&1 | grep -E 'zz_server_deep|^--- ' | head -8 || true
  done
  echo; echo "== C. Race-Detektor und Nebenläufigkeit (R1: Panic bei gleichzeitigem Unregister, C1: Data Races im Icecast-Client) =="
  go test -overlay="$T/overlay.json" -race -count=100 -timeout 150s -run TestR1 ./internal/xtest/ 2>&1 | grep -E 'DATA RACE|^--- FAIL|von 64' | sort | uniq -c | head -6 || true
  go test -overlay="$T/overlay.json" -race -count=1 -timeout 60s -run TestC1 ./internal/xtest/ 2>&1 | grep -E 'DATA RACE' | sort | uniq -c || true
fi
