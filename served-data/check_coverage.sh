#!/usr/bin/env bash
# Coverage drift gate: every DoLiMap dataset entity must have a live served zarr.
# Exits nonzero on any gap (uncovered entity, missing zarr, or undocumented
# entity-file drift). Wire into CI or run by hand after touching served-data/.
#
#   bash served-data/check_coverage.sh
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY="$ROOT/.venv-pilot/bin/python3"
[ -x "$PY" ] || PY="$(command -v python3)"
exec "$PY" "$ROOT/served-data/build_manifest.py" --check
