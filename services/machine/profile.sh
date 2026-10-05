# The machine's own settings for every login shell (docs/online-terminal.md 4.2).
# Global npm packages go into the home, where Codex's update command reaches them
# without root, and the home's own bin comes first, where Claude Code installs itself.
export NPM_CONFIG_PREFIX="$HOME/.local"
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac
