"""PDFs opened with nib, driven on a Windows probe build.

Emil, 2026-10-13: *"open with nib should be possible for pdfs"*. This probe registers
nothing with Windows and changes no default: it drives what "Open with" does once it
has chosen nib, which is the command line the installer registers for a PDF, `nib.exe
"<path>"`, handed to a nib that is not running and to one that is:

* **cold** - a launch for a PDF from outside every space opens nib with it in the
  viewer, in front, after copying it to the top of the space that is open.
* **warm** - a second PDF handed to the running app is a second tab, in front.
* **again** - the same paper handed over again is the copy the space already has: no
  second file, its tab in front.
* **in a space** - a PDF that is in a space opens where it is, and nothing is copied.
* **refused** - a note's path and a PDF after a link's flag open nothing.
* **the view** - a photograph of the window with the PDF in it.

Every launch goes through `run_probe`, off the screen and without the keyboard, and the
second launches that hand a PDF over and exit are watched the same way.

    python scripts/pdf-open-probe.py --exe <probe nib.exe> \\
      --identifier ch.emilvinu.nib.probe.<name>

Build the exe as scripts/probe_app.py says: version 99.0.0 and the updater pointed at a
loopback port nothing listens on.
"""

from __future__ import annotations

import argparse
import atexit
import importlib.util
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time

from probe_app import close_app, main_window, run_probe, sized

HERE = pathlib.Path(__file__).resolve().parent

# What the browser probe already knows how to do: the endpoint, eval, a second launch,
# a photograph. Loaded by path, since its file name is no module name.
_spec = importlib.util.spec_from_file_location("browser_probe", HERE / "default-browser-probe.py")
assert _spec and _spec.loader
browser = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(browser)

SPACE = "PDF probe"
NOTE = "Idea"

# The smallest PDF a viewer draws a page of.
PAPER = b"""%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R
/Resources<</Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>>>>>>>endobj
4 0 obj<</Length 40>>stream
BT /F1 24 Tf 40 100 Td (WORDS) Tj ET
endstream endobj
trailer<</Root 1 0 R>>
%%EOF
"""

# The tabs of the pane in front, and which of them is in front.
TABS = r"""
(() => {
  const ws = nib.workspace
  const front = ws.tabs.find((one) => one.id === ws.activeTabId)
  const pane = front ? front.paneId : null
  const said = (one) => `${one.kind}:${one.path ?? one.name}`
  return JSON.stringify({
    strip: ws.tabs.filter((one) => one.paneId === pane).map(said),
    front: front ? said(front) : null,
  })
})()
"""


def paper(at: pathlib.Path, words: str) -> pathlib.Path:
    at.parent.mkdir(parents=True, exist_ok=True)
    at.write_bytes(PAPER.replace(b"WORDS", words.encode()))
    return at


def tabs(port: int, secret: str) -> dict[str, object]:
    said = browser.ask(port, secret, TABS)
    return said if isinstance(said, dict) else {"error": said}


def settled(port: int, secret: str, front: str, seconds: float = 60) -> dict[str, object]:
    """The strip once `front` is the tab in front, or as it is when the time is up."""

    until = time.perf_counter() + seconds
    said: dict[str, object] = {}
    while time.perf_counter() < until:
        said = tabs(port, secret)
        if str(said.get("front") or "").lower() == front.lower():
            return said
        time.sleep(0.3)
    return said


