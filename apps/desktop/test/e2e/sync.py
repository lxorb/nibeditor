"""The sync batch, against the real Worker: versions, conflicts, the log, a second
factor, and a checkout from the command line.

Everything here needs a server, so it brings one up: `wrangler dev` with its own
database, the migrations applied to it, and the app built against its origin. Which
also means the two new migrations are exercised the way a deploy would run them.

What it drives, in order:

    versions    a note written here, pushed, and its history read back off the
                account with the device that wrote it beside each version
    rollback    what the space said an hour ago, asked first and then put back
    conflicts   the rule chosen in the pane and read back off the account
    log         the passes the device wrote down
    second      a second factor turned on with a code this script works out, the
                recovery codes it hands back, and a session ended from the list
    headless    scripts/nib-sync.mjs pulling the space into a folder with a token

Run it from the repository root:

    python apps/desktop/test/e2e/sync.py

Screenshots go beside this file under `shots/sync/`, which is ignored. A scratch
drive rather than a test: it photographs the app and says what it saw.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import shutil
import struct
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "apps" / "desktop"
SERVICE = ROOT / "services" / "sync"

# Above 1425, and not any other drive's port.
PORT = 18995
ORIGIN = f"http://127.0.0.1:{PORT}"

EMAIL = "sync-drive@example.com"

PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)
DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)


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


def totp(secret_hex: str, at: float | None = None) -> str:
    """The six digits a secret stands at, worked out here so the drive can answer
    its own second factor. The same arithmetic as services/sync/src/second.ts."""
    step = int((at if at is not None else time.time()) // 30)
    digest = hmac.new(bytes.fromhex(secret_hex), struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[19] & 15
    value = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF

    return str(value % 1_000_000).zfill(6)


class Worker:
    """The Worker under wrangler dev, its database, and the built app it serves.
    Lifted from first-sync.py, which brings the same three up."""

    def __init__(self) -> None:
        self.process: subprocess.Popen[bytes] | None = None
        self.log = APP / "test" / "e2e" / "shots" / "sync-worker.log"
        self.opened = None
        self.vars: Path | None = None

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

        # Not wrangler's own output: it draws a table, and a Windows console
        # cannot encode the box it draws it with.
        say(f"{done.stdout.count('0027') + done.stdout.count('0028')} of the new two named")

    def sql(self, statement: str) -> str:
        done = npx(
            "wrangler", "d1", "execute", "nib", "--local", f"--command={statement}", cwd=SERVICE
        )
        if done.returncode != 0:
            raise SystemExit(f"that query failed:\n{statement}\n{done.stdout}\n{done.stderr}")

        return done.stdout

    def start(self) -> None:
        say(f"starting the Worker on {ORIGIN}")
        # A secret the way `wrangler dev` takes one. Written here rather than kept
        # in the repository, and taken away again on the way out: it is the thing
        # the second factor is encrypted under, and a file of secrets is not
        # something a drive leaves behind.
        self.vars = SERVICE / ".dev.vars"
        self.vars.write_text("OPENAI_KEY_SECRET=a secret for the drive" + chr(10), "utf-8")

        self.log.parent.mkdir(parents=True, exist_ok=True)
        self.opened = self.log.open("wb")
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
            try:
                if request("/health").get("ok"):
                    say("the Worker is answering")
                    return
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
                time.sleep(1)

        raise SystemExit(f"the Worker never answered:\n{self.said()}")

    def said(self) -> str:
        if self.opened:
            self.opened.flush()
        if not self.log.exists():
            return "(nothing)"

        return "\n".join(self.log.read_text("utf-8", errors="replace").splitlines()[-40:])

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

        if self.vars and self.vars.exists():
            self.vars.unlink()

    def account(self, device: str = "the drive") -> tuple[str, str]:
        """An account with a live session, put straight into the database: the
        emailed code is not what any of this is about."""
        now = int(time.time() * 1000)
        user = str(uuid.uuid4())

        self.sql(f"insert into users (id, email, created_at) values ('{user}', '{EMAIL}', {now});")

        return self.session(user, device), user

    def session(self, user: str, device: str) -> str:
        """One more device signed in as the same account, which is what the list
        of sessions is about."""
        token = uuid.uuid4().hex + uuid.uuid4().hex
        digest = hashlib.sha256(token.encode()).hexdigest()
        now = int(time.time() * 1000)

        self.sql(
            "insert into sessions (token_hash, user_id, created_at, expires_at, id, name,"
            f" last_used_at) values ('{digest}', '{user}', {now}, {now + 86400000},"
            f" '{uuid.uuid4().hex[:16]}', '{device}', {now});"
        )

        return token


def pane_rows(page) -> list[str]:
    """Every row of the pane on screen, as a reader would read it."""
    return page.evaluate(
        """() => [...document.querySelectorAll('.pane .setting, .pane .action')]
             .map((one) => one.textContent.replace(/\\s+/g, ' ').trim())
             .filter(Boolean)"""
    )


def opened(browser, name: str, width: int, height: int, agent: str, finger: bool, token: str):
    context = browser.new_context(
        viewport={"width": width, "height": height},
        user_agent=agent,
        has_touch=finger,
        is_mobile=finger,
        color_scheme="dark" if not finger else "light",
        device_scale_factor=2,
    )

    # Signed in before the first frame, the way a machine that has been signed in
    # once is: the session is in storage and the app reads it on the way up.
    context.add_init_script(f"try {{ localStorage.setItem('nib:session', '{token}') }} catch {{}}")

    page = context.new_page()
    page.set_default_timeout(20000)
    page.on("pageerror", lambda error: say(f"[{name}] page error: {error}"))
    page.on(
        "console",
        lambda one: say(f"[{name}] console {one.type}: {one.text}")
        if one.type == "error"
        else None,
    )
    page.goto(ORIGIN, wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.nibApp", timeout=40000)
    page.wait_for_function("() => !!window.nibApp.account.user", timeout=40000)

    return context, page


def drive(browser, worker: Worker, out: Path, token: str, user: str, name: str, width, height, agent, finger):
    shots = out
    shots.mkdir(parents=True, exist_ok=True)
    context, page = opened(browser, name, width, height, agent, finger, token)

    def shot(tag: str) -> None:
        page.screenshot(path=str(shots / f"{name}-{tag}.png"))
        say(f"shot {name}-{tag}.png")

    # ── A note, synced, and what the account remembers of it ───────────────
    page.wait_for_function(
        "() => window.nibApp.workspace.activeSpace && window.nibApp.sync.status !== 'off'",
        timeout=40000,
    )

    space = page.evaluate("() => window.nibApp.workspace.activeSpace.root")
    made = page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          return await ws.noteFrom('# The plan\\n\\nThe first words.', ws.activeSpace.root)
        }"""
    )
    say(f"[{name}] wrote {made.replace(chr(92), '/').split('/')[-1]}")

    page.evaluate("() => window.nibApp.sync.nudge()")
    page.wait_for_function(
        "(path) => !!window.nibApp.sync.tracked(path)", arg=made, timeout=40000
    )

    tracked = page.evaluate("(path) => window.nibApp.sync.tracked(path)", made)
    held = request(f"/v1/notes/{tracked['id']}/versions", token)
    say(f"[{name}] the account holds {len(held.get('versions', []))} version(s): {held.get('versions')}")

    # The note says something else, an hour of waiting is skipped, and the second
    # version lands: the account keeps at most one every five minutes.
    worker.sql("update note_versions set at = at - 600000;")
    page.evaluate(
        """async (path) => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.path === path)
          if (note) await ws.open(note.path)
          window.nibApp.workspace.replace('# The plan\\n\\nSomething else entirely.')
          await ws.save()
        }""",
        made,
    )
    page.evaluate("() => window.nibApp.sync.nudge()")
    page.wait_for_timeout(4000)

    held = request(f"/v1/notes/{tracked['id']}/versions", token)
    say(f"[{name}] and now {len(held.get('versions', []))}, by {[one['by'] for one in held.get('versions', [])]}")

    # ── The history sheet shows both sides ────────────────────────────────
    page.evaluate("() => (window.nibApp.settings.historyOpen = true)")
    page.wait_for_timeout(900)
    shot("history")
    rows = page.evaluate("() => [...document.querySelectorAll('.versions button')].map((one) => one.textContent.trim())")
    say(f"[{name}] the history sheet lists: {rows}")
    page.evaluate("() => (window.nibApp.settings.historyOpen = false)")
    page.wait_for_timeout(400)

    # ── The Sync pane: the rule, the log, and going back ──────────────────
    page.evaluate("() => window.nibApp.settings.show('sync')")
    page.wait_for_timeout(900)
    shot("pane")

    page.evaluate("() => window.nibApp.modes.setConflicts('newest')")
    page.wait_for_timeout(1200)
    settings = request("/v1/settings", token)
    say(f"[{name}] the account's conflict rule is {settings.get('settings', {}).get('conflicts')!r}")

    # ── How long the account keeps a note's history ───────────────────────
    say(f"[{name}] the pane offers: {pane_rows(page)}")
    page.evaluate("() => window.nibApp.modes.setKeepVersions(365)")
    page.wait_for_timeout(1200)
    kept = request("/v1/settings", token).get("settings", {}).get("keepVersions")
    say(f"[{name}] the account keeps versions for {kept} days")

    # A year of history, at the ages the sweep's shelves are about: the sheet cuts
    # it up by month once a year is what the account keeps.
    day = 24 * 60 * 60 * 1000
    for age in [2, 40, 70, 100, 200, 300]:
        worker.sql(
            "insert or ignore into note_versions (note_id, at, hash, size, by) values"
            f" ('{tracked['id']}', cast(strftime('%s','now') as integer) * 1000 - {age * day},"
            f" 'aged-{age}', 120, 'the drive');"
        )

    page.evaluate("() => (window.nibApp.settings.historyOpen = true)")
    page.wait_for_timeout(1500)
    months = page.evaluate(
        "() => [...document.querySelectorAll('.versions .month')].map((one) => one.textContent.trim())"
    )
    say(f"[{name}] with a year kept the sheet is cut up by month: {months}")
    shot("history-by-month")
    page.evaluate("() => (window.nibApp.settings.historyOpen = false)")
    page.wait_for_timeout(300)
    page.evaluate("() => window.nibApp.settings.show('sync')")
    page.wait_for_timeout(600)

    passes = page.evaluate("() => window.nibApp.sync.status")
    log = page.evaluate(
        """() => [...document.querySelectorAll('.pass')].map((one) => one.textContent.replace(/\\s+/g, ' ').trim())"""
    )
    say(f"[{name}] sync is {passes}; the log says: {log[:3]}")

    # ── The account: the second code, and the devices signed in ──────────
    page.evaluate("() => window.nibApp.settings.show('account')")
    page.wait_for_timeout(900)

    # The first device turns it on the way somebody would: the app shows a
    # secret, and the code for it is worked out here rather than read anywhere.
    turn = page.query_selector('button:has-text("Turn on")')
    if turn:
        turn.click()
        page.wait_for_selector(".copyable .value", timeout=20000)
        shown = (page.text_content(".copyable .value") or "").strip()
        padded = shown + "=" * (-len(shown) % 8)
        page.fill('input[aria-label="Code from the app"]', totp(base64.b32decode(padded).hex()))
        page.click('button:has-text("Confirm")')
        page.wait_for_timeout(1500)

    say(f"[{name}] the account pane says: {pane_rows(page)}")
    shot("account")
    page.evaluate("() => window.nibApp.settings.show('sync')")
    page.wait_for_timeout(300)

    # The space on the account is one the app made for this folder, so its id is
    # asked for rather than assumed - and it is what the command line pulls below.
    remote = page.evaluate(
        "() => window.nibApp.sync.remoteIdFor(window.nibApp.workspace.activeSpace.root)"
    )
    asked = request(
        f"/v1/spaces/{remote}/rollback",
        token,
        {"at": int(time.time() * 1000) - 300000, "dry": True},
    )
    say(f"[{name}] a rollback to five minutes ago would change {asked.get('notes')} note(s)")

    context.close()
    return remote


