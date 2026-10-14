#!/usr/bin/env bash
# Orden started the way a Wayland desktop starts it, with no X server anywhere: a
# headless sway with Xwayland off, DISPLAY and GDK_BACKEND unset, three screens the way
# a laptop at a desk has them - one turned to portrait at a fractional 1.77, one at 1,
# one at 1.75 - and a session bus. Then the checks a reader would make by looking:
#
#   - the window maps, on Wayland, as a window sway can see;
#   - nothing the graphics stack says is a failure: no EGL display that could not be
#     made, no protocol error, no GTK criticals;
#   - a key from any app reaches the app the way this desktop allows: through the
#     portal where there is one (PORTAL=1 starts scripts/wayland-portal.py, which binds
#     and then presses quick add), or as `--quick-add` handed to the running app where
#     there is none (SECOND names the command that starts a second copy) - quick add's
#     window comes up either way, floating, as a compositor floats a fixed-size window.
#
# Run inside `dbus-run-session`, with the command that starts Orden:
#
#   dbus-run-session -- scripts/wayland-launch.sh /usr/bin/nib
#
# Everything it saw is left in $OUT (default ./wayland-out) for the job to keep.

set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
out=${OUT:-$PWD/wayland-out}
mkdir -p "$out"

unset DISPLAY GDK_BACKEND WAYLAND_DISPLAY
export XDG_RUNTIME_DIR
XDG_RUNTIME_DIR=$(mktemp -d)
chmod 700 "$XDG_RUNTIME_DIR"
export HOME=${HOME:-/root}

# sway with no GPU and no input: the headless backend, drawn in memory.
export WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1 WLR_HEADLESS_OUTPUTS=3
cat > "$out/sway.conf" <<'CONF'
xwayland disable
output HEADLESS-1 mode --custom 2560x1440@60Hz transform 90 scale 1.77 position 0 0
output HEADLESS-2 mode --custom 2560x1440@60Hz scale 1 position 814 0
output HEADLESS-3 mode --custom 1920x1080@60Hz scale 1.75 position 3374 0
CONF
sway -c "$out/sway.conf" > "$out/sway.log" 2>&1 &
sway_pid=$!

sock=""
for _ in $(seq 100); do
  sock=$(ls "$XDG_RUNTIME_DIR"/sway-ipc.*.sock 2>/dev/null | head -1 || true)
  [ -n "$sock" ] && break
  sleep 0.1
done
[ -n "$sock" ] || { echo "::error::sway did not start"; cat "$out/sway.log"; exit 1; }
export SWAYSOCK=$sock
WAYLAND_DISPLAY=$(basename "$(ls "$XDG_RUNTIME_DIR"/wayland-* | grep -v '\.lock$' | head -1)")
export WAYLAND_DISPLAY
swaymsg -t get_outputs > "$out/outputs.json"
echo "sway on $WAYLAND_DISPLAY, outputs:"
python3 -c 'import json,sys; [print(" ", o["name"], o["rect"], "scale", o["scale"], o["transform"]) for o in json.load(open(sys.argv[1]))]' "$out/outputs.json"

portal_pid=""
if [ "${PORTAL:-0}" = 1 ]; then
  python3 "$here/wayland-portal.py" "$out/portal.log" &
  portal_pid=$!
  for _ in $(seq 50); do
    grep -q '"owned"' "$out/portal.log" 2>/dev/null && break
    sleep 0.1
  done
  grep -q '"owned"' "$out/portal.log" || { echo "::error::the stand-in portal did not start"; exit 1; }
fi

# The windows sway has, one line each: app id, title, floating or tiled, focused.
views() {
  swaymsg -t get_tree | python3 -c '
import json, sys
def walk(node, floating=False):
    if node.get("pid") and node.get("type") in ("con", "floating_con"):
        print(node.get("app_id"), "|", node.get("name"), "|",
              "floating" if node["type"] == "floating_con" else "tiled", "|",
              "focused" if node.get("focused") else "-", "|",
              node["rect"]["width"], "x", node["rect"]["height"])
    for child in node.get("nodes", []) + node.get("floating_nodes", []):
        walk(child)
walk(json.load(sys.stdin))
'
}

wait_for_views() {
  local want=$1
  for _ in $(seq 120); do
    [ "$(views | wc -l)" -ge "$want" ] && return 0
    sleep 0.5
  done
  return 1
}

started=$(date +%s%N)
"$@" > "$out/orden.log" 2>&1 &
app_pid=$!

status=0
if wait_for_views 1; then
  echo "the window mapped after $(( ($(date +%s%N) - started) / 1000000 )) ms:"
  views
else
  echo "::error::no window mapped in 60 s"
  status=1
fi

if [ "$status" = 0 ] && [ -n "${SECOND:-}" ]; then
  sleep 3
  $SECOND > "$out/second.log" 2>&1 || true
  if wait_for_views 2; then
    echo "--quick-add, handed to the running app, brought quick add up:"
    views
  else
    echo "::error::--quick-add brought no window up"
    status=1
  fi
fi

if [ "$status" = 0 ] && [ -n "$portal_pid" ]; then
  if wait_for_views 2; then
    echo "the portal's press brought quick add up:"
    views
  else
    echo "::error::the portal's press brought no window up"
    status=1
  fi
  echo "what the portal was asked:"
  cat "$out/portal.log"
  grep -q '"BindShortcuts"' "$out/portal.log" || { echo "::error::nothing was bound through the portal"; status=1; }
  grep -q 'CTRL+ALT+space' "$out/portal.log" || { echo "::error::quick add's key was not the one preferred"; status=1; }
fi

if [ "$status" = 0 ] && [ -n "${QUICK_ADD_FLOATS:-}" ]; then
  views | grep -q '| floating |' || { echo "::error::quick add's window is tiled"; status=1; }
fi

sleep 2
views > "$out/views.txt" || true
swaymsg -t get_tree > "$out/tree.json" || true
kill "$app_pid" 2>/dev/null || true
wait "$app_pid" 2>/dev/null || true
[ -n "$portal_pid" ] && kill "$portal_pid" 2>/dev/null || true
kill "$sway_pid" 2>/dev/null || true

# The app's own log, which says how keys from other apps reach it here.
find "$HOME" -path '*ch.emilvinu.nib*' -name 'nib.log' -exec cp {} "$out/nib.log" \; 2>/dev/null || true
echo "::group::orden's output"
cat "$out/orden.log"
echo "::endgroup::"
if [ -f "$out/nib.log" ]; then
  echo "::group::nib.log"
  cat "$out/nib.log"
  echo "::endgroup::"
  if [ -n "${KEYS:-}" ]; then
    grep -q "global keys: $KEYS" "$out/nib.log" || { echo "::error::nib.log does not say 'global keys: $KEYS'"; status=1; }
  fi
fi

# What a Wayland session must never print: the EGL display the friend's NixOS box could
# not make, a protocol error, a GTK critical, a display that could not be opened.
if grep -nE 'EGL_BAD_PARAMETER|Could not create default EGL display|Error 71|Protocol error|-CRITICAL|cannot open display|Failed to create GBM|Aborting' "$out/orden.log" "$out/second.log" 2>/dev/null; then
  echo "::error::the graphics stack failed"
  status=1
fi

exit $status
