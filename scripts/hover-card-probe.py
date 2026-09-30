"""Does a tab's hover card come up over a web page, in front of it? Windows only.

A web tab's page is a native webview, which draws over every pixel of HTML in the
window: a card hanging from a tab over a page it did not hide would be a card nobody
sees. So the card photographs the pages on screen and takes a place on the overlay
stack while it is up, and the pages stand behind their stills - which is what a menu
does, and what this asks the pixels about (lib/tab-strip/hover-card.svelte.ts).

The page says in its own title whether its engine thinks it is seen, and the crate
hands that title back (`web_clip`). The drive rests a mouse on the other tab - a pointer
event of the window's own, never the machine's pointer - waits Chrome's delay, and asks:
is there a card, is the page out of sight, and is its still what the pane holds. Then
the pointer leaves, and the card has to be gone and the page seen again. It photographs
the window as well; a window kept off every screen may photograph black, and then the
pictures say nothing and the answers are the page's and the pane's.

    python scripts/hover-card-probe.py --exe path/to/nib.exe --identifier ch.emilvinu.nib.probe.tabs-hints

The exe is a release build under an identifier of its own; see web-switch-probe.py,
whose helpers this drive borrows, and web-overlays-probe.py, whose photograph it takes.
"""

from __future__ import annotations

import argparse
import http.server
import importlib.util
import json
import pathlib
import shutil
import sys
import threading
import time

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent / "target" / "hover-card"

# How much of the card's rectangle may still be the page for the card to count as in
# front of it: the card is a bubble with a light ground, so a card in front is almost
# none of it.
ENOUGH = 0.25

FLAT = b"""<!doctype html>
<title>start</title>
<body style="margin:0;background:#ff0080;height:100vh">
<script>
  // What the engine says about being seen, as the page's name: the tab wears it.
  const say = () => (document.title = 'page ' + document.visibilityState)
  document.addEventListener('visibilitychange', say)
  say()
</script>
</body>
"""


def borrowed(name: str, file: str):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    if spec is None or spec.loader is None:
        raise SystemExit(f"could not read {file}")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# A mouse resting on a tab, and leaving it: the strip's own pointer events, sent to the
# tab named by the page's title or the note's name.
POINT = """(() => {
  const tab = [...document.querySelectorAll('.tab')]
    .find((one) => (one.querySelector('.label')?.textContent ?? '').startsWith('%s'))
  if (!tab) return JSON.stringify(false)
  tab.dispatchEvent(new PointerEvent('%s', { pointerType: 'mouse' }))
  return JSON.stringify(true)
})()"""

WHERE = """(() => {
  const one = document.querySelector('.card')
  if (!one) return JSON.stringify(null)
  const box = one.getBoundingClientRect()
  return JSON.stringify([
    Math.round(box.x), Math.round(box.y), Math.round(box.right), Math.round(box.bottom),
  ])
})()"""

NAMES = "JSON.stringify([...document.querySelectorAll('.tab .label')].map((one) => one.textContent))"

# What the page says about being seen, read back through the crate.
SEEN = """(async () => {
  const tab = nib.workspace.tabs.find((one) => one.kind === 'web')
  const clip = await window.__TAURI_INTERNALS__.invoke('web_clip', { tab: tab.id, selection: false })
  return JSON.stringify(clip.title)
})()"""

# Whether the pane holds the page's still.
STILL = "JSON.stringify(document.querySelector('.hole')?.classList.contains('still') ?? null)"


def _all_black(shot: pathlib.Path) -> bool:
    from PIL import Image

    with Image.open(shot) as picture:
        return picture.convert("RGB").getextrema() == ((0, 0), (0, 0), (0, 0))


def main() -> int:
    if sys.platform != "win32":
        print("this drive photographs a Windows window")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe")
    args = parsed.parse_args()

    switch = borrowed("switch", "web-switch-probe.py")
    overlays = borrowed("overlays", "web-overlays-probe.py")
    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True, exist_ok=True)
    overlays.OUT = OUT

    switch.wipe(args.identifier)
    port = switch.free_port()

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(FLAT)

        def log_message(self, *_args: object) -> None:
            return

    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    space = switch.spaces_root() / switch.SPACE
    shutil.rmtree(space, ignore_errors=True)
    space.mkdir(parents=True, exist_ok=True)
    (space / "Idea.md").write_text("# Idea\n\nA note.\n", encoding="utf-8")
    (space / "A flat page.url").write_text(
        switch.shortcut(f"http://127.0.0.1:{port}/flat", "A flat page"), encoding="utf-8"
    )

    said: dict[str, object] = {}
    failed: list[str] = []
    running = None
    try:
        running, app, _ = switch.launch(args.exe, args.identifier)
        running.terminate()
        running.wait(timeout=30)
        switch.allow_eval(args.identifier)
        time.sleep(1)

        running, app, hwnd = switch.launch(args.exe, args.identifier, unlike=app.port)
        app.open("Idea.md", switch.SPACE)
        time.sleep(3)
        app.open("A flat page.url")
        time.sleep(6)

        said["the strip"] = app.ask(NAMES)
        said["the page, alone"] = app.ask(SEEN)
        overlays.shoot(hwnd, "page-alone")

        said["rested on Idea"] = app.ask(POINT % ("Idea", "pointerenter"))
        time.sleep(2.2)
        where = app.ask(WHERE)
        said["the card"] = where
        said["the page, with the card up"] = app.ask(SEEN)
        said["the pane holds the still"] = app.ask(STILL)
        shot = overlays.shoot(hwnd, "card-over-the-page")
        if not isinstance(where, list) or len(where) != 4:
            failed.append("no card came up over the page")
        elif said["the page, with the card up"] != "page hidden":
            failed.append("the page stayed in front of the card")
        if said["the pane holds the still"] is not True:
            failed.append("the pane held no still of the page under the card")
        # Only a picture with something in it says anything about pixels.
        blank = _all_black(shot)
        if not blank and isinstance(where, list) and len(where) == 4:
            behind = round(overlays.how_much(shot, tuple(int(one) for one in where)), 3)
            said["the card's rectangle that is still the page"] = behind
            if behind > ENOUGH:
                failed.append(f"the card is behind the page: {behind} of it is the page")

        app.ask(POINT % ("Idea", "pointerleave"))
        time.sleep(1.2)
        said["the card after leaving"] = app.ask(WHERE)
        said["the page, after"] = app.ask(SEEN)
        overlays.shoot(hwnd, "card-gone")
        if said["the card after leaving"] is not None:
            failed.append("the card stayed after the pointer left")
        if said["the page, after"] != "page visible":
            failed.append("the page stayed hidden after the card went")
    finally:
        if running is not None:
            running.terminate()
        server.shutdown()

    print(json.dumps(said, indent=2))
    print(f"\nthe photographs are in {OUT}")
    for one in failed:
        print(f"FAIL: {one}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
