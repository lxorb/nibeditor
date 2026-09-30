"""The DevTools protocol, spoken to a probe's web tabs with nothing but the standard
library: enough of a WebSocket to send a command and read what comes back, and a page's
own console read out of what it says.

Not a drive. Imported by name, as `probe_app` is: `from devtools import ...`.

**Why this and not the app.** What a page does wrong it says in its own console - an
uncaught `SyntaxError` in a bundle, a script that never ran - and nothing of that reaches
the app, by design: a web tab hands the page nothing to report through. A browser's
remote debugging port is the one door to it that neither presses a key in the page nor
changes what the page is given. `WebView2` reads its switches from
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` as well as from the app, so a probe opens the
port by launching the app with `debugged()` in its environment; port 0 lets every
browser process of the run pick its own and write it into its profile, where `port`
finds the web's.

**What never to send.** `Input.*` presses keys and buttons in the page, which moves the
keyboard into it and brings the probe's window forward - the one thing a probe must never
do; see `scripts/probe_app.py`. `Page.navigate` brought a probe forward once, on
2026-09-30, and is not sent either. `Page.reload` and `Runtime.evaluate` never have.
"""

from __future__ import annotations

import base64
import json
import os
import pathlib
import socket
import struct
import time
import urllib.request
from urllib.parse import urlparse

#: The switches the app starts its browser processes with (`BROWSER_ARGS` in
#: src-tauri/src/engine.rs), and the port. The variable replaces the app's own list rather
#: than adding to it, so the list is said again here.
SWITCHES = (
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,HideCursorWhileTyping"
    " --remote-debugging-port=0"
)


def debugged(env: dict[str, str] | None = None) -> dict[str, str]:
    """An environment whose `WebView2` processes each open a debugging port."""

    return {**(os.environ if env is None else env), "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": SWITCHES}


def port(web: pathlib.Path) -> int:
    """The debugging port of the browser process behind a web store: `web` is the store's
    folder, the app's `web` for the one every space shares. 0 while it has none."""

    for found in web.rglob("DevToolsActivePort"):
        try:
            return int(found.read_text().splitlines()[0])
        except (OSError, ValueError, IndexError):
            continue
    return 0


def targets(at: int) -> list[dict]:
    """Every page and frame the browser process at `at` has, as the protocol lists them."""

    with urllib.request.urlopen(f"http://127.0.0.1:{at}/json/list", timeout=10) as answer:
        return json.loads(answer.read())


class _Socket:
    """A WebSocket client, text frames only, which is all the protocol sends."""

    def __init__(self, url: str, seconds: float = 30) -> None:
        parsed = urlparse(url)
        self.sock = socket.create_connection((parsed.hostname, parsed.port or 80), timeout=seconds)
        key = base64.b64encode(os.urandom(16)).decode()
        path = parsed.path + (f"?{parsed.query}" if parsed.query else "")
        self.sock.sendall(
            (
                f"GET {path} HTTP/1.1\r\nHost: {parsed.hostname}:{parsed.port}\r\n"
                "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
            ).encode()
        )
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(1)
            if not chunk:
                raise ConnectionError("the socket closed during the handshake")
            head += chunk
        if b" 101 " not in head.split(b"\r\n", 1)[0]:
            raise ConnectionError(head.decode("latin-1"))

    def _exactly(self, count: int) -> bytes:
        out = bytearray()
        while len(out) < count:
            chunk = self.sock.recv(count - len(out))
            if not chunk:
                raise ConnectionError("the socket closed")
            out += chunk
        return bytes(out)

    def _frame(self, opcode: int, data: bytes) -> None:
        # A client masks every frame it sends; the server never does.
        head = bytearray([0x80 | opcode])
        if len(data) < 126:
            head.append(0x80 | len(data))
        elif len(data) < 65536:
            head.append(0x80 | 126)
            head += struct.pack(">H", len(data))
        else:
            head.append(0x80 | 127)
            head += struct.pack(">Q", len(data))
        mask = os.urandom(4)
        self.sock.sendall(bytes(head) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def send(self, text: str) -> None:
        self._frame(0x1, text.encode())

    def receive(self) -> str:
        parts = bytearray()
        while True:
            first, second = self._exactly(2)
            opcode = first & 0x0F
            length = second & 0x7F
            if length == 126:
                length = struct.unpack(">H", self._exactly(2))[0]
            elif length == 127:
                length = struct.unpack(">Q", self._exactly(8))[0]
            data = self._exactly(length)
            if opcode == 0x9:
                self._frame(0xA, data)
                continue
            if opcode == 0x8:
                raise ConnectionError("the socket was closed")
            parts += data
            if first & 0x80:
                return parts.decode("utf-8", "replace")

    def close(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass


class Session:
    """One page or frame, driven: each command answered in turn, and every event that
    arrives on the way kept in `events`."""

    def __init__(self, target: dict) -> None:
        self._socket = _Socket(target["webSocketDebuggerUrl"])
        self._last = 0
        self.events: list[dict] = []

    def call(self, method: str, params: dict | None = None, seconds: float = 30) -> dict:
        self._last += 1
        mine = self._last
        self._socket.send(json.dumps({"id": mine, "method": method, "params": params or {}}))
        until = time.monotonic() + seconds
        while time.monotonic() < until:
            self._socket.sock.settimeout(max(0.1, until - time.monotonic()))
            said = json.loads(self._socket.receive())
            if said.get("id") == mine:
                return {"error": said["error"]} if "error" in said else said.get("result", {})
            if "method" in said:
                self.events.append(said)
        return {"error": "no answer"}

    def listen(self, seconds: float) -> None:
        """Keeps what the page says for a while."""

        until = time.monotonic() + seconds
        while time.monotonic() < until:
            self._socket.sock.settimeout(max(0.05, until - time.monotonic()))
            try:
                said = json.loads(self._socket.receive())
            except (TimeoutError, socket.timeout):
                return
            if "method" in said:
                self.events.append(said)

    def value(self, expression: str, context: int | None = None, console: bool = False) -> object:
        """What an expression comes to in the page - or in the world `context` names -
        with the console's own helpers, such as `getEventListeners`, where asked."""

        params: dict[str, object] = {"expression": expression, "returnByValue": True}
        if context is not None:
            params["contextId"] = context
        if console:
            params["includeCommandLineAPI"] = True
        said = self.call("Runtime.evaluate", params)
        return said.get("result", {}).get("value", said)

    def world(self, name: str, frame: str | None = None) -> int | None:
        """The context of the world `name` in a frame, the page's own frame by default:
        the same one nib's scripts run in when `name` is nib's."""

        if frame is None:
            frame = self.call("Page.getFrameTree").get("frameTree", {}).get("frame", {}).get("id")
        made = self.call("Page.createIsolatedWorld", {"frameId": frame, "worldName": name})
        return made.get("executionContextId")

    def close(self) -> None:
        self._socket.close()


def thrown(events: list[dict]) -> list[str]:
    """The uncaught exceptions among what a page said, one line each: the message and
    where it was thrown."""

    out: list[str] = []
    for one in events:
        if one.get("method") != "Runtime.exceptionThrown":
            continue
        details = one.get("params", {}).get("exceptionDetails", {})
        text = details.get("exception", {}).get("description") or details.get("text") or ""
        first = text.splitlines()[0] if text else ""
        out.append(f"{first} @ {details.get('url', '')[:140]}")
    return out
