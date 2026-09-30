"""A scripted agent: the tool calls a model would make, without the model.

Every run is the same run, so what a scenario proves is about nib and not about what a
model felt like that day. It speaks to nib three ways, and a scenario is written once
for all three, in the verbs of the contract (src-tauri/src/agents/verbs.rs):

    mcp        `nib mcp` over its own stdin and stdout, JSON-RPC as the Model Context
               Protocol has it: what Claude Code does (agent-mcp)
    endpoint   the verbs posted to the app's endpoint with an agent's token: what
               `nib mcp` itself does underneath (agent-core)
    spike      a build of branch spike/agent-tabs, driven through the page nobody sees
               with the engine's own protocol (`agent_open`, `agent_cdp`): the engine's
               facts the lanes build on - keys, native pickers, frames - measured before
               the verbs exist. It goes when agent-core's verbs are on main.

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
        # A server that hands the contract's answer back as text is read as that answer.
        try:
            inner = json.loads(text)
        except ValueError:
            inner = None
        if isinstance(inner, dict) and inner.get("status") in ("ok", "needs_approval", "error"):
            return {**inner, "ms": round(ms, 1), "text": text, "untrusted": inner.get("untrusted") or untrusted}
        status = "error" if result.get("isError") else "ok"
        return answer(status, ms, text=text, message=text if status == "error" else None,
                      untrusted=untrusted, pictures=len(pictures), result=result.get("structuredContent"))

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


# ---- the spike: the engine's protocol on a page nobody sees ----

#: What the spike's pages are called in the app; see agent_tabs.rs on the spike branch.
SPIKE_LABEL = "agent-"

#: The script every spike call runs inside, in the app's own window through `eval`: the
#: protocol call, and the accessibility tree read as the contract's snapshot text.
SPIKE_PRELUDE = r"""
const invoke = window.__TAURI_INTERNALS__.invoke
const pause = (ms) => new Promise((go) => setTimeout(go, ms))
const cdp = async (label, method, params = {}) => {
  const raw = await invoke('agent_cdp', { label, method, params: JSON.stringify(params) })
  return JSON.parse(raw)
}
const value = async (label, expression) => {
  const said = await cdp(label, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (said.exceptionDetails) throw new Error(said.exceptionDetails.text || 'the page threw')
  return said.result?.value
}
const tree = async (label) => {
  const nodes = (await cdp(label, 'Accessibility.getFullAXTree', {})).nodes
  const byId = new Map(nodes.map((one) => [one.nodeId, one]))
  const skip = new Set(['generic', 'none', 'InlineTextBox', 'LineBreak'])
  const lines = []
  const refs = []
  const walk = (node, depth) => {
    if (!node) return
    const role = node.role?.value ?? ''
    const name = node.name?.value ?? ''
    let inner = depth
    if (!node.ignored && !skip.has(role) && !(role === 'StaticText' && !name)) {
      const ref = node.backendDOMNodeId ? `e${node.backendDOMNodeId}` : ''
      if (ref) refs.push({ ref, role, name })
      lines.push(`${'  '.repeat(depth)}- ${role}${name ? ` "${name}"` : ''}${ref ? ` [ref=${ref}]` : ''}`)
      inner = depth + 1
    }
    for (const child of node.childIds ?? []) walk(byId.get(child), inner)
  }
  walk(nodes[0], 0)
  return { text: lines.join('\n'), refs }
}
const press = async (label, ref) => {
  const backendNodeId = Number(ref.slice(1))
  await cdp(label, 'DOM.scrollIntoViewIfNeeded', { backendNodeId })
  const q = (await cdp(label, 'DOM.getContentQuads', { backendNodeId })).quads[0]
  const x = (q[0] + q[2] + q[4] + q[6]) / 4
  const y = (q[1] + q[3] + q[5] + q[7]) / 4
  await cdp(label, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
  await cdp(label, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  await cdp(label, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
}
"""

#: A key as the protocol names it, for the keys that are not a character.
NAMED_KEYS = {
    "Enter": ("Enter", 13, "\r"),
    "Tab": ("Tab", 9, ""),
    "Backspace": ("Backspace", 8, ""),
    "Escape": ("Escape", 27, ""),
    "ArrowLeft": ("ArrowLeft", 37, ""),
    "ArrowRight": ("ArrowRight", 39, ""),
    "ArrowUp": ("ArrowUp", 38, ""),
    "ArrowDown": ("ArrowDown", 40, ""),
}


def key_events(keys: str) -> list[dict[str, Any]]:
    """`Input.dispatchKeyEvent` calls for what `browser_press` is handed: a named key
    (`Enter`), or words, pressed a character at a time. Each key down and up; a
    character's down carries its text, which is how the engine types it."""

    if keys in NAMED_KEYS:
        key, code, text = NAMED_KEYS[keys]
        pressed: dict[str, Any] = {"type": "keyDown", "key": key, "code": key, "windowsVirtualKeyCode": code}
        if text:
            pressed["text"] = text
        return [pressed, {"type": "keyUp", "key": key, "code": key, "windowsVirtualKeyCode": code}]
    events: list[dict[str, Any]] = []
    for one in keys:
        code = ord(one.upper()) if one.isalnum() and one.isascii() else 0
        events.append({"type": "keyDown", "key": one, "text": one, "windowsVirtualKeyCode": code})
        events.append({"type": "keyUp", "key": one, "windowsVirtualKeyCode": code})
    return events


class Spike:
    """A build of spike/agent-tabs, driven with the verbs' names through the app's own
    `eval` (the reader's endpoint secret, and `eval` switched on in the probe's own
    automation.json). Only the verbs the engine's facts need; every other is missing."""

    name = "spike"

    VERBS = frozenset(
        {
            "browser_tabs",
            "browser_open",
            "browser_wait",
            "browser_snapshot",
            "browser_find",
            "browser_click",
            "browser_type",
            "browser_press",
            "browser_evaluate",
            "browser_screenshot",
            "browser_close",
        }
    )

    def __init__(self, port: int, secret: str) -> None:
        self.window = Endpoint(port, secret)
        self.opened: dict[str, str] = {}
        self.count = 0

    def run(self, body: str, seconds: float = 60) -> tuple[Any, float]:
        code = f"(async () => {{ {SPIKE_PRELUDE}\n{body} }})().then((v) => JSON.stringify(v ?? null))"
        said = self.window.call("eval", {"code": code, "yes": True}, seconds)
        if said["status"] != "ok":
            raise RuntimeError(said.get("message") or said.get("code") or "eval refused")
        raw = said.get("result")
        return (json.loads(raw) if isinstance(raw, str) else raw), said["ms"]

    def has(self, verb: str) -> bool:
        return verb in self.VERBS

    def call(self, verb: str, args: dict[str, Any], seconds: float = 60) -> Answer:
        if verb not in self.VERBS:
            return answer("missing", 0, message=f"the spike has no {verb}")
        try:
            result, ms = getattr(self, "_" + verb.removeprefix("browser_"))(args, seconds)
        except KeyError as unknown:
            return answer("error", 0, code="no_such_tab", message=f"no tab {unknown}")
        except RuntimeError as failed:
            return answer("error", 0, code="failed", message=str(failed))
        source = self.opened.get(str(args.get("tab")), "")
        pages = verb in ("browser_snapshot", "browser_find", "browser_evaluate")
        return answer("ok", ms, result=result, untrusted=source if pages else None)

    def label(self, args: dict[str, Any]) -> str:
        tab = str(args["tab"])
        if tab not in self.opened:
            raise KeyError(tab)
        return SPIKE_LABEL + tab

    def _tabs(self, _args: dict[str, Any], _s: float) -> tuple[Any, float]:
        return {"reader": [], "agent": [{"id": one, "url": url} for one, url in self.opened.items()]}, 0.0

    def _open(self, args: dict[str, Any], seconds: float) -> tuple[Any, float]:
        self.count += 1
        tab = f"h{self.count}"
        url = str(args["url"])
        width, height = int(args.get("width") or 1280), int(args.get("height") or 800)
        _, ms = self.run(
            f"await invoke('agent_open', {{ id: {json.dumps(tab)}, url: {json.dumps(url)}, hidden: false, "
            f"width: {width}, height: {height} }}); return true",
            seconds,
        )
        self.opened[tab] = url
        return {"tab": tab}, ms

    def _wait(self, args: dict[str, Any], seconds: float) -> tuple[Any, float]:
        label = self.label(args)
        until = args.get("for", "load")
        limit = int(args.get("timeout_ms") or 20000)
        # The page is built on about:blank, which is complete before the site's first
        # byte: loaded means the site's page, not that one.
        check = {
            "load": "location.href !== 'about:blank' && document.readyState === 'complete'",
        }.get(until) if isinstance(until, str) else None
        if isinstance(until, dict) and "text" in until:
            check = f"document.body && document.body.innerText.includes({json.dumps(until['text'])})"
        if isinstance(until, dict) and "url" in until:
            check = f"location.href.includes({json.dumps(until['url'])})"
        if check is None:
            raise RuntimeError(f"the spike cannot wait for {until}")
        result, ms = self.run(
            f"""const until = performance.now() + {limit}
  while (performance.now() < until) {{
    try {{ if (await value({json.dumps(label)}, {json.dumps(check)})) return {{ url: await value({json.dumps(label)}, 'location.href') }} }} catch {{}}
    await pause(50)
  }}
  throw new Error('timeout')""",
            seconds,
        )
        return result, ms

    def _snapshot(self, args: dict[str, Any], seconds: float) -> tuple[Any, float]:
        label = self.label(args)
        result, ms = self.run(
            f"await cdp({json.dumps(label)}, 'DOM.enable', {{}}); const t = await tree({json.dumps(label)}); "
            f"return {{ url: await value({json.dumps(label)}, 'location.href'), title: await value({json.dumps(label)}, 'document.title'), text: t.text, truncated: false }}",
            seconds,
        )
        return result, ms

    def _find(self, args: dict[str, Any], seconds: float) -> tuple[Any, float]:
        label = self.label(args)
        found, ms = self.run(f"await cdp({json.dumps(label)}, 'DOM.enable', {{}}); return (await tree({json.dumps(label)})).refs", seconds)
        role, name, text = args.get("role"), args.get("name"), args.get("text")
        matches = [
            one
            for one in found or []
            if (not role or one["role"] == role)
            and (not name or str(name).lower() in one["name"].lower())
            and (not text or str(text).lower() in one["name"].lower())
        ]
        return {"matches": matches}, ms

    def _click(self, args: dict[str, Any], seconds: float) -> tuple[Any, float]:
        label = self.label(args)
        return self.run(
            f"await press({json.dumps(label)}, {json.dumps(args['ref'])}); "
            f"return {{ url: await value({json.dumps(label)}, 'location.href'), opened: [] }}",
            seconds,
        )

    def _type(self, args: dict[str, Any], seconds: float) -> tuple[Any, float]:
        label = self.label(args)
        return self.run(
            f"await press({json.dumps(label)}, {json.dumps(args['ref'])}); "
            f"await cdp({json.dumps(label)}, 'Input.insertText', {{ text: {json.dumps(args['text'])} }}); "
            f"return {{ url: await value({json.dumps(label)}, 'location.href'), opened: [] }}",
            seconds,
        )

    def _press(self, args: dict[str, Any], seconds: float) -> tuple[Any, float]:
        label = self.label(args)
        calls = "\n".join(
            f"await cdp({json.dumps(label)}, 'Input.dispatchKeyEvent', {json.dumps(one)})"
            for one in key_events(str(args["keys"]))
        )
        return self.run(f"{calls}\nreturn {{ url: await value({json.dumps(label)}, 'location.href'), opened: [] }}", seconds)

    def _evaluate(self, args: dict[str, Any], seconds: float) -> tuple[Any, float]:
        label = self.label(args)
        return self.run(f"return {{ value: await value({json.dumps(label)}, {json.dumps(args['expression'])}) }}", seconds)

    def _screenshot(self, args: dict[str, Any], seconds: float) -> tuple[Any, float]:
        label = self.label(args)
        shot, ms = self.run(f"return (await cdp({json.dumps(label)}, 'Page.captureScreenshot', {{ format: 'png' }})).data", seconds)
        return {"png_bytes": len(str(shot or "")) * 3 // 4}, ms

    def _close(self, args: dict[str, Any], seconds: float) -> tuple[Any, float]:
        tab = str(args["tab"])
        self.label(args)
        _, ms = self.run(f"await invoke('agent_close', {{ id: {json.dumps(tab)} }}); return true", seconds)
        self.opened.pop(tab, None)
        return {"tab": tab}, ms

    def close(self) -> None:
        for tab in list(self.opened):
            self.call("browser_close", {"tab": tab}, seconds=10)
