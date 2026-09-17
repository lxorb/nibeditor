"""Publishing, against the real Worker: which notes, what will change, where a
page lives, what its head says, what a reader is given besides the note, and a
site behind a password.

Two halves, because `wrangler dev` builds the URL the Worker sees from the origin
it was given rather than from the request's Host header - so a run is either the
API or one blog, and this restarts the Worker between the two. The database is the
same either way, which is what makes that honest: the site the second half asks
for is the site the first half published.

    the sheet     a folder made private, and what the sheet says will change
    the pages     what the hostname serves and what it does not
    the paths     a permalink, an alias, and the redirect a rename leaves
    the machines  the sitemap, both feeds, robots and the favicon
    the way round the tree, the contents, what links here, previous and next
    the searching a word, a phrase, a refusal, a tag, a folder, and a draft
    the forms     an answer taken on the page and read back on the account
    the diagrams  a mermaid fence the app drew, as a picture on the page
    the dressing  publish.css, and a counter named in the policy
    the browser   the graph painted, the slash, the theme, and a hover card
    the password  the form, a wrong word, the right one, and the note behind it

Run it from the repository root:

    python apps/desktop/test/e2e/site.py

Screenshots go beside this file under `shots/site/`, which is ignored.
"""

from __future__ import annotations

import hashlib
import json
import re
import os
import shutil
import subprocess
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from xml.etree import ElementTree

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "apps" / "desktop"
SERVICE = ROOT / "services" / "sync"
SHOTS = APP / "test" / "e2e" / "shots" / "site"

# In this drive's own band, and not a port any other drive here uses: several of
# these run at once, in worktrees of their own, against Workers of their own.
PORT = 20841
ORIGIN = f"http://127.0.0.1:{PORT}"

# Every browser resolves `*.localhost` itself, so a blog's own hostname needs no
# hosts file: the Worker is told that this is the domain blogs are published under.
BLOG_ROOT = "localhost"
BLOG_HOST = f"field.{BLOG_ROOT}"
BLOG = f"http://{BLOG_HOST}:{PORT}"

EMAIL = "site-drive@example.com"
PASSWORD = "the quiet part"

PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)
DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

