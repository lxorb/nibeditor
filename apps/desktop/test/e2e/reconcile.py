"""Signing in on a machine that already holds five thousand notes.

The other direction from first-sync.py, and the one nobody had measured. There, an
account holds notes and the machine holds none; here the machine holds a space of
five thousand and the account holds nothing, so signing in is a reconcile: every
local note has to be compared against what the account has and then sent.

What is measured, from the moment the session lands:

    tree        the space still holds five thousand notes - nothing lost
    firstPass   the first sync pass comes back, which is when the space exists on
                the account: a local space with no mirror is `plan.upload`, and that
                pass creates it and pairs it
    requests    how many times the Worker was asked for anything
    longest     the longest task the window's own thread ran
    heap        the high-water mark of the heap while it went

Against the real Worker under `wrangler dev` with its own database, the way
first-sync.py does it - its harness is imported rather than copied, so there is one
statement of how to bring a Worker, a database and a built app up together.

Run it from the repository root:

    python apps/desktop/test/e2e/reconcile.py

It needs `CLOUDFLARE_API_TOKEN` in the environment for the reason the drives
document gives: the Worker binds Workers AI, which has no local emulation, so
wrangler opens a remote proxy session for it. Nothing here reaches the AI.

It prints numbers and nothing else: a scratch drive, not a test.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent

#: first-sync.py's Worker harness, and speed.py's five thousand note fixture. Both
#: imported by path because both filenames hold a hyphen, and both are the one
#: statement of what they are: a Worker with a database behind it, and a space of
#: the size somebody actually has.
def sibling(name: str):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), HERE / f"{name}.py")
    if not spec or not spec.loader:
        raise SystemExit(f"cannot read {name}.py")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


first = sibling("first-sync")
speed = sibling("speed")

#: How many notes the machine holds before anybody signs in.
NOTES = 5000


def say(words: str) -> None:
    print(f"  {words}", flush=True)


#: Every moment and every long task, installed before the app's first script runs.
#: The same observers speed.py uses, for the same reason: a poll that got round to
#: looking says when it looked.
WATCH = """
window.__sync = { tasks: [], heap: 0 }

new PerformanceObserver((list) => {
  for (const one of list.getEntries()) window.__sync.tasks.push(Math.round(one.duration))
}).observe({ entryTypes: ['longtask'] })

