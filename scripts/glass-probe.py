"""The glass theme in the packaged app, on Windows: what the compositor draws behind the
window, whether every word on the chrome still reads, and what it costs a launch.

What it checks, through the app's own automation endpoint and off the window itself:

* **The material.** Choosing glass puts Mica Alt behind the window - asked of DWM with
  `DwmGetWindowAttribute`, not of the app - tinted by the scheme the page is in, and
  choosing the built-in again takes it away. The Appearance pane has no Translucency row.
* **The words, on the window's own picture.** The window is photographed with
  capture-window.ps1 and every reading is taken off the pixels: the brightest or darkest
  pixel of a line of words against the colour most of the box round it is. Taken over
  the material as the probe window has it - which, for a window that is never the one
  in front, is Mica's own flat colour - and over the worst desks there are, painted
  where the material would be: white and black under Acrylic's wash, and the edges of
  the band Mica can be under Mica's.
* **The launch.** Three launches on the built-in theme and three on glass, with
  `NIB_TRACE_STARTUP` on, compared on when the shell was painted.

A desk of the reader's own is never touched: the probe is off the screen and never in
front (see probe_app.py), so what Windows composites behind it is Mica's flat colour,
and the wallpaper is left alone rather than swapped behind somebody's back. The painted
desks are the stricter test in any case - Mica keeps its own brightness whatever the
wallpaper is, and a white or a black desk is the most any wallpaper can be.

    pnpm --dir apps/desktop tauri build --no-bundle \\
      --config '{"identifier":"ch.emilvinu.nib.probe.glass","version":"99.0.0",
                 "plugins":{"updater":{"endpoints":["https://127.0.0.1:9/latest.json"]}}}'
    python scripts/glass-probe.py --exe apps/desktop/src-tauri/target/release/nib.exe \\
      --identifier ch.emilvinu.nib.probe.glass

Wipes that identifier's settings and webview profile first, and refuses one whose name
does not say `probe`. Photographs go to target/glass-probe/.
"""

from __future__ import annotations

import argparse
import ctypes
import json
import os
import pathlib
import re
import secrets
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.request
from ctypes import wintypes

from PIL import Image

from probe_app import close_app, main_window, run_probe, sized

HERE = pathlib.Path(__file__).resolve().parent
SHOTS = HERE.parent / "target" / "glass-probe"

#: What DWM calls the material behind a window. Mica Alt is the tabbed one.
DWMWA_USE_IMMERSIVE_DARK_MODE = 20
DWMWA_SYSTEMBACKDROP_TYPE = 38
DWMSBT_TABBEDWINDOW = 4

FLOOR = 4.5

NOTE = """# A window with a desk behind it

Ordinary words, and *some* of them `marked up`, with a [link](https://example.com).

> A quote, which is drawn in the muted colour.
"""

failures: list[str] = []


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def wrong(words: str) -> None:
    failures.append(words)
    say(f"WRONG {words}")


def attribute(hwnd: int, which: int) -> int:
    held = ctypes.c_int(0)
    ctypes.windll.dwmapi.DwmGetWindowAttribute(
        wintypes.HWND(hwnd), ctypes.c_uint(which), ctypes.byref(held), ctypes.sizeof(held)
    )
    return held.value


# ── the app ─────────────────────────────────────────────────────────────────


def roaming(identifier: str) -> pathlib.Path:
    return pathlib.Path(os.environ["APPDATA"]) / identifier


def local(identifier: str) -> pathlib.Path:
    return pathlib.Path(os.environ["LOCALAPPDATA"]) / identifier


def wipe(identifier: str) -> None:
    if "probe" not in identifier:
        raise SystemExit(f"{identifier} is not a probe's identifier; nothing is wiped")
    shutil.rmtree(roaming(identifier), ignore_errors=True)
    shutil.rmtree(local(identifier), ignore_errors=True)


def allow_eval(identifier: str) -> pathlib.Path:
    """`eval` turned on in the endpoint file, which is the only way it can be."""
    path = roaming(identifier) / "automation.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"port": 0, "secret": secrets.token_hex(32), "eval": True}), encoding="utf-8"
    )
    return path


def waited_for(path: pathlib.Path, patience: float = 90) -> dict:
    until = time.monotonic() + patience
    while time.monotonic() < until:
        try:
            held = json.loads(path.read_text(encoding="utf-8"))
            if held.get("port") and held.get("secret"):
                return held
        except (OSError, ValueError):
            pass
        time.sleep(0.3)
    raise SystemExit(f"no endpoint at {path} after {patience:.0f}s")


