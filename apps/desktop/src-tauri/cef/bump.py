#!/usr/bin/env python3
"""Move the pin to what upstream has now, and say what moved.

Emil's requirement for the engine was *"we don't need to do anything manually when
there are upstream changes"*, and this is the half of that which nib owns. The
engine's own cadence is CEF's: a branch per Chromium milestone, about four weeks
apart, with `cef-rs` publishing within days of each one and `tauri-runtime-cef`
taking whatever `cef-rs` has. So nib's part is to follow one revision, rebuild,
re-measure, and put the numbers in front of a person - which is a button rather
than a hand step.

    python bump.py                  # what would move, and nothing moved
    python bump.py --write          # move the pin in Cargo.toml
    python bump.py --set <revision> # move it to exactly this one

What it reports, all of it read from a primary source at the moment it runs:

  the pin          the revision `Cargo.toml` names, and the head of the branch it
                   follows
  the engine       which `cef` crate that revision pins, which is which Chromium
  CEF's own newest the newest *true* stable CEF, from the channel index - sorted by
                   version and not by date, because the index is ordered by
                   modification time and LTC branches are labelled stable too. That
                   is spike/browser/scripts/fetch-cef.py, which already knows
  published yet    whether `tauri-runtime-cef` is a release on crates.io. The day it
                   is, the pin becomes a version number, `upstream.py` goes away and
                   this file gets shorter

See docs/browser.md, section 7.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / 'Cargo.toml'
FETCH_CEF = HERE.parents[3] / 'spike' / 'browser' / 'scripts' / 'fetch-cef.py'


def pin() -> dict[str, str]:
    """The repository, the branch and the revision, from the one place in Cargo.toml."""
    text = MANIFEST.read_text(encoding='utf-8')
    block = text.split('[package.metadata.cef]', 1)
    if len(block) != 2:
        raise SystemExit(f'{MANIFEST} has no [package.metadata.cef] to read the pin from')

    found = {}
    for key in ('repository', 'branch', 'revision'):
        match = re.search(rf'^{key} = "([^"]+)"', block[1], re.M)
        if not match:
            raise SystemExit(f'{MANIFEST} names no {key} under the pin')
        found[key] = match.group(1)
    return found


def head(repository: str, branch: str) -> str:
    """What the branch points at right now, or a sentence and a stop.

    **The one lookup that is not allowed to half-fail.** Everything below is a
    description of a revision and can be reported as unreachable; this *is* the
    revision, so a network that cannot be reached here has to end the run rather than
    leave the rest of the report to describe a pin nobody resolved. Said as a sentence
    and not as a traceback, because the reader is somebody looking at a red Monday.
    """
    done = subprocess.run(
        ['git', 'ls-remote', repository, f'refs/heads/{branch}'],
        capture_output=True,
        text=True,
        check=False,
    )
    if done.returncode != 0:
        said = (done.stderr or done.stdout).strip() or f'git exited {done.returncode}'
        raise SystemExit(f'could not reach {repository} to resolve {branch}: {said}')
    out = done.stdout.split()
    if not out:
        raise SystemExit(f'{repository} has no branch {branch}')
    return out[0]


def engine_version(revision: str, missed: list[str]) -> str | None:
    """Which `cef` crate the revision pins, which is which Chromium it is."""
    url = (
        'https://raw.githubusercontent.com/tauri-apps/tauri/'
        f'{revision}/crates/tauri-runtime-cef/Cargo.toml'
    )
    try:
        text = urllib.request.urlopen(url, timeout=60).read().decode()
    except OSError as error:
        missed.append(f'the engine version of {revision[:12]}: {error}')
        return None
    match = re.search(r'^cef = \{ version = "=?([^"]+)"', text, re.M)
    if not match:
        missed.append(f'the engine version of {revision[:12]}: no cef version in the manifest')
        return None
    return match.group(1)


def newest_stable_cef(missed: list[str]) -> str | None:
    """The newest true stable CEF, out of the script that already knows the traps."""
    if not FETCH_CEF.is_file():
        missed.append(f"CEF's own newest stable: no {FETCH_CEF}")
        return None
    out = subprocess.run(
        [sys.executable, str(FETCH_CEF), '--newest-stable', '--print-version'],
        capture_output=True,
        text=True,
        check=False,
    )
    # It says the version and then talks about the channels, which is useful to a
    # person reading a log and not to this.
    for line in out.stdout.splitlines():
        if line.startswith('cef '):
            return line[len('cef ') :].strip()
    said = (out.stderr or out.stdout).strip().splitlines()
    missed.append(f"CEF's own newest stable: {said[-1] if said else 'nothing was said'}")
    return None


def published(missed: list[str]) -> str | None:
    """Whether `tauri-runtime-cef` is a release yet, and which one."""
    try:
        raw = urllib.request.urlopen(
            urllib.request.Request(
                'https://crates.io/api/v1/crates/tauri-runtime-cef',
                headers={'User-Agent': 'nib-cef-bump'},
            ),
            timeout=60,
        ).read()
    except OSError as error:
        missed.append(f'whether the engine is published: {error}')
        return None
    try:
        return json.loads(raw)['crate']['newest_version']
    except (KeyError, ValueError) as error:
        missed.append(f'whether the engine is published: {error}')
        return None


def write(revision: str) -> None:
    """Move the one line, and leave every other line exactly as it was.

    `newline='\\n'` is load bearing on Windows, where Python's text mode would
    otherwise translate every line ending on the way out and turn a one-line edit into
    a whole-file rewrite. The flagged package's own test reads this manifest with
    `include_str!` and splits it on `"\\n[patch.crates-io]\\n"`, so a file that came back
    with CRLF failed a test about the patch list on the only platform that does that -
    which is what a dispatch of cef-bump.yml on a Windows runner found.
    """
    text = MANIFEST.read_text(encoding='utf-8')
    MANIFEST.write_text(
        re.sub(r'^revision = "[0-9a-f]+"', f'revision = "{revision}"', text, count=1, flags=re.M),
        encoding='utf-8',
        newline='\n',
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true', help='move the pin')
    ap.add_argument('--set', default=None, help='move it to exactly this revision')
    ap.add_argument('--out', default=None, help='write the report here as JSON as well')
    args = ap.parse_args()

    held = pin()
    wanted = args.set or head(held['repository'], held['branch'])

    missed: list[str] = []
    report = {
        'repository': held['repository'],
        'branch': held['branch'],
        'from': held['revision'],
        'to': wanted,
        'moved': wanted != held['revision'],
        'engine_before': engine_version(held['revision'], missed),
        'engine_after': engine_version(wanted, missed),
        'newest_stable_cef': newest_stable_cef(missed),
        'published': published(missed),
        # What could not be read, by name. A null in this report used to mean either
        # "there is no answer" or "nobody could ask", and a Monday morning cannot tell
        # those apart.
        'unreachable': missed,
    }

    if report['moved'] and (args.write or args.set):
        write(wanted)
        print(f'the pin is now {wanted}')
    elif report['moved']:
        print(f'{held["revision"]} -> {wanted}, and nothing was written')
    else:
        print(f'the pin is already {wanted}')

    print(json.dumps(report, indent=2))
    if args.out:
        # With the newline, because the workflow reads this file into a multiline job
        # output and that syntax needs its delimiter on a line of its own: a file that
        # ends without a newline put `}REPORT` on one line and failed the whole job
        # with "Matching delimiter not found", which is what the first scheduled run
        # did. The workflow guards it too; a file that ends properly is the fix.
        Path(args.out).write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')

    for one in missed:
        print(f'could not read {one}')

    # **And then stop, if what could not be read is what a pull request would claim.**
    # A bump whose new revision cannot be described is a bump nobody can review, so it
    # is a red job with a sentence rather than a draft pull request with a null in it.
    if report['moved'] and report['engine_after'] is None:
        print(f'the pin would move to {wanted} and nothing could be read about it; stopping')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
