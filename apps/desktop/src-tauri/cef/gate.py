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
        --engine ../../../../.cef --out gate-out

`--engine` is a CEF distribution, and the run lays the engine out around the flagged
binary the way Chromium looks for it before it starts anything - beside the binary on
Windows and Linux, and as a real application bundle with the framework and the five
helper apps in it on a Mac - which is both what a release has to do and what makes the
size rows here the bytes a reader downloads.

**The contract, and it changed in batch 1.5.** This script exits 0 whenever it wrote a
table, and the verdict is *in* the table. A build that does not start is a row that
says so and a diagnosis beside it, not a red job: a red job means the gate could not
run at all, which is a break in the build or in this script. That is what makes the
workflow's own colour worth reading - batch 1 left it red on every run, so nobody
could tell a broken build from a measured "not yet", and the table it stopped before
writing was the thing worth having.

**And a build that never reaches its first line says why.** `diagnose` is the second
half of the gate: the Windows loader's whole import chain against what each module in
it exports, a Mac's bundle and its crash report, Linux's toolkit and a backtrace out
of gdb, and on all three the log CEF itself wrote - which is in the cache directory
rather than on stderr, and is the reason batch 1 read "nothing on stderr" as nothing
at all.
"""

from __future__ import annotations

import argparse
import json
import lzma
import os
import platform
import plistlib
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

# The framework a CEF application on a Mac loads its engine out of, by the name CEF's
# own loader looks for at `../Frameworks` relative to the executable.
FRAMEWORK = 'Chromium Embedded Framework.framework'

# The helper bundles a CEF application on a Mac has to carry, by the suffix CEF looks
# for. With `browser_subprocess_path` unset - and `tauri-runtime-cef` does not set it -
# CEF's default on that platform is
# `Contents/Frameworks/<app> Helper.app/Contents/MacOS/<app> Helper`, and it will not
# re-launch the main executable the way it does on Windows and Linux: the main bundle
# is the one with the entitlements and the one AppKit has already activated. The four
# suffixed ones let the system treat a renderer, the GPU process and an alert
# differently and CEF only uses one it finds, so all five are made.
HELPERS = (
    'Helper',
    'Helper (GPU)',
    'Helper (Renderer)',
    'Helper (Plugin)',
    'Helper (Alerts)',
)


def identifier() -> str:
    """The app's identifier, from the one place that has it."""
    return json.loads(CONFIG.read_text(encoding='utf-8'))['identifier']


def version() -> str:
    """The app's version, from the same place, for the bundle a Mac needs."""
    return str(json.loads(CONFIG.read_text(encoding='utf-8')).get('version') or '0.0.0')


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


def stage(engine: Path, beside: Path) -> list[str]:
    """Put the engine's own files where a release puts them: beside the binary.

    That is what the loader looks for on Windows, what `$ORIGIN` means on Linux, and
    what makes the size rows below the bytes a reader downloads rather than whatever a
    distribution happened to unpack - a CEF distribution also carries its headers, its
    CMake files and its samples, and a release ships none of those.

    `cef-dll-sys`'s own build script already copies the distribution into the cargo
    target directory on these two platforms, so most of this is a copy that finds its
    file already there; it is kept because the gate has to be able to say what it
    weighed, and because a build from a warm cache does not re-run that script.
    """
    copied = []
    for one in chosen_files(engine, CEF_PAYLOAD):
        # Flat, and a named directory keeps its own shape: Chromium wants `locales/`
        # as a directory and the rest as files.
        inside = one.relative_to(engine).parts
        at = next((part for part in inside if part in CEF_PAYLOAD), None)
        if at is None:
            continue
        kept = inside[inside.index(at) :]

        target = beside.joinpath(*kept)
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            shutil.copy2(one, target)
            copied.append(str(target.relative_to(beside)))
    return copied


def plist(executable: str, app_identifier: str, helper: bool) -> dict:
    """The `Info.plist` a CEF bundle on a Mac has to carry, as a dictionary.

    The keys are the ones `cef`'s own bundler writes (`src/build_util/mac.rs`), which
    is the recipe CEF's macOS documentation describes. Two of them are load bearing
    rather than descriptive:

    - `CFBundleExecutable`, because it is what makes the directory a bundle at all, and
      a bundle is what `[NSBundle mainBundle]` has to find for Chromium to resolve
      `icudtl.dat`, the `.pak` files and the locales inside the framework.
    - `LSEnvironment`'s `MallocNanoZone`, because loading the framework replaces the
      process's malloc zone and the nano zone has to be off before the first
      allocation. It only reaches a launch made through the system, so `run` sets the
      same variable in the environment it starts the binary with.
    """
    short = version()
    made = {
        'CFBundleName': executable,
        'CFBundleDisplayName': executable,
        'CFBundleExecutable': executable,
        'CFBundleIdentifier': app_identifier,
        'CFBundleDevelopmentRegion': 'English',
        'CFBundleInfoDictionaryVersion': '6.0',
        'CFBundlePackageType': 'APPL',
        'CFBundleSignature': '????',
        'CFBundleVersion': short,
        'CFBundleShortVersionString': short,
        'LSEnvironment': {'MallocNanoZone': '0'},
        'LSFileQuarantineEnabled': True,
        'LSMinimumSystemVersion': '11.0',
        'NSSupportsAutomaticGraphicsSwitching': True,
    }
    if helper:
        # A helper has no dock icon and no menu bar, and the system has to be told so
        # before it launches one.
        made['LSUIElement'] = '1'
    return made


