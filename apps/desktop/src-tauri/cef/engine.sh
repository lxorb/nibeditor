#!/usr/bin/env bash
# The CEF distribution the engine build is pinned to, for one Rust target, laid out in
# $CEF_DIR the way `cef-dll-sys` compiles against it and `pack.py` packs it, and named
# to the rest of the job as CEF_PATH.
#
# The version is the pin in Cargo.toml beside this (`[package.metadata.engine]`), so
# nothing here is written down twice. `export-cef-dir` is upstream's own exporter, at
# the same version as the `cef` crate the build takes.
#
#     bash engine.sh aarch64-pc-windows-msvc
set -euo pipefail

target="${1:?the Rust target the engine is for}"
here="$(cd "$(dirname "$0")" && pwd)"
version="$(sed -n '/^\[package.metadata.engine\]/,/^\[/s/^cef = "\(.*\)"$/\1/p' "$here/Cargo.toml")"
[ -n "$version" ] || { echo "no cef pin in $here/Cargo.toml" >&2; exit 1; }

if [ ! -f "$CEF_DIR/archive.json" ]; then
  cargo install export-cef-dir --version "=$version" --locked
  export-cef-dir --force --target "$target" "$CEF_DIR"
fi
echo "CEF_PATH=$CEF_DIR" >>"${GITHUB_ENV:-/dev/null}"
echo "the engine is cef $version for $target, in $CEF_DIR"
