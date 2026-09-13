#!/usr/bin/env python3
"""Run nib on both engines and print the gate table.

Batch 1 of docs/browser.md is allowed to answer "not yet", so it has to answer
with numbers. This runs the app twice - once as it ships, on the system's engine,
and once as `nib-cef`, on nib's own Chromium - and writes down what the second one
costs: the launch, the memory with no tab and with one and with two, what a
release would have to carry, and whether the engine's own pages, an extension and
the two profiles are what the design says they are.

The flagged build says its own numbers: `engine::gate` in the crate prints one
JSON object per line, `{"at": <ms>, "event": "..."}`, which is the protocol
`spike/browser/scripts/measure.py` already reads, so the spike's table and this
one can be read against each other. This script starts it, follows that, counts
the process tree at each step, photographs the screen and fails on any check the
app reported false.

The default build has no gate in it - that is the point of the feature being off -
so its launch is read from the launch trace the app already writes when
`NIB_TRACE_STARTUP` is set. Same instrument, same axis, both builds.

    python gate.py --cef target/release/nib-cef --control ../target/release/nib \\
        --payload target/release --out gate-out
"""

from __future__ import annotations

import argparse
import json
import lzma
import os
import platform
import queue
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONFIG = HERE.parent / 'tauri.conf.json'

WINDOWS = platform.system() == 'Windows'
MACOS = platform.system() == 'Darwin'

# What a release has to carry beside the binary, by the name CEF gives it. Weighed
# and compressed on its own as well as with everything else, because "how much
# bigger is the download" is the one number a reader of the release notes will
# actually feel.
CEF_PAYLOAD = (
    'libcef.dll',
    'libcef.so',
    'chrome_elf.dll',
    'd3dcompiler_47.dll',
    'dxcompiler.dll',
    'dxil.dll',
    'libEGL.dll',
    'libGLESv2.dll',
    'vk_swiftshader.dll',
    'vulkan-1.dll',
    'icudtl.dat',
    'resources.pak',
    'chrome_100_percent.pak',
    'chrome_200_percent.pak',
    'snapshot_blob.bin',
    'v8_context_snapshot.bin',
    'vk_swiftshader_icd.json',
    'locales',
    'Chromium Embedded Framework.framework',
    'chrome-sandbox',
)


def identifier() -> str:
    """The app's identifier, from the one place that has it."""
    return json.loads(CONFIG.read_text(encoding='utf-8'))['identifier']


def log_dir() -> Path:
    """Where the app writes its launch trace, the way Tauri works it out."""
    app = identifier()
    if MACOS:
        return Path.home() / 'Library' / 'Logs' / app
    if WINDOWS:
        return Path(os.environ.get('LOCALAPPDATA', Path.home())) / app / 'logs'
    local = os.environ.get('XDG_DATA_HOME') or str(Path.home() / '.local' / 'share')
    return Path(local) / app / 'logs'


def config_dir() -> Path:
    """Where the app keeps its settings, and under it the engine's profiles."""
    app = identifier()
    if MACOS:
        return Path.home() / 'Library' / 'Application Support' / app
    if WINDOWS:
        return Path(os.environ.get('APPDATA', Path.home())) / app
    config = os.environ.get('XDG_CONFIG_HOME') or str(Path.home() / '.config')
    return Path(config) / app


# --- the process tree -------------------------------------------------------


def processes() -> list[dict]:
    """Every process on the machine as `{pid, ppid, rss, command}`, rss in bytes.

    On Windows that is the working set, which is the closest thing the system
    reports to a resident set; every number here is only ever compared against
    another number this same function produced.
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


def tree(root: int, rows: list[dict]) -> list[dict]:
    """`root` and everything under it, however deep."""
    by_parent: dict[int, list[dict]] = {}
    for row in rows:
        by_parent.setdefault(row['ppid'], []).append(row)
    found = {row['pid']: row for row in rows if row['pid'] == root}
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

    No `--type=` at all is the browser process: the one that owns the tabs, the
    profiles, the extensions and the network service. How many of those serve two
    tabs is the measurement the whole design rests on, and the answer has to be
    one.
    """
    for part in command.replace('"', ' ').split():
        if part.startswith('--type='):
            return part[len('--type=') :]
    return 'browser'


