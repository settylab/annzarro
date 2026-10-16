# Sourced by mac_notarize.sh and mac_verify_signature.sh.
#
# stapler_retry <staple|validate> <app-or-dmg> [any]: run `xcrun stapler <verb>`, trying up to five
# times with a growing pause (ANNZARRO_STAPLE_PAUSE_S per attempt, 20 s). Both verbs talk to Apple's
# CloudKit ticket service, which drops the connection (error 68, "The network connection was lost",
# CloudKit -1005) often enough to fail releases. By default only that failure is retried: a real
# answer such as "does not have a ticket stapled" fails at once, so a missing ticket is never retried
# into a pass. `any` retries every failure (stapling right after notarization).
stapler_retry() {
  local verb=$1 target=$2 mode=${3:-network} pause=${ANNZARRO_STAPLE_PAUSE_S:-20} attempt out status
  for attempt in 1 2 3 4 5; do
    status=0
    out=$(xcrun stapler "$verb" "$target" 2>&1) || status=$?
    printf '%s\n' "$out"
    [[ $status -eq 0 ]] && return 0
    if [[ $mode != any ]] && ! grep -qiE 'Error 68|network connection was lost|-1005|NSURLErrorDomain|CloudKit' <<<"$out"; then
      echo "stapler $verb failed for $target and it is not a network error: not retrying" >&2
      return "$status"
    fi
    if [[ $attempt -lt 5 ]]; then
      echo "stapler $verb $target failed (attempt $attempt of 5), retrying in $((attempt * pause)) s" >&2
      sleep $((attempt * pause))
    fi
  done
  echo "stapler $verb: gave up on $target after 5 attempts" >&2
  return 1
}
