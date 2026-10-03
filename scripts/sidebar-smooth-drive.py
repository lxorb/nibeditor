"""Does the sidebar open and shut at 60 fps? The web build, in Chromium, on the real GPU.

Emil, 2026-10-03: the sidebar opened and shut in steps, "CHUCK CHUCK". web-smooth had
measured a GPU task of 70 to 400 ms in the app's page whenever the panel was built or
thrown away. This opens and shuts it three times each in the default theme, glass and
wallpaper, with a space of 300 notes and an 80-section note open, and reads two things:

* the page's own frames, from `requestAnimationFrame`: the gaps between them from the
  press until the slide has settled, and how many are over 20 ms;
* a trace of the whole browser: the longest tasks on the page's main thread and on the
  GPU's, and what the longest of them were made of.

    pnpm --dir apps/desktop exec vite build --mode drive --outDir <folder>
    python scripts/sidebar-smooth-drive.py <folder> [default glass wallpaper] [--cpu 4]

`--cpu 4` slows the page's processor fourfold, the way the launch numbers are measured,
which is what shows a task the machine itself is fast enough to hide. Headless, never on
the screen. A GPU task of several hundred milliseconds that lands on a caret's blink is
the machine's GPU being busy with something else rather than this page; run it again.
"""

from __future__ import annotations

import argparse
import functools
import http.server
import json
import os
import pathlib
import socket
import statistics
import threading

from playwright.sync_api import sync_playwright

CHROME_HOME = pathlib.Path(os.environ["LOCALAPPDATA"]) / "ms-playwright"

SEED = """
async (rows) => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('nib')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const now = Date.now()
  await new Promise((resolve, reject) => {
    const change = db.transaction(['files', 'stats'], 'readwrite')
    for (const [path, content] of rows) {
      change.objectStore('files').put({ path, content, modified: now, created: now })
      change.objectStore('stats').put({ path, modified: now, created: now })
    }
    change.oncomplete = () => resolve()
    change.onerror = () => reject(change.error)
  })
}
"""

LONG = "# Smooth\n\n" + "\n\n".join(
    f"## Part {i}\n\nSome **bold** words, some *italic* ones, `code`, a [link](https://example.com)"
    " and ==marks==, on a line long enough to wrap.\n\n- one\n- two **three**\n- [ ] task"
    for i in range(80)
)

ROWS = [["/Notes/Smooth.md", LONG]] + [
    [f"/Notes/Folder {f}/Note {f}-{i}.md", f"# Note {i}\n\ntext"] for f in range(12) for i in range(25)
]

# One press, and the page's frames from it until the slide has long settled.
TOGGLE = """
async () => {
  const stamps = []
  let going = true
  const tick = (at) => { stamps.push(at); if (going) requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  await new Promise((go) => setTimeout(go, 100))
  const from = performance.now()
  window.nibApp.workspace.toggleSidebar()
  await new Promise((go) => setTimeout(go, 700))
  going = false
  const gaps = []
  for (let i = 1; i < stamps.length; i++) if (stamps[i] > from) gaps.push(stamps[i] - stamps[i - 1])
  return { gaps, open: !!window.nibApp.workspace.panel }
}
"""

# A picture for the wallpaper theme: colour everywhere, which is what makes a panel
# over it expensive to draw.
PICTURE = """
async () => {
  const canvas = document.createElement('canvas')
  canvas.width = 2400
  canvas.height = 1600
  const pen = canvas.getContext('2d')
  const ground = pen.createLinearGradient(0, 0, 2400, 1600)
  ground.addColorStop(0, '#2a6')
  ground.addColorStop(0.5, '#a3c')
  ground.addColorStop(1, '#fc4')
  pen.fillStyle = ground
  pen.fillRect(0, 0, 2400, 1600)
  for (let i = 0; i < 300; i++) {
    pen.fillStyle = `hsl(${i * 7}, 70%, 50%)`
    pen.beginPath()
    pen.arc((i * 997) % 2400, (i * 613) % 1600, 40, 0, 7)
    pen.fill()
  }
  const picture = await new Promise((done) => canvas.toBlob(done, 'image/jpeg', 0.9))
  await window.nibApp.wallpaper.take(picture)
}
"""

CATEGORIES = [
    "toplevel",
    "devtools.timeline",
    "disabled-by-default-devtools.timeline",
    "disabled-by-default-devtools.timeline.frame",
    "gpu",
    "viz",
    "cc",
    "blink",
]

