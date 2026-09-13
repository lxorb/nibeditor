#!/usr/bin/env python3
"""Resolve, download and unpack a CEF binary distribution.

The whole upstream story hangs off one file: https://cef-builds.spotifycdn.com/index.json
is the index Spotify's CDN serves for every platform CEF builds for, and every
entry in it carries the CEF version, the Chromium version it was cut from, the
channel, and for each artefact a name, a size and a sha1. So a job that wants a
build needs no scraping and no guessing at a URL: it reads the index, picks a
version, and verifies what it downloaded against the digest the index gave it.

Two modes, and the difference is the whole update story:

    fetch-cef.py --pin              the version in cef-version.txt, and nothing else
    fetch-cef.py --newest-stable    whatever is newest on the stable channel

The first is what a build does. The second is what the scheduled bump workflow
does before it runs the spike's tests against it and opens a pull request that
changes one line of cef-version.txt. Nobody edits a URL.

Usage:
    fetch-cef.py --pin --out third_party/cef
    fetch-cef.py --newest-stable --print-version
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import urllib.request
from pathlib import Path

INDEX = 'https://cef-builds.spotifycdn.com/index.json'
BASE = 'https://cef-builds.spotifycdn.com/'
HERE = Path(__file__).resolve().parent
PIN_FILE = HERE.parent / 'cef-version.txt'

# What the index calls the platform this is running on. CEF's own names, which
# are not any other project's names for the same machines.
PLATFORMS = {
    ('Windows', 'AMD64'): 'windows64',
    ('Windows', 'ARM64'): 'windowsarm64',
    ('Darwin', 'arm64'): 'macosarm64',
    ('Darwin', 'x86_64'): 'macosx64',
    ('Linux', 'x86_64'): 'linux64',
    ('Linux', 'aarch64'): 'linuxarm64',
}

# `minimal` and not `standard`. The standard distribution is the minimal one plus
# the debug binaries and the full cefclient/cefsimple sources, which is around
# twice the download for a build nobody ships. What a release needs - libcef,
# the resources, the locales, the snapshots and the headers to link against - is
# all in minimal. See docs/browser.md.
ARTEFACT = 'minimal'


def host_platform() -> str:
    key = (platform.system(), platform.machine())
    if key not in PLATFORMS:
        raise SystemExit(f'no CEF distribution for {key}')
    return PLATFORMS[key]


def read_index() -> dict:
    cache = Path(os.environ.get('CEF_INDEX_CACHE', '')) if os.environ.get('CEF_INDEX_CACHE') else None
    if cache and cache.is_file():
        return json.loads(cache.read_text(encoding='utf-8'))
    with urllib.request.urlopen(INDEX, timeout=120) as response:
        raw = response.read()
    if cache:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_bytes(raw)
    return json.loads(raw)


def version_key(cef_version: str) -> tuple[int, ...]:
    """`152.0.6+g708dc14+chromium-152.0.7977.83` -> (152, 0, 6).

    Leading numbers only, and it stops at the first part that is not one: the
    index still holds CEF 3.x builds from 2016, whose versions put the commit
    hash in a dotted part (`3.2924.1571.g9f41a27`) rather than after a `+`.
    """
    parts: list[int] = []
    for part in cef_version.split('+', 1)[0].split('.'):
        if not part.isdigit():
            break
        parts.append(int(part))
    return tuple(parts)


def newest_stable(index: dict, plat: str) -> dict:
    stable = [v for v in index[plat]['versions'] if v.get('channel') == 'stable']
    if not stable:
        raise SystemExit(f'no stable build for {plat}')
    # By version and not by date, which is the bug this comment exists for. CEF
    # keeps cutting patch builds on older branches long after a newer one has
    # shipped - on 2026-09-13 the most recently *written* stable build was
    # 150.0.20, five days younger than 152.0.6 - so a job that took the newest
    # file would walk the pin backwards every time an old branch was patched.
    stable.sort(key=lambda v: version_key(v['cef_version']), reverse=True)
    return stable[0]


def pinned(index: dict, plat: str, version: str) -> dict:
    for entry in index[plat]['versions']:
        if entry['cef_version'] == version:
            return entry
    raise SystemExit(f'{version} is not in the index for {plat}')


def artefact(entry: dict) -> dict:
    for f in entry['files']:
        if f['type'] == ARTEFACT:
            return f
    raise SystemExit(f'{entry["cef_version"]} has no {ARTEFACT} distribution')


def download(url: str, dest: Path, sha1: str) -> None:
    if dest.is_file() and digest(dest) == sha1:
        print(f'cached {dest.name}')
        return
    print(f'downloading {url}')
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + '.part')
    with urllib.request.urlopen(url, timeout=1800) as response, tmp.open('wb') as out:
        shutil.copyfileobj(response, out, length=1 << 20)
    got = digest(tmp)
    if got != sha1:
        tmp.unlink()
        raise SystemExit(f'sha1 mismatch: wanted {sha1}, got {got}')
    tmp.replace(dest)


def digest(path: Path) -> str:
    h = hashlib.sha1()  # noqa: S324 - the index publishes sha1; this checks against it
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def unpack(archive: Path, out: Path) -> Path:
    """Unpack into `out`, and hand back the one directory the archive holds.

    Every CEF archive is a single top-level `cef_binary_<version>_<platform>`
    directory, so the caller gets that path rather than having to guess it.
    """
    out.mkdir(parents=True, exist_ok=True)
    # bz2 through tarfile is minutes on a 300 MB archive; the system tar is
    # seconds, and every runner has one. Fall back for a machine that does not.
    if shutil.which('tar'):
        subprocess.run(['tar', '-xf', str(archive), '-C', str(out)], check=True)
    else:
        with tarfile.open(archive) as tf:
            tf.extractall(out, filter='data')
    roots = [p for p in out.iterdir() if p.is_dir() and p.name.startswith('cef_binary_')]
    if len(roots) != 1:
        raise SystemExit(f'expected one cef_binary_ directory in {out}, found {roots}')
    return roots[0]


def main() -> int:
    ap = argparse.ArgumentParser()
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument('--pin', action='store_true', help='the version in cef-version.txt')
    mode.add_argument('--newest-stable', action='store_true', help='the newest stable build')
    ap.add_argument('--platform', default=None, help='override the platform name')
    ap.add_argument('--out', default=None, help='unpack here')
    ap.add_argument('--cache', default=None, help='keep archives here')
    ap.add_argument('--print-version', action='store_true', help='say the version and stop')
    args = ap.parse_args()

    plat = args.platform or host_platform()
    index = read_index()
    entry = newest_stable(index, plat) if args.newest_stable else pinned(index, plat, PIN_FILE.read_text().strip())

    print(f'cef {entry["cef_version"]}')
    print(f'chromium {entry["chromium_version"]}')
    if args.print_version:
        github_out = os.environ.get('GITHUB_OUTPUT')
        if github_out:
            with open(github_out, 'a', encoding='utf-8') as out:
                out.write(f'cef={entry["cef_version"]}\n')
                out.write(f'chromium={entry["chromium_version"]}\n')
        return 0

    file = artefact(entry)
    print(f'{ARTEFACT} distribution {file["size"] / 1048576:.1f} MB')
    cache = Path(args.cache or (HERE.parent / '.cef-cache'))
    archive = cache / file['name']
    download(BASE + file['name'], archive, file['sha1'])

    out = Path(args.out or (HERE.parent / 'third_party'))
    if out.exists():
        shutil.rmtree(out)
    root = unpack(archive, out)
    print(f'CEF_PATH={root}')
    github_env = os.environ.get('GITHUB_ENV')
    if github_env:
        with open(github_env, 'a', encoding='utf-8') as env:
            env.write(f'CEF_PATH={root}\n')
            env.write(f'CEF_VERSION={entry["cef_version"]}\n')
            env.write(f'CHROMIUM_VERSION={entry["chromium_version"]}\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