setInterval(() => {
  const used = performance.memory ? performance.memory.usedJSHeapSize : 0
  if (used > window.__sync.heap) window.__sync.heap = used
}, 100)
"""


#: What the window says about itself, for a wait that ran out. Printed beside every
#: moment as well, because a number with no state beside it says nothing about why.
SAYS = """
() => ({
  notes: window.nibApp?.workspace?.notes?.length ?? null,
  spaces: window.nibApp?.workspace?.spaces?.length ?? null,
  panel: window.nibApp?.workspace?.panel ?? null,
  signed: !!window.nibApp?.account?.signedIn,
  running: !!window.nibApp?.sync?.running,
  reconciledAt: window.nibApp?.sync?.reconciledAt ?? null,
  pushed: window.nibApp?.sync?.pushed ?? null,
  pulled: window.nibApp?.sync?.pulled ?? null,
  clashed: window.nibApp?.sync?.clashed ?? null,
  coming: window.nibApp?.arriving?.coming?.size ?? null,
})
"""


def drive(browser, token: str) -> dict[str, object]:
    context = browser.new_context(viewport={"width": 1280, "height": 860})
    context.add_init_script(WATCH)
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"page error: {error}"))

    asked: list[str] = []
    page.on("request", lambda one: asked.append(one.url) if first.ORIGIN in one.url else None)

    # A machine with a space of five thousand notes on it and nobody signed in.
    page.goto(f"{first.ORIGIN}/seed.html", wait_until="domcontentloaded")
    seeded = page.evaluate(
        speed.SEED,
        {"notes": NOTES, "lines": 0, "strokes": 0, "points": speed.POINTS, "space": "/Big"},
    )
    say(f"{seeded['rows']} rows seeded into {seeded['stores']}")

    page.goto(first.ORIGIN, wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.nibApp", timeout=60000)
    page.wait_for_function("() => !!window.nibApp.workspace.activeSpace", timeout=60000)
    page.evaluate(
        "() => { const ws = window.nibApp.workspace;"
        " if (ws.panel !== 'tree') ws.showPanel('tree') }"
    )
    page.wait_for_selector("aside .row", timeout=60000)
    # The scan of the space is part of the launch rather than part of the reconcile.
    page.wait_for_function(
        "() => !!window.nibApp && !window.nibApp.links.scanning && !!window.nibApp.links.rootOf()",
        timeout=180000,
    )
    page.wait_for_timeout(2500)

    before = len(asked)

    # And now there is a session, and the window comes back with one - which is how
    # first-sync.py signs in, and the moment the reconcile happens in. Everything
    # below is timed from this page's own navigation, so the clock starts at zero.
    page.evaluate(f"() => localStorage.setItem('nib:session', {json.dumps(token)})")
    page.reload(wait_until="commit")

    page.wait_for_function("() => !!window.nibApp", timeout=60000)
    page.wait_for_function("() => !!window.nibApp.workspace.activeSpace", timeout=120000)
    # Asked for again until it stays: the sitting is read back after the window says
    # it has a space, and reading it back sets which panel is open.
    page.wait_for_function(
        "() => { const ws = window.nibApp.workspace;"
        " if (ws.panel !== 'tree') { ws.showPanel('tree'); return false }"
        " return true }",
        timeout=60000,
    )

    def when(script: str, what: str, patience: int = 420000) -> float:
        try:
            page.wait_for_function(script, timeout=patience)
        except Exception:
            say(f"gave up on {what}: {page.evaluate(SAYS)}")
            raise

        at = page.evaluate("() => performance.now()")
        say(f"{what}: {round(at)}ms  {page.evaluate(SAYS)}")
        return at

    # The app's own count rather than the tree's attribute: what is being asked is
    # whether the space still holds every note, and the workspace is what knows.
    tree = when(
        f"() => (window.nibApp.workspace.notes?.length ?? 0) >= {NOTES}",
        "the space still holds every note",
    )
    # The reconcile having finished, off the sync's own word for it: `reconciledAt`
    # is the moment a pass last came back, and `running` says whether one is in
    # flight. Not a status class - a class that has not been put on yet reads as
    # idle, which is what `working` did: a flag the store does not have, so the
    # first version of this drive called the reconcile done in 384ms before it had
    # started.
    # The first pass coming back, which is when the space itself exists on the
    # account: a local space with no mirror is `plan.upload`, and that pass creates
    # the space and pairs it. The notes go up after it.
    first_pass = when(
        "() => { const s = window.nibApp?.sync;"
        " return !!s && !s.running && (s.reconciledAt ?? 0) > 0 }",
        "the first pass has come back",
    )

    # And then every note. This is the reconcile item two is about: five thousand
    # local notes meeting an account that holds none. Said as it goes, because a
    # number that climbs and a number that stops climbing are different findings.
    seen = -1
    still = 0
    while still < 20:
        now = page.evaluate("() => window.nibApp?.sync?.pushed ?? 0")
        if now != seen:
            if now and (seen < 0 or now // 500 != seen // 500):
                say(f"pushed {now} of {NOTES} at {round(page.evaluate('() => performance.now()'))}ms")
            seen = now
            still = 0
        else:
            still += 1

        if now >= NOTES:
            break

        page.wait_for_timeout(500)

    # Not waited on to the end, and this is the honest edge of what this drive can
    # say. `pushed` is reset per mirror at the top of every pass (see `sync.svelte.ts`),
    # so it counts what one pass sent and not what the upload has got through: it is
    # not a progress meter, and after eleven seconds of a running pass it still read
    # nought. What the whole upload of five thousand notes costs wants either the
    # account's own count off `/v1/spaces/:id/changes` or a look at how `push`
    # batches, and neither is a number to guess at.
    uploaded = page.evaluate("() => window.nibApp?.sync?.pushed ?? 0")
    say(f"the pass in flight has sent {uploaded} of {NOTES}; see the note in this file")

    told = page.evaluate(SAYS)
    held = page.evaluate("() => window.__sync")
    tasks = sorted(one for one in held["tasks"] if one >= 50)

    context.close()
    return {
        "tree": round(tree),
        "firstPass": round(first_pass),
        "sentSoFar": uploaded,
        "requests": len(asked) - before,
        "longest": tasks[-1] if tasks else 0,
        "over50": len(tasks),
        "heap": round(held["heap"] / 1e6),
        "pushed": told["pushed"],
        "pulled": told["pulled"],
        "clashed": told["clashed"],
    }


def main() -> int:
    service = first.Worker()
    service.build()
    (first.APP / "dist" / "seed.html").write_text(speed.SEED_PAGE, encoding="utf-8")
    service.clean()
    service.migrate()
    service.start()
    try:
        token = service.account()
        with sync_playwright() as play:
            browser = play.chromium.launch(
                channel="chrome", args=["--enable-precise-memory-info"]
            )
            found = drive(browser, token)
            browser.close()
    finally:
        service.stop()

    print()
    print(f"signing in with {NOTES} notes already on the machine:")
    for key, value in found.items():
        print(f"  {key:36} {value}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
