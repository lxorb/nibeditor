#!/bin/bash
# The image built and booted with nothing in the cloud (docs/online-terminal.md 6.2, lanes
# 2 and 6): nibd answering in it, the tools of 4.2, Claude Code and Codex installed
# unmodified with their checksums matching their makers' own, and nibd opening nothing
# under ~/.claude or ~/.codex while a session does. Run from services/machine with the
# image's tag; CI's machine workflow is the only caller.
set -euo pipefail
image=$1
secret=ci-$RANDOM-$RANDOM
cleanup() {
  docker logs nib-machine >machine.log 2>&1 || true
  docker rm -f nib-machine nib-traced >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d --name nib-machine -e NIBD_SECRET="$secret" -e TZ=Europe/Zurich \
  -p 127.0.0.1:7680:7680 "$image"

# A machine whose nibd runs under strace, with the agents' files in place and the agents
# not installed, so every open of those files is a session's or nibd's own.
docker run -d --name nib-traced --cap-add SYS_PTRACE -e NIBD_SECRET="$secret" \
  -p 127.0.0.1:7681:7680 --entrypoint bash "$image" -c '
    set -e
    apt-get update -qq && apt-get install -y -qq strace >/dev/null
    mkdir -p /home/nib/.claude /home/nib/.codex
    echo not-a-real-token >/home/nib/.claude/.credentials.json
    echo "{\"token\":\"not-a-real-token\"}" >/home/nib/.codex/auth.json
    chown -R nib:nib /home/nib
    exec strace -f -qq -o /tmp/trace \
      -e trace=open,openat,openat2,creat,execve,stat,lstat,newfstatat,statx,readlink,readlinkat,chdir,getdents64 \
      node /opt/nibd/nibd.cjs'

NIBD_URL=ws://127.0.0.1:7680 NIBD_TRACED_URL=ws://127.0.0.1:7681 NIBD_SECRET=$secret \
  pnpm exec vitest run --config vitest.image.config.ts

# The agents' checksums, against what their makers publish: Claude Code's binary against
# the SHA-256 in its release manifest, every Codex package against the registry's
# SHA-512 integrity.
docker exec -u nib -w /home/nib nib-machine bash -lc '
  set -euo pipefail
  version=$(claude --version | cut -d" " -f1)
  case "$(uname -m)" in x86_64) platform=linux-x64 ;; aarch64) platform=linux-arm64 ;; esac
  expected=$(curl -fsSL "https://downloads.claude.ai/claude-code-releases/$version/manifest.json" |
    jq -r ".platforms[\"$platform\"].checksum")
  actual=$(sha256sum "$(readlink -f ~/.local/bin/claude)" | cut -d" " -f1)
  echo "claude $version $platform: $actual"
  [ "$expected" = "$actual" ]

  # npm keeps the integrity of every tarball it fetched, checked as it fetched it, in
  # its cache index; each installed Codex package is looked up there by its tarball.
  checked=0
  for manifest in $(find ~/.local/lib/node_modules/@openai -name package.json -path "*/@openai/codex*/package.json" -not -path "*/node_modules/*/node_modules/*/node_modules/*"); do
    [ "$(jq -r .name "$manifest")" = "@openai/codex" ] || continue
    version=$(jq -r .version "$manifest")
    tarball="codex-$version.tgz"
    fetched=$(grep -rh -- "/-/$tarball" ~/.npm/_cacache/index-v5 | cut -f2 | jq -r ".integrity" | sort -u)
    published=$(npm view "@openai/codex@$version" dist.integrity)
    echo "@openai/codex@$version: $fetched"
    [ -n "$fetched" ] && [ "$fetched" = "$published" ]
    checked=$((checked + 1))
  done
  [ "$checked" -ge 2 ]
'

# nibd's own threads never open, list or look at anything of the agents': every process
# that touched those folders is one that went on to run a program of its own (execve).
docker exec nib-traced cat /tmp/trace >trace.log
python3 - trace.log <<'PY'
import re, sys
ran, touched = set(), {}
for line in open(sys.argv[1], encoding="utf-8", errors="replace"):
    pid, _, call = line.partition(" ")
    if "execve" in call:
        # Whole, or the "<... execve resumed>" half of one another thread interrupted.
        if re.search(r"= 0\s*$", call):
            ran.add(pid)
    elif re.search(r"/home/nib/\.(claude|codex)", call):
        touched.setdefault(pid, line.strip())
bad = {pid: line for pid, line in touched.items() if pid not in ran}
for line in bad.values():
    print("nibd itself:", line)
print(f"{len(touched)} processes touched the agents files; {len(bad)} of them were nibd")
sys.exit(1 if bad or not touched else 0)
PY
