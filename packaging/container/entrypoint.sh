#!/bin/sh
# Create the writable state AnnZarro expects, then run the command (gunicorn by default).
# Everything AnnZarro writes lives under $ANNZARRO_HOME (/state); /data is only read.
#
# A /state volume from before 0.7.2 keeps its old layout: data_dir was /state/data (with /data
# linked into it as "data") and panel sets were in /state/data/sessions. Such a volume goes on
# being served from /state/data, so browser paths and panel sets stay as they were; nothing is
# moved or deleted. `annzarro panel-sets migrate` copies the sets when the operator is ready.
#   entrypoint.sh --layout   print the decision (old or new) and what it exports, then exit
set -e
STATE="${ANNZARRO_HOME:-/state}"

# The data directory the configuration in effect gives (the image's /data unless the operator
# mounted a file or set a variable of their own). Empty if the server cannot say.
effective_data_dir() {
    "${ANNZARRO_BIN:-annzarro}" paths --format json 2>/dev/null |
        sed -n '/"label": "data directory"/{n;s/.*"path": "\(.*\)",\{0,1\}$/\1/p;}' | head -n 1
}

# Old layout: /state/data holds panel sets, or the "data" link made by the previous entrypoint,
# and the operator has not chosen another data_dir (a variable, or a mounted configuration file).
old_layout() {
    [ -z "${ANNZARRO_SERVER_DATA_DIR:-}" ] || return 1
    dir="$(effective_data_dir)"
    [ -z "$dir" ] || [ "$dir" = "/data" ] || return 1
    [ -d "$STATE/data/sessions" ] || [ -L "$STATE/data/data" ] || return 1
}

if [ "${1:-}" = "--layout" ]; then
    if old_layout; then
        echo "layout=old"
        echo "ANNZARRO_SERVER_DATA_DIR=$STATE/data"
        echo "ANNZARRO_SERVER_ALLOWED_DIRS=/data"
    else
        echo "layout=new"
    fi
    exit 0
fi

mkdir -p "$STATE/logs" "$STATE/auth"
if old_layout; then
    export ANNZARRO_SERVER_DATA_DIR="$STATE/data"
    export ANNZARRO_SERVER_ALLOWED_DIRS="${ANNZARRO_SERVER_ALLOWED_DIRS:-/data}"
    [ -d /data ] && ln -sfn /data "$STATE/data/data"
    echo "annzarro: this /state volume has the layout of an earlier version; serving $STATE/data as before." >&2
    if ls "$STATE"/data/sessions/*.json >/dev/null 2>&1 && ! ls "$STATE"/panel-sets/*.json >/dev/null 2>&1; then
        echo "annzarro: panel sets are read from $STATE/data/sessions (legacy). To copy them to $STATE/panel-sets: annzarro panel-sets migrate" >&2
    fi
fi
exec "$@"
