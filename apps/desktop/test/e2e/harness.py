"""The one harness under every drive in this folder.

Not a drive. Sixty-one of the drives here each carried a server, a port, a build, a
browser and a way of waiting of their own, and nothing ran them: a CI job had never
once started one but `smoke.py`. Each of those copies was written beside the batch
that needed it and each drifted on its own - a port two drives both picked, a
server that let the browser guess how long an asset was good for, a Worker drive
that rebuilt `dist` under the drive after it, a sleep where the app had a signal to
wait on. So what goes round a drive's steps is here, once, and a drive is its steps:

    from harness import Drive

    DRIVE = Drive(__file__)
    say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for


    def drive(browser):
        page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
        DRIVE.open(page)
        DRIVE.seed(page, "# Plan\\n\\nWhat we are doing.\\n")
        DRIVE.open_note(page, "Plan")
        ...
        if something_is_off:
            wrong("what a person would have seen")
        shot(page, "01-plan")


    if __name__ == "__main__":
        raise SystemExit(DRIVE.run(drive))

What that one import does, in the order a run meets it:

  - **One build.** `vite build --mode drive`: the release shape with the two handles
    a drive steers by, `window.nibApp` and `window.nib`, left on the page. A drive
    run by hand builds; `NIB_SKIP_BUILD=1` reuses `apps/desktop/dist`, which is how
    run-all.py hands every drive the one build it made. A drive against the real
    Worker loads a build of its own, `apps/desktop/dist-worker`, which asks its own
    origin for the API, so one build serves a Worker on any port and `dist` is never
    replaced under a drive that is still fetching from it.
  - **Its own origin.** The build is served on a port nobody picked - the system
    hands out a free one - under `http://<drive>.localhost:<port>`, so no two drives
    share storage, a service worker or a cookie, and none shares them with the dev
    server on 1420. Chrome resolves every `*.localhost` to the loopback itself.
  - **Served the way a deploy serves it.** HTTP/1.1 with the connection kept, a
    hashed asset good for ever and everything else checked every time, one fixed
    `Last-Modified`, and the types written out rather than read from the Windows
    registry, which has been known to call a script `text/plain`. See `Files`. A
    route of the drive's own is `DRIVE.answers`, a header `DRIVE.header`, a second
    server - a fake provider - `DRIVE.side`. A drive that imports the app's modules
    by their paths asks for a Vite dev server instead: `Drive(__file__, dev=True)`.
  - **The browser CI has.** Playwright's own Chromium, headless, so a drive says the
    same thing here as on the nightly run; `NIB_BROWSER=chrome` for the machine's
    own Chrome.
  - **The app's own signals.** `open` waits for the handle, the space and the last
    mark of the launch order (`nib: launch order finished`, lib/startup.svelte.ts),
    which is the app saying it is up, instead of a number of milliseconds.
  - **One verdict.** `wrong` counts, a page error counts, and the exit status is
    non-zero when anything did. `wait_for` walks out at once with `gave up waiting
    for`, which says the app never got there; `waited` counts that and carries on,
    for a step the rest of the drive does not stand on.
  - **A Worker when the drive wants one**, `Worker(DRIVE)`: `wrangler dev --local`
    with a database of this run's own in a temp folder, torn down with every
    process under it. `--local` switches the remote bindings off, so the Worker
    starts without a Cloudflare token: nothing a drive does reaches Workers AI.
  - **A native probe when the drive wants one**, `Native(DRIVE, exe)`: through
    scripts/probe_app.py's `run_probe`, off the screen, with `NIB_SPACES_DIR` in a
    temp folder, never the reader's own notes.

A drive says what it needs that a machine may not have with `NEEDS` at the top of
its file - `NEEDS = ("native",)` - and run-all.py lists it as skipped, with the
reason, wherever that is missing; and how long an honest run of it takes, where that
is longer than any drive is given, with `BUDGET = <seconds>`. See
docs/conventions.md, "Drives".
"""

from __future__ import annotations

import contextlib
import errno
import faulthandler
import functools
import hashlib
import http.server
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from collections.abc import Callable, Iterator, Mapping, Sequence
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
APP = ROOT / "apps" / "desktop"
#: The build every drive serves. `NIB_DIST` names another folder - the other half of
#: a before-and-after - which was built by hand and is never rebuilt here.
DIST = APP / os.environ.get("NIB_DIST", "dist")
OWN_BUILD = "NIB_DIST" not in os.environ
#: The build a Worker serves, asking its own origin for the API; see `Worker`.
WORKER_DIST = APP / os.environ.get("NIB_WORKER_DIST", "dist-worker")
SERVICE = ROOT / "services" / "sync"
SHOTS = HERE / "shots"

#: Which of the two builds a folder holds, written beside it, so a run can tell
#: whether it may reuse what is there: the plain one, or the one a Worker serves.
POINTED = ".nib-build"

#: A page on the app's own origin that is not the app: somewhere to write its storage
#: before the app is up to read it. Every build made here carries it, and the server
#: answers it for a folder built by hand.
SEED_PATH = "/seed.html"
SEED_PAGE = "<!doctype html><title>seed</title><p>seeding"

#: How long anything a drive waits for is given by default, in seconds.
PATIENCE = 30

#: How long a Worker is given to answer, and a build to finish.
WORKER_PATIENCE = 90
BUILD_PATIENCE = 600

#: How long closing may take once a drive's steps are done - the browser, Playwright,
#: the servers, the Worker. Playwright Test gives a worker's teardown a fixed time and
#: then ends it. Here the time is longer, because closing a browser on a busy Windows
#: machine is mostly its profile being deleted and has been measured at forty seconds;
#: but a browser has also been seen to go and leave Playwright waiting for it for
#: fifteen minutes, so a close that outlasts this is ended, and the drive's own
#: verdict stands.
TEARDOWN = 90