def second_factor(worker: Worker, token: str) -> None:
    """Turned on through the API the pane uses, with a code worked out here."""
    begun = request("/v1/second", token, {})
    if "secret" not in begun:
        say(f"the second factor could not be begun: {begun}")
        return

    # The secret is handed to the app in base32; the arithmetic wants the bytes.
    padded = begun["secret"] + "=" * (-len(begun["secret"]) % 8)
    secret = base64.b32decode(padded).hex()

    done = request("/v1/second/confirm", token, {"holding": begun["holding"], "code": totp(secret)})
    say(f"the second factor is on, with {len(done.get('recovery', []))} recovery codes")

    state = request("/v1/second", token)
    say(f"and the pane would say: on={state.get('on')} codesLeft={state.get('codesLeft')}")

    # And off again, which takes a code.
    refused = request("/v1/second", token, {"code": "000000"}, method="DELETE")
    say(f"a wrong code turning it off: {refused.get('status')} {refused.get('error')!r}")

    off = request("/v1/second", token, {"code": totp(secret)}, method="DELETE")
    say(f"the right one: on={off.get('on')}")


def sessions(worker: Worker, token: str, user: str) -> None:
    """What the account says is signed in, and one of them ended."""
    other = worker.session(user, "another laptop")
    listed = request("/v1/sessions", token)
    say(f"signed in on: {[(one['name'], one['current']) for one in listed.get('sessions', [])]}")

    theirs = next((one for one in listed.get("sessions", []) if not one["current"]), None)
    if theirs:
        request(f"/v1/sessions/{theirs['id']}", token, method="DELETE")
        after = request("/v1/sessions", other)
        say(f"after ending it, that session answers {after.get('status', 200)}")


