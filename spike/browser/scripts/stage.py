#!/usr/bin/env python3
"""Lay the built spike out the way a release would have to lay it out.

This is the part of shipping CEF that is not Rust at all, and it is worth having
in the spike because it is the part a first build always gets wrong.

Windows and Linux are easy: the binaries and CEF's resources sit beside the
executable, and the loader finds `libcef` because it is in the same directory.

macOS is the whole reason this file exists. A CEF app there is a bundle holding a
framework and *five helper bundles* - the renderer, the GPU process, the plugin
host, the alerts helper and a plain one - because macOS will not let one
executable be both an app and a background subprocess, and because each helper
needs its own Info.plist and its own set of entitlements. Every one of them is
signed separately, and the framework is signed separately again. Getting the
layout right here is what makes the notarisation story in docs/browser.md a
paragraph rather than a surprise.

    stage.py --out stage                 lay it out
    stage.py --out stage --print-binary  say what to run
    stage.py --out stage --report x.json write down what it weighs
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import plistlib
import shutil
import stat
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
CRATE = HERE.parent
SYSTEM = platform.system()

APP = 'nib-spike-browser'
HELPER = 'nib-spike-helper'

# The four kinds of macOS helper, as CEF names them, with the suffix each bundle
# identifier and each bundle name takes. The plain one handles every process type
# that is not one of the other three.
HELPERS = [
    ('', ''),
    (' (GPU)', '.gpu'),
    (' (Plugin)', '.plugin'),
    (' (Renderer)', '.renderer'),
    (' (Alerts)', '.alerts'),
]

BUNDLE_ID = 'com.nibeditor.spike.browser'


def target_dir() -> Path:
    return Path(os.environ.get('CARGO_TARGET_DIR', CRATE / 'target')) / 'release'


def cef_path() -> Path:
    """Where the CEF runtime files are, in either of the two layouts there are.

    `export-cef-dir` - which is how `cef-dll-sys` wants to be handed a
    distribution, and therefore what CI uses - writes a *flat* directory: libcef
    and the resource packs and the locales all directly inside `CEF_PATH`, with
    the headers under a versioned subdirectory the build script finds on its own.
    A raw distribution from `fetch-cef.py` instead has `Release/` and `Resources/`.
    Both are accepted here, because both exist on somebody's machine.
    """
    env = os.environ.get('CEF_PATH')
    if env and Path(env).is_dir():
        return Path(env)
    third = CRATE / 'third_party'
    roots = sorted(p for p in third.glob('cef_binary_*') if p.is_dir()) if third.is_dir() else []
    if not roots:
        raise SystemExit('no CEF distribution: set CEF_PATH or run fetch-cef.py')
    return roots[-1]


def runtime_dirs(cef: Path) -> list[Path]:
    """The directories holding the files a release ships, in copy order."""
    split = [cef / 'Release', cef / 'Resources']
    if all(d.is_dir() for d in split):
        return split
    return [cef]


def exe(name: str) -> str:
    return f'{name}.exe' if SYSTEM == 'Windows' else name


def copy(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if src.is_dir():
        shutil.copytree(src, dst, dirs_exist_ok=True, symlinks=True)
    else:
        shutil.copy2(src, dst)


def stage_flat(out: Path, cef: Path) -> Path:
    """Windows and Linux: everything in one directory beside the executable."""
    out.mkdir(parents=True, exist_ok=True)
    built = target_dir()
    for name in (APP, HELPER):
        source = built / exe(name)
        if source.is_file():
            copy(source, out / exe(name))

    # Everything the runtime directory holds that is not an import library, a
    # static one or a header: the loader needs all of the rest, and picking by
    # name is how a release ends up missing a Vulkan stub on one machine in fifty.
    for base in runtime_dirs(cef):
        for item in base.iterdir():
            if item.suffix.lower() in {'.lib', '.a', '.pdb', '.exp'}:
                continue
            # The versioned subdirectory `export-cef-dir` leaves behind is the
            # headers and the static library the build linked against; none of it
            # runs.
            if item.is_dir() and item.name[0].isdigit():
                continue
            copy(item, out / item.name)

    sandbox = out / 'chrome-sandbox'
    if sandbox.is_file():
        # The SUID sandbox wants root ownership and mode 4755, which a CI runner
        # cannot give it; the spike passes --no-sandbox instead and says so. A
        # release sets this in the package's post-install, which is what every
        # Chromium-based .deb does.
        sandbox.chmod(sandbox.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return out / exe(APP)


def write_plist(path: Path, values: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('wb') as f:
        plistlib.dump(values, f)


def stage_bundle(out: Path, cef: Path) -> Path:
    """macOS: an app bundle, a framework, and five helper bundles inside it."""
    out.mkdir(parents=True, exist_ok=True)
    app = out / f'{APP}.app'
    if app.exists():
        shutil.rmtree(app)
    contents = app / 'Contents'
    frameworks = contents / 'Frameworks'
    copy(target_dir() / APP, contents / 'MacOS' / APP)
    (contents / 'MacOS' / APP).chmod(0o755)
    write_plist(
        contents / 'Info.plist',
        {
            'CFBundleExecutable': APP,
            'CFBundleIdentifier': BUNDLE_ID,
            'CFBundleName': APP,
            'CFBundlePackageType': 'APPL',
            'CFBundleShortVersionString': '0.1',
            'CFBundleVersion': '0.1',
            'LSMinimumSystemVersion': '11.0',
            'NSHighResolutionCapable': True,
            # A spike run from a terminal on a runner still has to be allowed to
            # put a window on the screen.
            'LSUIElement': False,
        },
    )

    name = 'Chromium Embedded Framework.framework'
    framework = next(
        (base / name for base in runtime_dirs(cef) if (base / name).is_dir()),
        None,
    )
    if framework is None:
        raise SystemExit(f'no {name} under {cef}')
    copy(framework, frameworks / name)

    helper_binary = target_dir() / HELPER
    for suffix, id_suffix in HELPERS:
        name = f'{APP} Helper{suffix}'
        bundle = frameworks / f'{name}.app'
        copy(helper_binary, bundle / 'Contents' / 'MacOS' / name)
        (bundle / 'Contents' / 'MacOS' / name).chmod(0o755)
        write_plist(
            bundle / 'Contents' / 'Info.plist',
            {
                'CFBundleExecutable': name,
                'CFBundleIdentifier': f'{BUNDLE_ID}.helper{id_suffix}',
                'CFBundleName': name,
                'CFBundlePackageType': 'APPL',
                'CFBundleShortVersionString': '0.1',
                'CFBundleVersion': '0.1',
                # A helper is a subprocess and must never show in the Dock or take
                # the keyboard. Leaving this off is the classic first-build bug:
                # five icons appear in the Dock and the app steals focus on every
                # tab that opens.
                'LSUIElement': True,
            },
        )
    return contents / 'MacOS' / APP


def measure(out: Path) -> dict:
    """What the staged tree weighs, and what the big pieces are."""
    files = [p for p in out.rglob('*') if p.is_file() and not p.is_symlink()]
    total = sum(p.stat().st_size for p in files)
    biggest = sorted(files, key=lambda p: p.stat().st_size, reverse=True)[:12]
    return {
        'platform': f'{SYSTEM} {platform.machine()}',
        'cef': os.environ.get('CEF_VERSION'),
        'chromium': os.environ.get('CHROMIUM_VERSION'),
        'files': len(files),
        'total_bytes': total,
        'total_mb': round(total / 1048576, 1),
        'biggest': [
            {'name': str(p.relative_to(out)), 'mb': round(p.stat().st_size / 1048576, 2)}
            for p in biggest
        ],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--print-binary', action='store_true')
    ap.add_argument('--report', default=None)
    args = ap.parse_args()

    out = Path(args.out).resolve()

    if args.report:
        report = Path(args.report)
        report.parent.mkdir(parents=True, exist_ok=True)
        numbers = measure(out)
        report.write_text(json.dumps(numbers, indent=2), encoding='utf-8')
        print(json.dumps(numbers, indent=2))
        return 0

    # Asking where the binary is must not lay the tree out again: the bundle path
    # starts by deleting what is there, and a caller that only wanted a path would
    # get a rebuild and, on a bad day, a race with the thing it is about to run.
    if args.print_binary:
        print(
            out / f'{APP}.app' / 'Contents' / 'MacOS' / APP
            if SYSTEM == 'Darwin'
            else out / exe(APP)
        )
        return 0

    cef = cef_path()
    binary = stage_bundle(out, cef) if SYSTEM == 'Darwin' else stage_flat(out, cef)
    print(f'staged {out}')
    print(f'binary {binary}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
