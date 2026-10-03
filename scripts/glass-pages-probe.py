"""Glass following real pages in the packaged app, on Windows.

The glass frame takes its colour from the page in front (lib/glass in the app; the
crate reads the page through `web_tint`). This opens pages in web tabs of a probe
build, through the app's own automation endpoint, and reads the result off the window's
own picture: the colour the bar and the frame took, and the contrast of the quietest
word on the title bar, the list and the bar against the pixels under it.

The pages: four of the probe's own, served from the loopback (white, black, red with a
`theme-color`, yellow with none), and two of the web's (Google and YouTube), which a
machine with no network simply reports as unread.

    pnpm --dir apps/desktop tauri build --no-bundle \\
      --config '{"identifier":"ch.emilvinu.nib.probe.glass-redo","version":"99.0.0",
                 "plugins":{"updater":{"endpoints":["https://127.0.0.1:9/latest.json"]}}}'
    python scripts/glass-pages-probe.py --exe apps/desktop/src-tauri/target/release/nib.exe \\
      --identifier ch.emilvinu.nib.probe.glass-redo

Off the screen and never in front, through probe_app.py's run_probe, like every probe.
Pictures go to target/glass-pages-probe/.
"""

from __future__ import annotations

import argparse
import http.server
import importlib.util
import json
import pathlib
import sys
import tempfile
import threading
import time

from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
SHOTS = HERE.parent / "target" / "glass-pages-probe"

# The glass probe's own hands on the app: the endpoint, a command, a picture.
_spec = importlib.util.spec_from_file_location("glass_probe", HERE / "glass-probe.py")
assert _spec and _spec.loader
glass = importlib.util.module_from_spec(_spec)
sys.modules["glass_probe"] = glass
_spec.loader.exec_module(glass)
glass.SHOTS = SHOTS

FLOOR = 4.5


def site(ground: str, header: str, theme: str | None, title: str, ink: str) -> bytes:
    meta = f'<meta name="theme-color" content="{theme}">' if theme else ""
    return f"""<!doctype html><html><head><meta charset="utf-8">{meta}<title>{title}</title>
<style>html,body{{margin:0;background:{ground};color:{ink};font:15px/1.5 system-ui,sans-serif}}
header{{background:{header};padding:18px 24px;font-weight:600}}main{{padding:24px}}</style></head>
<body><header>{title}</header><main><p>A page standing on a colour of its own.</p></main></body></html>""".encode()


PAGES = {
    "white": site("#ffffff", "#ffffff", None, "White", "#111111"),
    "black": site("#0f0f0f", "#0f0f0f", None, "Black", "#ffffff"),
    "red": site("#ffffff", "#d32f2f", "#d32f2f", "Red", "#ffffff"),
    "yellow": site("#ffffff", "#ffeb3b", None, "Yellow", "#111111"),
}


class Pages(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 - the standard library's name
        name = self.path.strip("/").removesuffix(".html")
        body = PAGES.get(name)
        if body is None:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_: object) -> None:
        pass


#: Where to read each part of the frame, and the ink its quietest word is written in
#: there, in CSS pixels; the picture is in device pixels.
PARTS = """
JSON.stringify((() => {
  const ink = (one) => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--muted)'
    one.append(probe)
    const said = getComputedStyle(probe).color
    probe.remove()
    return (said.match(/[\\d.]+/g) || []).slice(0, 3).map(Number)
  }
  const shown = (selector) =>
    [...document.querySelectorAll(selector)].find((one) => one.getClientRects().length > 0)
  const part = (label, selector, where) => {
    const one = shown(selector)
    if (!one) return null
    const box = one.getBoundingClientRect()
    if (!box.width || !box.height) return null
    const x = where === 'start' ? box.left + 3 : box.left + box.width / 2
    const y = where === 'foot' ? box.bottom - 6 : box.top + box.height / 2
    return [label, x, y, ink(one)]
  }
  return {
    scale: devicePixelRatio,
    tint: document.documentElement.style.getPropertyValue('--glass-tint'),
    bar: shown('.webbar')?.style.getPropertyValue('--web-ground') || '',
    at: shown('.webbar input')?.value || '',
    frame: document.querySelector('header[data-chrome=top]')?.dataset.theme || '',
    parts: [
      part('the title bar', 'header[data-chrome=top] .drag', 'middle'),
      part('the list down the side', '.panels[data-chrome=start]', 'foot'),
      part('the bar over the page', '.webbar', 'start'),
    ].filter(Boolean),
  }
})())
"""


