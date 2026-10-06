#!/bin/bash
# What a machine has, said once (docs/online-terminal.md 4.2, 4.15): the Dockerfile runs
# this to build the Cloudflare image, and cloud-init runs it with --server on a Hetzner
# server, so the two can never drift apart.
#
#   install.sh            the system, the user and nib's own files (the image)
#   install.sh --server   all of that, and what a server of its own needs besides:
#                         cloudflared, the systemd units, security updates, swap, SSH shut
#   install.sh --files    nib's own files alone: what nib-update puts in place before
#                         every start of nibd, from the bundle the Worker hands out
#
# Run as root from the folder it is in, which holds the rest: nibd.cjs (or dist/nibd.cjs
# in the repository), package.json, agents.sh, profile.sh, nib-open, nib-update and
# server/*.service. Everything fetched is checked: apt by its signed repositories, node
# against the release's SHASUMS256.txt, uv against its release's .sha256. Claude Code and
# Codex are not here: they go into the home at boot (agents.sh), where their own
# updaters keep them current.
set -euo pipefail

NODE_VERSION=22.23.3
UV_VERSION=0.12.23

here=$(cd "$(dirname "$0")" && pwd)
mode=${1:-image}
export DEBIAN_FRONTEND=noninteractive

case "$(uname -m)" in
  x86_64) node_arch=x64 uv_arch=x86_64 ;;
  aarch64) node_arch=arm64 uv_arch=aarch64 ;;
  *)
    echo "install.sh: no machine for $(uname -m)" >&2
    exit 1
    ;;
esac

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Fetches $1 into $work as $2, failing on any HTTP error.
fetch() {
  curl -fsSL --retry 3 --retry-delay 2 -o "$work/$2" "$1"
}

