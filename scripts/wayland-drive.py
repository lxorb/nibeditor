#!/usr/bin/env python3
"""A web tab under Wayland, looked at: where its page is drawn, on every screen.

Run by scripts/wayland-launch.sh with DRIVE=1, once Orden's window is up under the
headless sway it started, and Orden started on this script's own page - a page of one
colour edge to edge, so where it is drawn can be read off a picture of the screen. For
every screen sway has (a portrait one at 1.77, one at 1, one at 1.75, one at 2):

  - the window moved there, the page asked where the window put its hole (`eval`
    through the app's own endpoint), and a picture of the screen taken (grim);
  - the page's colour has to fill that hole and nothing else, to a pixel or two:
    the report this came from had the site in the bottom half of the window, cut off;
  - each of the app's layers over the page (`LAYERS`) has to show over it, the page has
    to show round it - live, or as its still picture - and come back whole after;
  - and once, the window made smaller: the page follows.

    python3 scripts/wayland-drive.py <out folder> <app pid>
"""

import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image

OUT = Path(sys.argv[1])
APP = sys.argv[2]
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "ch.emilvinu.nib"
SLACK = 3
failures = []

# What opens over a web tab's page, and the button that opens it.
LAYERS = [
    ("the web tab's menu", '.webbar button[aria-haspopup="menu"]'),
    ("the app menu", "button.trigger[aria-expanded]"),
]


def fail(what):
    print(f"::error::{what}")
    failures.append(what)


def endpoint():
    for _ in range(120):
        try:
            kept = json.loads((CONFIG / "automation.json").read_text())
            if kept.get("port"):
                return kept["port"], kept["secret"]
        except (OSError, ValueError):
            pass
        time.sleep(0.5)
    raise SystemExit("::error::the app wrote no endpoint")


PORT, SECRET = endpoint()


