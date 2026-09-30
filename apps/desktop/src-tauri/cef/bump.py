#!/usr/bin/env python3
"""Move the engine's pins to what upstream has published, and say what moved.

Emil's requirement for the engine was *"we don't need to do anything manually when
there are upstream changes"*, and this is the half of that which nib owns. The engine
is published crates now - `tauri-runtime-cef` beside a Tauri 3 alpha, the plugins built
against one of its alphas, and `cef` for the Chromium under all of it - and the pins
are the six lines of `[package.metadata.engine]` in Cargo.toml beside this file. So
nib's part is to find the newest set that belongs together, rewrite those lines and the
dependency list written from them, and let the workflow build, measure and propose it.

**Which set belongs together.** Semver says an alpha's plugins accept any later alpha,
and the day Tauri renamed a method between two alphas they did not compile against it
(measured: `tauri-plugin-dialog` 3.0.0-alpha.1 against `tauri` 3.0.0-alpha.3). So the
set is read from what the plugins were built against rather than what they accept: the
lowest Tauri every plugin's newest release asks for is the Tauri, and the runtime is the
newest release built against exactly that Tauri, with Tauri's runtime interface held to
the release the runtime itself was built against.

    python bump.py --out bump.json        # what would move; nothing is written
    python bump.py --set '<pins json>'    # write exactly these pins

See docs/browser.md, section 7, and .github/workflows/cef-bump.yml.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / 'Cargo.toml'
ROOT = HERE.parents[3]

#: The plugins the app takes; the manifest's own list, read rather than repeated.
PLUGIN = re.compile(r'^(tauri-plugin-[a-z-]+) = ', re.M)

#: The pins, by the key `[package.metadata.engine]` writes them under.
KEYS = ('tauri', 'tauri-runtime-cef', 'tauri-runtime', 'tauri-build', 'plugins', 'cef')

AGENT = {'User-Agent': 'nib cef-bump (https://github.com/lxorb/nibeditor)'}


def crates_io(path: str) -> dict:
    request = urllib.request.Request(f'https://crates.io/api/v1/{path}', headers=AGENT)
    with urllib.request.urlopen(request, timeout=30) as answer:
        return json.loads(answer.read())


def versions(crate: str) -> list[str]:
    """Every published version of one crate, newest first, yanked ones left out."""
    said = crates_io(f'crates/{crate}/versions?per_page=100')
    return [one['num'] for one in said['versions'] if not one['yanked']]


def wants(crate: str, version: str, dependency: str) -> str | None:
    """What one release of `crate` asks of `dependency`, as written, or None."""
    said = crates_io(f'crates/{crate}/{version}/dependencies')
    for one in said['dependencies']:
        if one['crate_id'] == dependency and one['kind'] == 'normal':
            return one['req']
    return None


def floor(requirement: str) -> str:
    """The version a requirement starts at: `^3.0.0-alpha.2` and `=3.0.0-alpha.2` are
    both built against 3.0.0-alpha.2."""
    return re.sub(r'^[=^~><\s]+', '', requirement.split(',')[0]).strip()


def alpha_of(version: str) -> tuple[int, ...]:
    """A version's order, pre-release number included, for the 3.x alphas."""
    numbers = [int(part) for part in re.findall(r'\d+', version)]
    return tuple(numbers)


def current() -> dict[str, str]:
    text = MANIFEST.read_text(encoding='utf-8')
    table = text.split('\n[package.metadata.engine]\n', 1)[1]
    return {key: re.search(rf'^{re.escape(key)} = "([^"]+)"', table, re.M).group(1) for key in KEYS}


def newest() -> dict[str, str]:
    """The newest set of pins that belongs together; see this file's own docs."""
    plugins = sorted(set(PLUGIN.findall(MANIFEST.read_text(encoding='utf-8'))))
    built_against: list[str] = []
    plugin_version = ''
    for plugin in plugins:
        latest = next(one for one in versions(plugin) if one.startswith('3.'))
        plugin_version = max(plugin_version, latest, key=lambda one: alpha_of(one) if one else ())
        built_against.append(floor(wants(plugin, latest, 'tauri') or ''))
    tauri = min(built_against, key=alpha_of)

    runtime = next(
        one
        for one in versions('tauri-runtime-cef')
        if floor(wants('tauri-runtime-cef', one, 'tauri') or '') == tauri
    )
    cef = floor(wants('tauri-runtime-cef', runtime, 'cef') or '')
    core = floor(wants('tauri-runtime-cef', runtime, 'tauri-runtime') or '')
    utils = floor(wants('tauri', tauri, 'tauri-utils') or '')
    build = next(
        one
        for one in versions('tauri-build')
        if one.startswith('3.') and floor(wants('tauri-build', one, 'tauri-utils') or '') == utils
    )
    return {
        'tauri': tauri,
        'tauri-runtime-cef': runtime,
        'tauri-runtime': core,
        'tauri-build': build,
        'plugins': plugin_version,
        'cef': cef.split('+')[0],
    }


def write(pins: dict[str, str]) -> None:
    """The pins into the manifest, and the dependency list written from them again."""
    text = MANIFEST.read_text(encoding='utf-8')
    for key in KEYS:
        text = re.sub(
            rf'(\n\[package\.metadata\.engine\]\n(?:.*\n)*?){re.escape(key)} = "[^"]+"',
            lambda found, key=key: f'{found.group(1)}{key} = "{pins[key]}"',
            text,
            count=1,
        )
    MANIFEST.write_text(text, encoding='utf-8', newline='\n')
    subprocess.run(['node', str(ROOT / 'scripts' / 'engine-manifest.ts')], check=True)


def main() -> int:
    parsed = argparse.ArgumentParser()
    parsed.add_argument('--out', type=Path)
    parsed.add_argument('--set', dest='pins')
    args = parsed.parse_args()

    if args.pins:
        write(json.loads(args.pins))
        return 0

    was = current()
    now = newest()
    report = {'moved': was != now, 'from': was, 'to': now}
    text = json.dumps(report, indent=2) + '\n'
    if args.out:
        args.out.write_text(text, encoding='utf-8')
    print(text, end='')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
