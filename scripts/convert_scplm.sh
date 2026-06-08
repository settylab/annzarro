#!/usr/bin/env bash
# Harmonize + convert the D3 (scPLM, Tong/Wang 2024 pan-cancer liver-met atlas,
# DOI 10.34133/research.1208) raw atlas -> CSC zarr, then promote + symlink into
# the served tree. Temp store first; promote only on success (atomic appearance).
set -uo pipefail
ROOT=/fh/fast/setty_m/user/dotto/nexus/work/annzarro
PY=$ROOT/.venv-convert/bin/python
SRC=/fh/fast/setty_m/user/dotto/nexus/work/liver-data-research/data/raw/scPLM/scPLM.h5ad
ZDIR=/fh/fast/setty_m/user/dotto/nexus/work/liver-data-research/data/processed_zarr
TMP=$ZDIR/scPLM_harmonized.zarr.tmp
FINAL=$ZDIR/scPLM_harmonized.zarr
LINK=$ROOT/served-data/datasets/scPLM_harmonized.zarr
LOG=$ROOT/runs/convert_scplm.log
SENT=$ROOT/runs/convert_scplm.done
rm -f "$SENT"
{
  echo "[driver] $(date -Is) start; src=$SRC"
  rm -rf "$TMP"
  "$PY" "$ROOT/scripts/harmonize_scplm.py" "$SRC" "$TMP"
  rc=$?
  if [ $rc -ne 0 ]; then echo "[driver] harmonize FAILED rc=$rc"; echo "FAIL rc=$rc" > "$SENT"; exit $rc; fi
  rm -rf "$FINAL"
  mv "$TMP" "$FINAL"
  ln -sfn "$FINAL" "$LINK"
  echo "[driver] $(date -Is) promoted + symlinked: $LINK -> $FINAL"
  echo "OK" > "$SENT"
} >> "$LOG" 2>&1
