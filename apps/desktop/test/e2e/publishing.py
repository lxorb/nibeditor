"""A published page and the reading view, side by side.

One note with every construct nib renders in it - services/sync/test/everything.md -
read twice: in the app's reading view, and on the page the Worker publishes for it.
Both are the real thing. The app is the built web build; the Worker is `wrangler dev`
on workerd with the migrations applied; the space is created and published through
the same API the app calls, and the page is asked for on the hostname a blog is
served on.

Then the two are compared: the tag and class tree of each `#write`, which is the
whole of what a stylesheet has to work with. Nothing may differ except what is
written down in ALLOWED below - the page's own furniture, the metadata that became
that furniture, and the diagram this drive never drew.

The drive also lists every address the published page asked its browser for, and
fails if one of them is not this origin's: KaTeX's stylesheet and the faces an
equation is set in are the Worker's own now, so a reader of a page with maths on it
tells nobody else what they are reading. The equation's width and the faces it was
set in are printed, because a formula laid out in the reader's serif is what a
missing font looks like and it looks like nothing is wrong.

Run it from the repository root:

    python apps/desktop/test/e2e/publishing.py

Screenshots go beside this file under `shots/publishing/`, which is ignored.

The run prints a few content-security complaints about a picture and two players
it could not load. That is the page's own policy working: it allows `https:` and
nothing else, and a drive on the loopback address is `http:`. The note names files
this space does not hold anyway.
"""

from __future__ import annotations

import difflib
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from playwright.sync_api import Browser, Page, sync_playwright

ROOT = Path(__file__).resolve().parents[4]
SERVICE = ROOT / "services" / "sync"
APP = ROOT / "apps" / "desktop"
SHOTS = Path(__file__).resolve().parent / "shots" / "publishing"

# A port of this drive's own. Never 1420, which is the dev server's, and not one
# another drive already took.
PORT = 18863
ORIGIN = f"http://127.0.0.1:{PORT}"

# Every browser resolves `*.localhost` itself, so a blog's own hostname needs no
# hosts file: the Worker is told that this is the domain blogs are published under.
BLOG_ROOT = "localhost"
BLOG = f"http://field.{BLOG_ROOT}:{PORT}"

OWNER = "owner@example.com"
SPACE = "Field notes"
NOTE = "Everything.md"
OTHER = "Another note.md"
OTHER_TEXT = "# Another note\n\nThe other note itself.\n\n## Why it works\n\nBecause.\n"

FIXTURE = SERVICE / "test" / "everything.md"

