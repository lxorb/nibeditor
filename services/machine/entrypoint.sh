#!/bin/bash
# The machine's boot (docs/online-terminal.md 4.2, 4.8): the host's certificate trusted,
# the time zone set, the home made the user's, the agents installed or brought up to
# date in the background, and `nibd` started in this process's place, so the host's
# SIGTERM reaches it and the screens are saved.
set -euo pipefail

# The per-instance CA Cloudflare puts in the machine for HTTPS through the host. Its
# key never leaves the host's sidecar; the certificate is trusted by the system, and
# every runtime that keeps a list of its own is pointed at the system's.
if compgen -G '/etc/cloudflare/certs/*' >/dev/null; then
  for cert in /etc/cloudflare/certs/*; do
    case "$cert" in
      *.crt | *.pem) cp "$cert" "/usr/local/share/ca-certificates/cloudflare-$(basename "${cert%.*}").crt" ;;
    esac
  done
  update-ca-certificates >/dev/null
fi
bundle=/etc/ssl/certs/ca-certificates.crt
export NODE_EXTRA_CA_CERTS=$bundle SSL_CERT_FILE=$bundle REQUESTS_CA_BUNDLE=$bundle \
  CURL_CA_BUNDLE=$bundle GIT_SSL_CAINFO=$bundle

# The account's time zone, which Machine passes as TZ.
if [ -n "${TZ:-}" ] && [ -f "/usr/share/zoneinfo/$TZ" ]; then
  ln -sf "/usr/share/zoneinfo/$TZ" /etc/localtime
  echo "$TZ" >/etc/timezone
fi

# A home put back from a backup comes with whatever owner the restore gave it.
mkdir -p /home/nib /var/lib/nibd
chown nib:nib /home/nib
chmod 700 /var/lib/nibd

# Claude Code and Codex, installed into the home on the first boot and updated on the
# others; never in the way of the terminal, which is up long before either finishes.
if [ "${NIB_AGENTS:-1}" != 0 ]; then
  setpriv --reuid=nib --regid=nib --init-groups \
    env -i HOME=/home/nib USER=nib LOGNAME=nib PATH=/usr/local/bin:/usr/bin:/bin \
    NODE_EXTRA_CA_CERTS=$bundle SSL_CERT_FILE=$bundle LANG=C.UTF-8 \
    nice -n 10 /usr/local/bin/nib-agents >/tmp/nib-agents.log 2>&1 &
fi

exec node /opt/nibd/nibd.cjs
