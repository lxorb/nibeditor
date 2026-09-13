#!/usr/bin/env python3
"""Fetch the Tauri revision this workspace is pinned to, and repair it.

The pin is one revision in `Cargo.toml` beside this file, and this is what turns
it into a checkout `cargo` can build against. Four things have to happen before
nib runs on `tauri-runtime-cef`, and every one of them is upstream's rather than
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

**2. Windows cannot load what the branch links.** The branch takes the `cef` crate
with its default features and those include `sandbox`, which links
`cef_sandbox.lib`; since Chromium M138 that library only works in a binary built
with Chromium's own toolchain and loaded as a DLL by CEF's `bootstrap.exe`, so a
plain executable dies in the loader before its first line. That is ship gate 1 of
docs/browser.md, met in person: the repair takes the crate without the feature and
the flagged build runs unsandboxed, which is what the runtime's own documentation
says a Windows build does today.

**3. The winit method macOS no longer has.** The branch calls
`WindowAttributesMacOS::with_accepts_first_mouse`, which winit 0.31 removed - and it
takes `winit` from a fork's `master`, so the branch does not compile on a Mac
against the fork as it stands today. Dropping the call is what upstream itself did by
the time it published `tauri-runtime-cef 3.0.0-alpha.0`.

**4. `dpi` has to be one crate.** `tauri` takes it from crates.io while
`tauri-runtime-cef` takes `winit` from the `winit-gtk4` fork, which vendors a
`dpi` of its own. That one is a `[patch.crates-io]` in `Cargo.toml` and needs no
checkout; it is named here because the two belong together.

All of them are reported by the bump workflow, so the day the branch fixes one of
them the pull request says so - an edit that no longer applies is the good outcome,
not a failure.

    python upstream.py            # fetch and repair, into target/upstream/tauri
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
# Inside the build output, and that is the point: every check this repository
# runs - prettier, eslint, knip, the test walkers - already skips `target`, and a
# fetched dependency of two hundred megabytes has no business slowing an ordinary
# `pnpm format` down. `cargo clean` taking it away is correct; this puts it back.
INTO = HERE / 'target' / 'upstream' / 'tauri'

# The edits, as the text before and the text after. Replacements and not a patch
# file, so a moved line fails loudly here rather than producing a checkout that is
# quietly not what the comment says it is.
FEATURE_ANCHOR = 'unstable = []\n'
FEATURE_ADDED = """unstable = []
# Kept as an empty name so Tauri's own plugins, which ask for it on iOS, still
# resolve against this branch. See apps/desktop/src-tauri/cef/upstream.py.
wry = []
"""

# The Windows one, and it is ship gate 1 measured rather than described. The branch
# takes the `cef` crate with its default features, and those include `sandbox`, which
# links `cef_sandbox.lib`. Since Chromium M138 that library can only be linked by a
# binary built with Chromium's own toolchain and **loaded as a DLL by CEF's
# `bootstrap.exe`** - so a plain executable that links it dies in the loader with
# `STATUS_ENTRYPOINT_NOT_FOUND` before a line of its own code runs, which is exactly
# what the first Windows run of the gate did. A Tauri application is not that DLL
# yet, so the flagged build takes the crate without the feature and runs unsandboxed,
# which is what `tauri-runtime-cef`'s own documentation says a Windows build does.
# `spike/browser` says the same thing in its own manifest, for the same reason.
SANDBOX_BEFORE = 'cef = { version = "=151.8.1", features = ["build-util", "linux-x11"] }'
SANDBOX_AFTER = (
    'cef = { version = "=151.8.1", default-features = false, features = [\n'
    '  "build-util",\n'
    '  "linux-x11",\n'
    '  "resources",\n'
    '] }  # `sandbox` off: see apps/desktop/src-tauri/cef/upstream.py'
)

# The macOS one. The branch calls a winit method that winit 0.31 removed - its own
# changelog says so: *"On macOS, remove `WindowAttributesMacOS::with_accepts_first_mouse`"*
# - and it takes `winit` from a fork's `master`, so the branch does not compile on a
# Mac against the fork as it stands today. Dropping the call is what upstream itself
# did by the time it published `tauri-runtime-cef 3.0.0-alpha.0`; it costs a window
# attribute nib does not set.
FIRST_MOUSE_BEFORE = """      let pl_attrs = (*platform_attrs(&mut builder.attrs.inner))
        .with_accepts_first_mouse(config.accept_first_mouse);

      builder.attrs.inner = builder
        .attrs
        .inner
        .with_platform_attributes(Box::new(pl_attrs));
"""
FIRST_MOUSE_AFTER = """      // `with_accepts_first_mouse` was removed in winit 0.31, which is the winit
      // this branch resolves to. See apps/desktop/src-tauri/cef/upstream.py.
      let _ = config.accept_first_mouse;
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


def edit(path: Path, before: str, after: str, done: str, what: str) -> None:
    """One replacement, applied once, or a complaint saying which."""
    text = path.read_text(encoding='utf-8')

    if done in text:
        print(f'{what}: already there')
        return
    if before not in text:
        raise SystemExit(
            f'{path} has nothing to replace for {what}; the branch has moved, '
            'and it may well have fixed this itself'
        )

    path.write_text(text.replace(before, after, 1), encoding='utf-8')
    print(f'{what}: done')


def repair() -> None:
    """Every edit, applied once each."""
    edit(
        INTO / 'crates' / 'tauri' / 'Cargo.toml',
        FEATURE_ANCHOR,
        FEATURE_ADDED,
        'wry = []',
        'the wry feature every plugin asks for',
    )
    edit(
        INTO / 'crates' / 'tauri-runtime-cef' / 'Cargo.toml',
        SANDBOX_BEFORE,
        SANDBOX_AFTER,
        '# `sandbox` off:',
        'the sandbox library Windows cannot load as an executable',
    )
    edit(
        INTO / 'crates' / 'tauri-runtime-cef' / 'src' / 'window_builder.rs',
        FIRST_MOUSE_BEFORE,
        FIRST_MOUSE_AFTER,
        'let _ = config.accept_first_mouse;',
        'the winit method macOS no longer has',
    )


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