def asked(held: dict, verb: str, args: dict) -> dict:
    body = json.dumps({"verb": verb, "args": args, "rest": []}).encode()
    request = urllib.request.Request(
        f"http://127.0.0.1:{held['port']}/",
        data=body,
        headers={"authorization": f"Bearer {held['secret']}", "content-type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as answer:
        return json.loads(answer.read().decode())


def ran(held: dict, code: str) -> object:
    answer = asked(held, "eval", {"code": code, "yes": True})
    if not answer.get("ok"):
        wrong(f"the window would not run {code[:60]!r}: {answer.get('error')}")
        return None
    return answer.get("value")


def pressed(held: dict, command: str, settle: float = 1.2) -> None:
    """One row of the palette, by its own id: the row a reader presses."""
    answer = asked(held, "commands.run", {"id": command})
    if not answer.get("ok"):
        wrong(f"the {command} command would not run: {answer.get('error')}")
    time.sleep(settle)


def started(exe: pathlib.Path, identifier: str, spaces: pathlib.Path, trace: bool = False):
    endpoint = allow_eval(identifier)
    env = {**os.environ, "NIB_SPACES_DIR": str(spaces)}
    if trace:
        env["NIB_TRACE_STARTUP"] = "1"
    app = run_probe(exe, env=env, quiet=True)
    held = waited_for(endpoint)
    until = time.monotonic() + 30
    while not main_window(app.pid) and time.monotonic() < until:
        time.sleep(0.2)
    return app, held


def ended(app: subprocess.Popen[bytes]) -> None:
    if not close_app(app):
        app.kill()
        app.wait(timeout=30)


# ── the picture ─────────────────────────────────────────────────────────────


def photographed(pid: int, name: str) -> pathlib.Path:
    SHOTS.mkdir(parents=True, exist_ok=True)
    out = SHOTS / f"{name}.png"
    subprocess.run(
        [
            shutil.which("powershell") or "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(HERE / "capture-window.ps1"),
            "-ProcessId",
            str(pid),
            "-Out",
            str(out),
        ],
        capture_output=True,
        text=True,
        check=False,
        timeout=120,
    )
    say(f"photographed {out.name}")
    return out


def luminance(rgb: tuple[int, int, int]) -> float:
    def channel(one: int) -> float:
        value = one / 255
        return value / 12.92 if value <= 0.03928 else ((value + 0.055) / 1.055) ** 2.4

    r, g, b = rgb
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def ratio(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    high, low = sorted((luminance(a), luminance(b)), reverse=True)
    return round((high + 0.05) / (low + 0.05), 2)


#: Boxes round lines of words the chrome carries, read off the page: a tab's name in
#: the bar, a note's name in the list, and the list's own heading, which is the quiet
#: grey. The window's own coordinates, in CSS pixels.
BOXES = """
JSON.stringify((() => {
  const box = (label, element) => {
    if (!element) return null
    const r = element.getBoundingClientRect()
    return [label, r.left, r.top, r.width, r.height]
  }
  const rows = [...document.querySelectorAll('aside .nib-row-label')]
  return [
    box('a tab in the bar', document.querySelector('.tab:not(.active) .label')),
    box('a note in the list', rows.find((one) => one.textContent.trim().length > 3)),
    box('the heading over the list', document.querySelector('aside .nib-section')),
  ].filter(Boolean).concat([[ 'scale', devicePixelRatio, 0, 0, 0 ]])
})())
"""


def readings(held: dict, picture: pathlib.Path, where: str) -> None:
    """Every line of words on the chrome, read off the window's own picture."""
    found = json.loads(str(ran(held, BOXES) or "[]"))
    scale = next((one[1] for one in found if one[0] == "scale"), 1)
    image = Image.open(picture).convert("RGB")
    for label, left, top, width, height in (one for one in found if one[0] != "scale"):
        box = (
            int(left * scale),
            int(top * scale),
            int((left + width) * scale),
            int((top + height) * scale),
        )
        if box[2] <= box[0] or box[3] <= box[1]:
            continue
        pixels = list(image.crop(box).getdata())
        ground = statistics.mode(pixels)
        ink = max(pixels, key=lambda one: abs(luminance(one) - luminance(ground)))
        seen = ratio(ink, ground)
        line = f"[{where}] {label}: {seen}:1 (ink {ink}, ground {ground})"
        if seen >= FLOOR:
            say(f"ok   {line}")
        else:
            wrong(line)


#: A desk painted where the material would be composited, and the page told what it is
#: standing on, the way material.ts tells it.
DESK = """
(() => {{
  document.getElementById('nib-desk')?.remove()
  const style = document.createElement('style')
  style.id = 'nib-desk'
  style.textContent = 'html {{ background: {desk} !important; }}'
  document.head.append(style)
  document.documentElement.dataset.translucent = '{material}'
  return true
}})()
"""

UNDESK = """
(() => { document.getElementById('nib-desk')?.remove(); return true })()
"""


# ── the drive ───────────────────────────────────────────────────────────────


def looks(exe: pathlib.Path, identifier: str, spaces: pathlib.Path) -> None:
    app, held = started(exe, identifier, spaces)
    try:
        hwnd = main_window(app.pid)
        sized(hwnd, 1240, 760)
        time.sleep(2.5)
        # The list open, and a second tab beside the first, so the bar has a tab that is
        # not the open one to read.
        pressed(held, "files")
        pressed(held, "new")

        for scheme in ("dark", "light"):
            pressed(held, f"scheme:{scheme}")
            pressed(held, "theme:default")
            if attribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE) == DWMSBT_TABBEDWINDOW:
                wrong(f"[{scheme}] the built-in theme has a material behind the window")
            photographed(app.pid, f"{scheme}-default")

            pressed(held, "theme:glass", settle=1.8)
            backdrop = attribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE)
            if backdrop == DWMSBT_TABBEDWINDOW:
                say(f"ok   [{scheme}] DWM draws Mica Alt behind the window")
            else:
                wrong(f"[{scheme}] DWM says the backdrop is {backdrop}, not Mica Alt")
            dark = attribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE)
            if bool(dark) == (scheme == "dark"):
                say(f"ok   [{scheme}] and tints it {scheme}")
            else:
                wrong(f"[{scheme}] Mica is tinted {'dark' if dark else 'light'}")
            said = ran(held, "document.documentElement.dataset.translucent ?? ''")
            if said != "mica":
                wrong(f"[{scheme}] the page says it stands on {said!r}")

            picture = photographed(app.pid, f"{scheme}-glass")
            readings(held, picture, f"{scheme} glass, the material as the probe has it")

            # The worst desks there are, painted where the material would be.
            desks = {
                "dark": [("acrylic", "#ffffff"), ("acrylic", "#000000"), ("mica", "rgb(58,58,58)"), ("mica", "#000000")],
                "light": [("acrylic", "#000000"), ("acrylic", "#ffffff"), ("mica", "rgb(192,192,192)"), ("mica", "#ffffff")],
            }[scheme]
            for material, desk in desks:
                ran(held, DESK.format(desk=desk, material=material))
                time.sleep(0.6)
                name = f"{scheme}-glass-{material}-{re.sub(r'[^0-9a-z]+', '', desk)}"
                readings(held, photographed(app.pid, name), f"{scheme} glass, {material} over {desk}")
            ran(held, UNDESK)
            pressed(held, "theme:glass", settle=1.0)

        # The other surfaces a pane can hold, on glass in the last scheme: a web tab's
        # bar with its tab running down into it, and a terminal on the pane's paper.
        pressed(held, "theme:glass", settle=1.0)
        pressed(held, "new-website", settle=1.5)
        photographed(app.pid, "light-glass-web")
        ran(held, "(() => { document.querySelector('button.new')?.click(); return true })()")
        time.sleep(0.8)
        opened = ran(
            held,
            "(() => { const row = [...document.querySelectorAll('[role=menuitem]')]"
            ".find((one) => /terminal/i.test(one.textContent)); row?.click(); return !!row })()",
        )
        if opened:
            time.sleep(2.5)
            photographed(app.pid, "light-glass-terminal")
            pressed(held, "scheme:dark", settle=1.0)
            photographed(app.pid, "dark-glass-terminal")
            pressed(held, "scheme:light", settle=1.0)
        else:
            say("     the strip's plus offered no terminal to open")

        # Appearance: the Window group is the frame alone now.
        pressed(held, "settings", settle=1.2)
        ran(
            held,
            "(() => { const row = [...document.querySelectorAll('button')]"
            ".find((one) => one.textContent.trim() === 'Appearance'); row?.click(); return !!row })()",
        )
        time.sleep(1.0)
        rows = str(
            ran(
                held,
                "JSON.stringify([...document.querySelectorAll('.nib-setting')]"
                ".map((one) => one.textContent.replace(/\\s+/g, ' ').trim()))",
            )
        )
        if "Translucency" in rows:
            wrong("the Appearance pane still has a Translucency row")
        else:
            say("ok   the Appearance pane has no Translucency row")
        photographed(app.pid, "light-glass-settings")
        ran(held, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))")
        time.sleep(0.6)

        # The theme picker, where glass has a card of its own drawn over a desk.
        pressed(held, "themes", settle=1.5)
        photographed(app.pid, "light-glass-picker")
        ran(held, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))")
        time.sleep(0.6)

        pressed(held, "theme:default")
        if attribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE) == DWMSBT_TABBEDWINDOW:
            wrong("going back to the built-in theme left Mica Alt behind the window")
        else:
            say("ok   the built-in theme again, and the material is gone")
    finally:
        ended(app)