def bundle(engine: Path, flagged: Path, at: Path) -> tuple[Path, Path]:
    """A real application bundle for the flagged binary, and the executable in it.

    **This is the macOS fix, and it is not a convenience.** A CEF application on a Mac
    is a bundle with the framework in `Contents/Frameworks` and a helper app beside it,
    and every one of those three facts is something Chromium reads rather than
    something a packager chose:

    - the framework is where `cef::library_loader` looks, at `../Frameworks` relative
      to the executable, which batch 1 already satisfied;
    - the *bundle* is where Chromium looks for `icudtl.dat` and the `.pak` files, by
      asking `NSBundle` for the main bundle and then for the framework inside it - and
      an executable that is not in a bundle has no main bundle to ask, which is the
      `icudtl.dat not found in bundle` batch 1 measured;
    - the helper is what CEF launches for every renderer, the GPU process and every
      utility process, because on that platform it will not re-launch the main
      executable the way it does on the other two.

    The five helpers here are copies of the flagged binary, which is correct and is
    not what a release would do: the binary's own entry point already answers as a
    helper when it is handed `--type=`, so a copy works, and a release would carry one
    small binary that does only that instead of five copies of the whole app. Said in
    the table rather than left for a reader to find in a size row.
    """
    app = at / f'{flagged.stem}.app'
    if app.is_dir():
        shutil.rmtree(app)

    contents = app / 'Contents'
    for inside in ('MacOS', 'Resources', 'Frameworks'):
        (contents / inside).mkdir(parents=True, exist_ok=True)

    app_identifier = identifier()
    executable = contents / 'MacOS' / flagged.name
    shutil.copy2(flagged, executable)
    with (contents / 'Info.plist').open('wb') as writing:
        plistlib.dump(plist(flagged.name, app_identifier, helper=False), writing)

    found = next((one for one in engine.rglob(FRAMEWORK) if one.is_dir()), None)
    if found is None:
        raise SystemExit(f'no {FRAMEWORK} anywhere under {engine}')
    shutil.copytree(found, contents / 'Frameworks' / FRAMEWORK, symlinks=True)

    for suffix in HELPERS:
        name = f'{flagged.name} {suffix}'
        helper = contents / 'Frameworks' / f'{name}.app' / 'Contents'
        (helper / 'MacOS').mkdir(parents=True, exist_ok=True)
        shutil.copy2(flagged, helper / 'MacOS' / name)
        with (helper / 'Info.plist').open('wb') as writing:
            plistlib.dump(plist(name, f'{app_identifier}.helper', helper=True), writing)

    return executable, app


def layout(engine: Path | None, flagged: Path) -> tuple[Path, Path, list[str]]:
    """The engine where Chromium looks for it, and what to launch afterwards.

    Answers the binary to start and the tree to weigh, because on a Mac they are not
    the same thing any more: the binary is inside a bundle this builds and the tree is
    the bundle.
    """
    if not MACOS:
        copied = stage(engine, flagged.parent) if engine else []
        return flagged, flagged.parent, copied

    if engine is None:
        # Without a distribution there is nothing to build a bundle out of, so the
        # binary is launched where it lies and will say what it is missing.
        return flagged, flagged.parent, []

    executable, app = bundle(engine, flagged, flagged.parent)
    return executable, app, [str(app.name)]


def weigh(payload: Path, names: tuple[str, ...] | None = None) -> dict:
    """What a tree weighs unpacked, and what it weighs compressed.

    The compressed figure is the installer delta, measured rather than estimated:
    NSIS compresses with LZMA and a deb with xz, so this runs the same algorithm
    over the same bytes. A dmg uses zlib and compresses a little less well, which
    is said in the table rather than corrected for.
    """
    if not payload.is_dir():
        return {'error': f'{payload} is not a directory'}

    found = chosen_files(payload, names)
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
    found = chosen_files(payload, names)
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


# --- why it did not start ---------------------------------------------------


def ran(command: list[str], timeout: int = 300) -> str:
    """A command's output, however it went. A diagnosis never fails a run."""
    try:
        done = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
    except (OSError, subprocess.SubprocessError) as error:
        return f'{command[0]}: {error}'
    return (done.stdout or '') + (done.stderr or '')