#: The notes the site is made of. Everything the rules and the front matter have
#: to be right about, and nothing else.
NOTES = {
    "Public/One.md": (
        "---\norder: 1\ntags:\n  - fieldwork\n---\n\n# One\n\n"
        "The first words of it, about mycology.\n\n![a shot](/i/abc123.png)\n\n"
        "## A heading\n\nSomething under it.\n\n## Another heading\n\nAnd under that.\n\n"
        "### Deeper\n\nA link to [[Pinned]] and to [[Public/Two]].\n"
    ),
    "Public/Two.md": (
        "---\ndate: 2026-05-06\ndescription: The second one.\norder: 2\n---\n\n"
        "# Two\n\nMore about mycology, and a link back to [[Public/One]].\n"
    ),
    "Public/Diagram.md": (
        "---\norder: 3\n---\n\n# A diagram\n\nHow a note reaches a page.\n\n"
        "```mermaid\ngraph TD\n  A[A note] --> B[The reading view]\n"
        "  A --> C[A published page]\n```\n"
    ),
    "Drafts/Three.md": "# Three\n\nNot ready, and secretly about mycology.\n",
    "Quiet.md": "---\npublish: false\n---\n\n# Quiet\n\nNever on the site.\n",
    "Pinned.md": "---\npermalink: pinned/here\naliases:\n  - old-pin\n---\n\n# Pinned\n",
    "Moved.md": "# Moved\n\nThis note is about to be renamed.\n",
    "Say hello.md": (
        "# Say hello\n\nTell me what you think.\n\n"
        "```form\ntitle: Say hello\nsend: Send it\nfields:\n"
        "  - * Your name\n  - Your email: email\n  - What you want to say: lines\n```\n"
    ),
}


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def npx(*args: str, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [shutil.which("npx") or "npx", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )


def request(path: str, token: str | None = None, body: object = None, method: str | None = None):
    data = None if body is None else json.dumps(body).encode()
    ask = urllib.request.Request(f"{ORIGIN}{path}", data=data, method=method)
    if token:
        ask.add_header("authorization", f"Bearer {token}")
    if data is not None:
        ask.add_header("content-type", "application/json")

    try:
        with urllib.request.urlopen(ask, timeout=30) as answer:
            said = answer.read().decode()
            return json.loads(said) if said else {}
    except urllib.error.HTTPError as refused:
        said = refused.read().decode()
        return {"status": refused.code, **(json.loads(said) if said else {})}


class Answer:
    """One answer from the site: what it said, and how."""

    def __init__(self, status: int, text: str, headers) -> None:
        self.status = status
        self.text = text
        self.headers = headers


class Straight(urllib.request.HTTPRedirectHandler):
    """A redirect is an answer here rather than a step on the way to one."""

    def redirect_request(self, *_args):
        return None


def site(
    path: str,
    data: bytes | None = None,
    opener=None,
    follow: bool = True,
    cookie: str = "",
) -> Answer:
    """The blog. Asked for on the loopback address, because a browser resolves
    `*.localhost` by itself and Python does not - and it makes no difference:
    `wrangler dev` was told which origin it is answering as, so the Worker sees
    the blog's hostname whatever address the request arrived on."""
    ask = urllib.request.Request(f"{ORIGIN}{path}", data=data)
    if data is not None:
        ask.add_header("content-type", "application/x-www-form-urlencoded")
    if cookie:
        ask.add_header("cookie", cookie)

    if opener is None and not follow:
        opener = urllib.request.build_opener(Straight)

    open_it = opener.open if opener else urllib.request.urlopen
    try:
        with open_it(ask, timeout=30) as answer:
            return Answer(answer.status, answer.read().decode("utf-8", "replace"), answer.headers)
    except urllib.error.HTTPError as refused:
        return Answer(refused.code, refused.read().decode("utf-8", "replace"), refused.headers)


def answering() -> bool:
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
        self.log = SHOTS / "worker.log"
        self.opened = None

    def build(self) -> None:
        say("building the app against the local Worker")
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

    def migrate(self) -> None:
        say("applying the migrations")
        done = npx("wrangler", "d1", "migrations", "apply", "nib", "--local", cwd=SERVICE)
        if done.returncode != 0:
            raise SystemExit(f"the migrations failed:\n{done.stdout}\n{done.stderr}")

        # The four publishing carries: the note's front matter and the site's
        # own block, then the search index and the answers a form takes. By file
        # name, because a bare number is in every hash the output prints.
        wanted = ("0029_note_front", "0030_space_site", "0031_site_search", "0032_form_answers")
        named = [one for one in wanted if one in done.stdout]
        say(f"{len(named)} of the four publishing migrations named")

    def sql(self, statement: str) -> str:
        done = npx(
            "wrangler", "d1", "execute", "nib", "--local", f"--command={statement}", cwd=SERVICE
        )
        if done.returncode != 0:
            raise SystemExit(f"that query failed:\n{statement}\n{done.stdout}\n{done.stderr}")

        return done.stdout

    def start(self, upstream: str | None = None) -> None:
        say(f"the Worker on {ORIGIN}" + (f", answering as {upstream}" if upstream else ""))
        SHOTS.mkdir(parents=True, exist_ok=True)
        self.opened = self.log.open("ab")
        self.process = subprocess.Popen(
            [
                shutil.which("npx") or "npx",
                "wrangler",
                "dev",
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

        until = time.monotonic() + 150
        while time.monotonic() < until:
            if self.process.poll() is not None:
                raise SystemExit(f"the Worker stopped before it answered:\n{self.said()}")
            if answering():
                say("it is answering")
                return
            time.sleep(1)

        raise SystemExit(f"the Worker never answered:\n{self.said()}")

    def said(self) -> str:
        if self.opened:
            self.opened.flush()

        return self.log.read_text("utf-8", errors="replace") if self.log.exists() else ""

    def stop(self) -> None:
        if not self.process:
            return

        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(self.process.pid)],
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

    def account(self) -> str:
        """An account with a live session, put straight into the database: signing
        in is not what this is about."""
        token = uuid.uuid4().hex + uuid.uuid4().hex
        digest = hashlib.sha256(token.encode()).hexdigest()
        now = int(time.time() * 1000)
        user = str(uuid.uuid4())

        self.sql(
            f"insert into users (id, email, name, created_at)"
            f" values ('{user}', '{EMAIL}', 'Ada Lovelace', {now});"
            f"insert into sessions (token_hash, user_id, created_at, expires_at, id, name,"
            f" last_used_at) values ('{digest}', '{user}', {now}, {now + 86400000},"
            f" '{uuid.uuid4().hex[:16]}', 'the drive', {now});"
        )

        return token


def opened(browser, name: str, width: int, height: int, agent: str, finger: bool, token: str):
    context = browser.new_context(
        viewport={"width": width, "height": height},
        user_agent=agent,
        has_touch=finger,
        is_mobile=finger,
        color_scheme="light" if finger else "dark",
        device_scale_factor=2,
    )
    context.add_init_script(f"try {{ localStorage.setItem('nib:session', '{token}') }} catch {{}}")

    page = context.new_page()
    page.set_default_timeout(20000)
    page.on("pageerror", lambda error: say(f"[{name}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.nibApp", timeout=60000)
    page.wait_for_function("() => !!window.nibApp.workspace.activeSpace", timeout=60000)

    # A browser that has been introduced and then had its own notes erased, which
    # is what somebody who wants only what the account holds arrives as. The same
    # opening as first-sync.py, and the reason is the same: a device with a space
    # of its own has two spaces after signing in, and which one is "the space" is
    # then a question this drive should not have to ask.
    page.evaluate("async () => await window.nibApp.workspace.eraseLocalSpaces()")
    page.wait_for_function("() => window.nibApp.workspace.spaces.length === 0", timeout=60000)
    page.reload(wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.nibApp", timeout=60000)
    page.wait_for_function("() => !!window.nibApp.account.user", timeout=60000)

    return context, page


def sheet(browser, out: Path, token: str, name: str, width, height, agent, finger) -> None:
    """The publish sheet: the rules, what they would change, and Publish."""
    context, page = opened(browser, name, width, height, agent, finger, token)

    def shot(tag: str) -> None:
        page.screenshot(path=str(out / f"{name}-{tag}.png"))
        say(f"shot {name}-{tag}.png")

    # The space the account holds, once this device has it and its notes.
    try:
        page.wait_for_function(
            f"() => window.nibApp.workspace.notes.length >= {len(NOTES)}", timeout=60000
        )
    except Exception:
        say(f"[{name}] still waiting: {page.evaluate('''() => ({
          spaces: window.nibApp.workspace.spaces.map((one) => one.name),
          notes: window.nibApp.workspace.notes.length,
          sync: window.nibApp.sync.status,
          error: window.nibApp.sync.lastError,
        })''')}")
        raise
    space = page.evaluate("() => window.nibApp.workspace.spaces[0]")
    say(f"[{name}] the device holds {space['name']} with its notes")

    page.evaluate("() => window.nibApp.publish.show(window.nibApp.workspace.spaces[0])")
    page.wait_for_timeout(600)
    page.evaluate("() => (window.nibApp.publish.confirmed = true)")
    page.evaluate("() => window.nibApp.publish.typeSubdomain('field')")

    # Drafts out, which is the whole of what a folder rule is.
    page.evaluate("() => window.nibApp.publish.rule('exclude', 'Drafts', true)")
    page.evaluate("async () => await window.nibApp.publish.askChanges()")
    page.wait_for_timeout(500)

    changes = page.evaluate("() => window.nibApp.publish.changes")
    say(f"[{name}] the sheet says: {changes}")

    rows = page.evaluate(
        """() => [...document.querySelectorAll('.changed li')].map((one) => one.textContent.trim())"""
    )
    said = page.evaluate(
        """() => [...document.querySelectorAll('.note')].map((one) => one.textContent.replace(/\\s+/g, ' ').trim())"""
    )
    say(f"[{name}] and shows {said} {rows}")
    shot("sheet")

    # The one button the sheet exists for, in view rather than under the fold. The
    # form is longer than the sheet on every screen, and it used to sit at the end
    # of the body that scrolls: the sheet ended with a clean edge and nothing said
    # there was a Publish below it. It is in the sheet's own foot now; see
    # Sheet.svelte.
    where = page.evaluate(
        """() => {
          const sheet = document.querySelector('[role=dialog]')
          const go = document.querySelector('button.go')
          if (!sheet || !go) return null
          const box = go.getBoundingClientRect()
          const frame = sheet.getBoundingClientRect()
          return {
            inSheet: box.top >= frame.top - 1 && box.bottom <= frame.bottom + 1,
            inWindow: box.bottom <= innerHeight + 1 && box.top >= 0,
            height: Math.round(box.height),
          }
        }"""
    )
    say(f"[{name}] the Publish button sits at {where}")
    if not where or not where["inSheet"] or not where["inWindow"] or where["height"] < 20:
        say(f"FAILED: [{name}] the Publish button is not in view: {where}")

    page.evaluate("() => window.nibApp.publish.description = 'Notes from the field.'")
    # The button rather than the store, because the icon the site wears is read
    # off the mark the sheet has drawn; see site-icon.ts.
    page.click("button.go")
    page.wait_for_timeout(2500)

    live = page.evaluate("() => window.nibApp.publish.blog")
    say(f"[{name}] published: enabled={live['enabled']} at {live['subdomain']} rules={live['site']['rules']}")
    shot("published")

    # And the diagrams, which the app draws with the real mermaid in this real
    # browser and sends up as pictures: the Worker has no DOM to draw one in. What
    # this device has already sent is written down under the space, so that is what
    # says it happened; see apps/desktop/src/lib/site-diagrams.ts.
    drawn = []
    until = time.monotonic() + 40
    while time.monotonic() < until:
        drawn = page.evaluate(
            """() => {
              const id = window.nibApp.publish.spaceId
              try { return JSON.parse(localStorage.getItem(`nib:diagrams:${id}`) ?? '[]') } catch { return [] }
            }"""
        )
        if drawn:
            break
        page.wait_for_timeout(500)

    say(f"[{name}] the app drew and sent {len(drawn)} pictures for its one diagram")

    # The two panes P10 left behind, on the way past: the design pass measured
    # them and this is where they are looked at.
    for section in ["sync", "account"]:
        page.evaluate("() => window.nibApp.publish.close()")
        page.evaluate(f"() => window.nibApp.settings.show('{section}')")
        # The sheet is fetched the first time it is asked for rather than carried into
        # the first paint; what is measured below is what a thumb lands on, and a
        # sheet that is not there yet has nothing to land on. See surfaces.svelte.ts.
        page.wait_for_selector(".nib-screen.sheet", timeout=15000)
        page.wait_for_timeout(900)
        shot(section)

        # And measured, on the phone, where the floor is a platform rule rather
        # than a preference: everything a thumb lands on clears --touch-target.
        if finger:
            small = page.evaluate(
                """() => {
                  const floor = parseFloat(
                    getComputedStyle(document.documentElement).getPropertyValue('--touch-target'),
                  )
                  return [...document.querySelectorAll('.sheet button, .sheet input, .sheet select')]
                    .filter((one) => {
                      const box = one.getBoundingClientRect()
                      return box.width > 0 && box.height > 0 && box.height < floor - 0.5
                    })
                    .map((one) => `${one.tagName.toLowerCase()}.${one.className} ${Math.round(one.getBoundingClientRect().height)}px`)
                }"""
            )
            say(f"[{name}] {section}: {len(small)} targets under the floor {small[:4]}")

    context.close()


def pages(worker: Worker, token: str, space: str) -> None:
    """What the hostname serves, once the Worker is answering as the blog."""
    index = site("/")
    listed = sorted(set(re.findall(r"<span>([^<]+)</span>", index.text)))
    say(f"the index lists: {listed}")

    for path, wanted in [
        ("/public/one", 200),
        ("/public/two", 200),
        ("/drafts/three", 404),
        ("/quiet", 404),
        ("/pinned/here", 200),
        ("/old-pin", 200),
        ("/moved", 200),
    ]:
        answer = site(path)
        say(f"{path} answers {answer.status} (wanted {wanted})")

    head = site("/public/one").text
    for what in ['<meta name="description"', 'property="og:image"', 'rel="canonical"', 'rel="alternate"']:
        say(f"the head of /public/one has {what}: {what in head}")

    # A rename, through the API, and the path it used to live at.
    notes = request(f"/v1/spaces/{space}/changes?since=0", token).get("notes", [])
    moved = next((one for one in notes if one["path"] == "Moved.md"), None)
    if moved:
        request(
            f"/v1/notes/{moved['id']}",
            token,
            {"path": "Moved along.md", "content": "# Moved\n\nRenamed.\n", "baseVersion": moved["version"]},
            method="PUT",
        )
        was = site("/moved", follow=False)
        say(f"after the rename /moved answers {was.status} to {was.headers.get('location')}")
        say(f"and /moved-along answers {site('/moved-along').status}")

    feed = site("/feed.xml")
    order = [one for one in ["<title>Two</title>", "<title>One</title>"] if one in feed.text]
    say(f"the feed is {feed.headers.get('content-type')} and reads {order}")
    say(f"it carries the summaries: {'<summary>The second one.</summary>' in feed.text}")

    # And the same writing as RSS, which is the word a reader pastes into a reader.
    # Both parsed rather than grepped: a feed a reader cannot parse is a feed nobody
    # has, and Python has an XML parser in the standard library.
    rss = site("/rss.xml")
    order = [one for one in ["<title>Two</title>", "<title>One</title>"] if one in rss.text]
    say(f"the RSS feed is {rss.headers.get('content-type')} and reads {order}")
    say(f"it carries the summaries: {'<description>The second one.</description>' in rss.text}")

    for what, said in (("the feed", feed.text), ("the RSS feed", rss.text)):
        try:
            ElementTree.fromstring(said)
            say(f"{what} parses as XML")
        except ElementTree.ParseError as why:
            say(f"{what} does NOT parse: {why}")

    one = site("/public/one")
    say(
        "a page names both feeds:"
        f" {'type=\"application/atom+xml\"' in one.text and 'href=\"/rss.xml\"' in one.text}"
    )

    sitemap = site("/sitemap.xml")
    say(f"the sitemap lists {sitemap.text.count('<loc>')} pages and no drafts: {'/drafts/' not in sitemap.text}")
    say(f"and both feeds: {'/feed.xml</loc>' in sitemap.text and '/rss.xml</loc>' in sitemap.text}")

    robots = site("/robots.txt")
    say(f"robots says: {robots.text.strip().splitlines()}")

    icon = site("/favicon.svg")
    say(f"the favicon is {icon.headers.get('content-type')}, {len(icon.text)} bytes")


def furniture() -> None:
    """The bar, the tree, the contents, what links here, and where to go next."""
    one = site("/public/one")

    for what, wanted in [
        ("the search box", 'name="q"'),
        ("the theme button", 'class="theme"'),
        ("the page tree", 'class="pages"'),
        ("the contents beside it", 'class="toc-aside"'),
        ("what links here", "Linked from"),
        ("it lined up under the note", 'class="under"'),
        ("previous and next", 'class="around"'),
        ("a small graph", 'class="graph"'),
        ("the site script", "/s/"),
    ]:
        say(f"a page carries {what}: {wanted in one.text}")

    say(f"the tree marks the page: {'aria-current' in one.text}")
    say(f"and opens the folder it is in: {'<details open><summary>Public' in one.text}")

    headings = re.findall(r'<a href="#([^"]+)"', one.text)
    say(f"the contents list: {headings[:4]}")

    linked = re.search(r'class="linked".*?</nav>', one.text, re.S)
    say(f"linked from: {sorted(set(re.findall(r'>([^<>]+)</a>', linked.group(0) if linked else '')))}")

    say(f"previous and next: {re.findall(r'class=.(before|after). href=.([^\"]+).', one.text)}")

    graph = site("/graph")
    nodes = re.findall(r'"name":"([^"]+)"', graph.text)
    say(f"the graph page names: {sorted(set(nodes))}")


def searching() -> None:
    """The box, answered by the index over the published pages only."""
    for query, what in [
        ("mycology", "a word two pages share"),
        ("%22first+words%22", "a phrase"),
        ("mycology+-back", "a word refused"),
        ("tag:fieldwork", "a tag"),
        ("path:public", "a folder"),
        ("nothing-matches-this", "a word nobody wrote"),
    ]:
        answer = site(f"/search?q={query}")
        found = re.findall(r'class="what">([^<]+)<', answer.text)
        say(f"{what} ({query}): {found}")

    say(f"a private note is never an answer: {'Three' not in site('/search?q=mycology').text}")


def forms(token: str, space: str) -> None:
    """A form on the page, answered by a reader and read back on the account."""
    page = site("/say-hello")
    action = re.search(r'action="/form/([^"]+)"', page.text)
    say(f"the form posts to the note that asked: {bool(action)}")
    if not action:
        return

    note = action.group(1)
    sent = site(
        f"/form/{note}",
        data=b"your-name=Ada&your-email=ada%40example.com&what-you-want-to-say=Hello+there",
        follow=False,
    )
    say(f"an answer lands: {sent.status} to {sent.headers.get('location')}")
    say(f"and the page says so: {'Thank you' in site(f'/say-hello?sent={note}').text}")

    refused = site(f"/form/{note}", data=b"your-email=ada%40example.com", follow=False)
    say(f"a question it needs is refused: {'wrong=' in (refused.headers.get('location') or '')}")

    held = request(f"/v1/spaces/{space}/answers", token)
    say(f"the account holds: {[row['answers'] for row in held.get('answers', [])]}")


def diagrams() -> list[str]:
    """A mermaid fence as a picture on the page.

    Nothing here draws anything: the app drew both pictures in the half above and
    sent them up, and what the Worker does is write an `<img>` where the fence
    stood. Answers the two addresses, for the browser pass below."""
    page = site("/public/diagram")
    figure = re.search(r'<figure class="diagram"[^>]*>(.*?)</figure>', page.text, re.S)
    say(f"the page carries a figure rather than a fence: {bool(figure)}")
    say(f"and nothing is left as code: {'language-mermaid' not in page.text}")

    if not figure:
        return []

    inside = figure.group(1)
    sources = re.findall(r'src="([^"]+)"', inside)
    say(f"it names {len(sources)} pictures, for {re.findall(r'data-scheme="([^"]+)"', inside)}")
    say(f"with alt text: {re.findall(r'alt="([^"]*)"', inside)}")

    for src in sources:
        answer = site(src)
        say(
            f"{src} answers {answer.status} as {answer.headers.get('content-type')},"
            f" {len(answer.text)} bytes, {answer.headers.get('cache-control')}"
        )
        say(f"  and is allowed: {answer.headers.get('content-security-policy')}")
        say(f"  it has a size of its own: {re.findall(r'<svg[^>]*?(width=\"[^\"]+\")', answer.text)}")
        say(f"  and no script in it: {'<script' not in answer.text}")

    policy = page.headers.get("content-security-policy") or ""
    allowed = "img-src 'self'" in policy
    say(f"and the policy lets the page show its own pictures: {allowed}")

    return sources


def dressing(token: str, space: str) -> None:
    """The author's own stylesheet, and a counter's script."""
    css = b"#write{--nib-drive:1}"
    digest = hashlib.sha256(css).hexdigest()

    put = urllib.request.Request(
        f"{ORIGIN}/v1/blobs/{digest}",
        data=css,
        method="PUT",
        headers={"authorization": f"Bearer {token}", "content-type": "text/css"},
    )
    with urllib.request.urlopen(put, timeout=30) as answer:
        answer.read()

    request(
        f"/v1/spaces/{space}/files",
        token,
        {"files": [{"path": "publish.css", "hash": digest}]},
        method="PUT",
    )
    request(
        f"/v1/spaces/{space}/site",
        token,
        {"analytics": {"url": "https://plausible.io/js/script.js", "domain": BLOG_HOST}},
        method="PUT",
    )

    one = site("/public/one")
    policy = one.headers.get("content-security-policy") or ""
    say(f"the author's own stylesheet is linked: {f'/i/{digest}.css' in one.text}")
    say(f"the counter is loaded: {'plausible.io/js/script.js' in one.text}")
    say(f"and named in the policy: {'https://plausible.io' in policy}")
    say(f"the scripts are the site's own: {'script-src ' in policy}")


def drawn(browser, out: Path) -> None:
    """The diagram on the page, in a browser, both ways round.

    The whole point of the design is here: a picture per scheme, and the one shown
    follows both the reader's system and the button in the bar. And a page with a
    diagram on it still asks nobody but this site for anything, which is why the
    drawing is a blob of the author's rather than a library from a CDN."""
    context = browser.new_context(
        viewport={"width": 1000, "height": 900},
        user_agent=DESKTOP_AGENT,
        device_scale_factor=2,
    )
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"[drawn] page error: {error}"))

    asked: list[str] = []
    page.on("request", lambda one: asked.append(one.url))

    #: Which picture the browser is actually showing, and whether it arrived.
    SHOWING = """() => [...document.querySelectorAll('.diagram img')].map((one) => ({
      scheme: one.dataset.scheme ?? 'both',
      shown: getComputedStyle(one).display !== 'none',
      width: one.naturalWidth,
      height: one.naturalHeight,
    }))"""

    for scheme in ["light", "dark"]:
        page.emulate_media(color_scheme=scheme)
        page.goto(f"{ORIGIN}/public/diagram", wait_until="load")
        page.wait_for_timeout(800)

        say(f"[drawn] with the system on {scheme}: {page.evaluate(SHOWING)}")
        page.screenshot(path=str(out / f"site-diagram-{scheme}.png"))
        say(f"shot site-diagram-{scheme}.png")

    # And the reader's own word, which is the case a `prefers-color-scheme` inside
    # the picture could never have answered: the system says dark, the button says
    # light, and the light picture is the one on the page.
    page.click("button.theme")
    page.wait_for_timeout(300)
    while page.evaluate("() => document.documentElement.dataset.theme") != "light":
        page.click("button.theme")
        page.wait_for_timeout(300)

    say(f"[drawn] with the system on dark and the button on light: {page.evaluate(SHOWING)}")
    page.screenshot(path=str(out / "site-diagram-chosen.png"))
    say("shot site-diagram-chosen.png")

    elsewhere = sorted({one for one in asked if not one.startswith(ORIGIN)})
    say(f"[drawn] it asked {len(asked)} times, and nobody but this site: {elsewhere or 'nobody'}")

    context.close()


def looking(browser, out: Path) -> None:
    """The site itself, in a browser, on a desktop and a phone."""
    for name, width, height, agent, finger in [
        ("site-desktop", 1440, 900, DESKTOP_AGENT, False),
        ("site-phone", 390, 844, PHONE_AGENT, True),
    ]:
        context = browser.new_context(
            viewport={"width": width, "height": height},
            user_agent=agent,
            has_touch=finger,
            is_mobile=finger,
            color_scheme="light" if finger else "dark",
            device_scale_factor=2,
        )
        page = context.new_page()
        page.on("pageerror", lambda error: say(f"[{name}] page error: {error}"))
        page.goto(f"{ORIGIN}/public/one", wait_until="load")
        page.wait_for_timeout(1200)

        page.screenshot(path=str(out / f"{name}-page.png"))
        say(f"shot {name}-page.png")

        # The graph, which is the app's own layout painting on a canvas.
        page.goto(f"{ORIGIN}/graph", wait_until="load")
        page.wait_for_timeout(2500)
        drawn = page.evaluate(
            """() => {
              const canvas = document.querySelector('.graph canvas')
              if (!canvas) return null
              const context = canvas.getContext('2d')
              const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
              let painted = 0
              for (let at = 3; at < pixels.length; at += 4) if (pixels[at] > 0) painted++
              return { width: canvas.width, painted }
            }"""
        )
        say(f"[{name}] the graph painted: {drawn}")
        page.screenshot(path=str(out / f"{name}-graph.png"))
        say(f"shot {name}-graph.png")

        # The search box, focused by the slash the way it is in the app.
        page.goto(f"{ORIGIN}/", wait_until="load")
        page.wait_for_timeout(600)
        page.keyboard.press("/")
        focused = page.evaluate("() => document.activeElement?.getAttribute('name')")
        say(f"[{name}] slash focuses: {focused}")

        page.fill('input[name="q"]', "mycology")
        page.keyboard.press("Enter")
        page.wait_for_timeout(1200)
        rows = page.evaluate(
            "() => [...document.querySelectorAll('.found .what')].map((one) => one.textContent)"
        )
        say(f"[{name}] searching for mycology found: {rows}")
        page.screenshot(path=str(out / f"{name}-search.png"))
        say(f"shot {name}-search.png")

        # The theme the reader chose, remembered for the site - and the colours
        # of the page with it, since a button that only sets an attribute has
        # changed nothing a reader can see.
        page.goto(f"{ORIGIN}/public/one", wait_until="load")
        page.wait_for_timeout(600)
        ground = "() => getComputedStyle(document.body).backgroundColor"
        themed = (
            "() => [document.documentElement.dataset.theme,"
            " localStorage.getItem('nib:site-theme')]"
        )
        was = page.evaluate(ground)
        page.click("button.theme")
        page.wait_for_timeout(400)
        chosen = page.evaluate(themed)
        first = page.evaluate(ground)

        # Twice, because the first press lands on whichever the system already
        # said on one of the two screens: the second proves the other direction.
        page.click("button.theme")
        page.wait_for_timeout(400)
        say(f"[{name}] the theme button says: {chosen} then {page.evaluate(themed)}")
        say(f"[{name}] and the page turns: {was} -> {first} -> {page.evaluate(ground)}")
        page.screenshot(path=str(out / f"{name}-theme.png"))
        say(f"shot {name}-theme.png")

        # The card a link shows on hover, which a finger asks for differently.
        if not finger:
            page.hover('.pages a[href="/public/two"]')
            page.wait_for_timeout(1400)
            card = page.evaluate(
                "() => { const one = document.querySelector('body > .card'); return one && !one.hidden ? one.textContent.trim().slice(0, 40) : null }"
            )
            say(f"[{name}] the hover card shows: {card!r}")
            page.screenshot(path=str(out / f"{name}-hover.png"))
            say(f"shot {name}-hover.png")

        context.close()


def password(worker: Worker, token: str, space: str) -> None:
    """The form, a wrong word, the right one, and the note behind it."""
    request(f"/v1/spaces/{space}/site", token, {"password": PASSWORD}, method="PUT")

    asked = site("/public/one")
    say(f"with a password set, the page answers {asked.status} with a form: {'type=\"password\"' in asked.text}")
    say(f"and nothing of the note: {'The first words of it' not in asked.text}")
    say(f"robots now says: {site('/robots.txt').text.strip().splitlines()}")

    wrong = site("/public/one", data=b"password=nope")
    say(f"a wrong word answers {wrong.status}: {'not the password' in wrong.text}")

    right = site(
        "/public/one",
        data=f"password={PASSWORD.replace(' ', '+')}".encode(),
        follow=False,
    )
    ticket = (right.headers.get("set-cookie") or "").split(";")[0]
    say(f"the right one answers {right.status} to {right.headers.get('location')}, holding {ticket[:14]}…")

    # Carried by hand rather than by a cookie jar: the ticket is set `Secure`, and
    # a secure cookie is not sent back over the plain http a drive runs on. A
    # browser on the real site is on https and sends it by itself.
    read = site("/public/one", cookie=ticket)
    say(f"behind it, the note: {'The first words of it' in read.text} ({read.status})")

    request(f"/v1/spaces/{space}/site", token, {"password": None}, method="PUT")
    say(f"with the password off, the page answers {site('/public/one').status} again")


def main() -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    worker = Worker()

    worker.clean()
    worker.migrate()
    worker.build()
    worker.start()

    token = ""
    space = ""

    try:
        token = worker.account()
        made = request("/v1/spaces", token, {"name": "Field notes"})
        space = made["space"]["id"]
        for path, content in NOTES.items():
            request(f"/v1/spaces/{space}/notes", token, {"path": path, "content": content})

        # A space that wears an icon, because what a tab shows is that icon drawn
        # by the app; a space with none gets its letter, which the Worker draws.
        worker.sql(f"update spaces set icon = 'FileText' where id = '{space}';")
        say(f"the account holds {len(NOTES)} notes in Field notes, marked FileText")

        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                for one in [
                    ("desktop", 1440, 900, DESKTOP_AGENT, False),
                    ("phone", 390, 844, PHONE_AGENT, True),
                ]:
                    say(f"--- the sheet, {one[0]} ---")
                    sheet(browser, SHOTS, token, *one)
            finally:
                browser.close()
    finally:
        worker.stop()

    # And now as the blog itself, on the same database.
    worker.start(upstream=BLOG_HOST)
    try:
        say("--- what the hostname serves ---")
        pages(worker, token, space)
        say("--- getting around it ---")
        furniture()
        say("--- searching it ---")
        searching()
        say("--- a form on a page ---")
        forms(token, space)
        say("--- a diagram the app drew ---")
        diagrams()

        # In a browser before the counter is set below, so that "it asked nobody
        # but this site" is the whole truth rather than the truth minus one script
        # the author asked for.
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                drawn(browser, SHOTS)
            finally:
                browser.close()

        say("--- the author's own dressing ---")
        dressing(token, space)

        say("--- the site in a browser ---")
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                looking(browser, SHOTS)
            finally:
                browser.close()

        say("--- behind a password ---")
        password(worker, token, space)
    finally:
        worker.stop()

    say(f"shots in {SHOTS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
