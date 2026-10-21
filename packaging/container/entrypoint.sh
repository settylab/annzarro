#!/bin/sh
# Create the writable state AnnZarro expects, then run the command (gunicorn by default).
# Everything AnnZarro writes lives under $ANNZARRO_HOME (/state); /data is only read.
set -e
STATE="${ANNZARRO_HOME:-/state}"
mkdir -p "$STATE/logs" "$STATE/auth"
# A /state volume from before panel sets had a folder of their own holds them in
# /state/data/sessions, which the server no longer reads. Say so; nothing is moved or deleted.
if ls "$STATE"/data/sessions/*.json >/dev/null 2>&1 && ! ls "$STATE"/panel-sets/*.json >/dev/null 2>&1; then
    echo "annzarro: panel sets from an earlier version are in $STATE/data/sessions. Copy them with:" >&2
    echo "  annzarro panel-sets migrate --data-dir $STATE/data   (nothing is deleted)" >&2
fi
exec "$@"
