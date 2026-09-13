"""Is what the app opens over a web page drawn *over* it? Windows only.

Emil, 2026-09-13: *"Also some stuff with the overlay / z ordering is very fucked up for
browser pages."*

A web tab's page is a native child webview, and a native webview draws above every
pixel of HTML in the window - so anything the app opens over it has to be answered by
hiding the page, or the menu comes up behind the page and nobody can see it. Whether
that actually happens cannot be unit tested and cannot be seen from inside the window:
it is a question about pixels, so this asks the pixels.

The page it opens is one flat colour and nothing else. For each kind of overlay the app
has - the dots menu, the popover behind the mark in the bar, the palette - the drive
opens it over the page, photographs the window, asks the window where that overlay is,
and counts how much of the overlay's own rectangle is still the page's colour. A
rectangle full of it is a page drawn in front of the overlay, which is the bug and which
is what a reader sees as a menu that does not appear.

It cannot be the pane as a whole, because the pane is *meant* to stay the page's colour
now: what the app holds under an overlay is a still picture of the page, so that nothing
flashes, and a picture of a magenta page is magenta.

It also drives the one thing no unit test can reach: **a site asking for something.**
The served page calls `getCurrentPosition` as it loads, the engine raises its own
permission request, and the bubble under the address bar is what answers it - so the
photograph is proof that the whole road works, from the engine's event through the
crate's deferral to the reader's press.

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
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent / "target" / "web-overlays"

# The colour the page is, and how near a pixel has to be to count as it: a screen copy
# is exact, and this is for the edge of a rounded corner.
PAGE_COLOUR = (0xFF, 0x00, 0x80)
NEAR = 40

# How much of the pane may still be the page for an overlay to count as being in front
# of it. A menu is a small thing over a large page, so the question is not "the page is
# gone" but "the page is no longer all of it".
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
  // nothing in the app asked for it and nothing in the app could have. Where you are
  // rather than the camera, because a machine with no camera answers that one itself
  // before there is anything to ask about.
  //
  // The page says in its own title what the engine told it, which is how the drive sees
  // the far end of the answer: code 1 is PERMISSION_DENIED - the reader said no, or
  // nobody ever answered - and anything else means the request was allowed and the
  // machine simply has no location to give.
  navigator.geolocation.getCurrentPosition(
    function () {
      document.title = 'allowed'
    },
    function (wrong) {
      document.title = 'refused ' + wrong.code
    },
  )
</script>
</body>
""",
}


def shoot(hwnd: int, name: str) -> pathlib.Path:
    """A photograph of the window itself, not of the screen where it is.

    `PrintWindow` with `PW_RENDERFULLCONTENT` asks the window to draw itself into a
    bitmap, which is the only capture that works here: a drive cannot bring the window
    to the front - Windows refuses the foreground to a process that has not had it - so
    a copy of the screen at the window's rectangle is a copy of whatever is actually in
    front, which on this machine is the wallpaper. Asking the window instead needs
    nothing of the window manager."""

    import ctypes
    from ctypes import wintypes

    from PIL import Image

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)

    box = wintypes.RECT()
    user32.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(box))
    width = box.right - box.left
    height = box.bottom - box.top

    window = user32.GetWindowDC(wintypes.HWND(hwnd))
    made = gdi32.CreateCompatibleDC(window)
    bitmap = gdi32.CreateCompatibleBitmap(window, width, height)
    gdi32.SelectObject(made, bitmap)

    # PW_RENDERFULLCONTENT: the flag that makes this work for a window whose content is
    # composited rather than painted, which is every webview.
    user32.PrintWindow(wintypes.HWND(hwnd), made, 0x0000_0002)

    class BITMAPINFOHEADER(ctypes.Structure):
        _fields_ = [
            ("biSize", wintypes.DWORD),
            ("biWidth", ctypes.c_long),
            ("biHeight", ctypes.c_long),
            ("biPlanes", wintypes.WORD),
            ("biBitCount", wintypes.WORD),
            ("biCompression", wintypes.DWORD),
            ("biSizeImage", wintypes.DWORD),
            ("biXPelsPerMeter", ctypes.c_long),
            ("biYPelsPerMeter", ctypes.c_long),
            ("biClrUsed", wintypes.DWORD),
            ("biClrImportant", wintypes.DWORD),
        ]

    header = BITMAPINFOHEADER()
    header.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    header.biWidth = width
    # Negative, so the rows come back the way a picture is read rather than upside down.
    header.biHeight = -height
    header.biPlanes = 1
    header.biBitCount = 32
    header.biCompression = 0

    bits = ctypes.create_string_buffer(width * height * 4)
    gdi32.GetDIBits(made, bitmap, 0, height, bits, ctypes.byref(header), 0)

    gdi32.DeleteObject(bitmap)
    gdi32.DeleteDC(made)
    user32.ReleaseDC(wintypes.HWND(hwnd), window)

    out = OUT / f"{name}.png"
    picture = Image.frombuffer("RGBA", (width, height), bits, "raw", "BGRA", 0, 1)
    picture.convert("RGB").save(out)
    return out


