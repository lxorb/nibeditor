"""The colour a mark is drawn in, travelling between two devices of one account.

What the run is for: a space's icon and the icons of its folders have come down
with the account for a long time, and the colour each of those icons is drawn in
was this device's own - so a tree dressed on a desktop arrived on a phone in the
plain foreground. Migration 0036 gives the colour a column beside the icon it
colours, and this is the whole road: a real Worker, the migrations applied the way
a deploy runs them, one account signed in on two devices, and every question worth
asking of the pair.

No browser and no built app. What crosses between two devices here is a request
and a listing, and both ends of that are the Worker; the app's own halves of it are
measured in workspace/folder-icons.test.ts, workspace/device.test.ts and
services/sync/test/icons.test.ts. What no test can say is whether the column is
actually there after `wrangler d1 migrations apply` and whether the route writes
both halves in the one request, which is what this watches.

What it drives, in order:

    space       the space's own mark dressed on one device, read on the other
    folders     the icons of two folders and the colour of each, in one request
    older       an app with no word about the colours, which must undress nothing
    off         a colour taken off, which is the account's to say
    renamed     the map re-keyed under a renamed folder, colours and all
    refused     a hex, a path and a shouted name, none of which is an accent

Run it from the repository root:

    python apps/desktop/test/e2e/tints.py

It builds nothing. The log goes beside this file under `shots/tints-worker.log`,
which is ignored. A scratch drive rather than a test: it says what it saw.
"""

from __future__ import annotations

import hashlib
import json
import time
import urllib.error
import urllib.request
import uuid

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say = DRIVE.say
SHOTS = DRIVE.shots
#: The Worker's own address, which is also where the app it serves is loaded from.
ORIGIN = harness.worker_origin()


EMAIL = "tints-drive@example.com"

# What the picker writes, and what it writes beside it: an icon and one of the
# app's own accents by its id. See apps/desktop/src/lib/accents.ts.
DRESSED = {"Work": "Briefcase", "Work/Ideas": "folder-open"}
PAINTED = {"Work": "violet", "Work/Ideas": "teal"}

failures: list[str] = []


def shows(what: str, saw: object, wanted: object) -> None:
    """One thing the pair either says or does not. Every line of the run is one of
    these, so the output reads as the drive's own answer sheet."""
    if saw == wanted:
        say(f"ok   {what}: {saw!r}")
        return

    failures.append(what)
    say(f"NOT  {what}: {saw!r}, wanted {wanted!r}")


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


class Worker(harness.Worker):
    """The real Worker, with this drive's account in it; see harness.py."""

    def __init__(self) -> None:
        super().__init__(DRIVE)

    def account(self) -> str:  # type: ignore[override]
        """An account, put straight into the database: the emailed code is not what
        any of this is about."""
        now = int(time.time() * 1000)
        user = str(uuid.uuid4())
        self.sql(f"insert into users (id, email, created_at) values ('{user}', '{EMAIL}', {now});")

        return user

    def device(self, user: str, name: str) -> str:
        """One device of that account, signed in. Two of these is the whole point of
        the run: what one writes the other has to read."""
        token = uuid.uuid4().hex + uuid.uuid4().hex
        digest = hashlib.sha256(token.encode()).hexdigest()
        now = int(time.time() * 1000)

        self.sql(
            "insert into sessions (token_hash, user_id, created_at, expires_at, id, name,"
            f" last_used_at) values ('{digest}', '{user}', {now}, {now + 86400000},"
            f" '{uuid.uuid4().hex[:16]}', '{name}', {now});"
        )

        return token


def listed(token: str, space: str) -> dict:
    """The space as a device reads it on a pass: one listing, every space, and the
    marks along with the names. Which is the whole of how a colour travels - no
    device asks for one."""
    for one in request("/v1/spaces", token).get("spaces", []):
        if one.get("id") == space:
            return one

    raise SystemExit(f"the listing has no space {space}")