PATIENCE = 60


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def npx(*args: str, cwd: Path) -> subprocess.CompletedProcess[str]:
    executable = shutil.which("npx") or shutil.which("npx.cmd")
    if not executable:
        raise SystemExit("npx is not on the path")

    return subprocess.run(
        [executable, *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )


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


def request(path: str, token: str | None = None, body: dict | None = None, method: str | None = None):
    data = None if body is None else json.dumps(body).encode()
    headers = {}
    if data is not None:
        headers["content-type"] = "application/json"
    if token:
        headers["authorization"] = f"Bearer {token}"

    call = urllib.request.Request(
        f"{ORIGIN}{path}",
        data=data,
        headers=headers,
        method=method or ("GET" if data is None else "POST"),
    )
    with urllib.request.urlopen(call, timeout=20) as answer:
        return json.loads(answer.read() or b"null")


def answering() -> bool:
    """Whether anything is listening yet. Any answer at all counts: a session
    acting as a blog serves `/health` as a note nobody published rather than as the
    API's own health, and the port is open either way."""
    try:
        urllib.request.urlopen(f"{ORIGIN}/health", timeout=5).read()
        return True
    except urllib.error.HTTPError:
        return True
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
        return False


class Worker:
    """The Worker under wrangler dev, and the local database behind it."""

    def __init__(self) -> None:
        self.process: subprocess.Popen[bytes] | None = None
        self.log = SHOTS.parent / "publishing-worker.log"
        self.opened = None

    def build(self) -> None:
        say("building the web app against the local Worker")
        # A build made `--mode drive` keeps `window.nibApp`, which is how a drive
        # opens a note without pointing at anything.
        environment = {**os.environ, "VITE_NIB_API": ORIGIN, "NODE_ENV": "development"}
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

    def clean(self) -> None:
        state = SERVICE / ".wrangler" / "state"
        if state.exists():
            say("clearing what the last run left")
            shutil.rmtree(state, ignore_errors=True)
        if self.log.exists():
            self.log.unlink()

    def migrate(self) -> None:
        say("applying the migrations to the local database")
        done = npx("wrangler", "d1", "migrations", "apply", "nib", "--local", cwd=SERVICE)
        if done.returncode != 0:
            raise SystemExit(f"the migrations failed:\n{done.stdout}\n{done.stderr}")

    def sql(self, statement: str) -> None:
        done = npx(
            "wrangler", "d1", "execute", "nib", "--local", f"--command={statement}", cwd=SERVICE
        )
        if done.returncode != 0:
            raise SystemExit(f"that query failed:\n{statement}\n{done.stdout}\n{done.stderr}")

    def start(self, upstream: str | None = None) -> None:
        """The Worker, listening on the loopback address.

        `wrangler dev` answers whatever asks it and builds the URL the Worker sees
        from the origin it was given rather than from the request's own Host
        header, so which hostname a run is *on* is decided here: without one it is
        the app and the API, and with `upstream` it is that blog. The browser talks
        to the same address either way."""
        say(f"starting the Worker on {ORIGIN}" + (f" as {upstream}" if upstream else ""))
        SHOTS.mkdir(parents=True, exist_ok=True)
        self.opened = self.log.open("wb")
        self.process = subprocess.Popen(
            [
                shutil.which("npx") or "npx",
                "wrangler",
                "dev",
                # Everything local, including the bindings wrangler would otherwise
                # reach for over the network: the account's Workers AI is not what
                # publishing a note is about, and asking for it would want a token.
                "--local",
                "--port",
                str(PORT),
                "--ip",
                "127.0.0.1",
                "--var",
                f"BLOG_ROOT:{BLOG_ROOT}",
                *(["--local-upstream", upstream] if upstream else []),
                "--show-interactive-dev-session=false",
            ],
            cwd=SERVICE,
            stdout=self.opened,
            stderr=subprocess.STDOUT,
        )

        until = time.monotonic() + 90
        while time.monotonic() < until:
            if self.process.poll() is not None:
                raise SystemExit(f"the Worker stopped before it answered:\n{self.said()}")
            if answering():
                say("the Worker is answering")
                return
            time.sleep(1)

        raise SystemExit(f"the Worker never answered:\n{self.said()}")

    def said(self) -> str:
        if self.opened:
            self.opened.flush()
        if not self.log.exists():
            return ""

        return self.log.read_text("utf-8", errors="replace")

    def stop(self) -> None:
        if not self.process:
            return

        say("stopping the Worker")
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/T", "/F", "/PID", str(self.process.pid)],
                capture_output=True,
                check=False,
            )
        else:
            self.process.terminate()

        try:
            self.process.wait(timeout=20)
        except subprocess.TimeoutExpired:
            self.process.kill()

        self.process = None
        if self.opened:
            self.opened.close()
            self.opened = None

    def account(self, email: str) -> str:
        """An account with a live session, put straight into the database: signing
        in is not what is under test here."""
        token = uuid.uuid4().hex + uuid.uuid4().hex
        digest = hashlib.sha256(token.encode()).hexdigest()
        now = int(time.time() * 1000)
        user = str(uuid.uuid4())

        self.sql(
            f"insert into users (id, email, name, created_at)"
            f" values ('{user}', '{email}', 'Ada Lovelace', {now});"
            f"insert into sessions (token_hash, user_id, created_at, expires_at)"
            f" values ('{digest}', '{user}', {now}, {now + 86_400_000});"
        )

        return token


def wait_for(page: Page, script: str, what: str, patience: int = PATIENCE):
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(100)

    raise SystemExit(f"gave up waiting for {what}")


def note_console(label: str, message) -> None:
    if message.type in ("error", "warning"):
        say(f"[{label}] {message.type}: {message.text[:200]}")


#: The tag and class tree of a rendered note, which is everything a stylesheet
#: selects on. Editor-only attributes are not read at all: only what a rule can
#: see - the element, and the classes on it.
TREE = """
() => {
  const write = document.querySelector('#write')
  if (!write) return null

  const out = []
  const walk = (node, depth) => {
    for (const child of node.children) {
      const classes = [...child.classList].sort().join('.')
      out.push('  '.repeat(depth) + child.tagName.toLowerCase() + (classes ? '.' + classes : ''))
      walk(child, depth + 1)
    }
  }

  walk(write, 0)
  return out
}
"""