def pdfs(space: pathlib.Path) -> list[str]:
    return sorted(str(one.relative_to(space)) for one in space.rglob("*.pdf"))


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", required=True)
    parsed.add_argument("--shots", type=pathlib.Path, default=pathlib.Path(tempfile.gettempdir()))
    options = parsed.parse_args()

    browser.wipe(options.identifier)
    space = browser.spaces_root() / SPACE
    space.mkdir(parents=True)
    note = space / f"{NOTE}.md"
    note.write_text(f"# {NOTE}\n\nA note to open the space on.\n", encoding="utf-8")
    inside = paper(space / "Papers" / "Inside.pdf", "inside")

    outside_dir = pathlib.Path(tempfile.mkdtemp(prefix="nib-pdf-probe-downloads-"))
    atexit.register(shutil.rmtree, outside_dir, ignore_errors=True)
    first = paper(outside_dir / "Paper.pdf", "first")
    second = paper(outside_dir / "Second paper.pdf", "second")

    wrong: list[str] = []
    said: dict[str, object] = {}
    running: subprocess.Popen[bytes] | None = None
    try:
        # One launch to write the endpoint file and open the space, so eval can be turned
        # on and the next launch comes back to a space.
        running = run_probe(options.exe, quiet=True)
        port, secret = browser.endpoint(options.identifier, 90, running.pid)
        browser.shown(running.pid)
        browser.act(port, secret, "open", {"path": f"{NOTE}.md", "space": SPACE})
        time.sleep(3)
        if not close_app(running):
            running.terminate()
        running.wait(timeout=30)
        browser.allow_eval(options.identifier)

        # Cold: Explorer starts nib for a PDF in Downloads.
        running = run_probe(options.exe, quiet=True, args=[str(first)])
        port, secret = browser.endpoint(options.identifier, 90, running.pid)
        browser.shown(running.pid)
        landed = space / "Paper.pdf"
        cold = settled(port, secret, f"pdf:{landed}")
        said["cold"] = cold
        if str(cold.get("front") or "").lower() != f"pdf:{landed}".lower():
            wrong.append(f"a launch for a PDF did not open it in the viewer: {cold}")
        if not landed.exists() or landed.read_bytes() != first.read_bytes():
            wrong.append(f"the PDF was not copied to the top of the space: {pdfs(space)}")

        # Warm: another, while it runs.
        browser.hand_over(options.exe, str(second))
        landed_second = space / "Second paper.pdf"
        warm = settled(port, secret, f"pdf:{landed_second}")
        said["warm"] = warm
        if str(warm.get("front", "")).lower() != f"pdf:{landed_second}".lower():
            wrong.append(f"a PDF handed to the running app is not the tab in front: {warm}")

        # Again: the first paper a second time is the copy already there.
        browser.hand_over(options.exe, str(first))
        again = settled(port, secret, f"pdf:{landed}")
        said["again"] = again
        said["files"] = pdfs(space)
        if pdfs(space) != sorted([r"Papers\Inside.pdf", "Paper.pdf", "Second paper.pdf"]):
            wrong.append(f"the same paper was copied twice: {pdfs(space)}")
        if str(again.get("front", "")).lower() != f"pdf:{landed}".lower():
            wrong.append(f"the paper handed over again is not in front: {again}")

        # In a space: opened where it is.
        browser.hand_over(options.exe, str(inside))
        there = settled(port, secret, f"pdf:{inside}")
        said["inside"] = there
        if str(there.get("front", "")).lower() != f"pdf:{inside}".lower():
            wrong.append(f"a PDF in the space did not open where it is: {there}")
        if len(pdfs(space)) != 3:
            wrong.append(f"a PDF in the space was copied: {pdfs(space)}")

        # Refused: a note, and a PDF after a link's flag.
        before = tabs(port, secret)
        browser.hand_over(options.exe, str(note))
        browser.hand_over(options.exe, "--url", "https://example.invalid/", str(first))
        time.sleep(3)
        after = tabs(port, secret)
        said["refused"] = after
        pdf_tabs = [one for one in after.get("strip") or [] if str(one).startswith("pdf:")]
        if pdf_tabs != [one for one in before.get("strip") or [] if str(one).startswith("pdf:")]:
            wrong.append(f"a note or a link's command line opened a PDF: {after}")
        opened = [str(one).lower() for one in after.get("strip") or []]
        had = [str(one).lower() for one in before.get("strip") or []]
        if opened.count(f"note:{note}".lower()) > had.count(f"note:{note}".lower()):
            wrong.append(f"a note handed over on the command line was opened: {after}")

        # The view, photographed off the screen.
        browser.hand_over(options.exe, str(first))
        settled(port, secret, f"pdf:{landed}")
        hwnd = main_window(running.pid)
        if hwnd:
            sized(hwnd, 1180, 760)
        time.sleep(2.5)
        out = options.shots / "pdf-open.png"
        browser.photograph(running.pid, out)
        said["shot"] = str(out)
    finally:
        if running and running.poll() is None:
            if not close_app(running):
                running.terminate()

    for name, value in said.items():
        print(f"{name:8} {value}")
    for one in wrong:
        print(f"WRONG: {one}")
    return 1 if wrong else 0


if __name__ == "__main__":
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    sys.exit(main())
