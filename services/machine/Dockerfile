# A person's machine (docs/online-terminal.md 4.2): Ubuntu 24.04 with what a coding
# agent and its person reach for, `nibd`, and nothing of nib's beyond it.
#
# Built from this folder after `pnpm --filter @nib/machine build` has written
# dist/nibd.cjs. Claude Code and Codex are not in the image: they go into the home on
# the first boot (agents.sh), where their own updaters keep them current.

FROM node:22.23.3-bookworm-slim AS node
FROM ghcr.io/astral-sh/uv:0.12.23 AS uv

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bash zsh fish sudo tini \
      git curl wget ca-certificates gnupg \
      build-essential python3 python3-pip python3-venv python-is-python3 \
      ripgrep fd-find jq tmux vim nano less unzip zip zstd \
      openssh-client locales tzdata util-linux procps \
 && ln -s /usr/bin/fdfind /usr/local/bin/fd \
 && mkdir -p -m 755 /etc/apt/keyrings \
 && wget -qO /etc/apt/keyrings/githubcli.gpg https://cli.github.com/packages/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*

# node 22 LTS with npm and corepack, from the official image rather than a script piped
# into a shell.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && ln -s ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack \
 && node --version && npm --version

COPY --from=uv /uv /uvx /usr/local/bin/

# The one user, uid 1000, which Ubuntu's image gives to `ubuntu`; root by sudo without
# a password, since installing things is the point of having a machine (4.2).
RUN userdel -r ubuntu 2>/dev/null; \
    useradd -m -u 1000 -s /bin/bash nib \
 && echo 'nib ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/nib \
 && chmod 440 /etc/sudoers.d/nib

# Global npm installs go into the home, so Codex's own update command needs no root.
COPY profile.sh /etc/profile.d/nib.sh

# nibd: the bundle, and node-pty built here for this system.
WORKDIR /opt/nibd
COPY package.json /tmp/machine.json
RUN npm install --omit=dev --no-audit --no-fund --no-save \
      "node-pty@$(node -p "require('/tmp/machine.json').dependencies['node-pty']")" \
 && rm /tmp/machine.json \
 && node -e "require('node-pty')"
COPY dist/nibd.cjs /opt/nibd/nibd.cjs
COPY entrypoint.sh /usr/local/bin/nib-entrypoint
COPY agents.sh /usr/local/bin/nib-agents
RUN chmod 755 /usr/local/bin/nib-entrypoint /usr/local/bin/nib-agents \
 && mkdir -p /var/lib/nibd

WORKDIR /home/nib
EXPOSE 7680
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/nib-entrypoint"]