# What may differ between a pane and a page, and why. Everything else is a bug.
ALLOWED = [
    "the page's own furniture: the way back, the byline, the offer to present, the footer",
    "the front matter, which became that furniture rather than a table on the page",
    "the mermaid diagram, which this drive publishes through the API rather than"
    " from the app, so nothing has drawn its picture and the fence stays code",
]

#: Where the site's own script is served from: this origin, at a path that is the
#: file's own hash, never a CDN. See services/sync/src/blog/script.ts.
OWN_SCRIPT = "/s/"

#: The one inline script a page carries, which puts the reader's theme on the root
#: before the first paint; the policy names it by its hash.
THEME_LINE = "nib:site-theme"

#: The page's own chrome, which the note has nothing to do with.
CHROME = re.compile(r"^(?:p\.back|p\.by|p\.present|footer)$")

#: The front matter as the editor draws it, which a page does not.
PROPERTIES = "div.properties"


def depth_of(line: str) -> int:
    return (len(line) - len(line.lstrip())) // 2


def trimmed(tree: list[str]) -> list[str]:
    """One `#write` as the note alone: the page's own furniture and the metadata
    rows taken off, and a diagram read as a diagram whether it was drawn or left
    as its fence."""
    out: list[str] = []
    dropping: int | None = None

    for line in tree:
        depth = depth_of(line)
        if dropping is not None:
            if depth > dropping:
                continue
            dropping = None

        bare = line.strip()
        if CHROME.match(bare) or bare == PROPERTIES:
            dropping = depth
            continue

        # The app draws the diagram and a page cannot, so both come to one line
        # here and everything around them still has to match line for line.
        if bare.startswith("figure.diagram"):
            out.append("  " * depth + "DIAGRAM")
            dropping = depth
            continue

        out.append(line)

    # The fence a page leaves a diagram as, which is a `pre` with the code in it.
    collapsed: list[str] = []
    for at, line in enumerate(out):
        after = out[at + 1] if at + 1 < len(out) else ""
        if line.strip() == "pre" and after.strip() == "code.language-mermaid":
            collapsed.append("  " * depth_of(line) + "DIAGRAM")
            continue
        if line.strip() == "code.language-mermaid":
            continue
        collapsed.append(line)

    return collapsed


#: The tallest window a screenshot is taken in. Well past any note worth reading
#: in one picture, and short of what a browser will refuse to paint.
TALLEST = 14_000


def tall(page: Page) -> None:
    """The window as tall as the note in it."""
    height = page.evaluate(
        "() => Math.ceil(document.querySelector('#write').getBoundingClientRect().height) + 120"
    )
    page.set_viewport_size({"width": 1180, "height": min(int(height), TALLEST)})
    page.wait_for_timeout(600)


def fresh(
    browser: Browser,
    label: str,
    at: str,
    token: str | None = None,
    asked: list[str] | None = None,
) -> Page:
    context = browser.new_context(viewport={"width": 1180, "height": 900})
    if token:
        context.add_init_script(f"localStorage.setItem('nib:session', {json.dumps(token)})")

    page = context.new_page()
    page.on("console", lambda message: note_console(label, message))
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    # Every address the browser asks for, in the order it asked: what proves that a
    # page fetches from its own domain or not at all. Attached before the first
    # navigation, so the page itself is in the list too.
    if asked is not None:
        page.on("request", lambda request: asked.append(request.url))
    page.goto(at, wait_until="domcontentloaded")
    return page


