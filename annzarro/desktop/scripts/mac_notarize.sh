#!/bin/bash
# mac_notarize.sh <file.app|file.dmg>: notarize a signed app or dmg with Apple and staple the ticket.
#
# The release build runs this twice: on the .app, from the electron-builder afterSign hook
# (mac_after_sign.js) before the dmg and the zip are packed, so both carry a stapled app; and on
# each dmg, which is a separate file Apple has not seen, so `xcrun stapler validate` passes on it
# and it opens offline. electron-builder's own notarization is switched off (electron_build.js)
# because it has no retry for the staple step. An .app is zipped with ditto for the upload.
# Credentials are read from the environment, never printed:
#   APPLE_API_KEY (path to the .p8) + APPLE_API_KEY_ID + APPLE_API_ISSUER, or
#   APPLE_KEYCHAIN_PROFILE (a `notarytool store-credentials` profile, by name), or
#   APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID.
set -euo pipefail
target=${1:?usage: mac_notarize.sh <file.app|file.dmg>}
if [[ -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_KEY_ID:-}" && -n "${APPLE_API_ISSUER:-}" ]]; then
  auth=(--key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER")
elif [[ -n "${APPLE_KEYCHAIN_PROFILE:-}" ]]; then
  auth=(--keychain-profile "$APPLE_KEYCHAIN_PROFILE")
elif [[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
  auth=(--apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID")
else
  echo "mac_notarize: set APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER, or APPLE_KEYCHAIN_PROFILE, or APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID" >&2
  exit 2
fi
log=$(mktemp)
work=$(mktemp -d)
trap 'rm -rf "$log" "$work"' EXIT
upload=$target
if [[ -d "$target" ]]; then
  upload="$work/$(basename "$target" .app).zip"
  ditto -c -k --keepParent "$target" "$upload"
fi
xcrun notarytool submit "$upload" "${auth[@]}" --wait 2>&1 | tee "$log"
if ! grep -q "status: Accepted" "$log"; then
  echo "mac_notarize: Apple did not accept $target" >&2
  id=$(sed -n 's/^ *id: //p' "$log" | head -1)
  [[ -n "$id" ]] && xcrun notarytool log "$id" "${auth[@]}" 2>&1 | head -60 >&2
  exit 1
fi
# Stapling fetches the ticket Apple just issued; right after notarization that service has dropped
# the connection (error 68, "The network connection was lost") on three releases in a row, for the
# dmg and for the app. Retry with a growing pause (ANNZARRO_STAPLE_PAUSE_S per attempt, 20 s)
# before failing the build.
pause=${ANNZARRO_STAPLE_PAUSE_S:-20}
for attempt in 1 2 3 4 5; do
  if xcrun stapler staple "$target"; then
    exit 0
  fi
  echo "mac_notarize: stapling $target failed (attempt $attempt of 5), retrying in $((attempt * pause)) s" >&2
  sleep $((attempt * pause))
done
echo "mac_notarize: could not staple $target" >&2
exit 1