#: The drive's needs this harness knows how to answer, and what each wants. Read by
#: run-all.py off the drive's source, which is why it is a word and not a function.
NEEDS = {
    "native": "a native probe build (Windows, NIB_PROBE_EXE)",
}

#: The last mark the launch order makes, on the page's own timeline; see mark() in
#: lib/trace.ts and run() in lib/startup.svelte.ts. Every stage behind the first
#: paint has had its turn by then, which is what "the app is up" means.
LAUNCHED = "nib: launch order finished"


def say(words: str) -> None:
    print(f"  {words}", flush=True)


# A drive that hangs says where, all its threads, a little before run-all.py gives up
# on it - which is the difference between "it timed out" and a line to look at.
if os.environ.get("NIB_HANG_AFTER"):
    faulthandler.dump_traceback_later(float(os.environ["NIB_HANG_AFTER"]), exit=False)

# A drive says what it saw, arrows and all, and a Windows console that cannot draw a
# character is no reason for the drive to stop: such a character is written as its
# escape instead.
for _stream in (sys.stdout, sys.stderr):
    with contextlib.suppress(AttributeError, ValueError):
        _stream.reconfigure(errors="backslashreplace")  # type: ignore[union-attr]


# ---------------------------------------------------------------------- the build


def tool(package: Path, name: str) -> list[str]:
    """A command from a package's own node_modules: its bin shim directly, which is
    a second or two quicker per call than asking npx to find it, and npx otherwise."""
    shim = package / "node_modules" / ".bin" / (f"{name}.cmd" if os.name == "nt" else name)
    if shim.exists():
        return [str(shim)]
    return [shutil.which("npx") or "npx", name]


def build(into: Path = DIST, served_by_worker: bool = False) -> None:
    """The drive build, into `into`, reused when `NIB_SKIP_BUILD` says so and the
    folder holds the same kind of build.

    `--mode drive` and nothing else: a release in every respect but the handles, which
    is the shape that ships and so the shape worth driving. The build a Worker serves
    asks its own origin for the API - an empty `VITE_NIB_API` - which is how the web
    app at nibeditor.com talks to its Worker, and which makes one build good for a
    Worker on any port: every drive against one runs a Worker of its own, beside the
    others."""
    kind = "worker" if served_by_worker else "plain"
    if os.environ.get("NIB_SKIP_BUILD") and built(into, kind):
        say(f"reusing the build in {into.name}")
        return

    say(f"building the web app into {into.name}")
    started = time.monotonic()
    shutil.rmtree(into, ignore_errors=True)
    environment = {**os.environ}
    environment.pop("NODE_ENV", None)
    if served_by_worker:
        environment["VITE_NIB_API"] = ""
    else:
        environment.pop("VITE_NIB_API", None)
    done = subprocess.run(
        [*tool(APP, "vite"), "build", "--mode", "drive", "--outDir", str(into), "--emptyOutDir"],
        cwd=APP,
        env=environment,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=BUILD_PATIENCE,
        check=False,
    )
    if done.returncode != 0:
        raise SystemExit(f"the build failed:\n{done.stdout}\n{done.stderr}")
    (into / POINTED).write_text(kind, encoding="utf-8")
    (into / SEED_PATH.lstrip("/")).write_text(SEED_PAGE, encoding="utf-8")
    say(f"built in {time.monotonic() - started:.0f}s")


def built(into: Path, kind: str) -> bool:
    """Whether `into` holds a build of this kind. A folder with no word on it was made
    by hand or by an older runner, and is taken to be the plain one."""
    if not (into / "index.html").exists():
        return False
    pointed = into / POINTED
    said = pointed.read_text(encoding="utf-8").strip() if pointed.exists() else "plain"
    return said == kind


# ------------------------------------------------------------------ the server


#: The types a build is made of, written out: Python otherwise asks the Windows
#: registry, where an installed program can have made `.js` anything at all, and a
#: module script served as `text/plain` is an app that never starts.
TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".map": "application/json",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".wasm": "application/wasm",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".pdf": "application/pdf",
    "": "application/octet-stream",
}

#: One date for every file. A build's own mtimes are the time it was made, and a
#: browser left to guess how long a file is good for guesses a tenth of its age - so
#: two builds made minutes apart were served as two different launches.
STAMP = "Mon, 01 Jan 2024 00:00:00 GMT"

#: What a drive may answer a request with itself, ahead of the folder: a page of its
#: own, a mark, a header. Returns whether it answered.
Answer = Callable[["Files"], bool]


