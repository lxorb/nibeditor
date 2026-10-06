# A person's machine on Cloudflare (docs/online-terminal.md 4.2): Ubuntu 24.04 with what a
# coding agent and its person reach for, `nibd`, and nothing of nib's beyond it.
#
# What is installed is install.sh's, which a Hetzner server runs too (4.15), so the two
# hosts never drift apart. Built from this folder after `pnpm --filter @nib/machine
# build` has written dist/nibd.cjs. Claude Code and Codex are not in the image: they go
# into the home on the first boot (agents.sh), where their own updaters keep them current.

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

COPY install.sh package.json agents.sh profile.sh nib-open /tmp/machine/
COPY dist/nibd.cjs /tmp/machine/dist/nibd.cjs
RUN bash /tmp/machine/install.sh && rm -rf /tmp/machine

# The Sandbox SDK's shim, which the home's backups to R2 and their restores run through
# (services/sync/src/machines/host.ts); its tag is the pinned @cloudflare/sandbox's.
COPY --from=docker.io/cloudflare/sandbox:1.0.0 /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim

COPY entrypoint.sh /usr/local/bin/nib-entrypoint
RUN chmod 755 /usr/local/bin/nib-entrypoint

WORKDIR /home/nib
EXPOSE 7680
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/nib-entrypoint"]
