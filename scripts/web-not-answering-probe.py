"""A web tab's browser that stops answering, and the app that must not stop with it.
Windows only.

Every web tab of a store is drawn by one `WebView2` browser process, and showing, hiding
or building a page used to be a call into that process the window's thread waited on.
A browser busy with one heavy site - for seconds at a time, a chat app does it - took the
whole app with it: measured 2026-10-04, a press on a web tab sat in `web_place` for as long
as the browser was held, 47 to 89 seconds, with the window repainting and nothing else
answering. See src-tauri/src/web_answers.rs.

This holds the probe's own web browser still from outside - every thread of it suspended,
so it answers nothing at all - and asks the app for what a person does meanwhile: another
page opened, the tabs switched back and forth. Each time the window's page is asked a sum
over the automation endpoint, which only answers when the app's own loop runs, and this
probe asks the window's thread every 100 ms. Then the browser is let go, and both pages
must come back: the one asked for while it was held loads, the other is shown again.

    python scripts/web-not-answering-probe.py --exe path/to/nib.exe \\
        --identifier ch.emilvinu.nib.probe.<name>

Every launch goes through `run_probe`, off the screen; the browser suspended is the probe's
own child, found by its data folder, and every thread is resumed before the probe ends.
"""

from __future__ import annotations

import argparse
import ctypes
import importlib.util
import json
import pathlib
import shutil
import sys
import tempfile
import time
from ctypes import wintypes

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

spec = importlib.util.spec_from_file_location("heavy", HERE / "heavy-launch-probe.py")
assert spec and spec.loader
heavy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(heavy)

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
kernel32.OpenThread.restype = wintypes.HANDLE
THREAD_SUSPEND_RESUME = 0x0002

#: What each web tab's page is doing: name, in front, live, on its way.
PAGES = (
    "JSON.stringify(nib.workspace.tabs.filter((t) => t.kind === 'web').map((t) => {"
    " const p = nib.pages.of(t.id); return [t.name, t.id === nib.workspace.activeTabId, p.live, p.opening] }))"
)

failures: list[str] = []


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def check(ok: bool, words: str) -> None:
    if ok:
        say(f"ok   {words}")
    else:
        failures.append(words)
        say(f"FAIL {words}")


def answered(window, seconds: float = 3) -> float | None:
    """How long the window's page took to answer a sum, or None where it did not."""
    began = time.perf_counter()
    said = window.ask("1 + 1", seconds=seconds)
    return (time.perf_counter() - began) * 1000 if said == 2 else None


def front(window, name: str) -> None:
    window.ask(
        f"(() => {{ const ws = nib.workspace; const t = ws.tabs.find((t) => t.name === {json.dumps(name)}); ws.activate(t.id); return 'ok' }})()",
        seconds=5,
    )


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    import psutil

    parsed = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", required=True)
    told = parsed.parse_args()
    if "probe" not in told.identifier:
        raise SystemExit("a probe identifier, never the reader's")
    heavy.app_identifier = told.identifier

    spaces = pathlib.Path(tempfile.mkdtemp(prefix="nib-not-answering-"))
    space = spaces / "Web"
    space.mkdir()
    port = heavy.switch.free_port()
    for name in ("One", "Two"):
        (space / f"{name}.url").write_text(
            heavy.switch.shortcut(f"http://127.0.0.1:{port}/heavy/{name}", name), encoding="utf-8"
        )
    heard = heavy.Heard()
    server = heavy.serve(port, heard)
    heavy.switch.wipe(told.identifier)

    held: list[int] = []
    app = None
    try:
        # Twice: the first launch writes the file `eval` is turned on in.
        app, _, _, _ = heavy.started(told.exe, told.identifier, spaces, trace=False)
        heavy.ended(app)
        heavy.switch.allow_eval(told.identifier)
        app, window, hwnd, _ = heavy.started(told.exe, told.identifier, spaces, trace=False)
        time.sleep(5)

        window.ask(f"nib.workspace.openWeb({json.dumps(str(space / 'One.url'))}).then(() => 'opened')")
        check(bool(heavy.until(lambda: "One" in heard.loaded, 20)), "the first page loads")

        browser = next(
            (
                one
                for one in psutil.Process(app.pid).children(recursive=True)
                if one.name() == "msedgewebview2.exe"
                and "--type=" not in " ".join(one.cmdline())
                and "\\web\\" in " ".join(one.cmdline())
            ),
            None,
        )
        if browser is None:
            raise SystemExit("no browser behind the web tabs")
        for thread in browser.threads():
            handle = kernel32.OpenThread(THREAD_SUSPEND_RESUME, False, thread.id)
            if handle:
                kernel32.SuspendThread(handle)
                held.append(handle)
        say(f"the web browser {browser.pid} held still ({len(held)} threads)")

        pulse = heavy.Pulse(hwnd)
        heard.clear()
        window.ask(f"(() => {{ nib.workspace.openWeb({json.dumps(str(space / 'Two.url'))}); return 'asked' }})()", seconds=5)
        times = []
        for name in (None, "One.url", "Two.url", "One.url", "Two.url"):
            if name:
                front(window, name)
            time.sleep(1)
            times.append(answered(window))
        pulse.stop()
        say(f"sums answered in {[round(one) if one else None for one in times]} ms")
        check(all(one is not None and one < 1000 for one in times), "the app answers while the browser is held")
        away = max((took for _, took in pulse.stalls), default=0)
        check(away < 1000, f"the window's thread is never away a second (longest {away:.0f} ms)")
    finally:
        for handle in held:
            kernel32.ResumeThread(handle)
            kernel32.CloseHandle(handle)
    try:
        if app is not None and held:
            check(bool(heavy.until(lambda: "Two" in heard.loaded, 20)), "let go, the page asked for meanwhile loads")
            front(window, "One.url")
            time.sleep(2)
            pages = window.ask(PAGES, seconds=5)
            say(f"pages: {pages}")
            check(
                isinstance(pages, list) and any(one[0] == "One.url" and one[1] and one[2] for one in pages),
                "and the first is back in front, live",
            )
    finally:
        if app is not None:
            heavy.ended(app)
        server.shutdown()
        shutil.rmtree(spaces, ignore_errors=True)

    print()
    print("FAILED: " + "; ".join(failures) if failures else "all good")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
