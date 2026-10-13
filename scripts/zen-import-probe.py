"""Does Settings > Import > Zen bring a Zen profile's spaces in as spaces? Windows only.

Emil, 2026-10-13: *"should be possible to import your tabs from zen browser. spaces
translate to spaces and the tabs will get directly into the sidebar of nib. folders
will just be empty nib notes and so on."*

The probe writes a Zen of its own - a `profiles.ini` with two profiles and the first
one's `zen-sessions.jsonlz4`, the file Zen keeps its sidebar in - and points the app
at it with `NIB_ZEN_DIR`, so nobody's own Zen is ever read. Then, in an app started
off the screen through `run_probe`, it opens Settings > Import, presses Zen, picks the
profile out of the two, and asks:

* the spaces: Home, Work and Reading, Zen's three, in Zen's order;
* the files: every tab a web note where the sidebar had it, the folders folders, the
  empty folder an empty note, the settings page left behind;
* the order the file list draws them in, the Essential as a bookmark, the space's icon;
* a second import: nothing written twice.

And three pictures of the probe's own window, taken by its own engine: the Import
pane, the profile list, and the Work space's file list afterwards.

    python scripts/zen-import-probe.py --exe path/to/nib.exe \\
        --identifier ch.emilvinu.nib.probe.<name> --shots <folder>

Build the exe as `scripts/probe_app.py` says.
"""

from __future__ import annotations

import argparse
import atexit
import importlib.util
import json
import os
import pathlib
import shutil
import struct
import sys
import tempfile
import time

from probe_app import close_app

HERE = pathlib.Path(__file__).resolve().parent

#: What the app reads for where Zen is; see src-tauri/src/zen_profiles.rs.
ZEN_DIR = "NIB_ZEN_DIR"


