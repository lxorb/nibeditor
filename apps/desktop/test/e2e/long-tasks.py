"""Whether the launch keeps its hands off the main thread once the window is drawn.

The one-second rule has two halves. The first is the first paint, which the weight
guard in test/weight.test.ts holds and test/e2e/launch.py times. The second is what
happens after it: the index, the search, the icon sets, the rooms and the doors all
start in the launch order's idle turns (see lib/startup.svelte.ts), and every one of
them is written to hand the thread back as it goes - so a key pressed in the second
after the window appears is answered in the frame it was pressed in. A task that holds
the thread for longer than fifty milliseconds is a frame a key waits through, which is
the definition of a long task and the thing Chrome reports as one.

So this opens the release-shaped build in a real browser on a fixed space - the same
hundred notes every run, with their links, tags, tasks and front matter, and one of
them open - reloads it so the launch is a returning reader's, and counts the long
tasks from the first frame to the end of the launch order, less the one that builds the
restored note's editor. More than the ceiling is a failure, and each task is listed with
the launch's step it came after, so the failure says where to look.

**The same line on every machine.** Fifty milliseconds is a clock, and a clock on a
laptop with three builds running on it is not the clock on the runner the smoke job
gets. So the drive times a fixed piece of work in the page first - string building and
a regular expression, the shape of what a launch does - and scales the line by how much
slower or faster this machine did it than the reference, which is that runner: a long
task here is one that would have been fifty milliseconds there. A pass that
scans a space in one go crosses that line on a fast machine and a slow one alike, and
a pass that breaks its work up crosses it on neither, which is what makes a ceiling on
the count mean the same thing wherever it runs. Run on every change in the smoke job,
after smoke.py's own build:

    python apps/desktop/test/e2e/long-tasks.py

`NIB_SKIP_BUILD=1` reuses apps/desktop/dist; `NIB_CPU=4` slows the page four times
through the DevTools protocol, which is the slow device a launch has to open on too,
and is reported rather than gated.
"""

from __future__ import annotations

import functools
import http.server
import json
import os
import shutil
import socket
import socketserver
import subprocess
import threading
import time
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent
DIST = APP / "dist"

#: Not the dev server's, and not smoke.py's or any other drive's.
PORT = 18853
ORIGIN = f"http://127.0.0.1:{PORT}"

#: How many notes the fixed space holds.
NOTES = 100

#: How long a task may hold the thread before it is a long one on the reference
#: machine: Chrome's own line.
LONG = 50

#: What the fixed work below took on the reference machine - the smoke job's runner,
#: GitHub's ubuntu-latest, on 2026-09-30 - quickest of seven, in milliseconds. The line
#: on any other machine is `LONG` times its own time over this.
REFERENCE = 45.8

#: How many long tasks the launch may have after its first frame. None: on the
#: reference machine there were none, with the order finished a hundred milliseconds
#: after the window was whole; and a deliberate task of eighty reference milliseconds -
#: the fixed work below, 350,000 times round, put into the search stage's turn - was
#: read as one on the laptop the one-second table was measured on.
CEILING = 0

#: The fixed work, timed in the page before the launch that is measured.
BENCH = """
() => {
  const started = performance.now()
  const words = /(\\w+)@(\\w+)\\.(\\w+)/g
  let kept = 0
  for (let at = 0; at < 200000; at++) {
    const text = 'note-' + at + ' to someone@example.org about ' + (at % 97)
    words.lastIndex = 0
    const found = words.exec(text)
    kept += text.length + (found ? found[2].length : 0)
  }
  return kept > 0 ? performance.now() - started : -1
}
"""

#: The page's own timeline, read as it happened: every long task Chrome reports, from
#: before the first line of the app runs.
OBSERVE = """
window.__longTasks = []
new PerformanceObserver((list) => {
  for (const one of list.getEntries()) {
    window.__longTasks.push({ start: one.startTime, duration: one.duration })
  }
}).observe({ type: 'longtask', buffered: true })
"""

