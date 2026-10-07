"""A face, set in one browser and seen in another, against the real Worker.

The owner of a shared space opens Settings > Account, presses Change, picks a
picture, and keeps the round window the avatar sheet offers: the browser crops it
and makes the two WebP faces, uploads them and wears them. Then the owner's own
Share sheet draws that face on the owner's row, and somebody else in the space,
in a browser of their own with the same note open, sees it in front of the
owner's name on the caret and on the tab. And the hub has written down that the
owner is here, which the other person reads.

Everything is the real thing: the built web app, the Worker under `wrangler dev`
on workerd, the account's hub and the note's room as Durable Objects, and the D1
migrations including the profiles one (0048).

Run it from the repository root:

    python apps/desktop/test/e2e/profiles.py
"""

from __future__ import annotations

import json
import struct
import sys
import time
import zlib
from pathlib import Path

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say = DRIVE.say
SHOTS = DRIVE.shots
ORIGIN = harness.worker_origin()

OWNER = "owner@example.com"
MEMBER = "member@example.com"
SPACE = "Plans"
NOTE = "plan.md"
OPENING = "# Plan\n\nWhat we are doing.\n"

PATIENCE = 40


class Worker(harness.Worker):
    def __init__(self) -> None:
        super().__init__(DRIVE)


def picture() -> Path:
    """A small PNG to be somebody's face: a gradient, so a crop of it is a picture
    rather than a flat square, written by hand so the drive needs nothing installed."""
    width, height = 96, 72
    rows = b"".join(
        b"\x00" + bytes(value for x in range(width) for value in (x * 2, y * 3, 160))
        for y in range(height)
    )

    def chunk(kind: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )
    path = SHOTS / "face.png"
    path.write_bytes(png)
    return path


def wait_for(page: Page, script: str, what: str, arg: object = None, patience: int = PATIENCE):
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script, arg)
        if answer:
            return answer
        page.wait_for_timeout(100)
    raise SystemExit(f"gave up waiting for {what}")


def signed_in(browser: Browser, token: str, label: str) -> Page:
    context = browser.new_context(viewport={"width": 1180, "height": 760})
    context.add_init_script(f"localStorage.setItem('nib:session', {json.dumps(token)})")
    page = context.new_page()
    page.on(
        "console",
        lambda message: say(f"[{label}] {message.type}: {message.text[:200]}")
        if message.type in ("error", "warning")
        else None,
    )
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")
    wait_for(page, "() => !!window.nibApp && window.nibApp.account.signedIn", f"[{label}] the session")
    return page


def folder_for(page: Page, label: str, space_id: str) -> str:
    """What the folder mirroring the space is called on this machine."""
    return wait_for(
        page,
        "() => {"
        "  const space = window.nibApp.workspace.spaces.find("
        f"    (one) => window.nibApp.sync.remoteIdFor(one.root) === {json.dumps(space_id)});"
        "  return space ? space.name : null"
        "}",
        f"[{label}] a folder for the shared space",
    )


def open_note(page: Page, label: str, folder: str, note_id: str) -> None:
    listed = (
        "() => {"
        "  const walk = (entry) => (entry ? [entry.path, ...(entry.children ?? []).flatMap(walk)] : []);"
        f"  return walk(window.nibApp.workspace.tree).some((path) => path.endsWith('/{folder}/{NOTE}'))"
        "}"
    )
    page.evaluate(
        "(name) => { const space = window.nibApp.workspace.spaces.find((one) => one.name === name);"
        " if (space) return window.nibApp.workspace.showSpace(space.id) }",
        folder,
    )
    wait_for(page, listed, f"[{label}] the note to arrive")
    # Opened again while it waits: a note opened in the turn its space's pairing with the
    # account lands is a file the rooms have not yet been told is the account's.
    opening = (
        "(name) => { const space = window.nibApp.workspace.spaces.find((one) => one.name === name);"
        f" void window.nibApp.workspace.open(space.root + '/{NOTE}');"
        f" return window.nibApp.rooms.carries({json.dumps(note_id)}) }}"
    )
    wait_for(page, opening, f"[{label}] the room", folder, patience=PATIENCE * 2)