def headless(worker: Worker, token: str, space: str) -> None:
    """The script a CI job runs, against the same Worker. The space is named by its
    id, which the script takes as readily as a name."""
    minted = request("/v1/mcp/token", token, {"readOnly": False})
    program = minted.get("token", "")

    with tempfile.TemporaryDirectory(prefix="nib-ci-") as held:
        folder = Path(held)
        done = subprocess.run(
            ["node", str(ROOT / "scripts" / "nib-sync.mjs"), "pull", space, str(folder)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env={**os.environ, "NIB_TOKEN": program, "NIB_API": ORIGIN},
            check=False,
        )

        say(f"nib-sync pull said: {done.stdout.strip() or done.stderr.strip()}")
        landed = sorted(one.name for one in folder.rglob("*.md"))
        say(f"and left: {landed}")

        if landed:
            (folder / "from-ci.md").write_text("# From CI\n\nWritten by the action.\n", "utf-8")
            pushed = subprocess.run(
                ["node", str(ROOT / "scripts" / "nib-sync.mjs"), "push", space, str(folder)],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                env={**os.environ, "NIB_TOKEN": program, "NIB_API": ORIGIN},
                check=False,
            )
            say(f"nib-sync push said: {pushed.stdout.strip() or pushed.stderr.strip()}")


def page_note(browser, token: str, space: str) -> None:
    """A page note, across two devices.

    The mirror sends every file that is not a PDF up as a note, and the server's
    list of endings left `.pages` out: every page note anybody wrote was refused,
    on every pass, silently, and never left the machine it was written on. Both
    halves are checked here - the account takes the file, and a second device that
    has never seen it finds it in its tree.
    """
    paper = (
        '{"nodes":[{"id":"p1","type":"page","x":0,"y":0,"width":794,"height":1123}],'
        '"edges":[]}\n'
    )
    made = request(f"/v1/spaces/{space}/notes", token, {"path": "Journal.pages", "content": paper})
    landed = made.get("note", {}).get("path")
    say(f"the account took the page note as {landed!r}")
    if landed != "Journal.pages":
        say("FAILED: the account would not take a page note")
        return

    context, page = opened(browser, "pages", 1280, 860, DESKTOP_AGENT, False, token)
    try:
        page.wait_for_function(
            """() => {
              const walk = (one) => (one ? [one.path, ...(one.children ?? []).flatMap(walk)] : [])
              return walk(window.nibApp.workspace.tree)
                .some((path) => path.endsWith('Journal.pages'))
            }""",
            timeout=60000,
        )
        say("and a second device found it in its tree")
    except Exception as error:
        say(f"FAILED: the page note never reached a second device: {error}")
    finally:
        context.close()


def main() -> int:
    out = Path(__file__).resolve().parent / "shots" / "sync"
    worker = Worker()

    worker.clean()
    worker.migrate()
    worker.build()
    worker.start()

    try:
        token, user = worker.account()
        say("an account with nothing in it; the app makes its own space")

        # Before the app is looked at, because the pane below turns the factor on
        # for itself and these are the answers the API has to give first.
        say("--- the second factor ---")
        second_factor(worker, token)

        # One more device signed in, so the pane has a list rather than a row.
        worker.session(user, "another laptop")

        # Whichever space the app ended up syncing, which is the one the command
        # line is then pointed at.
        remote = ""

        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                for one in [
                    ("desktop", 1440, 900, DESKTOP_AGENT, False),
                    ("phone", 390, 844, PHONE_AGENT, True),
                ]:
                    say(f"--- {one[0]} ---")
                    remote = drive(browser, worker, out, token, user, *one) or remote
                say("--- a page note across two devices ---")
                if remote:
                    page_note(browser, token, remote)
            finally:
                browser.close()

        say("--- the sessions ---")
        sessions(worker, token, user)

        say("--- from the command line ---")
        headless(worker, token, remote)
    finally:
        worker.stop()

    say(f"shots in {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