def how_much(shot: pathlib.Path, box: tuple[int, int, int, int] | None = None) -> float:
    """How much of a rectangle of the window is the page's own colour.

    Given a rectangle, it is the overlay's own - which is the whole test: if the page is
    drawn in front, every pixel where the menu should be is the page's colour and the
    menu is invisible; if the overlay is in front, almost none of it is. Given none, it
    is the pane, which says whether there is a page there at all.

    A rectangle is needed rather than the pane as a whole because the pane is *meant* to
    stay the page's colour: the still picture of the page is what the app now holds under
    an overlay, and a picture of a magenta page is magenta. That is the feature, so the
    measurement cannot be "is there any magenta left"."""

    from PIL import Image

    with Image.open(shot) as picture:
        page = picture.convert("RGB")
        width, height = page.size
        # The pane, roughly: below the strip and the bar, and inside the window.
        cut = box if box else (width // 3, height // 4, width - 8, height - 8)
        inside = page.crop(cut)
        counted = 0
        total = 0
        for seen in inside.getdata():
            total += 1
            if all(abs(one - other) <= NEAR for one, other in zip(seen, PAGE_COLOUR)):
                counted += 1

    return counted / max(1, total)


# Each overlay, and the line that opens it in the window. `commands.run` would reach
# some of them, but a line of script reaches all of them and says which one it meant.
OVERLAYS = [
    (
        "the dots",
        "document.querySelector('.webbar button[aria-label=\"More\"]').click()",
        ".menu, [role=menu]",
    ),
    (
        "the site",
        "document.querySelector('.webbar button[aria-label=\"Site information\"]').click()",
        ".site[role=dialog]",
    ),
    (
        "the palette",
        "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true }))",
        ".palette, [role=dialog]",
    ),
]

# Where the overlay is, in the window's own pixels, asked of the window rather than
# guessed: the drive then looks at exactly the rectangle the overlay claims.
WHERE = """(() => {
  const one = document.querySelector('%s')
  if (!one) return JSON.stringify(null)
  const box = one.getBoundingClientRect()
  return JSON.stringify([
    Math.round(box.x), Math.round(box.y), Math.round(box.right), Math.round(box.bottom),
  ])
})()"""


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

        running, app, hwnd = switch.launch(args.exe, args.identifier, unlike=app.port)
        app.open("Idea.md", switch.SPACE)
        time.sleep(3)
        app.open("A flat page.url")
        time.sleep(6)

        bare = shoot(hwnd, "page-alone")
        said["the page alone"] = round(how_much(bare), 3)

        for name, opens, drawn in OVERLAYS:
            app.ask(opens)
            time.sleep(1.2)

            shot = shoot(hwnd, name.replace(" ", "-"))
            where = app.ask(WHERE % drawn)
            if not isinstance(where, list) or len(where) != 4:
                said[name] = "the overlay never opened"
                continue

            # Inside the overlay's own rectangle, in the window's pixels rather than the
            # page's: a scaled screen would move the crop, so both come from the same
            # picture. The pane's scale is 1 on this machine and the drive says so by
            # failing visibly rather than by correcting silently.
            said[name] = round(how_much(shot, tuple(int(one) for one in where)), 3)
            # And what the pane is holding under it: the still picture of the page, which
            # is what keeps an overlay from being a flash of empty pane. See `web_shot`.
            said[f"{name}: the picture under it"] = app.ask(
                "JSON.stringify((document.querySelector('.hole')?.style?.backgroundImage ?? '')"
                ".slice(0, 30))"
            )
            app.ask("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))")
            time.sleep(0.8)

        # The one the engine raises for itself: a site asking where you are. Waited for
        # rather than slept through - the page has to load and ask, and the bubble
        # arrives on a transition - and photographed once it is really there, because a
        # photograph taken a moment early is a photograph of nothing.
        app.open("A page that asks.url")
        asked = ""
        until = time.perf_counter() + 30
        while not asked and time.perf_counter() < until:
            said_text = app.ask(
                "JSON.stringify(document.querySelector('.ask[role=dialog]')?.textContent?.trim()"
                " ?? '')"
            )
            asked = said_text if isinstance(said_text, str) else ""
            if not asked:
                time.sleep(1)

        said["a site asks"] = asked
        time.sleep(0.5)
        shoot(hwnd, "a-site-asks")
        if not asked:
            print("FAIL: a site asked for where you are and no bubble went up")

        # And the far end of it: Allow is pressed, the engine is let go of, and the page's
        # own callback runs. The page puts what it was told in its title, so `refused 1`
        # would mean the answer never reached the engine - or reached it as a no.
        app.ask("document.querySelectorAll('.ask .nib-button')[1].click()")
        time.sleep(3)
        said["the bubble is gone"] = app.ask(
            "JSON.stringify(document.querySelector('.ask[role=dialog]') === null)"
        )
        # Read off the bar, which shows the site and then the page's own title: the page
        # wrote what it was told into that title, so this is the engine's answer as a
        # reader would see it.
        said["what the engine told the page"] = app.ask(
            "JSON.stringify(document.querySelector('.webbar input.address')?.value ?? '')"
        )
        said["what the site is allowed now"] = app.ask(
            "JSON.stringify(JSON.parse(localStorage.getItem('nib:web-grants') ?? '{}'))"
        )
        shoot(hwnd, "a-site-allowed")
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
