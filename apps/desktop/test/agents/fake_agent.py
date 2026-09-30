"""A scripted agent: the tool calls a model would make, without the model.

Every run is the same run, so what a scenario proves is about nib and not about what a
model felt like that day. It speaks to nib the two ways an agent does, and a scenario is
written once for both, in the verbs of the contract (src-tauri/src/agents/verbs.rs):

    mcp        `nib mcp` over its own stdin and stdout, JSON-RPC as the Model Context
               Protocol has it: what Claude Code does (agent-mcp)
    endpoint   the verbs posted to the app's endpoint with an agent's token: what
               `nib mcp` itself does underneath (agent-core)

Every answer comes back as one shape (`answer`): `status` is the contract's `ok`,
`needs_approval` or `error`, or `missing` where the verb is not there yet, which a
scenario reports as waiting on the lane that owes it rather than as a failure.
"""

from __future__ import annotations

import json
import queue
import subprocess
import threading
import time
import urllib.error
import urllib.request
from typing import Any

Answer = dict[str, Any]

#: Where `nib mcp` puts the contract's answer in a tool call's result, beside the text a
#: model reads: under `_meta`, which no model is shown (src-tauri/src/mcp/results.rs).
ANSWER_META = "ch.emilvinu.nib/answer"

#: What the window says for a verb it has not got, and what makes an answer `missing`.
NO_VERB = "there is no verb called"


def answer(status: str, ms: float, **rest: Any) -> Answer:
    """The one shape every transport answers in."""

    return {"status": status, "ms": round(ms, 1), **rest}


def from_contract(said: Any, ms: float) -> Answer:
    """An answer as the endpoint gives it - the contract's own `Answer`, or the window's
    `{ok, value}` for a verb the window answers - in the one shape."""

    if not isinstance(said, dict):
        return answer("error", ms, code="unreadable", message=str(said))
    if said.get("status") in ("ok", "needs_approval", "error"):
        return {**said, "ms": round(ms, 1)}
    if said.get("ok") is True:
        return answer("ok", ms, result=said.get("value"))
    error = str(said.get("error", ""))
    if error.startswith(NO_VERB):
        return answer("missing", ms, message=error)
    return answer("error", ms, code="window", message=error)


class Endpoint:
    """The app's endpoint, as an agent reaches it: a verb and its arguments, posted with
    the agent's token."""

    name = "endpoint"

    def __init__(self, port: int, token: str) -> None:
        self.port = port
        self.token = token
        self.known: dict[str, bool] = {}

    def call(self, verb: str, args: dict[str, Any], seconds: float = 60) -> Answer:
        body = json.dumps({"verb": verb, "args": args, "rest": []}).encode()
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/",
            data=body,
            headers={"authorization": f"Bearer {self.token}", "content-type": "application/json"},
        )
        started = time.perf_counter()
        try:
            with urllib.request.urlopen(request, timeout=seconds) as said:
                text = said.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as refused:
            ms = (time.perf_counter() - started) * 1000
            text = refused.read().decode("utf-8", "replace")
            # Before agent-core, a token that is not the secret is nobody's.
            status = "missing" if refused.code == 401 else "error"
            return answer(status, ms, code=f"http {refused.code}", message=text)
        except Exception as error:  # noqa: BLE001 - a wedged app fails in its own ways
            return answer("error", (time.perf_counter() - started) * 1000, code="no answer", message=str(error))
        ms = (time.perf_counter() - started) * 1000
        try:
            return from_contract(json.loads(text), ms)
        except ValueError:
            return answer("error", ms, code="unreadable", message=text[:400])

    def has(self, verb: str) -> bool:
        """Whether the endpoint answers the verb at all: asked once, with arguments no
        verb takes, which a verb that is there refuses and one that is not never reads."""

        if verb not in self.known:
            self.known[verb] = self.call(verb, {"harness": "is this verb here"}, seconds=10)["status"] != "missing"
        return self.known[verb]

    def close(self) -> None:
        return