class Files(http.server.SimpleHTTPRequestHandler):
    """The folder, served the way a deploy serves it.

    HTTP/1.1, so a page of thirty assets is one connection rather than thirty - each
    a thread taking the interpreter's lock from the drive that is measuring. Then a
    `Cache-Control` on everything: a file under a hash of its contents is good for
    ever, and the page that names them is asked about every time, so a rebuild is
    never missed and an unchanged asset is never fetched twice. That is what the
    Worker sends for the same files."""

    protocol_version = "HTTP/1.1"
    extensions_map = TYPES
    #: A kept connection holds a thread; this is how long an idle one keeps it.
    timeout = 10

    #: Set per server; see `Served`.
    folder = str(DIST)
    answer: Answer | None = None
    extra: Mapping[str, str] = {}

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=self.folder, **kwargs)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        return

    def tally(self) -> dict[str, int]:
        return self.server.tally  # type: ignore[attr-defined, no-any-return]

    def do_GET(self) -> None:  # noqa: N802 - the name http.server wants
        if self.answer is not None and self.answer(self):
            return
        if self.path == SEED_PATH and not (Path(self.folder) / SEED_PATH.lstrip("/")).exists():
            self.reply(SEED_PAGE)
            return
        super().do_GET()

    def do_HEAD(self) -> None:  # noqa: N802
        if self.answer is not None and self.answer(self):
            return
        super().do_HEAD()

    def send_response(self, code: int, message: str | None = None) -> None:
        held = self.tally()
        held["asked"] += 1
        if code == 200:
            held["sent"] += 1
        elif code == 304:
            held["again"] += 1
        super().send_response(code, message)

    def send_header(self, keyword: str, value: str) -> None:
        if keyword == "Last-Modified":
            value = STAMP
        if keyword == "Content-Length":
            self.tally()["bytes"] += int(value)
        super().send_header(keyword, value)

    def end_headers(self) -> None:
        # `_headers_buffer` is where http.server keeps what this response has said so
        # far; an answer that chose its own caching keeps it.
        said = b"".join(getattr(self, "_headers_buffer", [])).lower()
        if b"cache-control:" not in said:
            name = self.path.split("?", 1)[0]
            forever = name.startswith("/assets/") and "." in name.rsplit("/", 1)[-1]
            super().send_header(
                "Cache-Control", "public, max-age=31536000, immutable" if forever else "no-cache"
            )
        for keyword, value in self.extra.items():
            super().send_header(keyword, value)
        super().end_headers()

    def reply(self, body: bytes | str, kind: str = "text/html; charset=utf-8", code: int = 200) -> bool:
        """A whole answer of a drive's own, in one call. True, so an `Answer` can end
        with `return request.reply(...)`."""
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)
        return True


class _Loopback(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False
    #: The page asks for every chunk it preloads at once, a hundred and fifty of them,
    #: and the default backlog of five turned some away on Windows: the app then never
    #: came up, one run in two - which reads as the app being broken.
    request_queue_size = 256

    def handle_error(self, request: Any, client_address: Any) -> None:
        """A browser that closed a connection it no longer wanted - a page reloaded,
        a context closed - is not an error worth a traceback in the run."""
        if isinstance(sys.exc_info()[1], (ConnectionError, TimeoutError)):
            return
        super().handle_error(request, client_address)


class _Loopback6(_Loopback):
    address_family = socket.AF_INET6


class Served:
    """A folder on a free port of both loopback addresses.

    Both, because Chrome asks `::1` first for a `*.localhost` name and a server on
    `127.0.0.1` alone costs every connection the wait before it falls back - a third
    of a second a page, measured. The same port on each, so one origin reaches both."""

    def __init__(
        self,
        folder: Path | None = None,
        answer: Answer | None = None,
        headers: Mapping[str, str] | None = None,
        handler: type[http.server.BaseHTTPRequestHandler] | None = None,
    ) -> None:
        if handler is None:
            handler = type(
                "Handler",
                (Files,),
                {
                    "folder": str(folder or DIST),
                    "answer": staticmethod(answer) if answer else None,
                    "extra": dict(headers or {}),
                },
            )
        self.handler = handler

        self.servers: list[http.server.ThreadingHTTPServer] = []
        for _ in range(20):
            first = _Loopback(("127.0.0.1", 0), handler)
            try:
                second: _Loopback | None = _Loopback6(("::1", first.server_address[1]), handler)
            except OSError as error:
                # Somebody else on this port's `::1` is a reason to take another port;
                # a machine with no IPv6 is not, and Chrome then only asks the one.
                if error.errno in (errno.EADDRINUSE, getattr(errno, "WSAEADDRINUSE", -1)):
                    first.server_close()
                    continue
                second = None
            self.servers = [first, *([second] if second else [])]
            break
        else:
            raise SystemExit("no free port on the loopback for the file server")

        self.port = self.servers[0].server_address[1]
        self.tally = {"asked": 0, "sent": 0, "again": 0, "bytes": 0}
        for one in self.servers:
            one.tally = self.tally  # type: ignore[attr-defined]
            threading.Thread(target=one.serve_forever, name=f"serve {self.port}", daemon=True).start()

    def origin(self, host: str = "127.0.0.1") -> str:
        return f"http://{host}:{self.port}"

    def close(self) -> None:
        for one in self.servers:
            one.shutdown()
            one.server_close()


def side(handler: type[http.server.BaseHTTPRequestHandler]) -> Served:
    """A server of a drive's own on a free port - a fake OpenAI-compatible provider, a
    page the app is pointed at - stopped with the drive when it is started through
    `Drive.side`."""
    return Served(handler=handler)


def free_port() -> int:
    """A port nothing holds right now, for a process that binds it itself."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


# ----------------------------------------------------------------- processes


def spawn(command: Sequence[str], **options: Any) -> subprocess.Popen[bytes]:
    """A process in a group of its own, so `end` can take everything under it: a
    `wrangler dev` is a node inside a node around a workerd, and ending only the
    outermost leaves the runtime holding the port."""
    if os.name == "nt":
        options.setdefault("creationflags", subprocess.CREATE_NEW_PROCESS_GROUP)
    else:
        options.setdefault("start_new_session", True)
    process = subprocess.Popen(list(command), **options)
    SPAWNED.add(process)
    return process


#: Every process `spawn` started and `end` has not ended yet.
SPAWNED: set[subprocess.Popen[Any]] = set()


def end(process: subprocess.Popen[Any] | None, grace: float = 10) -> None:
    """The process and every process under it, by its own number and never by name:
    somebody else's node on this machine is not this drive's to end."""
    SPAWNED.discard(process)  # type: ignore[arg-type]
    if process is None or process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/T", "/F", "/PID", str(process.pid)], capture_output=True, check=False
        )
    else:
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=grace)
    except subprocess.TimeoutExpired:
        if os.name != "nt":
            with contextlib.suppress(ProcessLookupError, PermissionError):
                os.killpg(process.pid, signal.SIGKILL)
        process.kill()
        process.wait(timeout=grace)


def _driver(play: Any) -> int | None:
    """The process number of Playwright's own driver under this `sync_playwright`.
    Read off Playwright's internals, and nothing is lost when they move: the closing
    watch then only has the processes it started itself to end."""
    with contextlib.suppress(AttributeError, TypeError):
        return int(play.stop.__self__._connection._transport._proc.pid)
    return None


def _kill(pid: int) -> None:
    """One process of Playwright's, and on Windows everything under it."""
    if os.name == "nt":
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(pid)], capture_output=True, check=False)
    else:
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.kill(pid, signal.SIGKILL)


