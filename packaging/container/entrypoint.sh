#!/bin/sh
# Create the writable state AnnZarro expects, then run the command (gunicorn by default).
# Panel sets live in <data_dir>/sessions, the rest of the state under $ANNZARRO_HOME.
set -e
STATE="${ANNZARRO_HOME:-/state}"
mkdir -p "$STATE/data/sessions" "$STATE/logs" "$STATE/auth"
# The datasets appear in the browser as the folder "data" next to the saved panel sets (the
# browser lists data_dir, and /data is permitted through server.allowed_dirs).
[ -d /data ] && ln -sfn /data "$STATE/data/data"
exec "$@"