def run(code):
    """`code` run in the window's page, and what it came to."""
    body = json.dumps({"verb": "eval", "args": {"code": code, "yes": True}, "rest": []})
    asked = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/",
        data=body.encode(),
        headers={"authorization": f"Bearer {SECRET}", "content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(asked, timeout=30) as answer:
        said = json.loads(answer.read())
    if not said.get("ok"):
        print(f"eval said: {said}")
        return None
    return said.get("value")


def sway(*words):
    return json.loads(subprocess.check_output(["swaymsg", "-r", *words]))


def window_node():
    """The app's biggest window: the document window, not quick add's."""

    def walk(node):
        if str(node.get("pid")) == APP:
            yield node
        for child in node.get("nodes", []) + node.get("floating_nodes", []):
            yield from walk(child)

    found = sorted(
        walk(sway("-t", "get_tree")),
        key=lambda node: node["rect"]["width"] * node["rect"]["height"],
    )
    return found[-1] if found else None


def hole():
    """Where the window put the web tab's hole, in its own pixels, once it has one."""
    for _ in range(60):
        sent = run(
            "(() => { const all = nib.pages.each().map(([, page]) => page.sent)"
            ".filter((one) => one && one.visible); return all[0] ? all[0].pane : null })()"
        )
        if isinstance(sent, dict) and sent.get("width", 0) > 10:
            return sent
        time.sleep(0.5)
    return None


def is_page(rgb):
    red, green, blue = rgb
    return red > 230 and blue > 230 and green < 40


def bounding(shot):
    """Where the page's colour is in a picture."""
    image = Image.open(shot).convert("RGB")
    pixels = image.load()
    width, height = image.size
    xs, ys = [], []
    for y in range(height):
        for x in range(width):
            if is_page(pixels[x, y]):
                xs.append(x)
                ys.append(y)
    if not xs:
        return None
    return min(xs), min(ys), max(xs) + 1, max(ys) + 1


def share(shot, box):
    """How much of `box` in a picture is the page's colour."""
    image = Image.open(shot).convert("RGB")
    pixels = image.load()
    width, height = image.size
    left, top, right, bottom = (max(0, int(v)) for v in box)
    right, bottom = min(right, width), min(bottom, height)
    seen = hits = 0
    for y in range(top, bottom, 2):
        for x in range(left, right, 2):
            seen += 1
            hits += is_page(pixels[x, y])
    return hits / max(1, seen)


def shoot(output, name):
    path = OUT / f"{name}-{output}.png"
    subprocess.run(["grim", "-o", output, str(path)], check=True)
    return path


def near(got, want, scale):
    return got is not None and all(
        abs(a - b) <= SLACK * max(1, scale) for a, b in zip(got, want)
    )


def look(output):
    info = next(one for one in sway("-t", "get_outputs") if one["name"] == output)
    scale = info["scale"]
    subprocess.run(["swaymsg", f"[pid={APP}] move container to output {output}"], check=True)
    subprocess.run(["swaymsg", f"[pid={APP}] focus"], check=False)
    time.sleep(2.5)
    node = window_node()
    pane = hole()
    if not node or not pane:
        fail(f"{output}: no window or no hole to look at")
        return
    origin = (node["rect"]["x"] - info["rect"]["x"], node["rect"]["y"] - info["rect"]["y"])

    def on_screen(rect, inset=0):
        return (
            (origin[0] + rect["x"] + inset) * scale,
            (origin[1] + rect["y"] + inset) * scale,
            (origin[0] + rect["x"] + rect["width"] - inset) * scale,
            (origin[1] + rect["y"] + rect["height"] - inset) * scale,
        )

    want = on_screen(pane)
    got = bounding(shoot(output, "page"))
    print(f"{output} at {scale}: the hole is {tuple(round(v) for v in want)}, the page is {got}")
    if not near(got, want, scale):
        fail(f"{output} at {scale}: the page is at {got}, its hole at {tuple(round(v) for v in want)}")
        return

    for name, trigger in LAYERS:
        opened = run(
            "(() => { const button = document.querySelector(%s);"
            " if (!button) return null; const r = button.getBoundingClientRect();"
            " for (const kind of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])"
            " button.dispatchEvent(new MouseEvent(kind, { bubbles: true, clientX: r.right - 2,"
            " clientY: r.bottom - 2 })); return true })()" % json.dumps(trigger)
        )
        time.sleep(1.0)
        layer = run(
            "(() => { const all = [...document.querySelectorAll('[role=\"menu\"]')]"
            ".map((one) => one.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);"
            " const r = all[all.length - 1];"
            " return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null })()"
        )
        slug = name.replace(" ", "-").replace("'", "")
        if not opened or not isinstance(layer, dict):
            fail(f"{output}: {name} did not open")
        else:
            shot = shoot(output, slug)
            covered = share(shot, on_screen(layer, 4))
            under = share(shot, want)
            print(
                f"{output}: {name} at {layer}: the page is over {covered:.0%} of it,"
                f" and shows in {under:.0%} of its hole"
            )
            if covered > 0.05:
                fail(f"{output}: the page is drawn over {name} ({covered:.0%})")
            if under < 0.5:
                fail(f"{output}: under {name} the page is gone ({under:.0%} of its hole)")
        run("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
        time.sleep(1.0)
        back = bounding(shoot(output, f"after-{slug}"))
        if not near(back, want, scale):
            fail(f"{output}: the page did not come back whole after {name} ({back})")


outputs = [one["name"] for one in sway("-t", "get_outputs")]
for output in outputs:
    look(output)

# Smaller: floating, at a size of its own, and the page has to follow.
subprocess.run(["swaymsg", f"[pid={APP}] floating enable, resize set 900 650"], check=False)
time.sleep(2.5)
look(outputs[1])

(OUT / "drive.json").write_text(json.dumps({"failures": failures}, indent=2))
sys.exit(1 if failures else 0)