def borrowed(name: str, file: str):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    if spec is None or spec.loader is None:
        raise SystemExit(f"could not read {file}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def moz_lz4(data: bytes) -> bytes:
    """Bytes as a `.jsonlz4`: the header and one LZ4 block of nothing but literals."""

    token = min(len(data), 15) << 4
    length = b""
    if len(data) >= 15:
        rest = len(data) - 15
        length = b"\xff" * (rest // 255) + bytes([rest % 255])
    return b"mozLz40\0" + struct.pack("<I", len(data)) + bytes([token]) + length + data


def tab(sync: str, url: str, title: str, **more: object) -> dict[str, object]:
    return {"zenSyncId": sync, "entries": [{"url": url, "title": title}], "index": 1, **more}


#: A sidebar of the shape apps/desktop/src/lib/import/zen.fixture.ts holds.
SIDEBAR = {
    "spaces": [
        {
            "uuid": "{s-work}",
            "name": "Work",
            "icon": "chrome://browser/skin/zen-icons/selectable/briefcase.svg",
            "position": 1,
            "theme": {"type": "gradient", "gradientColors": [{"c": [53, 132, 228], "isPrimary": True}]},
        },
        {"uuid": "{s-home}", "name": "Home", "icon": "\U0001f3e1", "position": 0},
        {"uuid": "{s-reading}", "name": "Reading", "position": 2},
    ],
    "folders": [
        {"id": "f-docs", "name": "Docs", "parentId": None, "workspaceId": "{s-work}",
         "userIcon": "chrome://browser/skin/zen-icons/selectable/book.svg", "emptyTabIds": ["e1"]},
        {"id": "f-api", "name": "API", "parentId": "f-docs", "workspaceId": "{s-work}", "emptyTabIds": []},
        {"id": "f-later", "name": "Later", "parentId": None, "workspaceId": "{s-work}", "emptyTabIds": []},
    ],
    "tabs": [
        tab("t-mail", "https://mail.example.com/", "Mail", zenEssential=True, pinned=True),
        tab("t-news", "https://news.example.com/today", "News today", pinned=True, zenWorkspace="{s-home}",
            _zenPinnedInitialState={"entry": {"url": "https://news.example.com/", "title": "News"}}),
        tab("e1", "about:blank", "", zenIsEmpty=True, groupId="f-docs", zenWorkspace="{s-work}"),
        tab("t-guide", "https://docs.example.com/guide", "Guide", pinned=True, groupId="f-docs",
            zenWorkspace="{s-work}", zenStaticLabel="The guide"),
        tab("t-api", "https://docs.example.com/api", "API reference", pinned=True, groupId="f-api",
            zenWorkspace="{s-work}"),
        tab("t-board", "https://board.example.com/", "Board", pinned=True, zenWorkspace="{s-work}"),
        tab("t-search", "https://search.example.com/?q=b", "b - Search", zenWorkspace="{s-work}"),
        tab("t-settings", "about:preferences", "Settings", zenWorkspace="{s-work}"),
    ],
}

PROFILES_INI = (
    "[Install6F193CCC56814779]\r\nDefault=Profiles/b2.Default (release)\r\n\r\n"
    "[Profile0]\r\nName=Default (release)\r\nIsRelative=1\r\nPath=Profiles/b2.Default (release)\r\n\r\n"
    "[Profile1]\r\nName=Work\r\nIsRelative=1\r\nPath=Profiles/c3.Work\r\n\r\n"
    "[General]\r\nStartWithLastProfile=1\r\nVersion=2\r\n"
)


def zen_home() -> pathlib.Path:
    """A Zen of the probe's own, said to the app in `NIB_ZEN_DIR`."""

    made = pathlib.Path(tempfile.mkdtemp(prefix="nib-zen-probe-"))
    (made / "profiles.ini").write_text(PROFILES_INI, encoding="utf-8")
    first = made / "Profiles" / "b2.Default (release)"
    first.mkdir(parents=True)
    (first / "zen-sessions.jsonlz4").write_bytes(moz_lz4(json.dumps(SIDEBAR).encode()))
    # The second profile is Firefox's session alone, the way a profile from before
    # Zen's own file is; it is listed, and not the one imported.
    second = made / "Profiles" / "c3.Work" / "sessionstore-backups"
    second.mkdir(parents=True)
    (second / "recovery.jsonlz4").write_bytes(moz_lz4(json.dumps({"windows": []}).encode()))
    os.environ[ZEN_DIR] = str(made)
    atexit.register(shutil.rmtree, made, ignore_errors=True)
    return made


#: Presses the button of the Import pane's row with this name.
PRESS = """(async () => {
  const row = [...document.querySelectorAll('.nib-setting')]
    .find((one) => one.querySelector('.name')?.textContent?.trim() === %s)
  const button = row?.querySelector('button')
  if (!button || button.disabled) return 'no row'
  button.click()
  return 'pressed'
})()"""

#: The rows the Import pane shows.
ROWS = """JSON.stringify([...document.querySelectorAll('.nib-setting .name')]
  .map((one) => one.textContent.trim()))"""

#: What the app now holds: its spaces, and what it keeps beside them.
HELD = """JSON.stringify({
  spaces: nib.workspace.spaces.map((one) => one.name),
  open: nib.workspace.activeSpace?.name ?? null,
  busy: document.querySelector('.busy, [role="status"]')?.textContent?.trim() ?? null,
  arranged: JSON.parse(localStorage.getItem('nib:arranged') ?? '{}'),
  bookmarks: JSON.parse(localStorage.getItem('nib:bookmarks') ?? '{}'),
  icons: JSON.parse(localStorage.getItem('nib:icons') ?? '{}'),
})"""


def files_under(root: pathlib.Path) -> list[str]:
    return sorted(
        str(path.relative_to(root)).replace("\\", "/") for path in root.rglob("*") if path.is_file()
    )


def until(app, code: str, done, seconds: float = 30):
    said = None
    stop = time.perf_counter() + seconds
    while time.perf_counter() < stop:
        said = app.ask(code)
        if done(said):
            return said
        time.sleep(0.4)
    return said


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe.zen-import")
    parsed.add_argument("--shots", type=pathlib.Path, default=pathlib.Path("."))
    args = parsed.parse_args()

    switch = borrowed("switch", "web-switch-probe.py")
    camera = borrowed("favicon", "favicon-cache-probe.py")
    switch.wipe(args.identifier)
    spaces = switch.spaces_root()
    zen_home()
    notes = spaces / "Notes"
    notes.mkdir(parents=True)
    (notes / "Idea.md").write_text("# Idea\n", encoding="utf-8")
    args.shots.mkdir(parents=True, exist_ok=True)
    os.environ["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = "--remote-debugging-port=0"

    said: dict[str, object] = {}
    running = None
    try:
        running, app, _ = switch.launch(args.exe, args.identifier)
        if not close_app(running):
            running.terminate()
            running.wait(timeout=30)
        switch.allow_eval(args.identifier)
        time.sleep(2)
        running, app, _ = switch.launch(args.exe, args.identifier, unlike=app.port)

        until(app, "nib.workspace.activeSpace?.name ?? null", lambda one: one == "Notes", 60)
        app.ask("nib.settings.show('import') || 'shown'")
        said["rows"] = until(app, ROWS, lambda one: isinstance(one, list) and "Zen" in one)
        said["pane"] = camera.photograph(args.identifier, (args.shots / "zen-import-pane.png").resolve())

        said["pressed zen"] = app.ask(PRESS % json.dumps("Zen"))
        said["profiles"] = until(
            app, ROWS, lambda one: isinstance(one, list) and "Default (release)" in one
        )
        said["profile list"] = camera.photograph(
            args.identifier, (args.shots / "zen-import-profiles.png").resolve()
        )
        said["pressed profile"] = app.ask(PRESS % json.dumps("Default (release)"))

        held = until(
            app,
            HELD,
            lambda one: isinstance(one, dict) and "Reading" in one.get("spaces", []),
            60,
        )
        time.sleep(2)
        said["held"] = held = app.ask(HELD)
        said["files"] = {name: files_under(spaces / name) for name in ("Home", "Work", "Reading")}
        guide = spaces / "Work" / "Docs" / "The guide.url"
        said["a web note"] = guide.read_text(encoding="utf-8") if guide.exists() else None

        app.ask(
            "nib.workspace.showSpace(nib.workspace.spaces.find((one) => one.name === 'Work').id)"
            " && 'shown'"
        )
        time.sleep(2)
        said["work"] = camera.photograph(args.identifier, (args.shots / "zen-import-work.png").resolve())

        # Again, the same profile: nothing is written twice.
        app.ask("nib.settings.show('import') || 'shown'")
        until(app, ROWS, lambda one: isinstance(one, list) and "Zen" in one)
        app.ask(PRESS % json.dumps("Zen"))
        until(app, ROWS, lambda one: isinstance(one, list) and "Default (release)" in one)
        app.ask(PRESS % json.dumps("Default (release)"))
        time.sleep(6)
        said["again"] = {name: files_under(spaces / name) for name in ("Home", "Work", "Reading")}
        said["spaces again"] = app.ask("JSON.stringify(nib.workspace.spaces.map((one) => one.name))")
    finally:
        if running is not None and not close_app(running):
            running.terminate()

    print(json.dumps(said, indent=2))
    files = said.get("files")
    held = said.get("held")
    work_order = held.get("arranged", {}) if isinstance(held, dict) else {}
    good = (
        isinstance(held, dict)
        and held.get("spaces") == ["Notes", "Home", "Work", "Reading"]
        and files
        == {
            "Home": ["Mail.url", "News today.url"],
            "Work": [
                "Board.url",
                "Docs/API/API reference.url",
                "Docs/The guide.url",
                "Later.md",
                "b - Search.url",
            ],
            "Reading": [],
        }
        and "URL=https://docs.example.com/guide" in str(said.get("a web note"))
        and "Docs" in json.dumps(work_order)
        and "Mail.url" in json.dumps(held.get("bookmarks"))
        and said.get("again") == files
        and said.get("spaces again") == ["Notes", "Home", "Work", "Reading"]
    )
    print("PASS" if good else "FAIL")
    return 0 if good else 1


if __name__ == "__main__":
    raise SystemExit(main())