def main() -> int:
    if not FIXTURE.exists():
        raise SystemExit(f"the fixture is missing: {FIXTURE}")

    fixture = FIXTURE.read_text("utf-8")
    SHOTS.mkdir(parents=True, exist_ok=True)
    failures: list[str] = []

    def wrong(words: str) -> None:
        failures.append(words)
        say(f"WRONG: {words}")

    worker = Worker()
    worker.build()
    worker.clean()
    worker.migrate()
    worker.start()

    try:
        token = worker.account(OWNER)
        space = request("/v1/spaces", token=token, body={"name": SPACE})["space"]
        for path, content in ((NOTE, fixture), (OTHER, OTHER_TEXT)):
            request(f"/v1/spaces/{space['id']}/notes", token=token, body={"path": path, "content": content})

        request(
            f"/v1/spaces/{space['id']}/blog",
            token=token,
            body={"subdomain": "field"},
            method="PUT",
        )
        say(f"the space is published at {BLOG}")

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=chromium())
            try:
                # ── The note in the app ──────────────────────────────────
                app = fresh(browser, "app", ORIGIN, token=token)
                wait_for(app, "() => !!window.nibApp", "the app to start")
                app.evaluate("() => window.nibApp.theme.setScheme('light')")

                folder = wait_for(
                    app,
                    "() => {"
                    "  const found = window.nibApp.workspace.spaces.find("
                    f"    (one) => window.nibApp.sync.remoteIdFor(one.root) === {json.dumps(space['id'])});"
                    "  return found ? found.name : null"
                    "}",
                    "the space to arrive in the app",
                )
                app.evaluate(
                    "(name) => {"
                    "  const space = window.nibApp.workspace.spaces.find((one) => one.name === name);"
                    "  if (space) window.nibApp.workspace.showSpace(space.id)"
                    "}",
                    folder,
                )

                listed = (
                    "() => {"
                    "  const walk = (entry) => (entry ? [entry.path, ...(entry.children ?? []).flatMap(walk)] : []);"
                    "  const paths = walk(window.nibApp.workspace.tree);"
                    f"  return paths.includes('/{folder}/{NOTE}') && paths.includes('/{folder}/{OTHER}')"
                    "}"
                )
                wait_for(app, listed, "both notes to arrive in the app")

                # The space, read through. A space is read when it is opened, and
                # these notes arrived from the Worker after that - so this is the
                # state a reader is in who opens a space that already has notes.
                app.evaluate(
                    "(name) => {"
                    "  const space = window.nibApp.workspace.spaces.find((one) => one.name === name);"
                    "  return space ? window.nibApp.links.build(space.root) : null"
                    "}",
                    folder,
                )
                # The space has to have been read before the note is: a wikilink
                # points at a note the index knows about, and the reading view is
                # drawn once. See link-index.svelte.ts.
                wait_for(
                    app,
                    "() => window.nibApp.links"
                    f"  .index('/{folder}/{NOTE}').notes"
                    f"  .some((one) => one.name === {json.dumps(OTHER.replace('.md', ''))})",
                    "the space to be read through",
                )

                app.evaluate(f"() => window.nibApp.workspace.open('/{folder}/{NOTE}')")
                wait_for(app, "() => !!document.querySelector('.cm-content')", "the editor")

                app.evaluate("() => window.nibApp.workspace.toggleReading()")
                wait_for(app, "() => !!document.querySelector('#write .callout')", "the reading view")
                # The diagram drawers load on the first render of a note.
                app.wait_for_timeout(1500)

                reading = app.evaluate(TREE)
                if not reading:
                    raise SystemExit("the reading view rendered nothing")
                app.screenshot(path=str(SHOTS / "reading-pane.png"))
                # The whole note in one picture. The app pins the window and
                # scrolls the pane inside it, so nothing stitches a tall shot
                # together here: the window is made as tall as the note instead.
                tall(app)
                app.locator("#write").screenshot(path=str(SHOTS / "reading.png"))
                say(f"the reading view is drawn: {len(reading)} elements")

                # ── The same note, published ─────────────────────────────
                # The session is started again as the blog's own hostname, which is
                # how the Worker is asked for a published page; the space and its
                # notes are on disk from the run above. The browser still talks to
                # the loopback address, so the page's own links resolve.
                app.close()
                worker.stop()
                worker.start(upstream=f"field.{BLOG_ROOT}")

                asked: list[str] = []
                page = fresh(browser, "page", f"{ORIGIN}/everything", asked=asked)
                page.wait_for_selector("#write .callout", timeout=15_000)
                page.wait_for_timeout(500)

                # ── What the page fetched, and from whom ─────────────────
                # A face is fetched when something on the page is set in it, so the
                # equations have to be drawn before the list is read.
                page.evaluate("async () => { await document.fonts.ready }")
                elsewhere = sorted({url for url in asked if not url.startswith(ORIGIN)})
                say(f"the page asked for {len(asked)} addresses:")
                for url in sorted(set(asked)):
                    say(f"  {url[len(ORIGIN) :] if url.startswith(ORIGIN) else url}")
                if elsewhere:
                    wrong(f"the published page fetched from elsewhere: {', '.join(elsewhere)}")

                # And the maths is drawn in KaTeX's own faces, served from here: a
                # formula laid out in the reader's serif is what a missing font
                # looks like, and it looks like nothing is wrong.
                faces = page.evaluate(
                    "() => [...document.fonts]"
                    "  .filter((one) => one.family.startsWith('KaTeX_') && one.status === 'loaded')"
                    "  .map((one) => one.family).sort()"
                )
                drawn = page.evaluate(
                    "() => {"
                    "  const found = document.querySelector('#write .katex-display .katex');"
                    "  return found ? Math.round(found.getBoundingClientRect().width) : 0"
                    "}"
                )
                if not faces:
                    wrong("the published page drew its maths without any KaTeX face")
                elif not drawn:
                    wrong("the published page drew no block equation")
                else:
                    say(f"the equation is {drawn}px wide, set in {', '.join(faces)}")

                published = page.evaluate(TREE)
                if not published:
                    raise SystemExit("the published page rendered nothing")
                page.screenshot(path=str(SHOTS / "published-page.png"), full_page=True)
                page.locator("#write").screenshot(path=str(SHOTS / "published.png"))
                say(f"the published page is drawn: {len(published)} elements")

                # ── The same page, dark ─────────────────────────────────
                # A published page has nobody to ask which theme they are in and
                # no script to ask with, so it reads the browser's own answer.
                light = page.evaluate("() => getComputedStyle(document.body).backgroundColor")
                night = browser.new_context(viewport={"width": 1180, "height": 900}, color_scheme="dark")
                after = night.new_page()
                after.goto(f"{ORIGIN}/everything", wait_until="domcontentloaded")
                after.wait_for_selector("#write .callout", timeout=15_000)
                tall(after)
                after.locator("#write").screenshot(path=str(SHOTS / "published-dark.png"))

                if after.evaluate("() => getComputedStyle(document.body).backgroundColor") == light:
                    wrong("the published page is the same colour in the dark as in the light")
                night.close()

                # ── The same page? ──────────────────────────────────────
                one = trimmed(reading)
                other = trimmed(published)

                if one != other:
                    diff = [
                        line
                        for line in difflib.unified_diff(one, other, "reading", "published", n=2, lineterm="")
                        if line.strip()
                    ]
                    (SHOTS / "difference.txt").write_text("\n".join(diff), "utf-8")
                    wrong(f"the two differ in {sum(1 for line in diff if line[:1] in '+-') - 2} places")
                    for line in diff[:40]:
                        say(line)
                else:
                    say(f"the same {len(one)} elements, in the same order, with the same classes")

                for note in ALLOWED:
                    say(f"allowed: {note}")

                # Whose code runs on the page. It used to be nobody's: a published note
                # carried no script at all. A site has a search box, a tree, contents,
                # backlinks and a picture of the space now, and the theme is set before
                # the first paint by one inline line the policy names by its hash - so
                # what is checked is not that nothing runs but that only this site's own
                # does. See services/sync/src/blog/script.ts and shell.ts.
                carried = page.evaluate(
                    """() => [...document.querySelectorAll('script')].map((one) => ({
                         src: one.getAttribute('src') ?? '',
                         kind: one.getAttribute('type') ?? '',
                         words: (one.textContent ?? '').trim(),
                       }))"""
                )
                for one in carried:
                    # The picture of the space arrives as data in a tag of its own,
                    # which is read rather than run.
                    if one["kind"] == "application/json":
                        say("allowed: the graph's own data, which is not code")
                    elif one["src"]:
                        if one["src"].startswith(OWN_SCRIPT):
                            say(f"allowed: the site's own script at {one['src']}")
                        else:
                            wrong(f"the published page carries somebody else's script: {one['src']!r}")
                    elif THEME_LINE in one["words"]:
                        say("allowed: the one inline line that sets the theme before the first paint")
                    else:
                        wrong(f"the published page carries an inline script: {one['words'][:80]!r}")
                if not page.evaluate(
                    "() => [...document.styleSheets].some((one) => (one.href ?? '').includes('/s/'))"
                ):
                    wrong("the published page is not wearing the app's stylesheet")
            finally:
                browser.close()
    finally:
        worker.stop()

    if failures:
        print("\nFAILED", flush=True)
        for one in failures:
            print(f"  - {one}", flush=True)
        return 1

    print(
        f"\na published note is the note: {SHOTS / 'reading.png'} beside {SHOTS / 'published.png'}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