def painted_at(identifier: str, step: str) -> list[float]:
    """When each launch in the trace reached a step of the window's, in milliseconds."""
    path = local(identifier) / "logs" / "startup-trace.log"
    if not path.exists():
        return []
    found = re.findall(rf"^window: {step}\s+([\d.]+) ms", path.read_text(encoding="utf-8"), re.M)
    return [float(one) for one in found]


def launches(exe: pathlib.Path, identifier: str, spaces: pathlib.Path) -> None:
    """Three launches on each theme, the theme chosen by the launch before them, compared
    on their best: a machine running builds beside this makes the worst of three a
    question about the machine, and the best of three a question about the app."""
    best: dict[str, float] = {}
    for theme in ("default", "glass"):
        app, held = started(exe, identifier, spaces)
        time.sleep(3.0)
        pressed(held, f"theme:{theme}", settle=2.0)
        ended(app)

        log = local(identifier) / "logs" / "startup-trace.log"
        log.unlink(missing_ok=True)
        for _ in range(3):
            app, held = started(exe, identifier, spaces, trace=True)
            # The page hands its half over three seconds after the launch's last stage;
            # see `sendTrace` in trace.ts.
            time.sleep(7.0)
            ended(app)
        for step in ("shell painted", "active tab painted"):
            times = painted_at(identifier, step)
            if len(times) < 3:
                wrong(f"{theme}: {len(times)} launches traced to {step}, not 3")
                continue
            shown = ", ".join(f"{one:.0f}" for one in times)
            say(f"     {theme}: {step} at {shown} ms, best {min(times):.0f}")
            best[f"{theme} {step}"] = min(times)

    for step in ("shell painted", "active tab painted"):
        plain, glass = best.get(f"default {step}"), best.get(f"glass {step}")
        if plain is None or glass is None:
            continue
        if glass - plain > 50:
            wrong(f"glass reaches {step} {glass - plain:.0f} ms later than the built-in")
        else:
            say(f"ok   glass reaches {step} in {glass:.0f} ms against the built-in's {plain:.0f}")
        if glass > 1000:
            wrong(f"glass reaches {step} after a second even at its best")


def main() -> int:
    if sys.platform != "win32":
        print("this drive reads the Windows compositor", flush=True)
        return 0

    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    parser.add_argument("--skip-launches", action="store_true")
    parser.add_argument("--skip-looks", action="store_true")
    said = parser.parse_args()

    shutil.rmtree(SHOTS, ignore_errors=True)
    wipe(said.identifier)
    with tempfile.TemporaryDirectory(prefix="nib-glass-probe-") as spaces:
        # A space with two notes in it, so the list has names to read.
        space = pathlib.Path(spaces) / "Notes"
        space.mkdir()
        (space / "A window with a desk behind it.md").write_text(NOTE, encoding="utf-8")
        (space / "Second note.md").write_text("# Second note\n\nMore words.\n", encoding="utf-8")
        if not said.skip_looks:
            looks(said.exe.resolve(), said.identifier, pathlib.Path(spaces))
        if not said.skip_launches:
            launches(said.exe.resolve(), said.identifier, pathlib.Path(spaces))

    if failures:
        print(f"\n{len(failures)} thing(s) wrong:")
        for one in failures:
            print(f"  - {one}")
        return 1

    print("\nglass stands on Mica Alt, every word on it reads, and it costs a launch nothing")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
