"""The wallpaper theme in the packaged app: what it costs a launch, and its card.

Three launches on the built-in theme and three on the wallpaper with a picture chosen,
with `NIB_TRACE_STARTUP` on, compared on when the shell and the open tab were painted -
the wallpaper's picture rides in the sheet a launch wears early, so it should cost the
first paint nothing. Then the theme picker, photographed off the window, with the
wallpaper's card drawn from the picture.

Every launch goes through `run_probe` in probe_app.py, off the screen and never in
front, on a spaces folder of its own; the helpers are glass-probe.py's.

    pnpm --dir apps/desktop tauri build --no-bundle \\
      --config '{"identifier":"ch.emilvinu.nib.probe.wallpaper","version":"99.0.0",
                 "plugins":{"updater":{"endpoints":["https://127.0.0.1:9/latest.json"]}}}'
    python scripts/wallpaper-probe.py --exe apps/desktop/src-tauri/target/release/nib.exe \\
      --identifier ch.emilvinu.nib.probe.wallpaper

Wipes that identifier's settings and webview profile first, and refuses one whose name
does not say `probe`. Photographs go to target/glass-probe/.
"""

from __future__ import annotations

import argparse
import importlib.util
import pathlib
import sys
import tempfile
import time

HERE = pathlib.Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("glass_probe", HERE / "glass-probe.py")
assert _spec and _spec.loader
glass = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(glass)

# A picture as the store would have kept it - small, already blurred - written where it
# keeps one, since a release build has no handle to hand the store a file through. The
# theme is chosen after, so its sheet is read with the picture in it.
KEEP = """
(() => {
  const canvas = document.createElement('canvas')
  canvas.width = 183; canvas.height = 114
  const c = canvas.getContext('2d')
  const g = c.createLinearGradient(0, 0, 183, 114)
  g.addColorStop(0, '#0b1a3a'); g.addColorStop(0.5, '#e86a3a'); g.addColorStop(1, '#fff3c4')
  c.fillStyle = g; c.fillRect(0, 0, 183, 114)
  const side = (floor, ground) => ({ floor, ground })
  localStorage.setItem('nib:wallpaper', JSON.stringify({
    picture: canvas.toDataURL('image/png'),
    blur: 28,
    dark: side(0.62, '#3a2a2a'),
    light: side(0.6, '#e9dcd2'),
  }))
  return localStorage.getItem('nib:wallpaper').length
})()
"""


def launches(exe: pathlib.Path, identifier: str, spaces: pathlib.Path) -> None:
    best: dict[str, float] = {}
    for theme in ("default", "wallpaper"):
        app, held = glass.started(exe, identifier, spaces)
        time.sleep(3.0)
        if theme == "wallpaper":
            glass.say(f"     the picture kept: {glass.ran(held, KEEP)} characters")
        glass.pressed(held, f"theme:{theme}", settle=2.0)
        glass.ended(app)

        log = glass.local(identifier) / "logs" / "startup-trace.log"
        log.unlink(missing_ok=True)
        for _launch in range(3):
            app, held = glass.started(exe, identifier, spaces, trace=True)
            time.sleep(7.0)
            if theme == "wallpaper" and not best.get("photographed"):
                best["photographed"] = 1
                sheet = glass.ran(held, "document.getElementById('nib-user-theme')?.textContent.includes('--wallpaper-picture:')")
                (glass.say if sheet is True else glass.wrong)(f"the relaunch wears the picture: {sheet}")
                glass.photographed(app.pid, "wallpaper-relaunch")
                glass.pressed(held, "themes", settle=1.5)
                glass.photographed(app.pid, "wallpaper-picker")
            glass.ended(app)
        for step in ("shell painted", "active tab painted"):
            times = glass.painted_at(identifier, step)
            if len(times) < 3:
                glass.wrong(f"{theme}: {len(times)} launches traced to {step}, not 3")
                continue
            shown = ", ".join(f"{one:.0f}" for one in times)
            glass.say(f"     {theme}: {step} at {shown} ms, best {min(times):.0f}")
            best[f"{theme} {step}"] = min(times)

    for step in ("shell painted", "active tab painted"):
        plain, pictured = best.get(f"default {step}"), best.get(f"wallpaper {step}")
        if plain is None or pictured is None:
            continue
        if pictured - plain > 50:
            glass.wrong(f"the wallpaper reaches {step} {pictured - plain:.0f} ms later than the built-in")
        else:
            glass.say(f"ok   the wallpaper reaches {step} in {pictured:.0f} ms against the built-in's {plain:.0f}")


def main() -> int:
    if sys.platform != "win32":
        print("this drive runs the Windows probe", flush=True)
        return 0

    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    said = parser.parse_args()

    glass.wipe(said.identifier)
    with tempfile.TemporaryDirectory(prefix="nib-wallpaper-probe-") as spaces:
        space = pathlib.Path(spaces) / "Notes"
        space.mkdir()
        (space / "Under a picture.md").write_text(glass.NOTE, encoding="utf-8")
        launches(said.exe.resolve(), said.identifier, pathlib.Path(spaces))

    if glass.failures:
        print(f"\n{len(glass.failures)} thing(s) wrong:")
        for one in glass.failures:
            print(f"  - {one}")
        return 1

    print("\nthe wallpaper costs a launch nothing")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