class Mcp:
    """`nib mcp`, spoken to over its own pipes as an MCP client does: newline-delimited
    JSON-RPC, `initialize`, then `tools/list` and `tools/call`."""

    name = "mcp"

    #: The protocol version this client asks for.
    PROTOCOL = "2025-06-18"

    #: What this client calls itself, and so the name its token is kept under.
    CLIENT = "nib-agent-harness"

    def __init__(self, process: subprocess.Popen[bytes]) -> None:
        self.process = process
        self.lines: queue.Queue[dict[str, Any]] = queue.Queue()
        self.next = 0
        self.tools: set[str] = set()
        threading.Thread(target=self._read, name="mcp reader", daemon=True).start()
        opened = self.request(
            "initialize",
            {
                "protocolVersion": self.PROTOCOL,
                "capabilities": {},
                "clientInfo": {"name": self.CLIENT, "version": "1"},
            },
        )
        self.instructions = str((opened.get("result") or {}).get("instructions", ""))
        #: Why nib mcp is not there to be spoken to, where it is not.
        self.absent = str(opened["error"].get("message")) if "error" in opened else ""
        if not self.absent:
            self.notify("notifications/initialized", {})
            listed = self.request("tools/list", {})
            self.tools = {str(one.get("name")) for one in (listed.get("result") or {}).get("tools", [])}

    def _read(self) -> None:
        assert self.process.stdout is not None
        for raw in self.process.stdout:
            try:
                said = json.loads(raw.decode("utf-8", "replace"))
            except ValueError:
                # Anything but JSON-RPC on stdout breaks every client; say so as an answer.
                said = {"jsonrpc": "2.0", "id": None, "stray": raw[:200].decode("utf-8", "replace")}
            if isinstance(said, dict):
                self.lines.put(said)

    def send(self, message: dict[str, Any]) -> None:
        assert self.process.stdin is not None
        self.process.stdin.write((json.dumps(message) + "\n").encode())
        self.process.stdin.flush()

    def notify(self, method: str, params: dict[str, Any]) -> None:
        self.send({"jsonrpc": "2.0", "method": method, "params": params})

    def request(self, method: str, params: dict[str, Any], seconds: float = 60) -> dict[str, Any]:
        self.next += 1
        wanted = self.next
        self.send({"jsonrpc": "2.0", "id": wanted, "method": method, "params": params})
        until = time.perf_counter() + seconds
        while time.perf_counter() < until:
            try:
                said = self.lines.get(timeout=0.2)
            except queue.Empty:
                if self.process.poll() is not None:
                    return {"error": {"message": f"nib mcp ended with {self.process.returncode} before it answered {method}"}}
                continue
            if "stray" in said:
                return {"error": {"message": f"not JSON-RPC on stdout: {said['stray']}"}}
            if said.get("id") == wanted:
                return said
        return {"error": {"message": f"{method}: no answer in {seconds:.0f} s"}}

    def call(self, verb: str, args: dict[str, Any], seconds: float = 60) -> Answer:
        started = time.perf_counter()
        if verb not in self.tools:
            why = f"agent-mcp: {self.absent}" if self.absent else f"nib mcp lists no tool called {verb}"
            return answer("missing", 0, message=why)
        said = self.request("tools/call", {"name": verb, "arguments": args}, seconds)
        ms = (time.perf_counter() - started) * 1000
        if "error" in said:
            return answer("error", ms, code="rpc", message=str(said["error"].get("message")))
        result = said.get("result") or {}
        text = "\n".join(str(one.get("text", "")) for one in result.get("content", []) if one.get("type") == "text")
        pictures = [one for one in result.get("content", []) if one.get("type") == "image"]
        untrusted = marked_source(text)
        # The contract's answer itself, which the text is only written from.
        said = (result.get("_meta") or {}).get(ANSWER_META)
        if isinstance(said, dict) and said.get("status") in ("ok", "needs_approval", "error"):
            return {**said, "ms": round(ms, 1), "text": text, "pictures": len(pictures),
                    "untrusted": said.get("untrusted") or untrusted}
        # One of nib's own sentences - the pairing's state, a call it could not make.
        status = "error" if result.get("isError") else "ok"
        return answer(status, ms, text=text, message=text if status == "error" else None,
                      untrusted=untrusted, pictures=len(pictures), result=None)

    def has(self, verb: str) -> bool:
        return verb in self.tools

    def close(self) -> None:
        if self.process.stdin is not None:
            self.process.stdin.close()
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.process.kill()


def marked_source(text: str) -> str | None:
    """Where the words inside an `<untrusted source="...">` mark came from, or None where
    nothing in the text is marked."""

    at = text.find("<untrusted")
    if at < 0:
        return None
    start = text.find('source="', at)
    if start < 0:
        return ""
    start += len('source="')
    return text[start : text.find('"', start)]
