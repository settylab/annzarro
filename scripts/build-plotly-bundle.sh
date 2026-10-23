#!/bin/sh
# Rebuild scripts/plotly/plotly-2.35.3-annzarro.min.js, the Plotly.js bundle AnnZarro ships,
# from plotly.js's own partial-bundle tool at the pinned tag.
#
#   scripts/build-plotly-bundle.sh [--check] [WORKDIR]
#
# Builds in WORKDIR (default: a new temporary directory, removed afterwards) and, without
# --check, writes the result next to this script. With --check the committed file is left alone
# and the script fails unless the rebuild is the committed one. Needs git, node and npm; the
# source comes from github.com/plotly/plotly.js (tag v2.35.3) and the npm registry, with
# `npm ci --ignore-scripts`. Also writes scripts/plotly/bundle-packages.txt, the names of the npm
# packages inside the file (webpack's modules plus the prebuilt stackgl set; input of
# scripts/plotly_licences.py).
#
# The traces are the ones static/js creates: scatter (the colour-scale probe), scattergl (every
# 2D plot) and scatter3d (3D plots). No transforms. plotly.js's tool always adds the calendars
# component and the core, which carry the layout features AnnZarro uses (legend, colour bar,
# shapes, annotations, modebar, image export). Update the list below together with any new trace
# type in static/js; the browser test tests_browser/test_plotly_traces.py fails when a trace type
# AnnZarro creates is missing.
#
# The build is NOT byte-reproducible across checkouts: webpack derives its numeric module ids
# from the absolute path of the checkout (two clean builds in different directories differ by
# those ids, a few dozen bytes; the same directory rebuilds identically), and plotly.js writes the
# build year into the banner. The committed file is therefore the source of truth, pinned by the
# sha256 in scripts/vendor-assets.json. --check compares the rebuild with it after dropping every
# digit, which catches a changed trace list, tag or dependency but not the ids.
set -eu

TAG=v2.35.3
COMMIT=0c13c691e257045d7903c62d9c234a6cdbc0be53
TRACES=scatter,scattergl,scatter3d
OUT_NAME=plotly-2.35.3-annzarro.min.js

here=$(cd "$(dirname "$0")" && pwd)
dest=$here/plotly/$OUT_NAME
check=0
if [ "${1:-}" = "--check" ]; then check=1; shift; fi
if [ -n "${1:-}" ]; then work=$1; keep=1; mkdir -p "$work"; else work=$(mktemp -d); keep=0; fi
[ "$keep" = 1 ] || trap 'rm -rf "$work"' EXIT

src=$work/plotly.js
if [ ! -d "$src" ]; then
  git clone --quiet --depth 1 --branch "$TAG" https://github.com/plotly/plotly.js.git "$src"
fi
[ "$(git -C "$src" rev-parse HEAD)" = "$COMMIT" ] || { echo "error: $TAG is not commit $COMMIT" >&2; exit 1; }

cd "$src"
npm ci --ignore-scripts --no-audit --no-fund >/dev/null
npm run --silent preprocess
node tasks/custom_bundle.js --out annzarro --traces "$TRACES" --transforms none >/dev/null
built=$src/dist/plotly-annzarro.min.js

# Ids and the banner year depend on where and when it was built; the code does not.
norm() { tr -d '0-9' < "$1" | shasum -a 256 | cut -d' ' -f1; }
if [ "$(norm "$built")" != "$(norm "$dest")" ]; then
  echo "rebuilt bundle differs from $dest" >&2
  [ "$check" = 1 ] && exit 1
  echo "replacing it; update the sha256 and size in scripts/vendor-assets.json" >&2
fi
if [ "$check" = 1 ]; then echo "ok: the committed bundle is what $TAG builds"; exit 0; fi

cp "$built" "$dest"
mkdir -p "$work/ml"
{
  NODE_PATH=$src/node_modules node "$here/plotly/modlist.js" "$src" "$work/ml" 2>/dev/null | grep -v '^\[BABEL\]' | sed 's/@[^@]*$//'
  # stackgl_modules/index.js (scatter3d's WebGL code) is prebuilt from this lock file
  node -e 'const p=require(process.argv[1]).packages;for(const k in p)if(k&&!p[k].dev)console.log(k.split("node_modules/").pop())' "$src/stackgl_modules/package-lock.json"
} | sort -u > "$here/plotly/bundle-packages.txt"
shasum -a 256 "$dest"
wc -c < "$dest"
