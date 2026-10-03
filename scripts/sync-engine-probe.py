"""Two computers on sync v2, one of them offline while both write: the real packaged app.

docs/sync-v2.md section 12 asks for this once in the native app, beside the browser
drives (conflict.py, offline-days.py): two probe builds - two identifiers, so two devices
with two sync stores - signed in to one account on the real Worker under `wrangler dev`,
the account moved to v2:

  1. A starts with a space holding a note and a picture; B starts with nothing. B is
     handed both: the note's words and the picture's bytes, through the space.
  2. B's network goes: its only road to the Worker is a proxy this probe cuts. B's corner
     light goes hollow, never red.
  3. Both write in the note, a line each at its end, while apart.
  4. B's network comes back. Both machines end with one note holding both lines: no
     `(from another device` file anywhere, nothing asked, and the account says the same.

Every window through `probe_app.run_probe`, off the screen; spaces in temp folders. Both
builds bake the Worker's address in - A the Worker itself, B the proxy in front of it:

    scratchpad\\sync-client-engine\\build-probes.cmd   (two `tauri build --no-bundle --debug`
        of a `vite build --mode drive`, identifiers ch.emilvinu.nib.probe.sync-engine-a/-b,
        VITE_NIB_API http://127.0.0.1:8798 for A and :8799 for B, the updater blocked)
    python scripts/sync-engine-probe.py --a path/to/a/nib.exe --b path/to/b/nib.exe
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid

from probe_app import close_app, main_window, run_probe

HERE = pathlib.Path(__file__).resolve().parent
SERVICE = HERE.parent / "services" / "sync"
PORT = 8798
PROXY = 8799
API = f"http://127.0.0.1:{PORT}"
IDENTIFIERS = {"A": "ch.emilvinu.nib.probe.sync-engine-a", "B": "ch.emilvinu.nib.probe.sync-engine-b"}
SPACE = "Sync engine probe"
NOTE = "Plan.md"
OPENING = "# Plan\n\nThe line both computers start from.\n"
PICTURE = bytes((at * 7) % 251 for at in range(20_000))
LINES = {
    "A": "Written at the desk on A while B was away.",
    "B": "Train notes from laptop B, made offline.",
}
EMAIL = f"sync-engine-probe-{uuid.uuid4().hex[:8]}@example.com"
COPY = "(from another device"

failures: list[str] = []


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def wrong(words: str) -> None:
    failures.append(words)
    print(f"  WRONG: {words}", flush=True)


# ---- the Worker, and the road B reaches it by ----


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def npx(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [shutil.which("npx") or "npx", *args],
        cwd=SERVICE,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )


def api(path: str, token: str) -> object:
    call = urllib.request.Request(f"{API}{path}", headers={"authorization": f"Bearer {token}"})
    with urllib.request.urlopen(call, timeout=20) as answer:
        return json.loads(answer.read() or b"null")


class Worker:
    def __init__(self, log: pathlib.Path) -> None:
        self.log = log
        self.state = pathlib.Path(tempfile.mkdtemp(prefix="nib-sync-engine-worker-"))
        self.assets = pathlib.Path(tempfile.mkdtemp(prefix="nib-sync-engine-assets-"))
        (self.assets / "index.html").write_text("<!doctype html><title>probe</title>", encoding="utf-8")
        self.process: subprocess.Popen[bytes] | None = None
        self.opened = None

    def start(self) -> None:
        done = npx("wrangler", "d1", "migrations", "apply", "nib", "--local", "--persist-to", str(self.state))
        if done.returncode != 0:
            raise SystemExit(f"the migrations failed:\n{done.stdout}\n{done.stderr}")
        self.opened = self.log.open("wb")
        self.process = subprocess.Popen(
            [
                shutil.which("npx") or "npx",
                "wrangler",
                "dev",
                "--local",
                "--persist-to",
                str(self.state),
                "--port",
                str(PORT),
                "--ip",
                "127.0.0.1",
                # Its own, since other Workers may be running, and an empty folder for the
                # web app it would otherwise serve: the probes bring their own.
                "--inspector-port",
                str(free_port()),
                "--assets",
                str(self.assets),
                "--show-interactive-dev-session=false",
            ],
            cwd=SERVICE,
            stdout=self.opened,
            stderr=subprocess.STDOUT,
        )
        until = time.monotonic() + 120
        while time.monotonic() < until:
            if self.process.poll() is not None:
                raise SystemExit("the Worker stopped before it answered")
            try:
                with urllib.request.urlopen(f"{API}/health", timeout=5) as answer:
                    if json.loads(answer.read()).get("ok"):
                        return
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError, ValueError):
                time.sleep(1)
        raise SystemExit("the Worker never answered")

    def sql(self, statement: str) -> None:
        for _ in range(5):
            done = npx("wrangler", "d1", "execute", "nib", "--local", "--persist-to", str(self.state), f"--command={statement}")
            if done.returncode == 0:
                return
            time.sleep(2)
        raise SystemExit(f"that query failed:\n{statement}\n{done.stdout}\n{done.stderr}")

    def account(self) -> tuple[str, str]:
        """One account on sync v2, with a session for each computer."""
        tokens = [uuid.uuid4().hex + uuid.uuid4().hex for _ in range(2)]
        now = int(time.time() * 1000)
        user = str(uuid.uuid4())
        rows = [
            "insert into users (id, email, created_at, sync_version)"
            f" values ('{user}', '{EMAIL}', {now}, 2);"
        ]
        for token in tokens:
            digest = hashlib.sha256(token.encode()).hexdigest()
            rows.append(
                "insert into sessions (id, token_hash, user_id, created_at, expires_at)"
                f" values ('{uuid.uuid4()}', '{digest}', '{user}', {now}, {now + 86_400_000});"
            )
        self.sql("".join(rows))
        return tokens[0], tokens[1]

    def stop(self) -> None:
        # Only the process this probe started, by its PID, with what it started.
        if self.process:
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(self.process.pid)], capture_output=True, check=False)
            self.process = None
        if self.opened:
            self.opened.close()
        shutil.rmtree(self.state, ignore_errors=True)
        shutil.rmtree(self.assets, ignore_errors=True)


class Road:
    """A TCP proxy in front of the Worker, which this probe cuts and mends: B's network.
    Cut, every connection through it is closed and every new one refused at once, the
    way a laptop that lost its Wi-Fi finds the world."""

    def __init__(self) -> None:
        self.server = socket.create_server(("127.0.0.1", PROXY))
        self.open = True
        self.live: set[socket.socket] = set()
        self.lock = threading.Lock()
        threading.Thread(target=self.serve, daemon=True).start()

    def serve(self) -> None:
        while True:
            try:
                client, _ = self.server.accept()
            except OSError:
                return
            if not self.open:
                client.close()
                continue
            try:
                upstream = socket.create_connection(("127.0.0.1", PORT), timeout=10)
            except OSError:
                client.close()
                continue
            with self.lock:
                self.live.update((client, upstream))
            for one, other in ((client, upstream), (upstream, client)):
                threading.Thread(target=self.pipe, args=(one, other), daemon=True).start()

    def pipe(self, source: socket.socket, sink: socket.socket) -> None:
        try:
            while True:
                data = source.recv(65536)
                if not data:
                    break
                sink.sendall(data)
        except OSError:
            pass
        for one in (source, sink):
            try:
                one.close()
            except OSError:
                pass
            with self.lock:
                self.live.discard(one)

    def cut(self) -> None:
        self.open = False
        with self.lock:
            live = list(self.live)
        for one in live:
            try:
                one.shutdown(socket.SHUT_RDWR)
                one.close()
            except OSError:
                pass

    def mend(self) -> None:
        self.open = True

    def close(self) -> None:
        self.cut()
        self.server.close()


# ---- the two computers ----


def config_dir(identifier: str) -> pathlib.Path:
    roaming = os.environ.get("APPDATA") or str(pathlib.Path.home() / "AppData" / "Roaming")
    return pathlib.Path(roaming) / identifier


def local_dir(identifier: str) -> pathlib.Path:
    local = os.environ.get("LOCALAPPDATA") or str(pathlib.Path.home() / "AppData" / "Local")
    return pathlib.Path(local) / identifier


def wipe(identifier: str) -> None:
    if ".probe." not in identifier:
        raise SystemExit("not a probe identifier: refusing to delete its folders")
    for one in (config_dir(identifier), local_dir(identifier)):
        until = time.perf_counter() + 15
        while one.exists() and time.perf_counter() < until:
            shutil.rmtree(one, ignore_errors=True)
            time.sleep(0.5)


class Computer:
    def __init__(self, label: str, exe: pathlib.Path, token: str, seeded: bool) -> None:
        self.label = label
        self.exe = exe
        self.token = token
        self.identifier = IDENTIFIERS[label]
        self.spaces = pathlib.Path(tempfile.mkdtemp(prefix=f"nib-sync-engine-{label.lower()}-"))
        if seeded:
            space = self.spaces / SPACE
            space.mkdir(parents=True)
            (space / NOTE).write_text(OPENING, encoding="utf-8")
            (space / "photo.png").write_bytes(PICTURE)
        self.process: subprocess.Popen[bytes] | None = None
        self.port = 0
        self.secret = ""

    def endpoint(self, unlike: int = 0) -> None:
        path = config_dir(self.identifier) / "automation.json"
        until = time.perf_counter() + 150
        while time.perf_counter() < until:
            try:
                said = json.loads(path.read_text(encoding="utf-8"))
                if said.get("port") and said.get("secret") and int(said["port"]) != unlike:
                    self.port, self.secret = int(said["port"]), str(said["secret"])
                    return
            except (OSError, ValueError):
                pass
            time.sleep(0.2)
        raise SystemExit(f"{self.label} never wrote {path}")

    def launch(self) -> None:
        wipe(self.identifier)
        env = {**os.environ, "NIB_SPACES_DIR": str(self.spaces)}
        # Once to write the endpoint file, so eval can be turned on in it.
        self.process = run_probe(self.exe, env=env, quiet=True)
        self.endpoint()
        if not close_app(self.process):
            self.process.kill()
        path = config_dir(self.identifier) / "automation.json"
        said = json.loads(path.read_text(encoding="utf-8"))
        said["eval"] = True
        path.write_text(json.dumps(said), encoding="utf-8")
        time.sleep(1)

        unlike = self.port
        self.process = run_probe(self.exe, env=env, quiet=True)
        self.endpoint(unlike)
        until = time.perf_counter() + 90
        while time.perf_counter() < until and not main_window(self.process.pid):
            time.sleep(0.2)
        time.sleep(2)

    def ask(self, code: str, seconds: float = 60) -> object:
        body = json.dumps({"verb": "eval", "args": {"code": code, "yes": True}, "rest": []}).encode()
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/",
            data=body,
            headers={"authorization": f"Bearer {self.secret}", "content-type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=seconds) as answer:
                said = json.loads(answer.read().decode("utf-8", "replace"))
        except (urllib.error.URLError, TimeoutError, ConnectionError, ValueError) as failed:
            return {"error": str(failed)}
        if isinstance(said, dict) and said.get("ok"):
            return said.get("value")
        return {"error": said}

    def wait(self, code: str, what: str, seconds: float = 90) -> object:
        until = time.perf_counter() + seconds
        while time.perf_counter() < until:
            said = self.ask(code)
            if said and not (isinstance(said, dict) and "error" in said):
                return said
            time.sleep(0.3)
        raise SystemExit(f"gave up waiting for {self.label}: {what}")

    def sign_in(self) -> None:
        self.ask(f"localStorage.setItem('nib:session', {json.dumps(self.token)}); location.reload(); true")
        time.sleep(4)
        self.wait("window.nibApp?.sync.version === 2 && !!window.nibApp.sync.engine", "v2 to start")

    def root(self) -> pathlib.Path:
        return self.spaces / SPACE

    def write_line(self, words: str) -> None:
        """A line typed at the end of the note, through the editor, and written down the
        way the pause does."""
        opened = self.ask(
            """(async () => {
              const ws = window.nibApp.workspace
              const space = ws.spaces.find((one) => one.name === %s)
              if (ws.activeSpaceId !== space.id) await ws.selectSpace(space.id)
              await ws.loadTree()
              const note = ws.notes.find((one) => one.name === %s)
              await ws.openEntry(note.path, { activate: true })
              return ws.active?.path ?? null
            })()"""
            % (json.dumps(SPACE), json.dumps(NOTE))
        )
        if not opened or isinstance(opened, dict):
            wrong(f"{self.label} could not open the note: {opened}")
            return
        time.sleep(1.5)
        said = self.ask(
            """(async () => {
              const app = window.nibApp
              const view = app.views.of(app.workspace.panes.focusedId)
              if (!view) return 'no editor'
              view.dispatch({ changes: { from: view.state.doc.length, insert: %s }, userEvent: 'input.type' })
              await app.workspace.writeNow()
              return 'typed'
            })()"""
            % json.dumps(f"\n{words}\n")
        )
        if said != "typed":
            wrong(f"{self.label} could not type: {said}")
        time.sleep(1.5)

    def settled(self) -> None:
        self.ask("window.nibApp.sync.nudge(); true")
        time.sleep(3)
        self.wait("window.nibApp.sync.status === 'idle' && !window.nibApp.sync.passing", "a quiet pass", 120)

    def files(self) -> dict[str, bytes]:
        out: dict[str, bytes] = {}
        root = self.root()
        if root.exists():
            for one in root.rglob("*"):
                if one.is_file() and not any(part.startswith(".") for part in one.relative_to(root).parts):
                    out[one.relative_to(root).as_posix()] = one.read_bytes()
        return out

    def quit(self) -> None:
        if self.process and self.process.poll() is None and not close_app(self.process):
            self.process.kill()
        self.process = None


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives Windows builds")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--a", type=pathlib.Path, required=True)
    parsed.add_argument("--b", type=pathlib.Path, required=True)
    parsed.add_argument("--log", type=pathlib.Path, default=pathlib.Path(tempfile.gettempdir()) / "sync-engine-probe-worker.log")
    options = parsed.parse_args()

    worker = Worker(options.log)
    road: Road | None = None
    computers: list[Computer] = []
    measured: dict[str, object] = {}
    try:
        worker.start()
        road = Road()
        token_a, token_b = worker.account()
        a = Computer("A", options.a, token_a, seeded=True)
        b = Computer("B", options.b, token_b, seeded=False)
        computers = [a, b]

        say("A starts with a note and a picture, signs in on an account on sync v2")
        a.launch()
        a.sign_in()
        a.wait(
            f"!!window.nibApp.sync.remoteIdFor(window.nibApp.workspace.spaces.find((one) => one.name === {json.dumps(SPACE)})?.root ?? '')",
            "the space on the account",
        )
        a.settled()

        say("B starts with nothing and is handed both")
        started = time.perf_counter()
        b.launch()
        b.sign_in()
        until = time.perf_counter() + 120
        while time.perf_counter() < until:
            held = b.files()
            if held.get(NOTE) == OPENING.encode() and held.get("photo.png") == PICTURE:
                break
            b.ask("window.nibApp.sync.nudge(); true")
            time.sleep(1)
        held = b.files()
        measured["B signed in to both files on its disk, s"] = round(time.perf_counter() - started, 1)
        if held.get(NOTE) != OPENING.encode():
            wrong(f"B never got the note: {sorted(held)}")
        if held.get("photo.png") != PICTURE:
            wrong("B never got the picture's bytes")
        b.settled()

        say("B's network goes; both write a line at the end of the note")
        road.cut()
        b.ask("window.nibApp.sync.nudge(); true")
        light = b.wait("window.nibApp.sync.status === 'offline' ? 'offline' : ''", "the hollow light", 60)
        measured["B's light while away"] = light
        dot = b.ask("document.querySelector('.act.offline') ? 'hollow dot drawn' : 'no hollow dot'")
        measured["B's corner"] = dot
        a.write_line(LINES["A"])
        b.write_line(LINES["B"])
        a.settled()

        say("B's network comes back")
        started = time.perf_counter()
        road.mend()
        expected = [LINES["A"], LINES["B"]]
        until = time.perf_counter() + 120
        while time.perf_counter() < until:
            notes = [one.files().get(NOTE, b"").decode("utf-8", "replace") for one in computers]
            if all(all(line in note for line in expected) for note in notes):
                break
            for one in computers:
                one.ask("window.nibApp.sync.nudge(); true")
            time.sleep(1)
        measured["back online to both lines on both disks, s"] = round(time.perf_counter() - started, 1)
        for one in computers:
            one.settled()

        for one in computers:
            text = one.files().get(NOTE, b"").decode("utf-8", "replace")
            say(f"{one.label}'s {NOTE}: {json.dumps(text)}")
            for line in expected:
                if line not in text:
                    wrong(f"{one.label}'s note lacks {line!r}")
            copies = [name for name in one.files() if COPY in name]
            if copies:
                wrong(f"{one.label} has a copy beside the note: {copies}")
            held_notes = one.ask("(window.nibApp.sync.engine?.heldNotes ?? []).length")
            if held_notes:
                wrong(f"{one.label} asks about {held_notes} note(s)")
            status = one.ask("window.nibApp.sync.status")
            if status != "idle":
                wrong(f"{one.label}'s light says {status}")

        space_id = a.ask(
            f"window.nibApp.sync.remoteIdFor(window.nibApp.workspace.spaces.find((one) => one.name === {json.dumps(SPACE)}).root)"
        )
        listed = api(f"/v1/spaces/{space_id}/changes?since=0", token_a)
        names = [one["path"] for one in listed.get("notes", []) if not one.get("deleted")] if isinstance(listed, dict) else []
        say(f"the account holds {sorted(names)}")
        if any(COPY in name for name in names):
            wrong(f"the account holds a copy: {names}")
        for one in listed.get("notes", []) if isinstance(listed, dict) else []:
            if one["path"] == NOTE:
                text = api(f"/v1/notes/{one['id']}", token_a).get("content", "")
                for line in expected:
                    if line not in text:
                        wrong(f"the account's note lacks {line!r}")
    finally:
        for one in computers:
            one.quit()
        if road:
            road.close()
        worker.stop()
        for one in computers:
            wipe(one.identifier)
            shutil.rmtree(one.spaces, ignore_errors=True)

    print(json.dumps(measured, indent=2), flush=True)
    if failures:
        print(f"\n{len(failures)} thing(s) wrong:", flush=True)
        for one in failures:
            print(f"  - {one}", flush=True)
        return 1
    print("\ntwo computers, one offline, one note with both lines and no copy", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