def cef_log() -> list[str]:
    """The tail of the log CEF itself wrote, which is not on stderr.

    `tauri-runtime-cef` defaults `Settings::log_file` to `cef.log` inside the cache
    directory, so Chromium's own fatal messages - "No usable sandbox!", a missing
    resource, a failed GPU process - go to a file in the app's settings folder and
    never reach the terminal. Batch 1 read the silence on stderr as silence; it was
    not, and this is the file it was in.
    """
    log = config_dir() / 'web' / 'cef.log'
    if not log.is_file():
        return [f'no {log}']
    text = log.read_text(encoding='utf-8', errors='replace').splitlines()
    return text[-120:]


def embedded_manifest(binary: Path) -> str:
    """Whether the Windows binary carries an application manifest, and what it says.

    The answer batch 1 needed and did not have. `tauri_build::build()` runs in the
    *app* crate's build script and its resource reaches the linker as
    `cargo:rustc-link-arg-bins`, which cargo applies only to the binary targets of the
    package whose build script emitted it - so the flagged binary, which is a target of
    the workspace next door, is linked without it. A Windows binary with no manifest
    gets `comctl32.dll` 5.82 out of `System32` instead of the version 6 side-by-side
    assembly, and an import of anything only version 6 exports then fails in the loader
    with `STATUS_ENTRYPOINT_NOT_FOUND` before the first line of the program. See
    build.rs beside this file, which is the repair.
    """
    try:
        import pefile
    except ImportError:
        return 'pefile is not installed, so the resources were not read'

    try:
        image = pefile.PE(str(binary), fast_load=True)
        image.parse_data_directories(
            directories=[pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_RESOURCE']]
        )
        found = 'none'
        resources = getattr(image, 'DIRECTORY_ENTRY_RESOURCE', None)
        for entry in (resources.entries if resources is not None else []) or []:
            if entry.id != pefile.RESOURCE_TYPE['RT_MANIFEST']:
                continue
            data = entry.directory.entries[0].directory.entries[0].data.struct
            text = image.get_data(data.OffsetToData, data.Size).decode('utf-8', 'replace')
            found = ' '.join(text.split())
        image.close()
    except Exception as error:  # noqa: BLE001 - a diagnosis never raises
        return f'could not read the resources: {error}'
    return found


def loader_chain(binary: Path) -> dict:
    """Every module the Windows loader resolves, and each entry point that is not there.

    Batch 1 checked one edge of this graph - the flagged binary's own `cef_*` imports
    against what `libcef.dll` exports - found all thirty-nine present, and had nowhere
    else to look. This is the whole graph instead: each module's import table against
    the exports of the module the loader would actually bind it to, resolved in the
    loader's own order (the binary's own folder, then the system folder, then `PATH`).

    Delayed imports are checked and marked as delayed, because they cannot be what
    stopped a process before its first line: a delay-loaded module is not touched until
    something calls into it, which is why CEF's own link flags delay-load `libcef.dll`.

    **Read `missing` together with `manifest`.** This resolves a name the way the file
    system offers it, and an application manifest can redirect one of those to a
    side-by-side assembly that does export the entry point - which is exactly what the
    common controls do. So a row here is "the copy on disk does not have it", and
    whether that mattered depends on the manifest beside it. With no manifest at all,
    it mattered.
    """
    try:
        import pefile
    except ImportError:
        return {'error': 'pefile is not installed, so the import chain was not walked'}

    system = Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32'
    search = [binary.parent, system]
    search += [Path(one) for one in os.environ.get('PATH', '').split(os.pathsep) if one]

    def find(name: str) -> Path | None:
        for at in search:
            try:
                one = at / name
                if one.is_file():
                    return one
            except OSError:
                continue
        return None

    exports: dict[str, set[str]] = {}

    def exported(path: Path) -> set[str]:
        key = str(path).lower()
        if key in exports:
            return exports[key]
        names: set[str] = set()
        try:
            image = pefile.PE(str(path), fast_load=True)
            image.parse_data_directories(
                directories=[pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_EXPORT']]
            )
            for symbol in getattr(getattr(image, 'DIRECTORY_ENTRY_EXPORT', None), 'symbols', []):
                names.add(
                    symbol.name.decode('ascii', 'replace') if symbol.name else f'#{symbol.ordinal}'
                )
                names.add(f'#{symbol.ordinal}')
            image.close()
        except Exception as error:  # noqa: BLE001 - a diagnosis never raises
            names = set()
            print(f'  ! no exports read from {path}: {error}')
        exports[key] = names
        return names

    missing: list[dict] = []
    unresolved: list[dict] = []
    api_sets: set[str] = set()
    walked: list[str] = []
    seen: set[str] = set()
    frontier = [binary]

    while frontier and len(walked) < 500:
        one = frontier.pop(0)
        key = one.name.lower()
        if key in seen:
            continue
        seen.add(key)
        walked.append(one.name)

        try:
            image = pefile.PE(str(one), fast_load=True)
            image.parse_data_directories(
                directories=[
                    pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_IMPORT'],
                    pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_DELAY_IMPORT'],
                ]
            )
        except Exception as error:  # noqa: BLE001
            unresolved.append({'module': one.name, 'needs': f'unreadable: {error}'})
            continue

        tables = (
            (getattr(image, 'DIRECTORY_ENTRY_IMPORT', []) or [], False),
            (getattr(image, 'DIRECTORY_ENTRY_DELAY_IMPORT', []) or [], True),
        )
        for table, delayed in tables:
            for entry in table:
                name = entry.dll.decode('ascii', 'replace') if entry.dll else '?'
                # An api set is resolved by the loader through its own schema and not by
                # finding a file, so it is skipped before the search rather than after
                # it: a file of that name does exist here and there - a Windows Kit puts
                # several on `PATH` - and reading one of those as the answer produced
                # five missing entry points that were not missing at all.
                if name.lower().startswith(('api-ms-', 'ext-ms-')):
                    api_sets.add(name)
                    continue
                at = find(name)
                if at is None:
                    unresolved.append({'module': one.name, 'needs': name, 'delayed': delayed})
                    continue
                have = exported(at)
                for wanted in entry.imports or []:
                    asked = (
                        wanted.name.decode('ascii', 'replace')
                        if wanted.name
                        else f'#{wanted.ordinal}'
                    )
                    if asked not in have:
                        missing.append(
                            {
                                'module': one.name,
                                'needs': name,
                                'entry': asked,
                                'delayed': delayed,
                                'resolved_to': str(at),
                            }
                        )
                if not delayed:
                    frontier.append(at)
        image.close()

    return {
        'modules': len(walked),
        'walked': walked,
        # The ones that stop a launch come first, because a delayed one never does.
        'missing': sorted(missing, key=lambda one: (one['delayed'], one['module']))[:40],
        'missing_count': len(missing),
        'unresolved': unresolved[:20],
        # Named rather than hidden: an api set the loader resolves through its schema
        # has no exports this walk can read, so a missing entry point inside one would
        # not be found here. Nothing in Chromium's chain imports from one that a current
        # Windows does not have, which is why it is a count and not a list.
        'api_sets_not_checked': len(api_sets),
        'manifest': embedded_manifest(binary),
    }


def windows_errors(name: str) -> list[str]:
    """What Windows Error Reporting wrote about *this* binary, if anything.

    Narrowed to the binary by name and to the first line of each report, because the
    Application log on any Windows machine is mostly somebody else's kernel dumps and a
    diagnosis nobody can read is not a diagnosis.
    """
    script = (
        'Get-WinEvent -LogName Application -MaxEvents 120 -ErrorAction SilentlyContinue | '
        f'Where-Object {{ $_.Message -like "*{name}*" }} | Select-Object -First 4 | '
        # `-join` rather than `Join-String`, which is PowerShell 7 and a runner's
        # `powershell` is 5.1.
        'ForEach-Object { $_.TimeCreated.ToString() + " " + '
        '((($_.Message -split "\\r?\\n") | Select-Object -First 3) -join " ") }'
    )
    return ran(['powershell', '-NoProfile', '-NonInteractive', '-Command', script]).splitlines()[:12]


def crash_reports(name: str) -> list[str]:
    """The newest macOS crash report for this binary, which names the signal and the frame."""
    folder = Path.home() / 'Library' / 'Logs' / 'DiagnosticReports'
    if not folder.is_dir():
        return [f'no {folder}']
    found = sorted(
        (one for one in folder.glob('*') if one.is_file() and one.name.startswith(name)),
        key=lambda one: one.stat().st_mtime,
        reverse=True,
    )
    if not found:
        return [f'no report for {name} under {folder}']
    return found[0].read_text(encoding='utf-8', errors='replace').splitlines()[:120]


def diagnose(binary: Path, payload: Path, env: dict[str, str]) -> dict:
    """Why a build that never said anything never said anything.

    Runs only when the flagged binary produced no events at all, which is the one case
    the numbers cannot describe. Everything here is read-only and nothing here fails
    the run: a diagnosis is a row in the table.
    """
    found: dict = {'binary': str(binary), 'log': cef_log()}

    if WINDOWS:
        found['loader'] = loader_chain(binary)
        found['events'] = windows_errors(binary.name)
        return found

    if MACOS:
        found['otool'] = ran(['otool', '-L', str(binary)]).splitlines()[:40]
        found['bundle'] = sorted(
            str(one.relative_to(payload)) for one in payload.glob('Contents/*/*')
        )
        framework = payload / 'Contents' / 'Frameworks' / FRAMEWORK
        found['framework'] = str(framework) if framework.is_dir() else f'no {framework}'
        found['icudtl'] = [
            str(one.relative_to(payload)) for one in payload.rglob('icudtl.dat')
        ] or ['no icudtl.dat anywhere in the bundle']
        found['crash'] = crash_reports(binary.name)
        return found

    # Linux, where the question is which toolkit is in the process and where it died.
    found['ldd'] = [
        line.strip()
        for line in ran(['ldd', str(binary)]).splitlines()
        if any(name in line for name in ('gtk', 'cef', 'gdk', 'webkit', 'rsvg'))
    ]
    whole = dict(os.environ)
    whole.update(env)
    if shutil.which('gdb'):
        # **Without `libcef.so`'s symbols, deliberately.** CEF ships that library
        # unstripped at 1.4 GB and gdb spent its whole timeout reading the DWARF in it
        # and printing "Could not find DWO CU" several thousand times, which is what the
        # first run of this diagnosis captured instead of a backtrace. So symbols are
        # off to begin with and then loaded for `libg*` only - GTK, GDK, GLib, GObject -
        # which is where a toolkit crash is and is a few megabytes rather than one and a
        # half gigabytes. `info sharedlibrary` is what attributes the frames that are
        # still bare addresses.
        script = [
            'gdb',
            '--batch',
            '-iex',
            'set confirm off',
            '-iex',
            'set auto-solib-add off',
            '-ex',
            'run',
            '-ex',
            'sharedlibrary libg',
            '-ex',
            'backtrace 30',
            '-ex',
            'info sharedlibrary',
            '--args',
            str(binary),
        ]
        try:
            done = subprocess.run(
                script,
                capture_output=True,
                text=True,
                timeout=300,
                check=False,
                env=whole,
                cwd=str(binary.parent),
            )
            said = ((done.stdout or '') + (done.stderr or '')).splitlines()
            found['gdb'] = [
                line for line in said if 'During symbol reading' not in line and line.strip()
            ][-160:]
        except (OSError, subprocess.SubprocessError) as error:
            found['gdb'] = [f'gdb: {error}']
    else:
        found['gdb'] = ['no gdb on this machine']
    return found


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
        # The default build has no gate in it and no reason to stop, so the harness
        # stops it once the window is up: its exit code is the harness's, not its own.
        'stopped_by_the_gate': not measured,
        'exit': process.returncode,
        'wall_ms': round((time.monotonic() - started) * 1000),
        'events': events,
        'snapshots': snapshots,
        'trace': trace,
        'checks': [one for one in events if one.get('event') == 'check'],
        'log': log[-400:],
    }


def at(result: dict, event: str) -> float | None:
    for one in result.get('events') or []:
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


# --- the verdict ------------------------------------------------------------

# What Emil was told, by platform: how much longer the flagged build may take to a
# window and how much bigger the download may get, from docs/browser.md section 8.
# Linux is in neither, because criterion 1 is Windows and a Mac - the Linux row is
# allowed to lag as long as the lag has an owner.
BANDS = {
    'Windows': {'launch_ms': 250.0, 'download_mb': 170.0},
    'Darwin': {'launch_ms': 1200.0, 'download_mb': 140.0},
}


def rss(result: dict, tabs: int) -> object:
    return (result.get('snapshots') or {}).get(f'tabs:{tabs}', {}).get('rss_mb')


def browsers(result: dict, tabs: int) -> object:
    return (result.get('snapshots') or {}).get(f'tabs:{tabs}', {}).get('browser_processes')


def said(result: dict, name: str) -> dict | None:
    """The check the app itself reported whose name contains `name`."""
    for one in result.get('checks') or []:
        if name in str(one.get('name')):
            return one
    return None


def criteria(report: dict) -> list[dict]:
    """Batch 2's six criteria, each with the measurement that answers it.

    Section 8 of docs/browser.md, held to by the gate rather than by a conversation:
    every one of them is a row this script already measures, so the answer is a
    workflow run. A criterion with nothing behind it says "not measured" and counts as
    unanswered rather than as passed, which is the whole reason it is a table and not a
    boolean.
    """
    control = report.get('control') or {}
    cef = report.get('cef') or {}
    ships = report.get('ships') or {}
    tabs = report.get('tabs') or 2
    band = BANDS.get(platform.system(), {})

    def answer(number: int, name: str, ok: bool | None, note: str) -> dict:
        return {'n': number, 'name': name, 'ok': ok, 'note': note}

    out = []

    up = launch_ms(cef)
    out.append(
        answer(
            1,
            'the flagged build starts and shows a window',
            up is not None,
            f'the window was on screen at {up} ms' if up is not None else 'no window',
        )
    )

    count = browsers(cef, tabs)
    out.append(
        answer(
            2,
            f'one browser process serves {tabs} web tabs',
            None if count is None else count == 1,
            'not measured' if count is None else f'{count} browser processes',
        )
    )

    # Criterion 3 is the one the app's own check cannot answer on its own: it knows a
    # webview was created and not whether Chromium then let it navigate. CEF says so on
    # stderr when it refuses - *"Navigation to chrome://settings/ is blocked in
    # Alloy-style browser"* - and on macOS it always refuses, because a browser given a
    # native parent view is forced to Alloy style there (upstream issue #3294) and a
    # `chrome://` page is Chrome style's. So the log wins over the check.
    blocked = [
        line.strip()
        for line in cef.get('log') or []
        if 'blocked in Alloy-style browser' in line
    ]
    pages = said(cef, "the engine's own pages")
    if blocked:
        out.append(
            answer(
                3,
                'chrome://settings and chrome://extensions load',
                False,
                f'refused: {blocked[0].split("] ", 1)[-1]}',
            )
        )
    else:
        out.append(
            answer(
                3,
                'chrome://settings and chrome://extensions load',
                None if pages is None else bool(pages.get('ok')),
                'not measured' if pages is None else str(pages.get('note')),
            )
        )

    inside = said(cef, "never reaches the app's own interface")
    in_tab = said(cef, 'reaches a page in the browsing profile')
    both = None
    note = 'not measured'
    if inside is not None and in_tab is not None:
        both = bool(inside.get('ok')) and bool(in_tab.get('ok'))
        note = f'{in_tab.get("note")}; {inside.get("note")}'
    out.append(answer(4, 'an extension runs in a web tab and not in the interface', both, note))

    was = launch_ms(control)
    allowed = band.get('launch_ms')
    if up is None or was is None or allowed is None:
        out.append(
            answer(
                5,
                'the launch stays inside the band',
                None if allowed is not None else True,
                'not measured' if allowed is not None else 'no band on this platform',
            )
        )
    else:
        grew = round(up - was, 1)
        out.append(
            answer(
                5,
                'the launch stays inside the band',
                grew <= allowed,
                f'{grew:+} ms against a band of {allowed:+.0f} ms',
            )
        )

    grew_mb = ships.get('delta_packed_mb')
    allowed_mb = band.get('download_mb')
    if grew_mb is None or allowed_mb is None:
        out.append(
            answer(
                6,
                'the download stays inside the band',
                None if allowed_mb is not None else True,
                'not measured' if allowed_mb is not None else 'no band on this platform',
            )
        )
    else:
        out.append(
            answer(
                6,
                'the download stays inside the band',
                grew_mb <= allowed_mb,
                f'{grew_mb} MB against a band of {allowed_mb:.0f} MB',
            )
        )

    return out


def verdict(answers: list[dict]) -> str:
    """One line: whether batch 2 can start, and what is in the way if it cannot."""
    failed = [one for one in answers if one['ok'] is False]
    unknown = [one for one in answers if one['ok'] is None]
    if not failed and not unknown:
        return 'go: all six criteria answered yes'
    parts = []
    if failed:
        parts.append('no on ' + ', '.join(str(one['n']) for one in failed))
    if unknown:
        parts.append('nothing measured for ' + ', '.join(str(one['n']) for one in unknown))
    return 'not yet: ' + '; '.join(parts)


# --- the table --------------------------------------------------------------


def cause(report: dict) -> str:
    """One sentence naming why the flagged build never said anything, from the diagnosis."""
    why = report.get('why')
    if not why:
        return ''

    loader = why.get('loader') or {}
    for one in loader.get('missing') or []:
        if not one.get('delayed'):
            return (
                f'the loader could not bind `{one["entry"]}` for `{one["module"]}` in '
                f'`{one["needs"]}` (`{one["resolved_to"]}`)'
            )
    if loader.get('manifest') == 'none':
        return 'the binary carries no application manifest'

    for line in reversed(why.get('log') or []):
        if any(mark in line for mark in (':FATAL:', ':ERROR:', 'Check failed')):
            return f'CEF wrote `{line.strip()}`'

    for line in why.get('gdb') or []:
        if 'Program received signal' in line:
            return f'gdb: `{line.strip()}`'

    # Two toolkits in one process, which is a fact rather than a diagnosis - but it is
    # the fact the backtrace is read against, so it belongs in the one-line answer.
    linked = ' '.join(why.get('ldd') or [])
    if 'libgtk-3' in linked and 'libgtk-4' in linked:
        return (
            'the process links both `libgtk-3.so.0` and `libgtk-4.so.1`, which GTK '
            'does not support sharing a process'
        )

    if why.get('icudtl') and str(why['icudtl'][0]).startswith('no icudtl'):
        return 'the bundle carries no icudtl.dat'
    return 'the diagnosis is in report.json; nothing in it named a cause'


def table(report: dict) -> str:
    """The gate table, as the markdown that goes in the job summary.

    The verdict is in it, which is the contract: this script exits 0 whenever it got
    this far, so a red job means the gate could not run rather than that the answer was
    no. See the module comment.
    """
    control = report.get('control') or {}
    cef = report.get('cef') or {}
    ships = report.get('ships') or {}
    tabs = report.get('tabs') or 2

    def cell(value: object, unit: str = '') -> str:
        if value is None:
            return 'not measured'
        return f'{value}{unit}'

    answers = report.get('criteria') or []
    starts = next((one for one in answers if one['n'] == 1), {})

    rows = [
        ('platform', report.get('platform'), report.get('platform')),
        ('engine', "the system's", f'CEF, API {report.get("cef_api")}'),
        ('sandbox', "the system's own", report.get('sandbox')),
        ('**it starts**', 'yes', '**yes**' if starts.get('ok') else '**no**'),
        ('launch to the window, ms', cell(launch_ms(control)), cell(launch_ms(cef))),
        ('resident, no web tab, MB', cell(rss(control, 0)), cell(rss(cef, 0))),
        ('resident, one web tab, MB', 'not measured', cell(rss(cef, 1))),
        (f'resident, {tabs} web tabs, MB', 'not measured', cell(rss(cef, tabs))),
        (f'browser processes, {tabs} tabs', 'n/a', cell(browsers(cef, tabs))),
        ('the binary, MB', cell(ships.get('app_binary_mb')), cell(ships.get('cef_binary_mb'))),
        ('the engine beside it, unpacked MB', '0', cell(ships.get('engine_unpacked_mb'))),
        ('the engine beside it, compressed MB', '0', cell(ships.get('engine_packed_mb'))),
        ('**what the download grows by, MB**', '-', cell(ships.get('delta_packed_mb'))),
        ('exit code', 'stopped by the gate', cell(cef.get('exit'))),
    ]

    out = ['| | default build | `cef` |', '| --- | --- | --- |']
    out += [f'| {name} | {left} | {right} |' for name, left, right in rows]

    if not starts.get('ok'):
        out.append('')
        out.append(f'**Why it did not start.** {cause(report)}')

    out.append('')
    out.append(f'**The verdict: {report.get("verdict")}.**')
    out.append('')
    out.append("| batch 2's criteria, docs/browser.md section 8 | | |")
    out.append('| --- | --- | --- |')
    for one in answers:
        mark = 'yes' if one['ok'] else ('**no**' if one['ok'] is False else '-')
        out.append(f'| {one["n"]} | {one["name"]} | {mark}, {one["note"]} |')

    out.append('')
    out.append('| what the flagged build was asked to prove | |')
    out.append('| --- | --- |')
    for check in cef.get('checks') or []:
        mark = 'yes' if check.get('ok') else '**no**'
        out.append(f'| {check.get("name")} | {mark} - {check.get("note")} |')
    for name, ok in (report.get('profiles') or {}).items():
        held = len((report.get('profile_contents') or {}).get(name) or [])
        out.append(
            f'| the `{name}` profile is on disk | {"yes" if ok else "**no**"}'
            f' - {held} of Chromium\'s own files in it |'
        )
    for name, held in (report.get('profile_contents') or {}).items():
        if name.startswith('Profile-'):
            out.append(
                f'| a profile the runtime derived, `{name}` | '
                f'{len(held)} files: the interface asked for a path the runtime '
                'decided was not under the cache root |'
            )

    return '\n'.join(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--cef', required=True, help='the flagged binary')
    ap.add_argument('--control', default=None, help='the app as it ships')
    ap.add_argument('--engine', default=None, help='a CEF distribution, to lay out around it')
    ap.add_argument('--extension', default=None, help='an unpacked MV3 extension to load')
    ap.add_argument('--tabs', type=int, default=2)
    ap.add_argument('--timeout', type=int, default=420)
    ap.add_argument('--no-compress', action='store_true', help='skip the installer delta')
    ap.add_argument('--out', default='gate-out')
    args = ap.parse_args()

    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    built = Path(args.cef).resolve()

    # The engine where Chromium looks for it, before anything runs: beside the binary on
    # Windows and Linux, and a real bundle around it on a Mac. `flagged` is what gets
    # launched afterwards, which on a Mac is the executable inside that bundle.
    engine = Path(args.engine).resolve() if args.engine else None
    flagged, payload, copied = layout(engine, built)
    print(f'the engine is laid out at {payload} ({len(copied)} things put there)')
    print(f'launching {flagged}')
    report: dict = {
        'platform': f'{platform.system()} {platform.machine()}',
        'sandbox': os.environ.get('NIB_CEF_SANDBOX', 'auto'),
        'tabs': args.tabs,
        'launched': str(flagged),
        'payload': str(payload),
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
    if MACOS:
        # What the bundle's `LSEnvironment` says, said again: loading the framework
        # replaces the process's malloc zone and the nano zone has to be off before the
        # first allocation, and `LSEnvironment` only reaches a launch made through the
        # system rather than one made by this script.
        env['MallocNanoZone'] = '0'
    cef = run(flagged, env, out_dir / 'cef', args.timeout, measured=True)
    report['cef'] = cef
    report['cef_api'] = next(
        (one.get('cef_api') for one in cef['events'] if one.get('event') == 'engine'), None
    )

    # And if it never got a window up, why. That is the one case the numbers cannot
    # describe, so it is the one case with a diagnosis instead - and the test is the
    # window rather than the first line, because all three platforms printed *something*
    # and then died: the engine line is the first thing `main` does.
    if launch_ms(cef) is None:
        print('== no window, so: why ==')
        report['why'] = diagnose(flagged, payload, env)
        print(json.dumps({key: report['why'][key] for key in report['why']}, indent=2)[:8000])

    # The two profiles, on disk, after a run that used both of them.
    root = config_dir() / 'web'
    report['profiles'] = {
        'app': (root / 'app').is_dir(),
        'Default': (root / 'Default').is_dir(),
    }
    report['profile_root'] = str(root)
    report['profile_children'] = sorted(one.name for one in root.iterdir()) if root.is_dir() else []

    # And what is *in* each of them, which is the difference between a profile and a
    # folder. `engine::app_profile` makes `web/app` itself before it hands the path to
    # the engine, so the folder existing proves nothing at all; Chromium's own files in
    # it - `Preferences`, `Local Storage`, `Network` - prove the engine took it as a
    # profile. A `Profile-<hash>` beside them is the runtime deriving one from a path it
    # decided was not under the cache root, which is a finding rather than a layout.
    report['profile_contents'] = {
        one.name: sorted(inside.name for inside in one.iterdir())[:14]
        for one in (root.iterdir() if root.is_dir() else [])
        if one.is_dir() and (one.name in ('app', 'Default') or one.name.startswith('Profile-'))
    }

    # What a release would have to carry, and what that costs a reader: the engine's
    # own files where the run put them, weighed and then compressed with the algorithm
    # an installer uses. The two binaries are beside it, because one of them has
    # Chromium's bindings linked into it and the other does not. On a Mac the tree is
    # the bundle, which is what a dmg holds.
    ships: dict = {'payload': str(payload)}
    ships['engine'] = weigh(payload, CEF_PAYLOAD)
    ships['engine_unpacked_mb'] = ships['engine'].get('unpacked_mb')
    if MACOS:
        ships['bundle_unpacked_mb'] = weigh(payload).get('unpacked_mb')
        ships['bundle_note'] = (
            'the five helpers in the bundle are copies of the flagged binary, because '
            'its own entry point already answers as a helper; a release carries one '
            'small binary that does only that, which is batch 7'
        )

    if built.is_file():
        ships['cef_binary_mb'] = round(built.stat().st_size / 1048576, 2)
    if args.control and Path(args.control).is_file():
        ships['app_binary_mb'] = round(Path(args.control).stat().st_size / 1048576, 2)

    if not args.no_compress:
        print('compressing, which is the installer delta measured rather than guessed')
        packed = compress(payload, CEF_PAYLOAD)
        ships['engine_packed_mb'] = round(packed / 1048576, 1)
        # The delta is the engine plus however much bigger the binary itself got.
        grew = (ships.get('cef_binary_mb') or 0) - (ships.get('app_binary_mb') or 0)
        ships['delta_packed_mb'] = round(packed / 1048576 + max(grew, 0.0), 1)
        ships['delta_note'] = (
            'LZMA, which is what NSIS and a deb use; a dmg is zlib and compresses '
            'a little less well'
        )
    report['ships'] = ships

    report['criteria'] = criteria(report)
    report['verdict'] = verdict(report['criteria'])

    (out_dir / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    summary = table(report)
    (out_dir / 'gate.md').write_text(summary + '\n', encoding='utf-8')
    print()
    print(summary)

    # **The contract.** A table was written, so this run did its job: the answer is in
    # the table and the exit code is 0 whether the answer was yes or no. A non-zero exit
    # from here means the gate could not run at all - a broken build, a missing binary,
    # a bug in this script - which is the only thing a red job should ever mean. Batch 1
    # returned 1 on every "not yet" and threw the table away with it.
    for one in cef['checks']:
        if not one.get('ok'):
            print(f'the app reported no: {one.get("name")} - {one.get("note")}')
    if cef['exit'] not in (0, None):
        print(f'the flagged build exited {cef["exit"]}')
    print(f'the verdict is: {report["verdict"]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