def main() -> int:
    worker = Worker()
    failures: list[str] = []

    with DRIVE.session(
        args=[
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
        ],
    ) as browser:
        worker.start()

        owner_token = worker.account(OWNER)
        member_token = worker.account(MEMBER)
        space = worker.request("/v1/spaces", owner_token, {"name": SPACE})["space"]
        note = worker.request(
            f"/v1/spaces/{space['id']}/notes", owner_token, {"path": NOTE, "content": OPENING}
        )["note"]
        worker.request(
            f"/v1/spaces/{space['id']}/share/invite",
            owner_token,
            {"email": MEMBER, "role": "write"},
        )
        link = worker.waits_for_mail(MEMBER, r"/join/([a-f0-9]+)", "the invitation").group(1)
        worker.request(f"/v1/join/{link}", member_token, {})
        say(f"{MEMBER} is in {SPACE}")

        # ── The owner sets a face ──────────────────────────────────────
        owner = signed_in(browser, owner_token, "owner")
        owner.evaluate("() => window.nibApp.settings.show('account')")
        change = owner.get_by_role("button", name="Change", exact=True)
        change.wait_for(timeout=30_000)
        with owner.expect_file_chooser() as chosen:
            change.click()
        chosen.value.set_files(str(picture()))

        sheet = owner.get_by_role("dialog", name="Profile picture")
        sheet.wait_for(timeout=10_000)
        owner.wait_for_selector(".window canvas", timeout=10_000)
        # Zoomed in and dragged, so the face is a crop rather than the whole picture.
        owner.locator(".zoom").fill("1.6")
        window = owner.locator(".window")
        box = window.bounding_box()
        if box:
            owner.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            owner.mouse.down()
            owner.mouse.move(box["x"] + box["width"] / 2 + 30, box["y"] + box["height"] / 2)
            owner.mouse.up()
        sheet.screenshot(path=str(SHOTS / "avatar-sheet.png"))
        owner.get_by_role("button", name="Keep", exact=True).click()

        face = wait_for(
            owner,
            "() => window.nibApp.account.user?.avatar ?? null",
            "[owner] the face to be worn",
        )
        say(f"the owner wears {face['s'][:12]}… and {face['l'][:12]}…")

        held = worker.query(
            f"select type, size from blobs where hash in ('{face['s']}', '{face['l']}')"
        )
        if len(held) != 2:
            failures.append(f"the account keeps {len(held)} of the two pictures")
        for row in held:
            if row["type"] not in ("image/webp", "image/jpeg") or row["size"] > 100 * 1024:
                failures.append(f"a picture is {row['type']} at {row['size']} bytes")

        foot = owner.locator(f".foot img[src*='{face['s']}']")
        if not foot.count():
            failures.append("the panel's foot does not wear the face")
        owner.keyboard.press("Escape")
        owner.wait_for_timeout(300)

        # ── The owner's Share sheet draws it ───────────────────────────
        owner.evaluate(
            "(name) => { const space = window.nibApp.workspace.spaces.find((one) => one.name === name);"
            " return window.nibApp.share.show(space) }",
            SPACE,
        )
        share = owner.get_by_role("dialog")
        share.wait_for(timeout=10_000)
        drawn = wait_for(
            owner,
            "(hash) => [...document.querySelectorAll('[role=dialog] img')].some("
            "  (img) => img.src.includes(hash) && img.complete && img.naturalWidth > 0)",
            "[owner] the face on the owner's row of the Share sheet",
            face["s"],
        )
        if drawn:
            share.screenshot(path=str(SHOTS / "share-sheet-face.png"))
            say("the Share sheet draws the owner's face")
        owner.keyboard.press("Escape")
        owner.wait_for_timeout(300)

        # ── Somebody else sees it on a caret ───────────────────────────
        member = signed_in(browser, member_token, "member")
        theirs = folder_for(member, "member", space["id"])
        open_note(member, "member", theirs, note["id"])
        open_note(owner, "owner", SPACE, note["id"])
        owner.evaluate("() => { window.nib.dispatch({ selection: { anchor: 4 } }); window.nib.focus() }")

        wait_for(
            member,
            "() => [...document.querySelectorAll('.cm-nib-caret-face')].some("
            f"  (one) => one.style.backgroundImage.includes({json.dumps(face['s'])}))",
            "[member] the owner's face on the owner's caret",
        )
        member.locator(".cm-editor").first.screenshot(path=str(SHOTS / "caret-face.png"))
        say("the member sees the owner's face on the owner's caret")

        tab = wait_for(
            member,
            "() => [...document.querySelectorAll('.who.face')].some("
            f"  (one) => one.style.backgroundImage.includes({json.dumps(face['s'])}))",
            "[member] the owner's face on the tab",
        )
        if tab:
            member.locator(".strip").first.screenshot(path=str(SHOTS / "tab-face.png"))
            say("and on the tab")

        # ── And that the owner is here ──────────────────────────────────
        owner_id = owner.evaluate("() => window.nibApp.account.user.id")
        until = time.monotonic() + PATIENCE
        state = None
        while time.monotonic() < until:
            state = worker.request(f"/v2/presence?ids={owner_id}", member_token)["presence"].get(owner_id)
            if state == "active":
                break
            time.sleep(0.5)
        if state != "active":
            failures.append(f"the member reads the owner as {state!r}, not active")
        else:
            say("the member reads the owner as active, from the hub")

    if failures:
        print("\nFAILED", flush=True)
        for one in failures:
            print(f"  - {one}", flush=True)
        return 1

    print("\na face set in one browser is on the Share sheet, a caret and a tab in another", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