TASK = "ThreadControllerImpl::RunTask"


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def handle(self):
        try:
            super().handle()
        except ConnectionError:
            pass


def serve(folder: pathlib.Path):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", port), functools.partial(Quiet, directory=str(folder))
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{port}/", server


def threads(trace) -> dict:
    """The longest tasks on the page's main thread and the GPU's, and the biggest parts
    of the longest one on each."""
    events = trace["traceEvents"] if isinstance(trace, dict) else trace
    names = {
        (e["pid"], e["tid"]): e["args"]["name"]
        for e in events
        if e.get("ph") == "M" and e.get("name") == "thread_name"
    }
    out = {}
    for thread in ("CrRendererMain", "CrGpuMain"):
        tasks = sorted(
            (
                e
                for e in events
                if e.get("ph") == "X"
                and e.get("name") == TASK
                and names.get((e["pid"], e["tid"])) == thread
            ),
            key=lambda e: -e.get("dur", 0),
        )
        if not tasks:
            continue
        worst = tasks[0]
        start, end = worst["ts"], worst["ts"] + worst.get("dur", 0)
        parts: dict[str, float] = {}
        for e in events:
            if (
                e.get("ph") == "X"
                and e["pid"] == worst["pid"]
                and e["tid"] == worst["tid"]
                and start <= e["ts"] < end
                and e.get("name") != TASK
            ):
                parts[e["name"]] = parts.get(e["name"], 0) + e.get("dur", 0) / 1000
        out[thread] = {
            "longest ms": [round(e.get("dur", 0) / 1000, 1) for e in tasks[:5]],
            "over 16 ms": sum(e.get("dur", 0) > 16000 for e in tasks),
            "the longest was": [
                f"{name} {round(ms, 1)}" for name, ms in sorted(parts.items(), key=lambda kv: -kv[1])[:6]
            ],
        }
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("build", type=pathlib.Path)
    parser.add_argument("themes", nargs="*", default=["default", "glass", "wallpaper"])
    parser.add_argument("--cpu", type=float, default=1)
    asked = parser.parse_args()

    url, server = serve(asked.build)
    report: dict = {}
    chrome = sorted(CHROME_HOME.glob("chromium-1*/chrome-win*/chrome.exe"))[-1]
    with sync_playwright() as play:
        browser = play.chromium.launch(executable_path=str(chrome), args=["--headless=new"])
        try:
            page = browser.new_context(
                viewport={"width": 1600, "height": 1000}, device_scale_factor=1.5
            ).new_page()
            errors: list[str] = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(url)
            page.wait_for_timeout(3000)
            page.evaluate(SEED, ROWS)
            page.reload()
            page.wait_for_timeout(3000)
            page.keyboard.press("Control+o")
            page.wait_for_timeout(400)
            page.keyboard.type("Smooth")
            page.wait_for_timeout(800)
            page.keyboard.press("Enter")
            page.wait_for_timeout(2000)
            if asked.cpu > 1:
                page.context.new_cdp_session(page).send(
                    "Emulation.setCPUThrottlingRate", {"rate": asked.cpu}
                )

            for theme in asked.themes:
                if theme == "wallpaper":
                    page.evaluate(PICTURE)
                page.evaluate(f"() => window.nibApp.theme.select({json.dumps(theme)})")
                page.wait_for_timeout(2500)
                if not page.evaluate("() => !!window.nibApp.workspace.panel"):
                    page.evaluate("() => window.nibApp.workspace.toggleSidebar()")
                    page.wait_for_timeout(1500)

                browser.start_tracing(page=page, categories=CATEGORIES)
                runs = []
                for _ in range(6):
                    runs.append(page.evaluate(TOGGLE))
                    page.wait_for_timeout(300)
                trace = json.loads(browser.stop_tracing())

                for way in ("open", "shut"):
                    gaps = [g for run in runs if run["open"] == (way == "open") for g in run["gaps"]]
                    report[f"{theme}, {way}"] = {
                        "frames over 20 ms": sum(g > 20 for g in gaps),
                        "worst gaps ms": sorted((round(g, 1) for g in gaps), reverse=True)[:4],
                        "median gap ms": round(statistics.median(gaps), 1),
                    }
                report[f"{theme}, tasks"] = threads(trace)
            report["page errors"] = errors[:5]
        finally:
            browser.close()
            server.shutdown()

    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