def drive() -> None:
    worker = Worker()

    with DRIVE.session(browser=False):
        worker.start()
        user = worker.account()
        here = worker.device(user, "the desktop")
        there = worker.device(user, "the phone")
        say("one account, two devices signed in")

        space = request("/v1/spaces", here, {"name": "Notes"})["space"]["id"]

        # ── The space's own mark ──────────────────────────────────────────────
        # One request, because it is one gesture in the picker: an icon and the
        # colour it is drawn in.
        dressed = request(
            f"/v1/spaces/{space}", here, {"icon": "Briefcase", "tint": "violet"}, method="PATCH"
        )
        shows("the desktop dresses the space", dressed["space"]["tint"], "violet")
        shows("the phone reads that colour", listed(there, space)["tint"], "violet")

        # ── The folders of its tree ───────────────────────────────────────────
        painted = request(
            f"/v1/spaces/{space}/icons", here, {"icons": DRESSED, "tints": PAINTED}, method="PUT"
        )
        shows("both maps come back from the one request", painted["tints"], PAINTED)

        phone = listed(there, space)
        shows("the phone reads the icons", phone["icons"], DRESSED)
        shows("and the colour of each", phone["tints"], PAINTED)

        # ── An app older than the colours ─────────────────────────────────────
        # It sends the icons alone. Undressing every colour on the account because
        # one machine has not been updated is the one thing that must not happen.
        old = request(
            f"/v1/spaces/{space}/icons",
            there,
            {"icons": {**DRESSED, "Travel": "Plane"}},
            method="PUT",
        )
        shows("an older app leaves the colours as they were", old["tints"], PAINTED)
        shows("while its own icon arrives", listed(here, space)["icons"].get("Travel"), "Plane")

        # ── A colour taken off ────────────────────────────────────────────────
        # The account holds the one copy, so this is what reaches the other device.
        request(
            f"/v1/spaces/{space}/icons",
            there,
            {"icons": DRESSED, "tints": {"Work": "violet"}},
            method="PUT",
        )
        shows("a colour taken off on the phone", listed(here, space)["tints"], {"Work": "violet"})

        bare = request(f"/v1/spaces/{space}", there, {"tint": None}, method="PATCH")
        shows("and the space's own, taken off", bare["space"]["tint"], None)
        shows("with its icon left where it was", bare["space"]["icon"], "Briefcase")

        # ── A folder renamed ──────────────────────────────────────────────────
        # The map is keyed by the path, so renaming a folder re-keys every entry
        # under it - which is one PUT of both maps, and the reason they go whole.
        request(
            f"/v1/spaces/{space}/icons",
            here,
            {
                "icons": {"Studio": "Briefcase", "Studio/Ideas": "folder-open"},
                "tints": {"Studio": "violet", "Studio/Ideas": "teal"},
            },
            method="PUT",
        )
        moved = listed(there, space)
        shows("a renamed folder keeps its icon", moved["icons"].get("Studio"), "Briefcase")
        shows("and its colour, under the new key", moved["tints"].get("Studio"), "violet")
        shows("with nothing left under the old one", moved["tints"].get("Work"), None)

        # ── What is not an accent ─────────────────────────────────────────────
        # The colours are the app's own, named by their ids; the service reads the
        # shape of one rather than a list, so a palette that gains a colour needs no
        # deploy. A hex or a path is not that shape.
        junk = request(
            f"/v1/spaces/{space}/icons",
            here,
            {
                "icons": {"Studio": "Briefcase"},
                "tints": {"Studio": "#7c6bf5", "Elsewhere": "../../etc"},
            },
            method="PUT",
        )
        shows("a hex and a path are dropped", junk["tints"], {})

        # Against a colour that is there, so what this measures is a junk value being
        # left out rather than written: an accent nobody can read is not a reason to
        # undress the mark.
        request(f"/v1/spaces/{space}", here, {"icon": "Briefcase", "tint": "teal"}, method="PATCH")
        for bad in ("#7c6bf5", "Violet", "rgb(1, 2, 3)"):
            refused = request(f"/v1/spaces/{space}", here, {"tint": bad}, method="PATCH")
            shows(f"{bad!r} leaves the colour as it was", refused["space"]["tint"], "teal")

        ahead = request(f"/v1/spaces/{space}", here, {"tint": "oxblood"}, method="PATCH")
        shows("but a colour a newer app named is carried", ahead["space"]["tint"], "oxblood")
        shows("and the other device reads it", listed(there, space)["tint"], "oxblood")

        # ── The column itself ─────────────────────────────────────────────────
        # What the migration actually added, read off the database rather than
        # through the route: two columns, beside the two icons they colour.
        columns = worker.sql(
            "select name from pragma_table_info('spaces') where name in ('tint', 'tints');"
        )
        shows("0036 added tint", "tint" in columns, True)
        shows("and tints", "tints" in columns, True)

    if failures:
        raise SystemExit(f"{len(failures)} of them did not: {', '.join(failures)}")

    say("every colour crossed")


if __name__ == "__main__":
    drive()
