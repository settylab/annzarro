#!/bin/bash
# mac_verify_signature.sh <AnnZarro.app> [<file.dmg>...]: the checks a release must pass.
#
#   codesign --verify --deep --strict    the signature is complete and unmodified
#   spctl -a -vv -t exec                 Gatekeeper accepts it and says "Notarized Developer ID"
#   xcrun stapler validate               the notarization ticket is stapled (app and each dmg)
#
# Any failure stops the script with a non-zero status. Prints no secrets.
set -euo pipefail
app=${1:?usage: mac_verify_signature.sh <AnnZarro.app> [<file.dmg>...]}
shift
echo "== codesign --verify --deep --strict $app"
codesign --verify --deep --strict --verbose=2 "$app"
echo "== spctl -a -vv -t exec $app"
out=$(spctl -a -vv -t exec "$app" 2>&1) || { echo "$out"; echo "Gatekeeper rejected the app" >&2; exit 1; }
echo "$out"
grep -q "source=Notarized Developer ID" <<<"$out" || { echo "the app is not notarized (expected source=Notarized Developer ID)" >&2; exit 1; }
echo "== xcrun stapler validate $app"
xcrun stapler validate "$app"
for dmg in "$@"; do
  echo "== xcrun stapler validate $dmg"
  xcrun stapler validate "$dmg"
done
echo "signature checks passed"
