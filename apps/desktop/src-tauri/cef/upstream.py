#!/usr/bin/env python3
"""Fetch the Tauri revision this workspace is pinned to, and repair it.

The pin is one revision in `Cargo.toml` beside this file, and this is what turns
it into a checkout `cargo` can build against. Two things have to happen before
nib compiles on `tauri-runtime-cef`, and both of them are upstream's rather than
nib's:

**1. `tauri` needs the `wry` feature back, as a name that does nothing.** Every
Tauri plugin that supports iOS carries

    [target.'cfg(target_os = "ios")'.dependencies.tauri]
    version = "2.10"
    features = ["wry"]

and the `feat/cef` branch removed that feature, because there the runtime is
chosen by the application instead of being compiled into `tauri`. Cargo resolves
a dependency's target-specific dependencies whatever platform it is building for,
so the missing name is a hard resolution failure - and it is not one an
application can work round: `tauri-plugin-opener` and `tauri-plugin-dialog` are
in nib's graph, nib's capabilities name their permissions, and no version of
either that Cargo will accept leaves the feature out. **So no Tauri application
that uses those plugins can build against `tauri-runtime-cef` today, whatever it
does with its own code.** That is the first thing batch 1 measured, it is one
line to repair, and the repair is here rather than in a fork nib would have to
host.

**2. `dpi` has to be one crate.** `tauri` takes it from crates.io while
`tauri-runtime-cef` takes `winit` from the `winit-gtk4` fork, which vendors a
`dpi` of its own. That one is a `[patch.crates-io]` in `Cargo.toml` and needs no
checkout; it is named here because the two belong together.

Both are reported by the bump workflow, so the day the branch fixes either of
them the pull request says so - an edit that no longer applies is the good
outcome, not a failure.

    python upstream.py            # fetch and repair, into .upstream/tauri
    python upstream.py --print    # say where it is, fetch nothing
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / 'Cargo.toml'
INTO = HERE / '.upstream' / 'tauri'

# The one edit, as the text before and the text after. A replacement and not a
# patch file, so a moved line fails loudly here rather than producing a checkout
# that is quietly not what the comment says it is.
FEATURE_ANCHOR = 'unstable = []\n'
FEATURE_ADDED = """unstable = []
# Kept as an empty name so Tauri's own plugins, which ask for it on iOS, still
# resolve against this branch. See apps/desktop/src-tauri/cef/upstream.py.
wry = []
"""


def pin() -> tuple[str, str]:
    """The repository and the revision `Cargo.toml` names, from one place in it."""
    text = MANIFEST.read_text(encoding='utf-8')
    block = text.split('[package.metadata.cef]', 1)
    if len(block) != 2:
        raise SystemExit(f'{MANIFEST} has no [package.metadata.cef] to read the pin from')

    repository = re.search(r'^repository = "([^"]+)"', block[1], re.M)
    revision = re.search(r'^revision = "([0-9a-f]+)"', block[1], re.M)
    if not repository or not revision:
        raise SystemExit(f'{MANIFEST} names no repository and revision under the pin')
    return repository.group(1), revision.group(1)


def fetch(repository: str, revision: str) -> None:
    """The pinned revision, as shallow a checkout as one commit can be."""
    if (INTO / '.git').is_dir():
        head = subprocess.run(
            ['git', '-C', str(INTO), 'rev-parse', 'HEAD'],
            capture_output=True,
            text=True,
            check=False,
        ).stdout.strip()
        if head.startswith(revision):
            print(f'the checkout is already at {revision}')
            return
        shutil.rmtree(INTO)

    INTO.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['git', 'init', '--quiet', str(INTO)], check=True)
    subprocess.run(['git', '-C', str(INTO), 'remote', 'add', 'origin', repository], check=True)
    subprocess.run(
        ['git', '-C', str(INTO), 'fetch', '--quiet', '--depth', '1', 'origin', revision],
        check=True,
    )
    subprocess.run(['git', '-C', str(INTO), 'checkout', '--quiet', 'FETCH_HEAD'], check=True)
    print(f'fetched {revision}')


def repair() -> None:
    """The one edit, applied once."""
    manifest = INTO / 'crates' / 'tauri' / 'Cargo.toml'
    text = manifest.read_text(encoding='utf-8')

    if 'wry = []' in text:
        print('the wry feature is already there')
        return
    if FEATURE_ANCHOR not in text:
        raise SystemExit(
            f'{manifest} has no `{FEATURE_ANCHOR.strip()}` line to add the wry feature after; '
            'the branch has moved, and it may have fixed this itself'
        )

    manifest.write_text(text.replace(FEATURE_ANCHOR, FEATURE_ADDED, 1), encoding='utf-8')
    print('added the wry feature')


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--print', action='store_true', help='say where the checkout goes')
    args = ap.parse_args()

    if args.print:
        print(INTO)
        return 0

    repository, revision = pin()
    fetch(repository, revision)
    repair()
    print(f'upstream is ready at {INTO}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
