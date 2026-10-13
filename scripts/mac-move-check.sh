#!/bin/bash
# The way out for a Mac's copy that cannot update itself: this build, started from a
# disk image as somebody who never dragged it anywhere starts it, says it is stuck,
# moves itself into Applications and comes back from there, no longer stuck. On a
# runner that is nobody's machine, under an identifier of its own and with the updater
# pointed nowhere. Usage: mac-move-check.sh <the built .app>
set -u

built="$1"
identifier="ch.emilvinu.nib.probe.mac-move"
cli="$(cd "$(dirname "$0")/.." && pwd)/apps/cli/nib.mjs"
support="$HOME/Library/Application Support/$identifier"
export NIB_ENDPOINT="$support/automation.json"
name="$(basename "$built")"
image=/tmp/nib-move.dmg
mount=/tmp/nib-move

rm -f "$image"
hdiutil create -quiet -srcfolder "$built" -format UDZO "$image"
hdiutil attach -nobrowse -readonly -mountpoint "$mount" "$image" >/dev/null
app="$mount/$name"
moved="/Applications/$name"
rm -rf "$moved"

say_eval() { node "$cli" eval "$1" --yes 2>&1; }
running() { pgrep -f "$1/Contents/MacOS/" >/dev/null; }

up() {
  for _ in $(seq 60); do
    [ -f "$NIB_ENDPOINT" ] && running "$1" && node "$cli" verbs >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "nothing answered from $1"
  return 1
}

quit_app() {
  osascript -e "quit app id \"$identifier\"" >/dev/null 2>&1 || true
  for _ in $(seq 20); do running "$1" || return 0; sleep 1; done
  pkill -f "$1/Contents/MacOS/" || true
  sleep 2
}

rm -rf "$support"
open "$app"
up "$app" || exit 1
python3 - "$NIB_ENDPOINT" <<'EOF'
import json, sys
path = sys.argv[1]
held = json.load(open(path))
held["eval"] = True
json.dump(held, open(path, "w"))
EOF
quit_app "$app"
open "$app"
up "$app" || exit 1

verdict=0
from_image="$(say_eval "await window.__TAURI_INTERNALS__.invoke('app_stuck')")"
echo "stuck on the disk image: $from_image"
case "$from_image" in *true*) ;; *) echo "FAILED: the copy on the disk image did not say it is stuck"; verdict=1 ;; esac

say_eval "void window.__TAURI_INTERNALS__.invoke('move_to_applications'), 'asked'"
for _ in $(seq 60); do running "$app" || break; sleep 1; done
running "$app" && { echo "FAILED: the copy on the disk image is still running"; verdict=1; }
up "$moved" || verdict=1
ls /Applications | grep -i nib || true
xattr -l "$moved" | grep -q quarantine && { echo "FAILED: the moved copy is quarantined"; verdict=1; }

in_place="$(say_eval "await window.__TAURI_INTERNALS__.invoke('app_stuck')")"
echo "stuck in Applications: $in_place"
case "$in_place" in *false*) ;; *) echo "FAILED: the copy in Applications says it is stuck"; verdict=1 ;; esac

quit_app "$moved"
hdiutil detach "$mount" >/dev/null 2>&1 || true
rm -rf "$moved"
[ "$verdict" = 0 ] && echo "the copy moved itself to Applications and runs from there"
exit $verdict