system() {
  apt-get update
  apt-get install -y --no-install-recommends \
    bash zsh fish sudo tini \
    git curl wget ca-certificates gnupg xz-utils \
    build-essential python3 python3-pip python3-venv python-is-python3 \
    ripgrep fd-find jq tmux vim nano less unzip zip zstd \
    openssh-client locales tzdata util-linux procps
  ln -sf /usr/bin/fdfind /usr/local/bin/fd

  # gh, from GitHub's own signed repository.
  mkdir -p -m 755 /etc/apt/keyrings
  wget -qO /etc/apt/keyrings/githubcli.gpg https://cli.github.com/packages/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli.gpg] https://cli.github.com/packages stable main" \
    >/etc/apt/sources.list.d/github-cli.list
  apt-get update
  apt-get install -y --no-install-recommends gh

  # node 22 LTS with npm and corepack, the release's own tarball, checked against the
  # checksums it was published with.
  local file="node-v$NODE_VERSION-linux-$node_arch.tar.xz"
  fetch "https://nodejs.org/dist/v$NODE_VERSION/$file" "$file"
  fetch "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" SHASUMS256.txt
  (cd "$work" && grep " $file\$" SHASUMS256.txt | sha256sum -c --quiet -)
  tar -xJf "$work/$file" -C /usr/local --strip-components=1 --no-same-owner \
    --exclude CHANGELOG.md --exclude LICENSE --exclude README.md
  node --version
  npm --version

  # uv, the release's own binary, checked the same way.
  file="uv-$uv_arch-unknown-linux-gnu.tar.gz"
  fetch "https://github.com/astral-sh/uv/releases/download/$UV_VERSION/$file" "$file"
  fetch "https://github.com/astral-sh/uv/releases/download/$UV_VERSION/$file.sha256" "$file.sha256"
  (cd "$work" && sha256sum -c --quiet "$file.sha256")
  tar -xzf "$work/$file" -C "$work"
  install -m 755 "$work/uv-$uv_arch-unknown-linux-gnu/uv" "$work/uv-$uv_arch-unknown-linux-gnu/uvx" /usr/local/bin/

  rm -rf /var/lib/apt/lists/*
}

# The one user, uid 1000 where it is free (Ubuntu's image gives it to `ubuntu`, which
# goes); root by sudo without a password, since installing things is the point of
# having a machine (4.2).
user() {
  if id ubuntu >/dev/null 2>&1 && [ "$(id -u ubuntu)" = 1000 ] && ! pgrep -u ubuntu >/dev/null; then
    userdel -r ubuntu 2>/dev/null || true
  fi
  if ! id nib >/dev/null 2>&1; then
    if getent passwd 1000 >/dev/null; then
      useradd -m -s /bin/bash nib
    else
      useradd -m -u 1000 -s /bin/bash nib
    fi
  fi
  install -d -o nib -g nib /home/nib/.local /home/nib/.local/bin
  echo 'nib ALL=(ALL) NOPASSWD:ALL' >/etc/sudoers.d/nib
  chmod 440 /etc/sudoers.d/nib
}

# nib's own files: nibd with node-pty built here for this system, the browser shims, the
# agents' installer, the login shells' settings, and on a server the units and the updater.
files() {
  local nibd="$here/nibd.cjs"
  [ -f "$nibd" ] || nibd="$here/dist/nibd.cjs"

  install -d /opt/nibd
  local pty
  pty=$(node -p "require('$here/package.json').dependencies['node-pty']")
  if [ "$(cat /opt/nibd/pty 2>/dev/null)" != "$pty" ]; then
    (cd /opt/nibd && npm install --omit=dev --no-audit --no-fund --no-save "node-pty@$pty")
    echo "$pty" >/opt/nibd/pty
  fi
  (cd /opt/nibd && node -e "require('node-pty')")
  install -m 644 "$nibd" /opt/nibd/nibd.cjs.new
  mv /opt/nibd/nibd.cjs.new /opt/nibd/nibd.cjs

  # Global npm installs go into the home, so Codex's own update command needs no root.
  install -m 644 "$here/profile.sh" /etc/profile.d/nib.sh
  install -m 755 "$here/agents.sh" /usr/local/bin/nib-agents
  # The machine's browser is its owner's (4.13): every name a program asks for one by,
  # ahead of /usr/bin, and $BROWSER (profile.sh, nibd).
  install -m 755 "$here/nib-open" /usr/local/bin/nib-open
  for name in xdg-open sensible-browser x-www-browser www-browser; do
    ln -sf nib-open "/usr/local/bin/$name"
  done
  mkdir -p /var/lib/nibd /run/nibd
  chmod 700 /var/lib/nibd

  if [ -d /etc/systemd/system ] && [ "$mode" != image ]; then
    install -m 755 "$here/nib-update" /usr/local/bin/nib-update
    install -m 644 "$here"/server/*.service /etc/systemd/system/
  fi
}

# What only a server of its own needs (4.15).
server() {
  apt-get update
  apt-get install -y --no-install-recommends unattended-upgrades openssh-server

  # cloudflared, the machine's one way in, from Cloudflare's own signed repository.
  wget -qO /usr/share/keyrings/cloudflare-main.gpg https://pkg.cloudflare.com/cloudflare-main.gpg
  echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' \
    >/etc/apt/sources.list.d/cloudflared.list
  apt-get update
  apt-get install -y --no-install-recommends cloudflared

  # Security updates by themselves, every day; never a reboot nobody asked for, since a
  # reboot is the one thing a session does not survive.
  cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
  cat >/etc/apt/apt.conf.d/52nib-upgrades <<'EOF'
Unattended-Upgrade::Automatic-Reboot "false";
EOF

  # Swap, so a build that overreaches is slowed rather than killed; kept for when it is
  # needed, never preferred.
  if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
    [ -f /swapfile ] || { fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null; }
    swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  fi
  echo 'vm.swappiness = 10' >/etc/sysctl.d/90-nib.conf
  sysctl -q --system || true

  # No way in as root, no passwords at all; SSH only for the person's own key, and only
  # while the firewall lets port 22 through (an emergency setting, off by default). Read
  # first of the drop-ins, since sshd keeps the first value it reads of each setting.
  passwd -l root >/dev/null
  install -d -m 755 /etc/ssh/sshd_config.d
  cat >/etc/ssh/sshd_config.d/01-nib.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
AllowUsers nib
EOF
  if [ -s /etc/nibd/ssh_key ]; then
    install -d -m 700 -o nib -g nib /home/nib/.ssh
    install -m 600 -o nib -g nib /etc/nibd/ssh_key /home/nib/.ssh/authorized_keys
    systemctl enable --now ssh.service >/dev/null 2>&1 || true
    systemctl reload ssh.service >/dev/null 2>&1 || true
  else
    systemctl disable --now ssh.socket ssh.service >/dev/null 2>&1 || true
  fi

  # The account's time zone, as the container's TZ is.
  local zone
  zone=$(sed -n 's/^TZ=//p' /etc/nibd/env 2>/dev/null || true)
  if [ -n "$zone" ] && [ -f "/usr/share/zoneinfo/$zone" ]; then
    timedatectl set-timezone "$zone" 2>/dev/null || ln -sf "/usr/share/zoneinfo/$zone" /etc/localtime
  fi

  systemctl daemon-reload
  systemctl enable nibd.service nib-agents.service cloudflared.service
  systemctl restart nibd.service
  systemctl start --no-block nib-agents.service
  systemctl restart cloudflared.service || true
}

case "$mode" in
  image)
    system
    user
    files
    ;;
  --server)
    system
    user
    files
    server
    ;;
  --files)
    files
    ;;
  *)
    echo "usage: install.sh [--server | --files]" >&2
    exit 2
    ;;
esac