#: The fixed space: the notes are what the index and the search read in the launch
#: order, so they are what decides whether those passes break their work up.
SEED = """
async (count) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  const tags = ['#wind', '#ink', '#paper', '#kestrel', '#plan']
  for (let at = 0; at < count; at++) {
    const body = [
      '---', 'icon: rocket', 'aliases:', `  - note ${at} elsewhere`, '---', '',
      `# Note ${at}`, '',
      `${tags[at % 5]} and a line about the wind, written on the ${at}th of the month.`, '',
      `See [[Note ${(at + 7) % count}]] and [[Note ${(at + 3) % count}#What went in, 1]].`, '',
      '- [ ] Pressure on the pen', '- [x] Slides out of a note', '',
      ...Array.from({ length: 12 }, (_, part) => [
        `## What went in, ${part}`, '',
        'The wind was steady all week, and the ink took its time. What the pen leaves',
        'behind on paper is the only part of this anybody reads twice.', '',
      ]).flat(),
    ].join('\\n')
    await ws.noteFrom(body, root)
  }
  await ws.loadTree()
  const first = ws.notes.find((one) => one.name.startsWith('Note 0'))
  if (first) await ws.openEntry(first.path, { activate: true })
  return ws.notes.length
}
"""


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def build() -> None:
    if os.environ.get("NIB_SKIP_BUILD") and (DIST / "index.html").exists():
        say("reusing the build that is there")
        return
    say("building the web app in drive")
    shutil.rmtree(DIST, ignore_errors=True)
    built = subprocess.run(
        [shutil.which("npx") or "npx", "vite", "build", "--mode", "drive"],
        cwd=APP,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if built.returncode != 0:
        raise SystemExit(f"the build failed:\n{built.stdout}\n{built.stderr}")


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        return

    def end_headers(self) -> None:
        # Cached the way a returning reader's browser caches it, so the launch
        # measured is the app's and not the file server's.
        self.send_header("Cache-Control", "max-age=3600")
        super().end_headers()


def serve() -> socketserver.TCPServer:
    handler = functools.partial(Quiet, directory=str(DIST))
    server = socketserver.ThreadingTCPServer(("127.0.0.1", PORT), handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    until = time.monotonic() + 20
    while time.monotonic() < until:
        try:
            with socket.create_connection(("127.0.0.1", PORT), timeout=1):
                return server
        except OSError:
            time.sleep(0.2)
    raise SystemExit("the file server never answered")


def wait_for(page: Page, expression: str, what: str, patience: float = 60) -> None:
    until = time.monotonic() + patience
    while time.monotonic() < until:
        if page.evaluate(f"() => !!({expression})"):
            return
        page.wait_for_timeout(50)
    raise SystemExit(f"gave up waiting for {what}")


def marks(page: Page) -> dict[str, float]:
    return page.evaluate(
        "() => Object.fromEntries(performance.getEntriesByType('mark')"
        ".filter((one) => one.name.startsWith('nib: '))"
        ".map((one) => [one.name.slice(5), one.startTime]))"
    )


def main() -> int:
    build()
    server = serve()
    slowed = float(os.environ.get("NIB_CPU") or 1)
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            context = browser.new_context(viewport={"width": 1180, "height": 820})
            context.add_init_script(OBSERVE)
            page = context.new_page()
            page.goto(ORIGIN, wait_until="domcontentloaded")
            wait_for(page, "window.nibApp?.workspace?.activeSpace", "a space")
            wait_for(page, "window.nibApp.workspace.active", "the app to open its own note")
            say(f"the space holds {page.evaluate(SEED, NOTES)} notes")
            # Written as a returning reader's session is, then the machine timed while
            # nothing else in the page is running.
            page.wait_for_timeout(1500)
            bench = min(page.evaluate(BENCH) for _ in range(7))

            session = context.new_cdp_session(page)
            if slowed != 1:
                session.send("Emulation.setCPUThrottlingRate", {"rate": slowed})
            page.reload(wait_until="commit")
            wait_for(
                page,
                "performance.getEntriesByName('nib: launch order finished').length",
                "the launch order",
            )
            # The last turn's fetches land a moment after the turn itself.
            page.wait_for_timeout(1000)
            if slowed != 1:
                session.send("Emulation.setCPUThrottlingRate", {"rate": 1})

            seen = marks(page)
            marks_all = page.evaluate(
                "() => performance.getEntriesByType('mark')"
                ".filter((one) => one.name.startsWith('nib: '))"
                ".map((one) => [one.name.slice(5), one.startTime])"
            )
            tasks = page.evaluate("() => window.__longTasks")
            browser.close()
    finally:
        server.shutdown()
        server.server_close()

    # From the first frame to the end of the launch order, less the task that builds
    # the editor the note it was left on arrives in. That task is the note arriving
    # rather than the launch getting in its way - a key pressed before it has nowhere
    # to go - and it is told apart by the mark it makes (see Editor.svelte), not by
    # when it happens: the stages of the order run beside the restore, and under load
    # one of them can come first. Everything else is the launch's own work, which is
    # what has to hand the thread back.
    start = seen.get("first frame painted")
    end = seen.get("launch order finished")
    built = [at for name, at in marks_all if name == "editor built"]
    if start is None or end is None:
        say(f"the page never marked its launch: {json.dumps(seen)}")
        return 1

    scale = bench / REFERENCE
    line = LONG * scale
    say(
        f"the fixed work took {bench:.1f} ms against {REFERENCE:.1f} on the reference machine,"
        f" so a long task here is one over {line:.0f} ms"
    )
    say(
        f"first frame at {start:.0f} ms, launch order finished at {end:.0f} ms"
        + (f", the page slowed {slowed:g} times" if slowed != 1 else "")
    )

    inside = [
        one
        for one in tasks
        if start <= one["start"] < end
        and not any(one["start"] <= at <= one["start"] + one["duration"] for at in built)
    ]
    long = [one for one in inside if one["duration"] > line]
    for one in long:
        # Which of the launch's steps it came after, and which it held up: the marks
        # are the only names a long task has without a profiler.
        before = [name for name, at in seen.items() if at <= one["start"]]
        during = [
            name
            for name, at in seen.items()
            if one["start"] < at <= one["start"] + one["duration"]
        ]
        say(
            f"  a long task at {one['start']:.0f} ms, {one['duration']:.0f} ms,"
            f" after {before[-1] if before else 'nothing'!r}"
            + (f", holding up {', '.join(repr(name) for name in during)}" if during else "")
        )
    say(f"{len(long)} long tasks after the first frame, the editor's own left out")

    if slowed == 1 and len(long) > CEILING:
        say(f"FAILED: more than {CEILING} long tasks between the first frame and the end of the launch")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
