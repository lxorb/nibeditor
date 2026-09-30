#!/usr/bin/env python3
"""Pack a built `nib-chromium` into the two archives a release carries for it.

The Browser setting fetches nib's own Chromium the first time somebody chooses it
(src/engine_switch/fetch.rs), and fetches it per version of the app, so what a release
carries for each platform is split in two:

    chromium-runtime-<cef>-<platform>.tar.gz   the engine's own files, which only
                                               change when the engine does
    nib-chromium-<version>-<platform>.tar.gz   the app built on them, every release

Paths inside both are relative to the folder the app unpacks them into: the runtime is
linked into that folder and the app's archive unpacked over it. On Windows that is the
executable with Chromium's files beside it; on a Mac it is a real application bundle,
`nib-chromium.app`, laid out by `gate.py`'s `bundle`, whose executables and
`Info.plist` files are the app's half and everything else - the framework above all - is
the runtime's.

It also writes `chromium-<platform>.json`, the platform's row of the release's
`chromium.json`: each archive's name and size. The signatures are added when the
release signs the archives with the updater's key; see `scripts/chromium-manifest.mjs`.

    python pack.py --binary target/release/nib-chromium.exe --version 0.9.2 \\
        --platform windows-aarch64 --out chromium-out [--engine <CEF distribution>]
"""

from __future__ import annotations

import argparse
import json
import platform as host
import re
import shutil
import tarfile
import tempfile
from pathlib import Path

from gate import CEF_PAYLOAD, bundle

MACOS = host.system() == 'Darwin'

#: What goes with the engine's files on every platform: Chromium's own licence notices.
NOTICES = ('CREDITS.html',)


def cef_version(engine: Path) -> str:
    """The CEF release a distribution is, out of the `archive.json` beside it: its
    archive's name starts `cef_binary_<version>+`."""

    said = json.loads((engine / 'archive.json').read_text(encoding='utf-8'))
    found = re.match(r'cef_binary_([0-9.]+)\+', said['name'])
    if not found:
        raise SystemExit(f'no CEF version in {said["name"]}')
    return found.group(1)


def packed(into: Path, root: Path, members: list[Path]) -> int:
    """A `.tar.gz` of `members`, named relative to `root`, and its size in bytes.
    Links stay links and modes stay modes, which a Mac bundle needs."""

    with tarfile.open(into, 'w:gz', compresslevel=9) as archive:
        for member in sorted(members):
            archive.add(member, arcname=member.relative_to(root).as_posix(), recursive=False)
    return into.stat().st_size


def walked(top: Path) -> list[Path]:
    """Every file, link and folder under `top`, and `top` itself, for an archive that
    keeps a bundle's links as links rather than following them."""

    found = [top]
    if top.is_dir() and not top.is_symlink():
        for one in top.iterdir():
            found.extend(walked(one))
    return found


def windows_halves(binary: Path) -> tuple[Path, list[Path], list[Path]]:
    """The folder, the runtime's members and the app's, for a build whose Chromium files
    the build already put beside the executable."""

    root = binary.parent
    runtime: list[Path] = []
    for name in (*CEF_PAYLOAD, *NOTICES):
        if (root / name).exists():
            runtime.extend(walked(root / name))
    if not (root / 'libcef.dll').exists():
        raise SystemExit(f'no libcef.dll beside {binary}: is this the engine build?')
    return root, runtime, [binary]


def mac_halves(binary: Path, engine: Path, stage: Path) -> tuple[Path, list[Path], list[Path]]:
    """The folder, the runtime's members and the app's, for a bundle laid out here."""

    named = stage / 'nib-chromium'
    shutil.copy2(binary, named)
    _, app = bundle(engine, named, stage)
    ours: list[Path] = []
    for one in walked(app):
        if one.is_file() and not one.is_symlink() and (one.parent.name == 'MacOS' or one.name == 'Info.plist'):
            ours.append(one)
    runtime = [one for one in walked(app) if one not in ours]
    for name in NOTICES:
        if (engine / name).exists():
            shutil.copy2(engine / name, stage / name)
            runtime.append(stage / name)
    return stage, runtime, ours


def main() -> int:
    parsed = argparse.ArgumentParser()
    parsed.add_argument('--binary', required=True, type=Path)
    parsed.add_argument('--version', required=True)
    parsed.add_argument('--platform', required=True)
    parsed.add_argument('--out', required=True, type=Path)
    parsed.add_argument('--engine', type=Path, help='the CEF distribution; beside the binary where not given')
    args = parsed.parse_args()

    binary = args.binary.resolve()
    engine = (args.engine or binary.parent).resolve()
    cef = cef_version(engine)
    args.out.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as stage:
        if MACOS:
            root, runtime, app = mac_halves(binary, engine, Path(stage))
        else:
            root, runtime, app = windows_halves(binary)

        runtime_name = f'chromium-runtime-{cef}-{args.platform}.tar.gz'
        app_name = f'nib-chromium-{args.version}-{args.platform}.tar.gz'
        row = {
            'platform': args.platform,
            'cef': cef,
            'runtime': {'name': runtime_name, 'size': packed(args.out / runtime_name, root, runtime)},
            'app': {'name': app_name, 'size': packed(args.out / app_name, root, app)},
        }

    (args.out / f'chromium-{args.platform}.json').write_text(json.dumps(row, indent=2), encoding='utf-8')
    print(json.dumps(row))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
