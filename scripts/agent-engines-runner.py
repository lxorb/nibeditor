"""An agent's tab on nib's own Chromium, measured on a CI runner of any desktop
(docs/agent-native.md 12): the windowless browser `src-tauri/src/agents/engines/cef.rs`
builds, driven over the app's endpoint as the reader's command line drives it.

For a runner, where nobody sits: it starts the engine build as it is laid out by the
gate (`apps/desktop/src-tauri/cef/gate.py`, a bundle on a Mac), with no watch over the
screen. On a machine somebody uses, scripts/agent-tab-probe.py --chromium is the one to
run, under `run_probe`.

What it asks: whether a page is built at all, its rates (`requestAnimationFrame` and a
10 ms timer, a second) and visibility, a picture, a press and a key through the engine
and whether the page saw them as a person's (`isTrusted`), and how long each took.

    python scripts/agent-engines-runner.py --binary <nib-chromium> --engine <CEF dist> --out out.json

Prints one JSON document and writes it to `--out`; exits 0 whenever it wrote one, with
the answers in it, so a red step means it could not run at all.
"""

from __future__ import annotations

import argparse
import http.server
import importlib.util
import json
import os
import pathlib
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
GATE = HERE.parent / "apps" / "desktop" / "src-tauri" / "cef" / "gate.py"

PAGE = """<!doctype html><meta charset=utf-8><title>{title}</title>
<body style="margin:0;background:#ff00ff"><main style="padding:2rem">{body}</main>
<script>
window.raf = 0; window.ticks = 0; window.keys = []; window.clicks = []
;(function loop () {{ window.raf++; requestAnimationFrame(loop) }})()
setInterval(function () {{ window.ticks++ }}, 10)
addEventListener('keydown', function (e) {{ window.keys.push([e.key, e.isTrusted]) }})
addEventListener('click', function (e) {{ window.clicks.push(e.isTrusted) }})
window.m = function () {{ return {{ raf: window.raf, ticks: window.ticks, at: Date.now(), state: document.visibilityState }} }}
</script>"""

PAGES = {
    "/meter": PAGE.format(title="Meter", body="<h1>Meter</h1>"),
    "/keys": PAGE.format(title="Keys", body='<input id="box" aria-label="Box"><button id="go">Go</button>'),
}


def gate():
    spec = importlib.util.spec_from_file_location("gate", GATE)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def serve() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            body = PAGES.get(self.path.split("?")[0], "<title>Nothing</title>").encode()
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args: object) -> None:
            return

    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return port


def endpoint(config: pathlib.Path, unlike: int = 0) -> tuple[int, str]:
    path = config / "automation.json"
    until = time.monotonic() + 120
    while time.monotonic() < until:
        try:
            said = json.loads(path.read_text(encoding="utf-8-sig"))
            if said.get("port") and said.get("secret") and int(said["port"]) != unlike:
                return int(said["port"]), str(said["secret"])
        except (OSError, ValueError):
            pass
        time.sleep(0.25)
    raise RuntimeError(f"the app never wrote {path}")


