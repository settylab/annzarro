#!/usr/bin/env bash
# Convert the F1 (GSE235863, Guo 2025 anti-PD-1+lenvatinib HBV+ HCC CD45+ immune)
# harmonized h5ad -> CSC zarr, then promote + symlink into the served tree.
# Writes a temp store first; only promotes on success so the dataset appears
# atomically (no half-written store ever becomes browsable).
set -uo pipefail
ROOT=/fh/fast/setty_m/user/dotto/nexus/work/annzarro
PY=$ROOT/.venv-convert/bin/python
SRC=/fh/fast/setty_m/user/dotto/nexus/work/liver-data-research/data/processed/GSE235863.h5ad
ZDIR=/fh/fast/setty_m/user/dotto/nexus/work/liver-data-research/data/processed_zarr
TMP=$ZDIR/GSE235863_harmonized.zarr.tmp
FINAL=$ZDIR/GSE235863_harmonized.zarr
LINK=$ROOT/served-data/datasets/GSE235863_harmonized.zarr
LOG=$ROOT/runs/convert_gse235863.log
SENT=$ROOT/runs/convert_gse235863.done
rm -f "$SENT"
{
  echo "[driver] $(date -Is) start; src=$SRC"
  rm -rf "$TMP"
  "$PY" "$ROOT/convert_to_zarr.py" "$SRC" "$TMP"
  rc=$?
  if [ $rc -ne 0 ]; then echo "[driver] convert FAILED rc=$rc"; echo "FAIL rc=$rc" > "$SENT"; exit $rc; fi
  # promote temp -> final atomically (same filesystem rename)
  rm -rf "$FINAL"
  mv "$TMP" "$FINAL"
  # symlink into served tree (match the other 17 datasets' convention)
  ln -sfn "$FINAL" "$LINK"
  echo "[driver] $(date -Is) promoted + symlinked: $LINK -> $FINAL"
  echo "OK" > "$SENT"
} >> "$LOG" 2>&1
