#!/bin/bash
# Claude Code and Codex in the person's home (docs/online-terminal.md 4.2, 4.7), run as
# the user at every boot.
#
# Both unmodified and by their makers' own routes, every sign-in method left in:
# - Claude Code by Anthropic's installer, which checks the binary against the SHA-256
#   in the release's manifest before it installs it, and keeps it current itself;
# - Codex by npm, which checks every package against the registry's SHA-512 integrity,
#   updated here at each boot since an npm install has no updater of its own.
# Neither is ever signed in to by nib, and nothing here reads what they keep.
set -uo pipefail

export NPM_CONFIG_PREFIX="$HOME/.local"
export PATH="$HOME/.local/bin:$PATH"
mkdir -p "$HOME/.local/bin"

if ! command -v claude >/dev/null 2>&1; then
  installer=$(mktemp)
  if curl -fsSL https://claude.ai/install.sh -o "$installer"; then
    bash "$installer" || echo "claude: the installer failed" >&2
  else
    echo "claude: the installer could not be fetched" >&2
  fi
  rm -f "$installer"
fi

npm install -g --no-audit --no-fund @openai/codex@latest || echo "codex: npm failed" >&2