def call(port: int, secret: str, verb: str, **args: object) -> dict[str, object]:
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/",
        data=json.dumps({"verb": verb, "args": args}).encode(),
        headers={"authorization": f"Bearer {secret}", "content-type": "application/json"},
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=90) as answer:
            said = json.loads(answer.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as refused:
        said = {"status": "http", "code": refused.code, "message": refused.read().decode("utf-8", "replace")}
    except Exception as error:  # noqa: BLE001 - a wedged app fails in its own ways
        said = {"status": "no answer", "message": str(error)}
    out = said if isinstance(said, dict) else {"value": said}
    out["ms"] = round((time.perf_counter() - started) * 1000, 1)
    return out


def value(said: dict[str, object]) -> object:
    result = said.get("result")
    return result.get("value") if isinstance(result, dict) else None


def rates(before: object, after: object) -> dict[str, object]:
    if not isinstance(before, dict) or not isinstance(after, dict):
        return {"error": {"before": before, "after": after}}
    seconds = (float(after["at"]) - float(before["at"])) / 1000
    return {
        "rAF per s": round((float(after["raf"]) - float(before["raf"])) / seconds, 1),
        "10 ms interval per s": round((float(after["ticks"]) - float(before["ticks"])) / seconds, 1),
        "visibilityState": after.get("state"),
    }


def measure(port: int, secret: str, site: str) -> dict[str, object]:
    said: dict[str, object] = {}
    opened = call(port, secret, "browser_open", url=f"{site}/meter")
    said["open"] = opened
    result = opened.get("result")
    tab = str(result.get("tab", "")) if isinstance(result, dict) else ""
    if not tab:
        return said
    said["wait"] = call(port, secret, "browser_wait", tab=tab, **{"for": "load"})
    first = value(call(port, secret, "browser_evaluate", tab=tab, expression="window.m()", world="page"))
    time.sleep(4)
    second = value(call(port, secret, "browser_evaluate", tab=tab, expression="window.m()", world="page"))
    said["rates"] = rates(first, second)
    shot = call(port, secret, "browser_screenshot", tab=tab)
    png = shot.get("result", {}).get("png") if isinstance(shot.get("result"), dict) else None
    said["screenshot"] = {"status": shot.get("status"), "ms": shot.get("ms"), "bytes": len(png or "")}
    call(port, secret, "browser_navigate", tab=tab, url=f"{site}/keys")
    snapshot = call(port, secret, "browser_snapshot", tab=tab)
    text = str(snapshot.get("result", {}).get("text", "")) if isinstance(snapshot.get("result"), dict) else ""
    said["snapshot"] = {"ms": snapshot.get("ms"), "text": text[:600]}
    box = next((line.split("[ref=")[1].split("]")[0] for line in text.splitlines() if "textbox" in line and "[ref=" in line), None)
    said["click"] = call(port, secret, "browser_click", tab=tab, ref=box) if box else "no box"
    said["press"] = call(port, secret, "browser_press", tab=tab, keys="a")
    said["page saw"] = value(call(port, secret, "browser_evaluate", tab=tab, world="page", expression="({ keys: window.keys, clicks: window.clicks, value: document.getElementById('box').value })"))
    said["close"] = call(port, secret, "browser_close", tab=tab).get("status")
    return said


def main() -> int:
    parsed = argparse.ArgumentParser()
    parsed.add_argument("--binary", required=True, type=pathlib.Path)
    parsed.add_argument("--engine", type=pathlib.Path)
    parsed.add_argument("--out", required=True, type=pathlib.Path)
    args = parsed.parse_args()
    # The build's own identifier is the one somebody's installed nib has: only ever on a
    # runner, where there is nobody's.
    if not os.environ.get("CI"):
        raise SystemExit("this runs on a CI runner only: scripts/agent-tab-probe.py --chromium is the one for a machine somebody uses")

    laid = gate()
    binary, _, _ = laid.layout(args.engine, args.binary.resolve())
    config = laid.config_dir()
    root = pathlib.Path(tempfile.mkdtemp(prefix="nib-agent-engines-"))
    env = {
        **os.environ,
        "NIB_SPACES_DIR": str(root / "spaces"),
        "NIB_AGENT_PAGES": "1",
        "NIB_CEF_SANDBOX": "disabled",
    }
    (root / "spaces").mkdir()
    site = f"http://127.0.0.1:{serve()}"
    report: dict[str, object] = {"platform": sys.platform, "binary": str(binary)}

    def launch() -> subprocess.Popen[bytes]:
        return subprocess.Popen([str(binary)], env=env, cwd=str(binary.parent),
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # A run before this one (the gate's) left its port behind; the app writes its own.
    (config / "automation.json").unlink(missing_ok=True)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    running = None
    try:
        started = time.perf_counter()
        running = launch()
        port, secret = endpoint(config)
        report["endpoint ms"] = round((time.perf_counter() - started) * 1000)
        time.sleep(3)
        report["measured"] = measure(port, secret, site)
    except Exception as error:  # noqa: BLE001 - the answer is the report either way
        report["error"] = str(error)
    finally:
        if running is not None:
            running.terminate()
            try:
                running.wait(timeout=30)
            except subprocess.TimeoutExpired:
                running.kill()
    text = json.dumps(report, indent=2, default=str)
    print(text)
    args.out.write_text(text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
