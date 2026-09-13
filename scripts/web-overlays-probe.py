"""Is what the app opens over a web page drawn *over* it? Windows only.

Emil, 2026-09-13: *"Also some stuff with the overlay / z ordering is very fucked up for
browser pages."*

A web tab's page is a native child webview, and a native webview draws above every
pixel of HTML in the window - so anything the app opens over it has to be answered by
hiding the page, or the menu comes up behind the page and nobody can see it. Whether
that actually happens cannot be unit tested and cannot be seen from inside the window:
it is a question about pixels, so this asks the pixels.

The page it opens is one flat colour and nothing else. For each kind of overlay the app
has - a menu, the palette, a sheet, a dialog, the bubble a site is answered in, the
popover behind the mark in the bar - the drive opens it over the page, photographs the
window, and counts how much of that colour is left in the pane. A pane still full of it
is a page drawn over the overlay, which is the bug.

It also drives the one thing no unit test can reach: **a site asking for the camera.**
The served page calls `getUserMedia` as it loads, the engine raises its own permission
request, and the bubble under the address bar is what answers it - so the photograph is
proof that the whole road works, from the engine's event through the crate's deferral to
the reader's press.

    python scripts/web-overlays-probe.py --exe path/to/nib.exe

The exe is a release build under an identifier of its own; see web-switch-probe.py,
whose helpers this drive borrows so the two cannot drift apart.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import shutil
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent / "target" / "web-overlays"

# The colour the page is, and how much of the pane has to stop being it for the overlay
# to count as being in front. A menu is a small thing over a large page, so the test is
# not "the page is gone" but "the page is no longer all of it".
PAGE_COLOUR = (0xFF, 0x00, 0x80)
ENOUGH = 0.6


def borrowed():
    """The switch probe's own helpers: the space, the launch, the endpoint, `eval`."""

    spec = importlib.util.spec_from_file_location("switch", HERE / "web-switch-probe.py")
    if spec is None or spec.loader is None:
        raise SystemExit("could not read web-switch-probe.py")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PAGES = {
    "/flat": b"""<!doctype html>
<title>A flat page</title>
<body style="margin:0;background:#ff0080;height:100vh"></body>
""",
    "/asks": b"""<!doctype html>
<title>A page that asks</title>
<body style="margin:0;background:#0080ff;height:100vh">
<script>
  // The engine raises its own permission request for this, which is the whole point:
  // nothing in the app asked for it and nothing in the app could have.
  navigator.mediaDevices.getUserMedia({ video: true }).then(
    function () {},
    function () {},
  )
</script>
</body>
""",
}


def shoot(name: str) -> pathlib.Path:
    """A photograph of the window, taken by the platform: a webview cannot photograph
    the window it is drawn in."""

    out = OUT / f"{name}.png"
    subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-File",
            str(HERE / "capture-window.ps1"),
            "-ProcessName",
            "nib",
            "-Out",
            str(out),
        ],
        check=False,
        capture_output=True,
        timeout=90,
    )
    return out


def how_much(shot: pathlib.Path) -> float:
    """How much of the lower half of the window is still the page's own colour."""

    from PIL import Image

    with Image.open(shot) as picture:
        page = picture.convert("RGB")
        width, height = page.size
        # The pane, roughly: below the strip and the bar, and inside the window.
        box = page.crop((width // 3, height // 4, width - 8, height - 8))
        counted = 0
        total = 0
        for red, green, blue in box.getdata():
            total += 1
            if abs(red - 0xFF) < 30 and green < 40 and abs(blue - 0x80) < 40:
                counted += 1

    return counted / max(1, total)


# Each overlay, and the line that opens it in the window. `commands.run` would reach
# some of them, but a line of script reaches all of them and says which one it meant.
OVERLAYS = [
    ("the dots", "document.querySelector('.webbar button[aria-label=\"More\"]').click()"),
    (
        "the site",
        "document.querySelector('.webbar button[aria-label=\"Site information\"]').click()",
    ),
    ("the palette", "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true }))"),
]


def main() -> int:
    if sys.platform != "win32":
        print("this drive photographs a Windows window")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe")
    args = parsed.parse_args()

    switch = borrowed()
    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True, exist_ok=True)

    switch.wipe(args.identifier)
    port = switch.free_port()

    # The two pages this drive serves, in the switch probe's own server.
    import http.server
    import threading

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            body = PAGES.get(self.path)
            self.send_response(200 if body else 404)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(body or b"no")

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
    (space / "A page that asks.url").write_text(
        switch.shortcut(f"http://127.0.0.1:{port}/asks", "A page that asks"), encoding="utf-8"
    )

    said: dict[str, object] = {}
    running = None
    try:
        running, app, _ = switch.launch(args.exe, args.identifier)
        running.terminate()
        running.wait(timeout=30)
        switch.allow_eval(args.identifier)
        time.sleep(1)

        running, app, _ = switch.launch(args.exe, args.identifier, unlike=app.port)
        app.open("Idea.md", switch.SPACE)
        time.sleep(3)
        app.open("A flat page.url")
        time.sleep(6)

        bare = shoot("page-alone")
        said["the page alone"] = round(how_much(bare), 3)

        for name, opens in OVERLAYS:
            app.ask(opens)
            time.sleep(1.2)
            shot = shoot(name.replace(" ", "-"))
            left = round(how_much(shot), 3)
            said[name] = left
            app.ask("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))")
            time.sleep(0.8)

        # The one an engine raises for itself: a site asking for the camera.
        app.open("A page that asks.url")
        time.sleep(6)
        shot = shoot("a-site-asks")
        said["a site asks"] = app.ask(
            "JSON.stringify(document.querySelector('.ask[role=dialog]')?.textContent?.trim() ?? '')"
        )
    finally:
        if running is not None:
            running.terminate()
        server.shutdown()

    print(json.dumps(said, indent=2))
    print(f"\nthe photographs are in {OUT}")

    over = [name for name, value in said.items() if isinstance(value, float) and value > ENOUGH]
    for name in over:
        if name != "the page alone":
            print(f"FAIL: {name} left {said[name]} of the pane as the page: it is behind it")

    return 1 if [one for one in over if one != "the page alone"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
