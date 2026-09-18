"""A horizontal rule in the editor: nothing in front of it, and typeable.

Two things this drives, because they are the same line. A rule is drawn as a
hairline across the line it is on and nothing else - no dot out in the margin,
which is what the deck marker used to hang there in any note that happened to
have a rule between two paragraphs. And `---` typed one hyphen at a time stays
`---`, which smart punctuation used to eat on the second hyphen.

Builds the web app, serves `dist` statically on a port of its own, drives light
and dark, and stops everything again. Screenshots go beside it under `shots/`.

Run it from the repository root:

    python apps/desktop/test/e2e/rules.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import Browser, Page, sync_playwright

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "apps" / "desktop"
SHOTS = Path(__file__).resolve().parent / "shots" / "rules"

# A port of this run's own, above the dev server's 1420 and clear of the others.
PORT = 18895
ORIGIN = f"http://127.0.0.1:{PORT}"

PATIENCE = 40


def say(words: str) -> None:
    # A Windows console is not UTF-8, and what is reported here holds class names
    # the compiler made: anything unprintable is said as an escape rather than
    # taking the run down.
    safe = f"  {words}".encode(sys.stdout.encoding or "ascii", "backslashreplace")
    print(safe.decode(sys.stdout.encoding or "ascii"), flush=True)


def chromium() -> str:
    """The newest chromium Playwright has downloaded."""
    local = Path(os.environ["LOCALAPPDATA"]) / "ms-playwright"
    found = sorted(
        (path for path in local.glob("chromium-*/chrome-win*/chrome.exe")),
        key=lambda path: int(path.parents[1].name.split("-")[1]),
    )
    if not found:
        raise SystemExit("no chromium under %s" % local)

    return str(found[-1])


def build() -> None:
    if os.environ.get("NIB_SKIP_BUILD") == "1":
        say("reusing the build that is there")
        return

    say("building the web app")
    environment = {**os.environ, "NODE_ENV": "development"}
    built = subprocess.run(
        [shutil.which("npx") or "npx", "vite", "build", "--mode", "drive"],
        cwd=APP,
        env=environment,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if built.returncode != 0:
        raise SystemExit(f"the build failed:\n{built.stdout}\n{built.stderr}")


def wait_for(page: Page, script: str, what: str, patience: int = PATIENCE):
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(50)

    raise SystemExit(f"gave up waiting for {what}")


def fresh(browser: Browser, label: str, scheme: str) -> Page:
    context = browser.new_context(viewport={"width": 1180, "height": 760}, color_scheme=scheme)
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "() => !!window.nibApp", f"[{label}] the app to start")
    wait_for(page, "() => !!window.nibApp.workspace.activeSpace", f"[{label}] a space")
    return page


# A note with a rule between two paragraphs, which is the note the dot turned up
# in: two chunks of words with a break between them is a deck as far as the
# detector is concerned, and every rule in it wore the marker.
SEED = """
async () => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  const at = (name) => (root.endsWith('/') ? root + name : root + '/' + name)

  const text = '# Notes\\n\\nthe first thought\\n\\n---\\n\\nthe second thought\\n'
  const path = await ws.noteFrom(text, root)
  await ws.openEntry(path)
  return path
}
"""

# What the rule line is made of, and whether anything is drawn in front of it.
# The dot had no element of its own - it was a `::before` on the line - so the
# computed pseudo-style is the only place to read it.
RULE = """
() => {
  const line = document.querySelector('.cm-line:has(.nib-rule)')
  if (!line) return null

  const before = getComputedStyle(line, '::before')
  return {
    classes: line.className,
    editor: document.querySelector('.cm-editor')?.className ?? '',
    rules: [...line.querySelectorAll('.nib-rule')].length,
    content: before.content,
    width: before.width,
    height: before.height,
    radius: before.borderRadius,
    background: before.backgroundColor,
  }
}
"""

# `---` typed one hyphen at a time, straight into the document, with smart
# punctuation on: the setting is off out of the box now, and the guard has to
# hold for a reader who turned it on.
TYPED = """
async () => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  const path = await ws.noteFrom('# Deck\\n\\nthe first slide\\n\\n', root)
  await ws.openEntry(path)
  return path
}
"""


def shoot(browser: Browser, scheme: str) -> None:
    page = fresh(browser, scheme, scheme)
    try:
        say(f"[{scheme}] wrote {page.evaluate(SEED)}")
        wait_for(
            page,
            "() => !!document.querySelector('.cm-line:has(.nib-rule)')",
            f"[{scheme}] the rule",
        )
        page.wait_for_timeout(300)

        rule = page.evaluate(RULE)
        say(f"[{scheme}] the rule line: {rule}")

        # Shot before it is judged, so a run that fails leaves the picture of
        # what it saw behind it.
        box = page.locator(".cm-line:has(.nib-rule)").first.bounding_box()
        page.screenshot(
            path=str(SHOTS / f"rule-{scheme}.png"),
            clip={
                "x": max(0, box["x"] - 40),
                "y": max(0, box["y"] - 46),
                "width": min(1180, box["width"] + 80),
                "height": box["height"] + 92,
            },
        )
        say(f"[{scheme}] wrote rule-{scheme}.png")

        # The hairline is the whole of a rule. Anything drawn in front of it is
        # the marker that used to leak out of the deck styling.
        if rule["content"] not in ("none", "normal", ""):
            raise SystemExit(
                f"[{scheme}] something is drawn in front of the rule: "
                f"content={rule['content']} {rule['width']}x{rule['height']} "
                f"radius={rule['radius']} background={rule['background']}"
            )
        if rule["rules"] != 1:
            raise SystemExit(f"[{scheme}] the rule line holds {rule['rules']} hairlines")

        if scheme != "light":
            return

        # Typed rather than seeded, with the setting a reader may have turned on.
        say(f"[{scheme}] wrote {page.evaluate(TYPED)}")
        page.evaluate("() => window.nibApp.modes.punctuation || window.nibApp.modes.togglePunctuation()")
        content = page.locator(".cm-content")
        content.click()
        page.keyboard.press("Control+End")
        page.keyboard.type("---")
        page.wait_for_timeout(200)

        # The editor's own document, which is what the keystrokes landed in.
        text = page.evaluate("() => window.nib.state.doc.toString()")
        lines = [line for line in text.split("\n") if line.strip()]
        typed = lines[-1] if lines else ""
        say(f"[{scheme}] the last line reads {typed!r}")
        if typed != "---":
            raise SystemExit(f"[{scheme}] typing three hyphens gave {typed!r}, not '---'")

        # A break with nothing after it opens no second slide, so the note is
        # only a deck once the slide under the rule has words on it.
        page.keyboard.type("\n\nthe second slide\n")
        page.wait_for_timeout(300)

        written = page.evaluate("() => window.nib.state.doc.toString()")
        say(f"[{scheme}] the note now reads {written!r}")
        if "\n---\n" not in written:
            raise SystemExit(f"[{scheme}] no rule survived in {written!r}")

        # The editor class follows the tab's saved document rather than the one
        # being typed into, so it arrives a save later; what matters here is that
        # the file says `---`, which is the detector's whole input.
        worn = page.evaluate("() => !!document.querySelector('.cm-editor.nib-deck')")
        say(f"[{scheme}] the editor wears the deck class: {worn}")
    finally:
        page.context.close()


def main() -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    build()

    say(f"serving {APP / 'dist'} on {ORIGIN}")
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
        cwd=APP / "dist",
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=chromium(), headless=True)
            try:
                shoot(browser, "light")
                shoot(browser, "dark")
            finally:
                browser.close()
    finally:
        say("stopping the server")
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/T", "/F", "/PID", str(server.pid)],
                capture_output=True,
                check=False,
            )
        else:
            server.terminate()
        try:
            server.wait(timeout=20)
        except subprocess.TimeoutExpired:
            server.kill()

    print("\nthe rule is a hairline and nothing else, and it can be typed", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