def snapshot(pid: int) -> dict:
    """The tree's processes by kind and what it all weighs, right now."""
    rows = tree(pid, processes())
    by_kind: dict[str, int] = {}
    for row in rows:
        name = kind(row['command'])
        by_kind[name] = by_kind.get(name, 0) + 1
    return {
        'processes': len(rows),
        'by_kind': by_kind,
        'browser_processes': by_kind.get('browser', 0),
        'rss_mb': round(sum(row['rss'] for row in rows) / 1048576, 1),
    }


# --- what a release would ship ----------------------------------------------


def files_under(path: Path) -> list[Path]:
    if path.is_file():
        return [path]
    return [one for one in path.rglob('*') if one.is_file() and not one.is_symlink()]


def chosen_files(payload: Path, names: tuple[str, ...] | None) -> list[Path]:
    """Every file under `payload` that a release would have to carry.

    By name anywhere in the path rather than by a layout, because the layout is
    whatever the distribution happened to unpack into and the question is only
    which bytes are Chromium's. A named directory - the locales, the macOS
    framework - brings everything inside it.
    """
    found = files_under(payload)
    if names is None:
        return found

    wanted = set(names)
    return [
        one
        for one in found
        if one.name in wanted or any(part in wanted for part in one.relative_to(payload).parts)
    ]


def weigh(payload: Path, names: tuple[str, ...] | None = None) -> dict:
    """What a tree weighs unpacked, and what it weighs compressed.

    The compressed figure is the installer delta, measured rather than estimated:
    NSIS compresses with LZMA and a deb with xz, so this runs the same algorithm
    over the same bytes. A dmg uses zlib and compresses a little less well, which
    is said in the table rather than corrected for.
    """
    if not payload.is_dir():
        return {'error': f'{payload} is not a directory'}

    chosen = [payload / name for name in names] if names else [payload]
    found: list[Path] = []
    for one in chosen:
        if one.exists():
            found.extend(files_under(one))

    total = sum(one.stat().st_size for one in found)
    biggest = sorted(found, key=lambda one: one.stat().st_size, reverse=True)[:12]
    return {
        'files': len(found),
        'unpacked_mb': round(total / 1048576, 1),
        'biggest': [
            {'name': str(one.relative_to(payload)), 'mb': round(one.stat().st_size / 1048576, 2)}
            for one in biggest
        ],
    }


def compress(payload: Path, names: tuple[str, ...] | None = None) -> int:
    """How many bytes those files come to under LZMA, streamed so nothing is held."""
    chosen = [payload / name for name in names] if names else [payload]
    found: list[Path] = []
    for one in chosen:
        if one.exists():
            found.extend(files_under(one))

    out = 0
    packer = lzma.LZMACompressor(preset=6)
    for one in sorted(found):
        with one.open('rb') as reading:
            while True:
                block = reading.read(4 << 20)
                if not block:
                    break
                out += len(packer.compress(block))
    return out + len(packer.flush())


# --- a picture of the screen ------------------------------------------------


