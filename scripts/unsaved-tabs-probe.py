"""Do tabs with no file come back after a restart, and is each web page built in the store
of the space it belongs to? Windows only.

Emil, 2026-09-30: *"When I open a new tab or note on nib it should be in an unsaved state
(with no saving location) [...] unsaved web tabs should use the current store of the
current space. And a note should always use the data saving option from the space that it
is from."*

Two spaces, each keeping its web data apart (Space in its menu, a store folder of its own
under `web-stores`). In Work, a new note is typed into and a page is opened behind it as a
browser tab with no file; then Home is put on screen and the app is closed the way a
person closes it. Started again, it is asked:

* whether the new note came back with its words and no file, and the browser tab with
  its space still Work although Home is on screen;
* whether that tab's page, shown again, is built in Work's store - its folder comes back
  - and not in Home's;
* whether a web note of Home's, opened while Work is on screen, is built in Home's store.

    python scripts/unsaved-tabs-probe.py --exe path/to/nib.exe \\
        --identifier ch.emilvinu.nib.probe.<name>

Build the exe as `scripts/probe_app.py` says. Every launch goes through `run_probe`, off
every screen and never taking the keyboard, and the app is driven through its automation
endpoint.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import pathlib
import shutil
import sys
import time

from probe_app import close_app

HERE = pathlib.Path(__file__).resolve().parent


def borrowed():
    """The switch probe's own helpers: the spaces, the launch, the endpoint, `eval`."""

    spec = importlib.util.spec_from_file_location("switch", HERE / "web-switch-probe.py")
    if spec is None or spec.loader is None:
        raise SystemExit("could not read web-switch-probe.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


switch = borrowed()

WORDS = "Probe words, typed and never saved"

#: Each space's id, by name, as the window knows it.
IDS = "JSON.stringify(Object.fromEntries(nib.workspace.spaces.map((one) => [one.name, one.id])))"

#: What came back: the unsaved note, the browser tab and its space, and what is on screen.
BACK = """JSON.stringify((() => {
  const ws = nib.workspace
  const note = ws.tabs.find((one) => one.kind === 'note' && one.path === null)
  const web = ws.tabs.find((one) => one.kind === 'web' && one.path === null)
  return {
    note: note ? { doc: note.doc, path: note.path } : null,
    web: web ? { id: web.id, space: ws.spaceOf(web.note), address: web.address ?? null } : null,
    onScreen: ws.activeSpaceId,
  }
})())"""


def store_of(space: str) -> str:
    """The folder a space's own store is, named the way web-data.ts names it."""
    return "space_" + re.sub(r"[^a-z0-9.-]", "-", space.lower())


def stores(identifier: str) -> set[str]:
    folder = switch.config_dir(identifier) / "web-stores"
    return {one.name for one in folder.iterdir()} if folder.exists() else set()


def asked(app, code: str, seconds: float = 60) -> object:
    """What the window answers, asked again while it is still coming up."""
    print(f"{time.strftime('%H:%M:%S')} asks {code[:70]}", flush=True)
    end = time.perf_counter() + seconds
    said: object = None
    while time.perf_counter() < end:
        said = app.ask(code)
        if not (isinstance(said, dict) and "error" in said):
            return said
        time.sleep(1)
    return said


def until(seconds: float, done) -> bool:
    end = time.perf_counter() + seconds
    while time.perf_counter() < end:
        if done():
            return True
        time.sleep(0.5)
    return False


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe")
    args = parsed.parse_args()

    switch.wipe(args.identifier)
    port = switch.free_port()
    server = switch.serve(port)
    page = f"http://127.0.0.1:{port}/page"

    root = switch.spaces_root()
    for name in ("Work", "Home"):
        shutil.rmtree(root / name, ignore_errors=True)
        (root / name).mkdir(parents=True)
    (root / "Work" / "Idea.md").write_text("# Idea\n\nA note.\n", encoding="utf-8")
    # First in its space, so a launch with no session opens a note and never a page.
    (root / "Home" / "A note.md").write_text("# A note\n", encoding="utf-8")
    (root / "Home" / "Mail.url").write_text(switch.shortcut(f"http://127.0.0.1:{port}/other", "Mail"), encoding="utf-8")

    said: dict[str, object] = {}
    running = None
    try:
        # One launch to write the endpoint file, so eval can be turned on in it.
        running, app, _ = switch.launch(args.exe, args.identifier)
        if not close_app(running):
            running.terminate()
            running.wait(timeout=30)
        switch.allow_eval(args.identifier)
        time.sleep(1)

        # Both spaces keep their web data apart: a store folder of each one's own.
        running, app, _ = switch.launch(args.exe, args.identifier, unlike=app.port)
        found: dict[str, object] = {}

        def listed() -> bool:
            found["ids"] = asked(app, IDS)
            return isinstance(found["ids"], dict) and {"Work", "Home"} <= set(found["ids"])

        until(60, listed)
        ids = found.get("ids")
        if not isinstance(ids, dict) or "Work" not in ids or "Home" not in ids:
            raise SystemExit(f"the two spaces are not there: {ids}")
        work, home = str(ids["Work"]), str(ids["Home"])
        said["spaces"] = {"Work": work, "Home": home}
        apart = json.dumps({work: "space", home: "space"})
        asked(app, f"localStorage.setItem('nib:web-data', {json.dumps(apart)}) || 'kept'")
        close_app(running)
        time.sleep(1)

        # The run before: in Work, a note typed into and a page with no file.
        running, app, _ = switch.launch(args.exe, args.identifier, unlike=app.port)
        asked(app, f"nib.workspace.showSpace({json.dumps(work)}).then(() => 'work')")
        app.open("Idea.md", "Work")
        time.sleep(1)
        asked(app, f"(nib.workspace.openBlank(), nib.workspace.active.note.live.replace({json.dumps(WORDS)}, true), 'typed')")
        # Behind the note, so its page is first built after the restart: that is the
        # build this asks about, and a page in a store of its own is a browser process
        # of its own, which the close below has no need to wait out.
        asked(app, f"nib.workspace.openPage({json.dumps(page)}, 'behind') && 'opened'")
        said["no store before the restart"] = store_of(work) not in stores(args.identifier)
        asked(app, f"nib.workspace.showSpace({json.dumps(home)}).then(() => 'home')")
        time.sleep(2)
        first = app.port
        closing = time.perf_counter()
        if not close_app(running):
            raise SystemExit("the app did not close when asked")
        said["closed in seconds"] = round(time.perf_counter() - closing, 1)

        # The restart.
        running, app, _ = switch.launch(args.exe, args.identifier, unlike=first)
        back: object = None
        until(30, lambda: isinstance(back := asked(app, BACK), dict) and back.get("web") is not None)
        back = asked(app, BACK)
        said["after the restart"] = back
        web = back.get("web") if isinstance(back, dict) else None
        if isinstance(web, dict):
            asked(app, f"nib.workspace.activate({json.dumps(web['id'])}) || 'shown'")
        said["page rebuilt in Work's store"] = until(
            30, lambda: store_of(work) in stores(args.identifier)
        )
        said["stores after the restart"] = sorted(stores(args.identifier))

        # A web note of Home's, opened behind with Work on screen: Home's, whose store
        # its page is built in; see `spaceOf`. Opened behind, so no page of a store of
        # its own is built here, which the tab above has already proved.
        asked(app, f"nib.workspace.showSpace({json.dumps(work)}).then(() => 'work')")
        mail = f"nib.workspace.spaces.find((one) => one.id === {json.dumps(home)}).root + '/Mail.url'"
        asked(app, f"nib.workspace.openWeb({mail}, {{ activate: false }}).then(() => 'opened')")
        owner = asked(
            app,
            "(() => { const ws = nib.workspace; const tab = ws.tabs.find((one) => (one.path ?? '')"
            ".endsWith('Mail.url')); return tab ? ws.spaceOf(tab.note) : null })()",
        )
        said["web note in its own space's store"] = owner == home
        said["stores at the end"] = sorted(stores(args.identifier))
    finally:
        if running is not None and not close_app(running):
            running.terminate()
        server.shutdown()

    print(json.dumps(said, indent=2))
    after = said.get("after the restart")
    ids = said.get("spaces")
    good = (
        isinstance(after, dict)
        and isinstance(ids, dict)
        and isinstance(after.get("note"), dict)
        and after["note"].get("doc") == WORDS
        and after["note"].get("path") is None
        and isinstance(after.get("web"), dict)
        and after["web"].get("space") == ids["Work"]
        and after.get("onScreen") == ids["Home"]
        and said.get("page rebuilt in Work's store") is True
        and said.get("web note in its own space's store") is True
    )
    print("PASS" if good else "FAIL")
    return 0 if good else 1


if __name__ == "__main__":
    raise SystemExit(main())