def opened(held: dict, name: str) -> None:
    answer = glass.asked(held, "open", {"path": f"{name}.url"})
    if not answer.get("ok"):
        glass.wrong(f"{name} would not open: {answer.get('error')}")


#: The edges of the band Mica can be, per scheme, painted where the material would be
#: composited: a window that is not in front has no Mica in its own picture, so the
#: frame's wash is read over these instead, as glass-probe.py reads it.
BANDS = {"dark": ["#000000", "rgb(58,58,58)"], "light": ["rgb(192,192,192)", "#ffffff"]}


def parts(held: dict, host: str) -> dict:
    """The frame once the page in front is the one asked for and has said its colour."""
    until = time.monotonic() + 20
    said: dict = {}
    while time.monotonic() < until:
        said = json.loads(str(glass.ran(held, PARTS) or "{}"))
        if host in said.get("at", "").lower() and said.get("bar"):
            # A page of a site seen before wears the site's last colour at once, and its
            # own a moment after it has landed and been read.
            time.sleep(3.0)
            return json.loads(str(glass.ran(held, PARTS) or "{}"))
        time.sleep(0.4)
    return said


def read(held: dict, app_pid: int, scheme: str, name: str, host: str) -> None:
    said = parts(held, host)
    label = f"[{scheme}, {name}]"
    if host not in said.get("at", "").lower() or not said.get("bar"):
        glass.say(f"     {label} the page said no colour (at {said.get('at')!r}, frame {said.get('tint')})")
        return
    glass.say(f"     {label} bar {said['bar']}, frame {said['tint']}, frame words {said['frame'] or scheme}")
    scale = said.get("scale", 1)
    for desk in BANDS[scheme]:
        glass.ran(held, glass.DESK.format(desk=desk, material="mica"))
        time.sleep(0.5)
        tag = desk.replace("#", "").replace("rgb(", "").replace(")", "").replace(",", "-")
        picture = Image.open(glass.photographed(app_pid, f"{scheme}-{name}-{tag}")).convert("RGB")
        for part, x, y, ink in said.get("parts", []):
            at = (int(x * scale), int(y * scale))
            if not (0 <= at[0] < picture.width and 0 <= at[1] < picture.height):
                continue
            ground = picture.getpixel(at)
            seen = glass.ratio(tuple(int(one) for one in ink), ground)
            line = f"{label} over {desk}, {part}: quiet words {seen}:1 on {ground}"
            if seen >= FLOOR:
                glass.say(f"ok   {line}")
            else:
                glass.wrong(line)
    glass.ran(held, glass.UNDESK)


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives the Windows build", flush=True)
        return 0

    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    said = parser.parse_args()

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Pages)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_address[1]}"

    glass.wipe(said.identifier)
    try:
        with tempfile.TemporaryDirectory(prefix="nib-glass-pages-") as spaces:
            space = pathlib.Path(spaces) / "Notes"
            space.mkdir()
            (space / "Read me.md").write_text("# Read me\n\nWords.\n", encoding="utf-8")
            sites = {name: f"{origin}/{name}.html" for name in PAGES}
            sites |= {"google": "https://www.google.com/", "youtube": "https://www.youtube.com/"}
            for name, address in sites.items():
                (space / f"{name}.url").write_text(f"[InternetShortcut]\r\nURL={address}\r\n", encoding="utf-8")

            app, held = glass.started(said.exe.resolve(), said.identifier, pathlib.Path(spaces))
            try:
                hwnd = glass.main_window(app.pid)
                glass.sized(hwnd, 1240, 760)
                time.sleep(2.5)
                glass.pressed(held, "files")
                for scheme in ("light", "dark"):
                    glass.pressed(held, f"scheme:{scheme}")
                    glass.pressed(held, "theme:glass", settle=1.5)
                    for name in sites:
                        opened(held, name)
                        # The address field says the site and the page's title, and each
                        # page here names itself after its file.
                        read(held, app.pid, scheme, name, name)
            finally:
                glass.ended(app)
    finally:
        server.shutdown()

    if glass.failures:
        print(f"\n{len(glass.failures)} thing(s) wrong:")
        for one in glass.failures:
            print(f"  - {one}")
        return 1
    print("\nglass took every page's colour, and every word on the frame reads")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
