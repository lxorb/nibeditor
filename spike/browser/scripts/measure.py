#!/usr/bin/env python3
"""Run the spike and write down what it cost.

The spike binary does the browser work and prints one JSON object per line to
stdout - `{"at": <ms since it started>, "event": "...", ...}`. This script starts
it, reads that, and answers the five questions the decision rests on:

  processes  how many browser processes serve two tabs. One is the whole point.
  memory     the resident set of the whole tree with two tabs open.
  paint      milliseconds from "make me a browser" to the first paint in it.
  size       the bytes a release would have to ship.
  cold       that nib's own launch is untouched when no web tab is open, which is
             measured as the spike started with `--no-browser`: CEF is not
             initialised, so the number is the binary's own start.

Everything is written to a JSON file and a short human summary, and both go up as
CI artefacts. No third-party packages: a runner has Python and nothing else.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path

WINDOWS = platform.system() == 'Windows'
MACOS = platform.system() == 'Darwin'


# --- the process tree -------------------------------------------------------


def processes() -> list[dict]:
    """Every process on the machine as `{pid, ppid, rss, command}`.

    `rss` is in bytes. On Windows that is the working set, which is the closest
    thing the system reports to a resident set; the number is only ever compared
    against another number this same function produced.
    """
    if WINDOWS:
        script = (
            'Get-CimInstance Win32_Process | '
            'Select-Object ProcessId,ParentProcessId,WorkingSetSize,CommandLine | '
            'ConvertTo-Json -Compress -Depth 3'
        )
        out = subprocess.run(
            ['powershell', '-NoProfile', '-NonInteractive', '-Command', script],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        rows = json.loads(out)
        return [
            {
                'pid': r['ProcessId'],
                'ppid': r['ParentProcessId'],
                'rss': r['WorkingSetSize'] or 0,
                'command': r['CommandLine'] or '',
            }
            for r in (rows if isinstance(rows, list) else [rows])
        ]

    out = subprocess.run(
        ['ps', '-Ao', 'pid=,ppid=,rss=,args='], capture_output=True, text=True, check=True
    ).stdout
    rows = []
    for line in out.splitlines():
        parts = line.split(None, 3)
        if len(parts) < 4:
            continue
        rows.append(
            {
                'pid': int(parts[0]),
                'ppid': int(parts[1]),
                # ps reports kilobytes.
                'rss': int(parts[2]) * 1024,
                'command': parts[3],
            }
        )
    return rows


def tree(root: int, all_rows: list[dict]) -> list[dict]:
    """`root` and everything under it, however deep."""
    by_parent: dict[int, list[dict]] = {}
    for row in all_rows:
        by_parent.setdefault(row['ppid'], []).append(row)
    found = {row['pid']: row for row in all_rows if row['pid'] == root}
    frontier = [root]
    while frontier:
        pid = frontier.pop()
        for child in by_parent.get(pid, []):
            if child['pid'] not in found:
                found[child['pid']] = child
                frontier.append(child['pid'])
    return list(found.values())


def kind(command: str) -> str:
    """What Chromium calls this process, off its own `--type=` switch.

    A Chromium process says what it is on its command line and nowhere else. No
    `--type=` at all is the browser process: the one that owns the tabs, the
    profile, the extensions and the network service. Counting how many of those
    serve two tabs is the single measurement this whole spike exists for.
    """
    for part in command.replace('"', ' ').split():
        if part.startswith('--type='):
            return part[len('--type=') :]
    return 'browser'


# --- what a release would ship ---------------------------------------------

# The files CEF's own distribution documents as required at runtime, by platform.
# Anything in the distribution that is not here is a header, a static library, a
# sample, or a debug binary - none of which ships.
SHIPPED = {
    'Windows': [
        'libcef.dll',
        'chrome_elf.dll',
        'd3dcompiler_47.dll',
        'libEGL.dll',
        'libGLESv2.dll',
        'vk_swiftshader.dll',
        'vk_swiftshader_icd.json',
        'vulkan-1.dll',
        'v8_context_snapshot.bin',
        'icudtl.dat',
        'chrome_100_percent.pak',
        'chrome_200_percent.pak',
        'resources.pak',
        'locales',
    ],
    'Linux': [
        'libcef.so',
        'libEGL.so',
        'libGLESv2.so',
        'libvk_swiftshader.so',
        'libvulkan.so.1',
        'vk_swiftshader_icd.json',
        'v8_context_snapshot.bin',
        'snapshot_blob.bin',
        'icudtl.dat',
        'chrome_100_percent.pak',
        'chrome_200_percent.pak',
        'resources.pak',
        'locales',
        'chrome-sandbox',
    ],
    # One framework bundle, which holds all of the above.
    'Darwin': ['Chromium Embedded Framework.framework'],
}


def bytes_at(path: Path) -> int:
    if path.is_file():
        return path.stat().st_size
    if not path.is_dir():
        return 0
    return sum(p.stat().st_size for p in path.rglob('*') if p.is_file())


def shipped_size(cef_path: Path) -> dict:
    """What the release half of a CEF distribution weighs, file by file."""
    release = cef_path / 'Release'
    resources = cef_path / 'Resources'
    per_file: dict[str, int] = {}
    for name in SHIPPED.get(platform.system(), []):
        for base in (release, resources):
            candidate = base / name
            if candidate.exists():
                per_file[name] = bytes_at(candidate)
                break
    # The locale packs live under Resources on Windows and Linux and are a
    # directory of a hundred small files; the framework already holds them.
    return {'total': sum(per_file.values()), 'files': per_file}


# --- a picture of the screen ------------------------------------------------


def screenshot(dest: Path, label: str) -> Path | None:
    """A picture of the whole screen, however this system takes one.

    A screenshot rather than a window capture, because what is being proved is
    partly that a native view landed where it was told to: a capture of one
    window would hide exactly the mistake worth seeing.
    """
    dest.mkdir(parents=True, exist_ok=True)
    out = dest / f'{label}.png'
    try:
        if MACOS:
            subprocess.run(['screencapture', '-x', str(out)], check=True, timeout=60)
        elif WINDOWS:
            script = f"""
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $bmp.Size)
$bmp.Save('{out.as_posix()}', [System.Drawing.Imaging.ImageFormat]::Png)
"""
            subprocess.run(
                ['powershell', '-NoProfile', '-NonInteractive', '-Command', script],
                check=True,
                timeout=120,
            )
        elif shutil.which('import'):
            subprocess.run(['import', '-window', 'root', str(out)], check=True, timeout=60)
        elif shutil.which('xwd'):
            raw = subprocess.run(
                ['xwd', '-root', '-silent'], capture_output=True, check=True, timeout=60
            ).stdout
            (dest / f'{label}.xwd').write_bytes(raw)
            return dest / f'{label}.xwd'
        else:
            return None
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        print(f'no screenshot for {label}: {error}')
        return None
    return out if out.exists() else None


# --- the run ----------------------------------------------------------------


def run(binary: Path, extra: list[str], out_dir: Path, timeout: int) -> dict:
    """Start the spike, read its events, measure it while it is up."""
    started = time.monotonic()
    env = dict(os.environ)
    env['NIB_SPIKE_SHOTS'] = str(out_dir / 'shots')
    process = subprocess.Popen(
        [str(binary), *extra],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env=env,
    )

    events: list[dict] = []
    log: list[str] = []
    snapshots: list[dict] = []
    assert process.stdout is not None
    for line in process.stdout:
        line = line.rstrip('\n')
        log.append(line)
        print(f'  | {line}', flush=True)
        if line.startswith('{'):
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            events.append(event)
            name = event.get('event')
            if name == 'ready':
                # Two tabs are up and painted. This is the moment worth
                # measuring and the moment worth photographing.
                time.sleep(2)
                rows = tree(process.pid, processes())
                snapshots.append(
                    {
                        'when': 'two tabs',
                        'processes': [
                            {'pid': r['pid'], 'kind': kind(r['command']), 'rss': r['rss']}
                            for r in rows
                        ],
                    }
                )
                shot = screenshot(out_dir / 'shots', 'two-tabs')
                if shot:
                    print(f'  | screenshot {shot.name}')
            elif isinstance(name, str) and name.startswith('shot:'):
                shot = screenshot(out_dir / 'shots', name[len('shot:') :])
                if shot:
                    print(f'  | screenshot {shot.name}')
        if time.monotonic() - started > timeout:
            process.kill()
            log.append('*** the spike outran its timeout and was killed')
            break

    code = process.wait(timeout=60)
    return {
        'argv': [binary.name, *extra],
        'exit': code,
        'wall_ms': round((time.monotonic() - started) * 1000),
        'events': events,
        'snapshots': snapshots,
        'log': log,
    }


def summarise(result: dict) -> dict:
    """The five numbers, pulled out of a run's events and snapshots."""
    events = {e.get('event'): e for e in result['events']}
    two_tabs = next((s for s in result['snapshots'] if s['when'] == 'two tabs'), None)
    answer: dict = {
        'exit': result['exit'],
        'paint_ms': events.get('first-paint', {}).get('at'),
        'init_ms': events.get('cef-initialised', {}).get('at'),
        'binary_ready_ms': events.get('window-shown', {}).get('at'),
    }
    if two_tabs:
        by_kind: dict[str, int] = {}
        rss = 0
        for p in two_tabs['processes']:
            by_kind[p['kind']] = by_kind.get(p['kind'], 0) + 1
            rss += p['rss']
        answer['processes'] = by_kind
        answer['browser_processes'] = by_kind.get('browser', 0)
        answer['rss_mb'] = round(rss / 1048576, 1)
    return answer


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--binary', required=True)
    ap.add_argument('--cef-path', default=os.environ.get('CEF_PATH'))
    ap.add_argument('--out', default='spike-out')
    ap.add_argument('--timeout', type=int, default=300)
    args = ap.parse_args()

    binary = Path(args.binary).resolve()
    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    report: dict = {
        'platform': f'{platform.system()} {platform.machine()}',
        'cef': os.environ.get('CEF_VERSION'),
        'chromium': os.environ.get('CHROMIUM_VERSION'),
        'binary_bytes': binary.stat().st_size,
    }

    if args.cef_path:
        report['shipped'] = shipped_size(Path(args.cef_path))

    # The cold run first, so the machine is as quiet for it as it will ever be.
    # No browser is asked for, so CEF is never initialised: what this measures is
    # the cost of a build that *can* open a web tab to somebody who does not.
    print('== no web tab ==')
    report['cold'] = summarise(run(binary, ['--no-browser'], out_dir / 'cold', 120))

    print('== two web tabs ==')
    full = run(binary, [], out_dir / 'full', args.timeout)
    report['full'] = summarise(full)
    report['full']['checks'] = [
        e for e in full['events'] if e.get('event') == 'check'
    ]

    (out_dir / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    (out_dir / 'full.log').write_text('\n'.join(full['log']), encoding='utf-8')

    print()
    print(json.dumps(report, indent=2))

    failures = [c for c in report['full']['checks'] if not c.get('ok')]
    if report['full']['exit'] != 0:
        print(f'the spike exited {report["full"]["exit"]}')
        return 1
    if report['full'].get('browser_processes') != 1:
        print(f'expected one browser process, counted {report["full"].get("browser_processes")}')
        return 1
    if failures:
        for c in failures:
            print(f'failed: {c.get("name")} - {c.get("note")}')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
