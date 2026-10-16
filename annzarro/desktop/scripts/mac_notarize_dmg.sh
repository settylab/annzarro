#!/bin/bash
# mac_notarize_dmg.sh <file.dmg>: notarize a signed dmg with Apple and staple the ticket.
#
# electron-builder notarizes and staples the .app; the dmg it wraps it in is a separate file
# that Apple has not seen. This notarizes the dmg too, so `xcrun stapler validate` passes on
# it and it opens offline. Credentials are read from the environment, never printed:
#   APPLE_API_KEY (path to the .p8) + APPLE_API_KEY_ID + APPLE_API_ISSUER, or
#   APPLE_KEYCHAIN_PROFILE (a `notarytool store-credentials` profile, by name).
set -euo pipefail
dmg=${1:?usage: mac_notarize_dmg.sh <file.dmg>}
if [[ -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_KEY_ID:-}" && -n "${APPLE_API_ISSUER:-}" ]]; then
  auth=(--key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER")
elif [[ -n "${APPLE_KEYCHAIN_PROFILE:-}" ]]; then
  auth=(--keychain-profile "$APPLE_KEYCHAIN_PROFILE")
else
  echo "mac_notarize_dmg: set APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER, or APPLE_KEYCHAIN_PROFILE" >&2
  exit 2
fi
log=$(mktemp)
trap 'rm -f "$log"' EXIT
xcrun notarytool submit "$dmg" "${auth[@]}" --wait 2>&1 | tee "$log"
if ! grep -q "status: Accepted" "$log"; then
  echo "mac_notarize_dmg: Apple did not accept $dmg" >&2
  id=$(sed -n 's/^ *id: //p' "$log" | head -1)
  [[ -n "$id" ]] && xcrun notarytool log "$id" "${auth[@]}" 2>&1 | head -60 >&2
  exit 1
fi
# Stapling fetches the ticket Apple just issued; right after notarization that service has dropped
# the connection (error 68, "The network connection was lost") on two releases in a row. Retry
# with a growing pause (ANNZARRO_STAPLE_PAUSE_S per attempt, 20 s) before failing the build.
pause=${ANNZARRO_STAPLE_PAUSE_S:-20}
for attempt in 1 2 3 4 5; do
  if xcrun stapler staple "$dmg"; then
    exit 0
  fi
  echo "mac_notarize_dmg: stapling $dmg failed (attempt $attempt of 5), retrying in $((attempt * pause)) s" >&2
  sleep $((attempt * pause))
done
echo "mac_notarize_dmg: could not staple $dmg" >&2
exit 1