class _Closing:
    """A watch over a drive's closing, armed once its steps are done.

    A close still going after `TEARDOWN` seconds says so with every thread's stack and
    ends Playwright's driver, which is what a stuck call is waiting on and whose going
    wakes it. One still stuck after that ends every process this drive started and
    leaves with the drive's own verdict."""

    def __init__(self, drive: Drive) -> None:
        self.drive = drive
        self.driver: int | None = None
        self.done = threading.Event()
        self.fired = False
        self.clean = True

    def start(self) -> None:
        # Called in the `finally` after the drive's steps: whether they walked out is
        # whether an exception is on its way through.
        self.clean = sys.exc_info()[1] is None
        threading.Thread(target=self._watch, name="closing watch", daemon=True).start()

    def _watch(self) -> None:
        if self.done.wait(TEARDOWN):
            return
        self.fired = True
        say(f"closing took longer than {TEARDOWN}s; ending the browser (every thread below)")
        faulthandler.dump_traceback(all_threads=True)
        if self.driver:
            _kill(self.driver)
        if self.done.wait(15):
            return
        for one in list(SPAWNED):
            end(one)
        code = self.drive.verdict() if self.clean else 1
        sys.stdout.flush()
        os._exit(code)


# ---------------------------------------------------------------------- a drive


