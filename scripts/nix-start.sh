#!/usr/bin/env bash
# Starts Orden out of a flake inside a headless sway and says whether it came up:
# a window has to map, stay mapped, and the log must name no missing library and
# no display or EGL failure. What .github/workflows/nix.yml runs, on a runner with
# no screen and no GPU.
#
#   scripts/nix-start.sh wayland <flake>   native Wayland: no Xwayland, no DISPLAY
#   scripts/nix-start.sh x11 <flake>       X11, through sway's Xwayland, with no
#                                          WAYLAND_DISPLAY for GTK to prefer
#
# sway is wlroots, like Hyprland, and it says what each window is: `shell` is
# xdg_shell for a Wayland client and xwayland for an X11 one. Leaves <mode>.log,
# <mode>.png, <mode>.json and <mode>.env in the working directory.
#
# With STRANGER_PLUGINS set to a folder of shared libraries that are not
# GStreamer's, the app is started with both of GStreamer's plugin paths pointing
# at it, the way a NixOS profile's lib/ full of Qt and KDE plugins reaches a
# session. The app's environment must have neither, and with GST_INSPECT set,
# GStreamer itself is started in exactly that environment and must load its own
# plugins and nothing else.
set -euo pipefail

mode=${1:?wayland or x11}
flake=${2:?a flake, as nix run takes it}
out=$PWD

case "$mode" in
  wayland) xwayland=disable shell=xdg_shell drop=DISPLAY ;;
  x11) xwayland=enable shell=xwayland drop=WAYLAND_DISPLAY ;;
  *) echo "no mode $mode" >&2; exit 2 ;;
esac

stranger=""
if [ -n "${STRANGER_PLUGINS:-}" ]; then
  stranger="GST_PLUGIN_PATH=$STRANGER_PLUGINS GST_PLUGIN_SYSTEM_PATH_1_0=$STRANGER_PLUGINS"
fi

export XDG_RUNTIME_DIR=$(mktemp -d)
chmod 700 "$XDG_RUNTIME_DIR"
printf 'xwayland %s\noutput HEADLESS-1 resolution 1280x800\n' "$xwayland" >"$out/sway-$mode.conf"
WLR_BACKENDS=headless WLR_LIBINPUT_NO_DEVICES=1 WLR_RENDERER=pixman \
  env -u DISPLAY -u WAYLAND_DISPLAY sway -c "$out/sway-$mode.conf" >"$out/sway-$mode.log" 2>&1 &
sway=$!
trap 'kill "$sway" 2>/dev/null || true' EXIT

for _ in $(seq 30); do
  SWAYSOCK=$(ls "$XDG_RUNTIME_DIR"/sway-ipc.*.sock 2>/dev/null | head -1) && [ -n "$SWAYSOCK" ] && break
  sleep 1
done
[ -n "${SWAYSOCK:-}" ] || { cat "$out/sway-$mode.log"; exit 1; }
export SWAYSOCK

# Started by sway, so it gets sway's own WAYLAND_DISPLAY and, with Xwayland on,
# its DISPLAY; the other one is taken away.
swaymsg exec "env -u $drop $stranger nix run '$flake' >'$out/$mode.log' 2>&1" >/dev/null

views='[recurse(.nodes[]?, .floating_nodes[]?) | select(.pid? != null and (.type == "con" or .type == "floating_con"))]'
for _ in $(seq 180); do
  [ "$(swaymsg -t get_tree | jq "$views | length")" -gt 0 ] && break
  sleep 1
done
swaymsg -t get_tree | jq "$views | map({pid, app_id, class: .window_properties.class?, name, shell})" | tee "$out/$mode.json"

failed=0
if [ "$(jq length "$out/$mode.json")" -eq 0 ]; then
  echo "::error::no window on $mode within three minutes"
  failed=1
elif ! jq -e --arg shell "$shell" 'all(.shell == $shell)' "$out/$mode.json" >/dev/null; then
  echo "::error::the window on $mode is not an $shell one"
  failed=1
else
  # Long enough for the page to load and paint in software.
  sleep 15
  WAYLAND_DISPLAY=$(cd "$XDG_RUNTIME_DIR" && ls wayland-? | head -1) grim "$out/$mode.png"
  pid=$(jq '.[0].pid' "$out/$mode.json")

  # What it runs with: GTK picks the backend itself, on Mesa the DMA-BUF
  # renderer stays on, and GStreamer looks at its own plugins only.
  mapfile -d '' environment <"/proc/$pid/environ"
  printf '%s\n' "${environment[@]}" |
    grep -E '^(GDK_BACKEND|WEBKIT_DISABLE_DMABUF_RENDERER|WAYLAND_DISPLAY|DISPLAY|GST_[A-Z_0-9]*|LD_PRELOAD|LD_LIBRARY_PATH)=' |
    tee "$out/$mode.env" || true
  if grep -q '^GDK_BACKEND=' "$out/$mode.env"; then
    echo "::error::something set GDK_BACKEND on $mode"
    failed=1
  fi
  if grep -qE '^LD_(PRELOAD|LIBRARY_PATH)=' "$out/$mode.env"; then
    echo "::error::the app runs with LD_PRELOAD or LD_LIBRARY_PATH"
    failed=1
  fi
  if [ ! -e /proc/driver/nvidia/version ] && grep -q '^WEBKIT_DISABLE_DMABUF_RENDERER=' "$out/$mode.env"; then
    echo "::error::the DMA-BUF renderer is off with no NVIDIA driver"
    failed=1
  fi
  if [ -n "${STRANGER_PLUGINS:-}" ]; then
    if grep -qE '^GST_PLUGIN_PATH(_1_0)?=' "$out/$mode.env" || grep -qF "$STRANGER_PLUGINS" "$out/$mode.env"; then
      echo "::error::the session's GStreamer plugin path reached the app"
      failed=1
    fi
    if ! grep -q '^GST_REGISTRY_1_0=' "$out/$mode.env"; then
      echo "::error::GStreamer keeps no registry of the app's own"
      failed=1
    fi
  fi
  if [ -n "${GST_INSPECT:-}" ]; then
    # The elements WebKit plays a video and its sound with.
    for element in playbin autoaudiosink videoconvert vp9dec avdec_h264 opusdec; do
      if ! env -i "${environment[@]}" "$GST_INSPECT" "$element" >>"$out/$mode.gst.log" 2>&1; then
        echo "::error::GStreamer, as the app runs it, has no $element"
        failed=1
      fi
    done
    if grep -E 'GStreamer-WARNING|Failed to load plugin' "$out/$mode.gst.log"; then
      echo "::error::GStreamer, as the app runs it, tried to load a plugin that is not its own"
      failed=1
    fi
  fi

  if ! kill -0 "$pid" 2>/dev/null || [ "$(swaymsg -t get_tree | jq "$views | length")" -eq 0 ]; then
    echo "::error::the window on $mode closed on its own"
    failed=1
  fi
  kill "$pid" 2>/dev/null || true
fi

sleep 1
cat "$out/$mode.log"
if grep -iE 'error while loading shared libraries|cannot open shared object|cannot open display|Could not create default EGL display|EGL_BAD|failed to create EGL|Failed to create GBM|gstreamer.*not found|GStreamer-WARNING|Failed to load plugin|LD_PRELOAD' "$out/$mode.log"; then
  echo "::error::the log on $mode says something is missing"
  failed=1
fi
exit "$failed"
