#!/usr/bin/env bash
# The AppImage Tauri builds, without the libraries a Linux desktop's own graphics stack
# has to supply: the Wayland client libraries, xkbcommon, EGL, GL, GBM and DRM. Copies
# of those from the build machine's Ubuntu sit under the host's Mesa or NVIDIA driver,
# which then cannot make an EGL display - "Could not create default EGL display:
# EGL_BAD_PARAMETER. Aborting...", NixOS under Hyprland, 2026-10-14 - and the window
# never comes. Tauri's bundler leaves libwayland-client out since 2.12; this takes the
# rest out the same way.
#
# Rebuilt in place from its own runtime and the same compression, nothing downloaded:
# the image is the runtime with a squashfs after it, and only the squashfs changes.
# With TAURI_SIGNING_PRIVATE_KEY set, the updater's signature beside it is made again
# for the bytes that are now there.
#
#   scripts/appimage-trim.sh path/to/Orden.AppImage
#
# Needs squashfs-tools.

set -euo pipefail

image=$(realpath "$1")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"

offset=$("$image" --appimage-offset)
"$image" --appimage-extract > /dev/null

echo "taken out of $(basename "$image"):"
find squashfs-root \( -name 'libwayland-*' -o -name 'libxkbcommon*' -o -name 'libEGL*' \
  -o -name 'libGL*' -o -name 'libgbm*' -o -name 'libdrm*' \) -prune -print -exec rm -rf {} +

compression=$(unsquashfs -s -o "$offset" "$image" | sed -n 's/^Compression //p' | head -1)
head -c "$offset" "$image" > runtime
mksquashfs squashfs-root squashfs -root-owned -noappend -quiet -comp "${compression:-gzip}"
cat runtime squashfs > trimmed
chmod +x trimmed
mv trimmed "$image"

if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ] && [ -f "$image.sig" ]; then
  rm "$image.sig"
  pnpm --dir "$OLDPWD" --filter @nib/desktop exec tauri signer sign "$image" > /dev/null
  echo "signed again: $(basename "$image").sig"
fi
