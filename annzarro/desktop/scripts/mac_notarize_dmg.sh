#!/bin/bash
# mac_notarize_dmg.sh <file.dmg>: the old name of mac_notarize.sh, which also takes an .app.
exec "$(dirname "$0")/mac_notarize.sh" "$@"