class Drive:
    """One drive's run: its name, its origin, its shots and its verdict.

    Made at the top of the drive's file, so the rest of it can name `ORIGIN` and
    `SHOTS` the way it always did. The port is bound here, which costs a socket; the
    build and the browser wait for `run` or `session`."""

    def __init__(
        self,
        file: str,
        *,
        served: bool = True,
        folder: Path = DIST,
        shots: str | None = None,
        fresh: bool = True,
        dev: bool = False,
        known: Mapping[str, str] | None = None,
    ) -> None:
        self.name = Path(file).stem
        #: A Vite dev server rather than the build, for a drive that imports the app's
        #: own modules by their paths, which only a dev server answers. It builds
        #: nothing and leaves `dist` alone.
        self.dev = dev
        self.dev_port = free_port() if dev else 0
        self.shots = SHOTS / (shots or self.name)
        #: Whether a run starts from an empty shots folder. A drive that compares
        #: this run with the one before it keeps what that one wrote.
        self.fresh = fresh
        #: Failures already found and handed on, each by words it says and who has it:
        #: the run goes past them and names them every time, the way Chromium's own
        #: harness keeps a failure it expects with the bug that owns it. One that no
        #: longer happens is said too, so the entry is taken off rather than left.
        self.known = dict(known or {})
        self._cleared = False
        self.failures: list[str] = []
        self.folder = folder
        self._stack = contextlib.ExitStack()
        #: Somebody else's server to drive instead of a build of this run's own: the
        #: dev server on 1420, or whatever a desktop build is loading from.
        self.borrowed = os.environ.get("NIB_ORIGIN", "").rstrip("/")
        self.served = served and not self.borrowed and not dev
        self.server = Served(folder) if self.served else None
        if self.borrowed:
            self.origin = self.borrowed
        elif dev:
            self.origin = f"http://{self.name}.localhost:{self.dev_port}"
        elif self.server:
            self.origin = self.server.origin(f"{self.name}.localhost")
        else:
            self.origin = ""

    def header(self, name: str, value: str) -> None:
        """A header on every answer from now on - the app's own policy, say, which is
        only known once the build it is read out of has been made."""
        if self.server is not None:
            self.server.handler.extra[name] = value  # type: ignore[attr-defined]

    def answers(self, answer: Answer) -> Answer:
        """A request the drive answers itself, ahead of the build: a page of its own,
        a picture, a header. Used as a decorator; the answer returns whether it did."""
        if self.server is not None:
            self.server.handler.answer = staticmethod(answer)  # type: ignore[attr-defined]
        return answer

    # -- what a drive says

    def say(self, words: str) -> None:
        say(words)

    def wrong(self, what: str) -> None:
        """Something a person would have seen, counted; the drive carries on so one
        run says everything that is off rather than the first thing."""
        say(f"FAILED: {what}")
        self.failures.append(what)

    def shot(self, page: Any, name: str, **options: Any) -> Path:
        """The page - or a locator - as a picture in this drive's shots folder. A name
        with a slash in it is a folder inside that one."""
        path = self.shots / f"{name}.png"
        path.parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(path), **options)
        say(f"shot {name}.png")
        return path

    def steady(self, page: Any, name: str, **options: Any) -> Path:
        """A shot kept only once two in a row match; see settling.py."""
        from settling import steady

        self.shots.mkdir(parents=True, exist_ok=True)
        path = self.shots / f"{name}.png"
        path.write_bytes(steady(page, lambda: page.screenshot(**options), say, name))
        say(f"shot {name}.png")
        return path

    def wait_for(self, page: Any, expression: str, what: str, patience: float = PATIENCE) -> Any:
        """Until the expression is true in the page - an expression, or a function
        the page calls - and what it came to; or out with `gave up waiting for`, which
        says the app never got there rather than that it is wrong."""
        try:
            # On a timer rather than on frames: a page in a context nobody is
            # looking at can go without a frame for as long as it likes.
            came = page.wait_for_function(expression, timeout=patience * 1000, polling=50)
        except Exception as error:
            if "Timeout" not in type(error).__name__ and "Timeout" not in str(error):
                raise
            raise SystemExit(f"gave up waiting for {what}") from None
        return came.json_value()

    def waited(self, page: Any, expression: str, what: str, patience: float = PATIENCE) -> bool:
        """Whether the expression came true in time. When it did not, that is counted
        as a failure and the drive carries on, for a step that the rest of the run
        does not stand on."""
        try:
            self.wait_for(page, expression, what, patience)
        except SystemExit:
            self.wrong(f"gave up waiting for {what}")
            return False
        return True

    # -- the browser

    def browser(self, play: Any, **options: Any) -> Any:
        """Playwright's own Chromium, new headless, which is what the nightly run has;
        the machine's Chrome with `NIB_BROWSER=chrome`."""
        channel = os.environ.get("NIB_BROWSER", "chromium")
        options.setdefault("channel", channel)
        return play.chromium.launch(**options)

    def context(self, browser: Any, **options: Any) -> Any:
        return browser.new_context(**options)

    def persistent(self, play: Any, profile: Path, **options: Any) -> Any:
        """A browser with its profile on disk, for a drive whose question is what
        survives the browser being closed and opened again."""
        options.setdefault("channel", os.environ.get("NIB_BROWSER", "chromium"))
        return play.chromium.launch_persistent_context(user_data_dir=str(profile), **options)

    def page(self, browser: Any, errors: bool = True, **options: Any) -> Any:
        """A page in a context of its own. A script error the page throws is a
        failure unless `errors` is false, because an app that threw is an app that
        broke whether or not the drive's own question noticed."""
        page = self.context(browser, **options).new_page()
        if errors:
            page.on("pageerror", lambda error: self.wrong(f"page error: {error}"))
        return page

    def open(
        self, page: Any, path: str = "/", origin: str | None = None, patience: float = PATIENCE
    ) -> None:
        """The app, at this drive's origin - or a Worker's - and up. Given the same
        patience as the rest of the wait, whatever the drive set its own steps to: a
        page of a hundred and fifty chunks on a busy machine is a page that takes a
        while, and that is not the app being wrong."""
        page.goto(f"{origin or self.origin}{path}", wait_until="domcontentloaded", timeout=patience * 1000)
        self.ready(page, patience)

    def ready(self, page: Any, patience: float = PATIENCE) -> None:
        """The app is up by its own word: the handle, a space, and the last turn of the
        launch order."""
        self.wait_for(page, "window.nibApp", "the app", patience)
        self.wait_for(page, "window.nibApp.workspace.activeSpace", "a space", patience)
        self.wait_for(
            page,
            f"performance.getEntriesByName({json.dumps(LAUNCHED)}).length > 0",
            "the launch order to finish",
            patience,
        )

    def inject(self, page: Any, script: Path) -> None:
        """A script the drive brings - axe-core, say - run in the page past the app's
        own policy, which refuses every inline script and so every script tag a
        drive could add. Evaluated through the browser's own protocol, which no policy
        governs: the measuring stick is the drive's, not the app's."""
        page.evaluate(script.read_text(encoding="utf-8"))

    def preload(self, page: Any, folder: Path | None = None) -> int:
        """Every chunk of the build in the page's module map, fetched and parsed and
        not run, so a drive that takes the network away takes only the network.

        The installed app carries its chunks on the disk, so a desktop that loses
        its connection still opens every sheet it has not opened yet. A page served
        over the loopback does not: a chunk first asked for while the context is
        offline fails, and a failed module import is remembered for the rest of the
        page's life. `modulepreload` is how the page is handed them all beforehand -
        the same links the build puts in front of its own first paint. Answers how
        many there were."""
        assets = (folder or self.folder) / "assets"
        chunks = sorted(f"/assets/{one.name}" for one in assets.glob("*.js"))
        page.evaluate(
            """(chunks) => Promise.all(chunks.map((href) => new Promise((done) => {
              const link = document.createElement('link')
              link.rel = 'modulepreload'
              link.href = href
              link.onload = link.onerror = () => done()
              document.head.append(link)
            })))""",
            chunks,
        )
        return len(chunks)

    def reading(self, page: Any, patience: float = PATIENCE) -> None:
        """The note in front as it reads, once the reading view has drawn it: the view is
        fetched the first time it is asked for, so the frame after the press can still
        be the editor, or nothing at all."""
        page.evaluate("() => window.nibApp.workspace.toggleReading()")
        self.wait_for(
            page, "document.querySelector('article#write')?.childElementCount", "the reading view", patience
        )
        self.settled(page)

    def settled(self, page: Any) -> None:
        """Two painted frames: whatever the last step changed is on screen."""
        page.evaluate(
            "() => new Promise((go) => requestAnimationFrame(() => requestAnimationFrame(() => go())))"
        )

    def seed(self, page: Any, *texts: str, folder: str | None = None) -> list[str]:
        """Notes in the open space, each named from its first line the way a new note
        is, and the tree read again. Answers every note's name."""
        return page.evaluate(  # type: ignore[no-any-return]
            """
            async ([texts, folder]) => {
              const ws = window.nibApp.workspace
              const root = ws.activeSpace.root
              const into = folder ? `${root.replace(/\\/+$/, '')}/${folder}` : root
              for (const text of texts) await ws.noteFrom(text, into)
              await ws.loadTree()
              return ws.notes.map((one) => one.name)
            }
            """,
            [list(texts), folder],
        )

    def open_note(self, page: Any, starts: str, patience: float = PATIENCE) -> None:
        """The note whose name starts with `starts`, in front, with its words drawn."""
        page.evaluate(
            """async (starts) => {
              const ws = window.nibApp.workspace
              const note = ws.notes.find((one) => one.name.startsWith(starts))
              if (!note) throw new Error(`no note starts with ${starts}`)
              await ws.openEntry(note.path, { activate: true })
            }""",
            starts,
        )
        self.wait_for(
            page,
            f"window.nibApp.workspace.active?.note?.name?.startsWith({json.dumps(starts)})"
            " && document.querySelector('.cm-content')",
            f"the {starts} note",
            patience,
        )
        self.settled(page)

    # -- a run

    def side(self, handler: type[http.server.BaseHTTPRequestHandler]) -> str:
        """A server of the drive's own for as long as the run lasts; its origin."""
        server = side(handler)
        self._stack.callback(server.close)
        return server.origin()

    def later(self, callback: Callable[[], object]) -> None:
        """Something to undo when the run ends, however it ends."""
        self._stack.callback(callback)

    @contextlib.contextmanager
    def session(self, browser: bool = True, playwright: bool = False, **launch: Any) -> Iterator[Any]:
        """The build, the server and the browser, for as long as the block runs, and
        nothing of any of them afterwards - a drive that walks out half way still
        closes its browser and its Worker. `playwright` hands over Playwright itself
        instead, for a drive that launches its own (see `persistent`); no browser at
        all, for one that only talks to a Worker."""
        from playwright.sync_api import sync_playwright

        self.clear()
        closing = _Closing(self)
        try:
            with self._stack:
                if self.borrowed:
                    say(f"driving {self.origin}, which somebody else is serving")
                if self.server:
                    self._stack.callback(self.server.close)
                    # A folder other than `dist` is one the drive was handed built - the
                    # other half of a before-and-after, say - and is not rebuilt here.
                    if self.folder == DIST and OWN_BUILD:
                        build()
                    elif not (self.folder / "index.html").exists():
                        raise SystemExit(f"nothing is built in {self.folder}")
                    say(f"serving {self.folder.name} on {self.origin}")
                if self.dev and not self.borrowed:
                    self._develop()
                if not browser and not playwright:
                    try:
                        yield None
                    finally:
                        closing.start()
                    return
                with sync_playwright() as play:
                    closing.driver = _driver(play)
                    if playwright:
                        try:
                            yield play
                        finally:
                            closing.start()
                        return
                    opened = self.browser(play, **launch)
                    try:
                        yield opened
                    finally:
                        closing.start()
                        opened.close()
        except SystemExit as walked:
            # A walk-out that is a known failure is that failure, said in the verdict;
            # the steps after it did not run, and the verdict is what says so.
            said = str(walked.code) if walked.code is not None else ""
            if not any(words in said for words in self.known):
                raise
            self.failures.append(said)
        except Exception:
            # What the watch ended is not the drive going wrong: its steps had all run.
            if not (closing.fired and closing.clean):
                raise
            say("closing was ended from outside; the drive's steps had all run")
        finally:
            closing.done.set()

    def _develop(self) -> None:
        """The dev server on this drive's port, answering, and ended with the run."""
        say(f"serving the app from a dev server on {self.origin}")
        server = spawn(
            [
                "node",
                str(APP / "node_modules" / "vite" / "bin" / "vite.js"),
                "--port",
                str(self.dev_port),
                "--strictPort",
                "--host",
                "127.0.0.1",
            ],
            cwd=APP,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self._stack.callback(end, server)
        until = time.monotonic() + 60
        while time.monotonic() < until:
            if server.poll() is not None:
                raise SystemExit("the dev server stopped before it answered")
            try:
                with socket.create_connection(("127.0.0.1", self.dev_port), timeout=1):
                    return
            except OSError:
                time.sleep(0.3)
        raise SystemExit("the dev server never answered")

    def clear(self) -> None:
        """The shots folder, emptied once a run - before the first thing is written
        into it, which is the session or a Worker's log, whichever comes first."""
        if not self._cleared:
            self._cleared = True
            if self.fresh:
                shutil.rmtree(self.shots, ignore_errors=True)
        self.shots.mkdir(parents=True, exist_ok=True)

    def verdict(self, passed: str = "") -> int:
        """The drive's exit status: non-zero for any failure that is not a known one,
        each named either way. Every line run-all.py reads starts `KNOWN`."""
        known = [one for one in self.failures if any(words in one for words in self.known)]
        new = [one for one in self.failures if one not in known]
        for words, owner in self.known.items():
            if any(words in one for one in known):
                print(f"KNOWN: {words} ({owner})", flush=True)
            else:
                print(f"KNOWN NO LONGER: {words} ({owner}) - take it off the drive", flush=True)
        if new:
            print(f"\nFAILED ({len(new)})", flush=True)
            for one in new:
                print(f"  - {one}", flush=True)
            return 1
        if passed:
            print(f"\n{passed}", flush=True)
        return 0

    def run(self, steps: Callable[[Any], object], passed: str = "", **launch: Any) -> int:
        """The whole of a drive's `main`: its steps, in a session, and the verdict."""
        with self.session(**launch) as browser:
            steps(browser)
        return self.verdict(passed)


# ---------------------------------------------------------------------- the Worker


@functools.cache
def worker_port() -> int:
    """The port this drive's Worker answers on: one nothing holds, asked for once, so
    the drive's `ORIGIN` and its Worker agree."""
    return free_port()


def worker_origin() -> str:
    """Where this drive's Worker - and the app it serves - answers."""
    return f"http://127.0.0.1:{worker_port()}"


class Worker:
    """The real Worker under `wrangler dev --local`, with a database of its own.

    Everything a Worker drive used to carry, once: the build pointed at it, the
    migrations the way a deploy runs them, the process and its log, SQL straight into
    its database, an account with a live session, and the mail it would have sent.
    The state is a temp folder per drive rather than `services/sync/.wrangler/state`,
    so a run starts from nothing and no two worktrees share a database; it outlives a
    `stop` and a `start`, which is how a drive restarts the Worker as a blog's host,
    and goes when the drive does."""

    def __init__(self, drive: Drive, variables: Mapping[str, str] | None = None) -> None:
        self.drive = drive
        self.port = worker_port()
        self.origin = worker_origin()
        self.variables = dict(variables or {})
        self.process: subprocess.Popen[bytes] | None = None
        self.state: Path | None = None
        self.log = drive.shots / "worker.log"
        self._output: Any = None

    def wrangler(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [*tool(SERVICE, "wrangler"), *args],
            cwd=SERVICE,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=BUILD_PATIENCE,
            check=False,
        )

    def prepare(self) -> None:
        """The build pointed at this Worker and a database of this run's own with every
        migration applied, once. `start` asks for it; so does `sql`, which is how a
        drive writes its accounts before the Worker runs - the runtime opens the
        database on a connection of its own, and a row written into the file by
        another process while it is running is not one it is bound to see."""
        if self.state is not None:
            return
        build(WORKER_DIST, served_by_worker=True)
        self.state = Path(tempfile.mkdtemp(prefix=f"nib-{self.drive.name}-worker-"))
        self.drive.later(self.close)
        self.drive.clear()
        self.log.write_bytes(b"")
        say("applying the migrations to a database of this run's own")
        done = self.wrangler("d1", "migrations", "apply", "nib", "--local", "--persist-to", str(self.state))
        if done.returncode != 0:
            raise SystemExit(f"the migrations failed:\n{done.stdout}\n{done.stderr}")

    def start(self, upstream: str | None = None, assets: Path | None = None) -> None:
        """Built, migrated and answering, or out with what it said. `upstream` is the
        hostname the Worker answers as - a blog's, say - since `wrangler dev` builds
        the URL the Worker sees from it rather than from the request's own Host.
        `assets` is another build for it to hand out, such as the app that shipped,
        put to the same server as the one on main."""
        self.prepare()

        say(f"starting the Worker on {self.origin}" + (f" as {upstream}" if upstream else ""))
        self._output = self.log.open("ab")
        command = [
            *tool(SERVICE, "wrangler"),
            "dev",
            "--local",
            "--port",
            str(self.port),
            "--ip",
            "127.0.0.1",
            "--persist-to",
            str(self.state),
            # Its own, since several Workers run at once and the default is one port.
            "--inspector-port",
            str(free_port()),
            "--assets",
            str(assets or WORKER_DIST),
            "--show-interactive-dev-session=false",
            *(["--local-upstream", upstream] if upstream else []),
        ]
        for key, value in self.variables.items():
            command += ["--var", f"{key}:{value}"]
        # Its output to a file rather than a pipe: a pipe nobody reads fills, and a
        # Worker with nowhere to write stops answering.
        self.process = spawn(command, cwd=SERVICE, stdout=self._output, stderr=subprocess.STDOUT)

        until = time.monotonic() + WORKER_PATIENCE
        while time.monotonic() < until:
            if self.process.poll() is not None:
                raise SystemExit(f"the Worker stopped before it answered:\n{self.said()}")
            if self.answering():
                say("the Worker is answering")
                return
            time.sleep(0.5)
        raise SystemExit(f"the Worker never answered:\n{self.said()}")

    def answering(self) -> bool:
        """Whether anything answers yet. Any answer at all counts: a Worker acting as a
        blog serves `/health` as a note nobody published, and is up all the same."""
        try:
            urllib.request.urlopen(f"{self.origin}/health", timeout=5).read()
            return True
        except urllib.error.HTTPError:
            return True
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
            return False

    def stop(self) -> None:
        """The Worker and every process under it; its database stays for a restart."""
        if self.process is not None:
            say("stopping the Worker")
            end(self.process)
            self.process = None
        if self._output is not None:
            self._output.close()
            self._output = None

    def close(self) -> None:
        self.stop()
        if self.state is not None:
            shutil.rmtree(self.state, ignore_errors=True)
            self.state = None

    def said(self, lines: int = 40) -> str:
        """The end of what the Worker wrote."""
        if not self.log.exists():
            return "(nothing)"
        return "\n".join(self.log.read_text("utf-8", errors="replace").splitlines()[-lines:])

    def written(self) -> str:
        """Everything the Worker wrote."""
        return self.log.read_text("utf-8", errors="replace") if self.log.exists() else ""

    def sql(self, statement: str) -> str:
        """What running the statement printed, which is its rows as a table."""
        self.prepare()
        done = self.wrangler(
            "d1", "execute", "nib", "--local", "--persist-to", str(self.state), f"--command={statement}"
        )
        if done.returncode != 0:
            raise SystemExit(f"that query failed:\n{statement}\n{done.stdout}\n{done.stderr}")
        return done.stdout

    def query(self, statement: str) -> list[dict[str, Any]]:
        """The rows a statement reads."""
        self.prepare()
        done = self.wrangler(
            "d1",
            "execute",
            "nib",
            "--local",
            "--persist-to",
            str(self.state),
            "--json",
            f"--command={statement}",
        )
        if done.returncode != 0:
            raise SystemExit(f"that query failed:\n{statement}\n{done.stdout}\n{done.stderr}")
        answer = json.loads(done.stdout)
        return list(answer[0].get("results", [])) if answer else []

    def request(
        self,
        path: str,
        token: str | None = None,
        body: Any = None,
        method: str | None = None,
        timeout: float = 20,
    ) -> Any:
        """The Worker's answer to one call, as JSON; an `HTTPError` for a refusal."""
        data = None if body is None else json.dumps(body).encode()
        headers = {"content-type": "application/json"} if data is not None else {}
        if token:
            headers["authorization"] = f"Bearer {token}"
        call = urllib.request.Request(
            f"{self.origin}{path}",
            data=data,
            headers=headers,
            method=method or ("GET" if data is None else "POST"),
        )
        with urllib.request.urlopen(call, timeout=timeout) as answer:
            return json.loads(answer.read() or b"null")

    def account(self, email: str) -> str:
        """An account with a live session, written straight into the database: signing
        in needs an emailed code, and the sign-in is signin.py's question, not this
        drive's. Everything after this goes through the API the app uses."""
        token = uuid.uuid4().hex + uuid.uuid4().hex
        digest = hashlib.sha256(token.encode()).hexdigest()
        now = int(time.time() * 1000)
        user = str(uuid.uuid4())
        self.sql(
            f"insert into users (id, email, created_at) values ('{user}', '{email}', {now});"
            "insert into sessions (token_hash, user_id, created_at, expires_at)"
            f" values ('{digest}', '{user}', {now}, {now + 86_400_000});"
        )
        return token

    def mail_to(self, address: str, after: int = 0) -> str:
        """The last message the Worker handed its mail binding for this address: the
        subject and the words. `after` skips what the log already held, so an older
        message to the same person is never read as the answer to a newer request."""
        lines = self.written()[after:].splitlines()
        found = [at for at, line in enumerate(lines) if line.strip() == f"To: {address}"]
        if not found:
            return ""
        message = ""
        for line in lines[found[-1] : found[-1] + 6]:
            if line.startswith("Subject: "):
                message += line[len("Subject: ") :] + "\n"
            if line.startswith("Text: "):
                text = Path(line[len("Text: ") :].strip())
                if text.exists():
                    message += text.read_text("utf-8", errors="replace")
        return message

    def waits_for_mail(
        self, address: str, pattern: str, what: str, after: int = 0, patience: float = 40
    ) -> re.Match[str]:
        until = time.monotonic() + patience
        while time.monotonic() < until:
            found = re.search(pattern, self.mail_to(address, after))
            if found:
                return found
            time.sleep(0.3)
        raise SystemExit(
            f"gave up waiting for {what}. the last message to {address} was:\n"
            f"{self.mail_to(address, after)!r}"
        )


# ---------------------------------------------------------------- a native probe


class Native:
    """A probe build of the desktop app, started the one way every probe is.

    Through scripts/probe_app.py's `run_probe`, which refuses a build that would
    update itself, opens every window off the screen without the keyboard, and ends
    the drive the moment one is ever in front of anybody. The spaces folder is a temp
    folder of this run's own, never the reader's Documents/Nib, and goes with it."""

    def __init__(self, drive: Drive, exe: Path, env: Mapping[str, str] | None = None) -> None:
        sys.path.insert(0, str(ROOT / "scripts"))
        import probe_app

        self.probe = probe_app
        self.drive = drive
        self.exe = exe
        self.spaces = probe_app.spaces_folder(drive.name)
        self.env = {**os.environ, **(env or {}), "NIB_SPACES_DIR": str(self.spaces)}
        self.app: subprocess.Popen[bytes] | None = None
        drive.later(self.stop)

    def start(self, args: Sequence[str] = (), quiet: bool = True) -> subprocess.Popen[bytes]:
        self.app = self.probe.run_probe(self.exe, env=self.env, quiet=quiet, args=args)
        return self.app

    def stop(self) -> None:
        if self.app is not None and self.app.poll() is None:
            if not self.probe.close_app(self.app):
                self.app.kill()
        self.app = None
        shutil.rmtree(self.spaces, ignore_errors=True)


def needs_of(source: str) -> tuple[str, ...]:
    """What a drive says it needs, read off its source the way run-all.py reads it. A
    drive that launches the desktop app needs a native build whether or not it says
    so, which is how a drive written before `NEEDS` is still skipped where it cannot
    run rather than failed."""
    found = re.search(r"^NEEDS = \(([^)]*)\)", source, re.MULTILINE)
    said = tuple(one.strip().strip("\"'") for one in found.group(1).split(",") if one.strip()) if found else ()
    if "native" not in said and re.search(r"\bprobe_app\b|\bNative\(DRIVE\b|\"nib\.exe\"", source):
        said = (*said, "native")
    return said


def missing(needs: Sequence[str]) -> str:
    """Which of a drive's needs this machine cannot meet, as the reason it is skipped;
    empty when it can run."""
    for one in needs:
        if one == "native" and not (sys.platform == "win32" and os.environ.get("NIB_PROBE_EXE")):
            return f"needs {NEEDS['native']}"
        if one not in NEEDS:
            return f"needs {one}, which the harness does not know"
    return ""