def screenshot(dest: Path, label: str) -> Path | None:
    """A picture of the whole screen, however this system takes one.

    A screenshot rather than a window capture, because part of what is being
    proved is that a native view landed where it was told to: a capture of one
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
        else:
            return None
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        print(f'no screenshot for {label}: {error}')
        return None
    return out if out.exists() else None


# --- the launch trace -------------------------------------------------------


def trace_file() -> Path:
    return log_dir() / 'startup-trace.log'


def read_trace() -> dict:
    """The last launch on the trace, as `{step: milliseconds}` in order.

    The app appends a page per launch, so the last `=== nib ... ===` header is
    this run's. Every line is a step, the milliseconds it happened at and how long
    it took; only the first number is wanted here.
    """
    path = trace_file()
    if not path.is_file():
        return {}

    pages = path.read_text(encoding='utf-8', errors='replace').split('=== nib ')
    if len(pages) < 2:
        return {}

    steps: dict[str, float] = {}
    for line in pages[-1].splitlines()[1:]:
        if ' ms ' not in line:
            continue
        step, rest = line.rsplit(' ms  +', 1) if ' ms  +' in line else (line, '')
        parts = step.rsplit(None, 1)
        if len(parts) != 2:
            continue
        try:
            steps[parts[0].strip()] = float(parts[1])
        except ValueError:
            continue
    return steps


# --- the runs ---------------------------------------------------------------


def run(binary: Path, env: dict[str, str], out_dir: Path, timeout: int, measured: bool) -> dict:
    """Start a build, follow what it says, and measure it while it is up."""
    started = time.monotonic()
    whole = dict(os.environ)
    whole.update(env)
    out_dir.mkdir(parents=True, exist_ok=True)

    process = subprocess.Popen(
        [str(binary)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env=whole,
        cwd=str(binary.parent),
    )

    events: list[dict] = []
    log: list[str] = []
    snapshots: dict[str, dict] = {}

    # The reading happens on a thread and the clock is watched on this one, so a
    # build that hangs silently is still a build with a number against it.
    lines: queue.Queue[str | None] = queue.Queue()

    def read() -> None:
        assert process.stdout is not None
        for raw in process.stdout:
            lines.put(raw)
        lines.put(None)

    threading.Thread(target=read, daemon=True).start()

    # The default build says nothing at all, on purpose: it is watched through the
    # trace file it writes and then asked to go.
    watching_trace = not measured

    while True:
        if time.monotonic() - started > timeout:
            log.append('*** the run outran its timeout and was killed')
            break

        if watching_trace and 'window shown' in read_trace():
            time.sleep(2)
            snapshots['tabs:0'] = snapshot(process.pid)
            screenshot(out_dir / 'shots', 'control')
            break

        try:
            raw = lines.get(timeout=1)
        except queue.Empty:
            continue
        if raw is None:
            break

        line = raw.rstrip('\n')
        log.append(line)
        print(f'  | {line}', flush=True)
        if not line.startswith('{'):
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue

        events.append(event)
        name = event.get('event')
        if name == 'tabs':
            # Two seconds after the app said the tab had painted, which is as
            # settled as a runner's memory ever gets.
            time.sleep(2)
            snapshots[f'tabs:{event.get("count")}'] = snapshot(process.pid)
        elif isinstance(name, str) and name.startswith('shot:'):
            screenshot(out_dir / 'shots', name[len('shot:') :])

    trace = read_trace()
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=30)
        except subprocess.TimeoutExpired:
            process.kill()

    return {
        'binary': binary.name,
        'exit': process.returncode,
        'wall_ms': round((time.monotonic() - started) * 1000),
        'events': events,
        'snapshots': snapshots,
        'trace': trace,
        'checks': [one for one in events if one.get('event') == 'check'],
        'log': log[-400:],
    }


def at(result: dict, event: str) -> float | None:
    for one in result['events']:
        if one.get('event') == event:
            return one.get('at')
    return None


def launch_ms(result: dict) -> float | None:
    """When the window was on screen, on the app's own axis.

    The launch trace, because both builds write it and it counts from before our
    first line - the machine loading the binary included. The gate's own
    `window-shown` is the same moment on the same axis and is the fallback where
    the trace could not be written at all.
    """
    trace = result.get('trace') or {}
    return trace.get('window shown') or at(result, 'window-shown')


# --- the table --------------------------------------------------------------


def table(report: dict) -> str:
    """The gate table, as the markdown that goes in the job summary."""
    control = report.get('control') or {}
    cef = report.get('cef') or {}
    ships = report.get('ships') or {}

    def cell(value: object, unit: str = '') -> str:
        if value is None:
            return 'not measured'
        return f'{value}{unit}'

    def rss(result: dict, tabs: int) -> object:
        return (result.get('snapshots') or {}).get(f'tabs:{tabs}', {}).get('rss_mb')

    def browsers(result: dict, tabs: int) -> object:
        return (result.get('snapshots') or {}).get(f'tabs:{tabs}', {}).get('browser_processes')

    rows = [
        ('platform', report.get('platform'), report.get('platform')),
        ('engine', 'the system\'s', f'CEF, API {report.get("cef_api")}'),
        ('sandbox', 'the system\'s own', report.get('sandbox')),
        ('launch to the window, ms', cell(launch_ms(control)), cell(launch_ms(cef))),
        ('resident, no web tab, MB', cell(rss(control, 0)), cell(rss(cef, 0))),
        ('resident, one web tab, MB', 'not measured', cell(rss(cef, 1))),
        ('resident, two web tabs, MB', 'not measured', cell(rss(cef, 2))),
        ('browser processes, two tabs', 'n/a', cell(browsers(cef, 2))),
        ('unpacked, MB', cell(ships.get('app_unpacked_mb')), cell(ships.get('cef_unpacked_mb'))),
        ('compressed, MB', cell(ships.get('app_packed_mb')), cell(ships.get('cef_packed_mb'))),
        ('installer delta, MB', '-', cell(ships.get('delta_packed_mb'))),
        ('exit code', cell(control.get('exit')), cell(cef.get('exit'))),
    ]

    out = ['| | default build | `cef` |', '| --- | --- | --- |']
    out += [f'| {name} | {left} | {right} |' for name, left, right in rows]

    out.append('')
    out.append('| what the flagged build was asked to prove | |')
    out.append('| --- | --- |')
    for check in cef.get('checks') or []:
        mark = 'yes' if check.get('ok') else '**no**'
        out.append(f'| {check.get("name")} | {mark} - {check.get("note")} |')
    for name, ok in (report.get('profiles') or {}).items():
        out.append(f'| the `{name}` profile is on disk | {"yes" if ok else "**no**"} |')

    return '\n'.join(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--cef', required=True, help='the flagged binary')
    ap.add_argument('--control', default=None, help='the app as it ships')
    ap.add_argument('--payload', default=None, help='the folder a release would ship out of')
    ap.add_argument('--extension', default=None, help='an unpacked MV3 extension to load')
    ap.add_argument('--tabs', type=int, default=2)
    ap.add_argument('--timeout', type=int, default=420)
    ap.add_argument('--no-compress', action='store_true', help='skip the installer delta')
    ap.add_argument('--out', default='gate-out')
    args = ap.parse_args()

    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    report: dict = {
        'platform': f'{platform.system()} {platform.machine()}',
        'sandbox': os.environ.get('NIB_CEF_SANDBOX', 'auto'),
    }

    # A trace of its own for each run: the app appends, and the last page is the
    # one that is read, so an old file would answer for a build that is not up.
    if trace_file().is_file():
        trace_file().unlink()

    if args.control:
        control = Path(args.control).resolve()
        if control.is_file():
            print('== the app as it ships ==')
            report['control'] = run(
                control, {'NIB_TRACE_STARTUP': '1'}, out_dir / 'control', 120, measured=False
            )
        else:
            print(f'no control binary at {control}')

    if trace_file().is_file():
        trace_file().unlink()

    print('== nib on its own Chromium ==')
    env = {'NIB_TRACE_STARTUP': '1', 'NIB_CEF_GATE': str(args.tabs)}
    if args.extension:
        env['NIB_CEF_EXTENSION'] = str(Path(args.extension).resolve())
    cef = run(Path(args.cef).resolve(), env, out_dir / 'cef', args.timeout, measured=True)
    report['cef'] = cef
    report['cef_api'] = (at(cef, 'engine') is not None) and next(
        (one.get('cef_api') for one in cef['events'] if one.get('event') == 'engine'), None
    )

    # The two profiles, on disk, after a run that used both of them.
    root = config_dir() / 'web'
    report['profiles'] = {
        'app': (root / 'app').is_dir(),
        'Default': (root / 'Default').is_dir(),
    }
    report['profile_root'] = str(root)
    report['profile_children'] = sorted(one.name for one in root.iterdir()) if root.is_dir() else []

    if args.payload:
        payload = Path(args.payload).resolve()
        ships: dict = {'payload': str(payload)}
        ships['cef'] = weigh(payload, CEF_PAYLOAD)
        ships['cef_unpacked_mb'] = ships['cef'].get('unpacked_mb')
        binary = Path(args.cef).resolve()
        ships['binary_mb'] = round(binary.stat().st_size / 1048576, 2) if binary.is_file() else None
        if args.control and Path(args.control).is_file():
            ships['app_unpacked_mb'] = round(
                Path(args.control).stat().st_size / 1048576, 2
            )
        if not args.no_compress:
            print('compressing, which is the installer delta rather than a guess')
            ships['cef_packed_mb'] = round(compress(payload, CEF_PAYLOAD) / 1048576, 1)
            if args.control and Path(args.control).is_file():
                ships['app_packed_mb'] = round(
                    compress(Path(args.control).parent, (Path(args.control).name,)) / 1048576, 1
                )
            if ships.get('cef_packed_mb') is not None:
                ships['delta_packed_mb'] = ships['cef_packed_mb']
        report['ships'] = ships

    (out_dir / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    summary = table(report)
    (out_dir / 'gate.md').write_text(summary + '\n', encoding='utf-8')
    print()
    print(summary)

    failed = [one for one in cef['checks'] if not one.get('ok')]
    if cef['exit'] not in (0, None):
        print(f'the flagged build exited {cef["exit"]}')
    if not failed and cef['exit'] == 0:
        return 0
    for one in failed:
        print(f'failed: {one.get("name")} - {one.get("note")}')
    return 1


if __name__ == '__main__':
    sys.exit(main())
