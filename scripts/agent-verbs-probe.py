"""Does an agent reach every kind of tab through `nib mcp`, with nothing of nib in front of
anybody and the reader's screen never moved without `workspace.focus`?

The agent is a real client of `nib mcp` over pipes, paired the way any client is, against
a probe build started by `run_probe` (scripts/probe_app.py):

    context     the space, every tab with its id and kind, the selected one
    note        a note tab made behind the tab in front, with the agent's words; read by
                its tab; renamed while unsaved; saved into a folder, where the file is
    canvas      a canvas tab made and drawn on by its tab, never saved
    pages       a page note made as a file, a page put in, a card on the second page
    web         a web note made as a file, a page opened behind the reader's tab
    terminal    a terminal tab made behind, read before its shell runs, typed into (an
                allowed program goes and answers what it printed), read again; a program
                not on the list asks; Ctrl+C alone does not
    rename      a note opened behind and renamed by its tab: the file renamed on disk
    trash       that note to Recently deleted, gone from the space, and restored
    focus       the selected tab unchanged by all of the above; then focus, with the scope

Every process of the app's family is watched from the moment it exists, as
scripts/mcp-probe.py watches it; a window on a screen or in front ends the drive with
exit 3.

    pnpm --dir apps/desktop tauri build --no-bundle --config \\
      '{"identifier":"ch.emilvinu.nib.probe.agent-verbs","version":"99.0.0",
        "plugins":{"updater":{"endpoints":["https://127.0.0.1:9/latest.json"]}}}'
    python scripts/agent-verbs-probe.py --exe apps/desktop/src-tauri/target/release/nib.exe \\
        --identifier ch.emilvinu.nib.probe.agent-verbs
"""

from __future__ import annotations

import argparse
import ctypes
import importlib.util
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
from typing import Any

import psutil

from probe_app import close_app, refuse_updating, run_probe

# mcp-probe.py's client, family watch and endpoint helpers, taken as they are: its name
# has a dash, so it is loaded by path rather than imported by name.
_spec = importlib.util.spec_from_file_location("mcp_probe", pathlib.Path(__file__).with_name("mcp-probe.py"))
assert _spec is not None and _spec.loader is not None
mcp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mcp)

CLIENT = {"name": "nib-verbs-probe", "title": "Verbs probe", "version": "1"}

SPACE = "Verbs probe"

#: What the shell is asked to print, which nothing else on a screen says.
MARK = "nib-verbs-probe-42"

user32 = ctypes.WinDLL("user32", use_last_error=True)


class Drive(mcp.Drive):
    def __init__(self, exe: pathlib.Path, identifier: str, spaces: pathlib.Path) -> None:
        super().__init__(exe, identifier, spaces, "")
        self.space = spaces / SPACE
        self.timings: list[tuple[str, float]] = []

    def call(self, agent: Any, tool: str, args: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        """A call, timed, with the model's answer and the contract's beside it."""

        started = time.perf_counter()
        said = agent.call(tool, args)
        self.timings.append((f"{tool} {args.get('op') or args.get('kind') or ''}".strip(), (time.perf_counter() - started) * 1000))
        return said, mcp.contract(said)

    def result(self, agent: Any, tool: str, args: dict[str, Any]) -> Any:
        said, answer = self.call(agent, tool, args)
        if said.get("isError"):
            self.check(f"{tool} answered", False, mcp.text(said))
        return answer.get("result")

    def pair(self) -> Any:
        agent = self.client(CLIENT)
        mcp.answer_pairing(self.folder, CLIENT["title"], allow=True)
        listed, _, _ = self.settled(agent, lambda now: "workspace_tabs" in now, 40)
        self.check("paired", listed)

        # The terminal, and one program it may start without asking.
        grants = mcp.window(self.folder, "agents_read")
        mine = next(one for one in grants if one["client"] == CLIENT["title"])
        mine["scopes"] = sorted({*mine["scopes"], "terminal"})
        mine["programs"] = ["echo"]
        since = time.monotonic()
        mcp.window(self.folder, "agents_write", {"grants": grants})
        agent.wait_changed(since, 15)
        listed, _, tools = self.settled(agent, lambda now: "type_terminal" in now and "read_terminal" in now)
        self.check("the terminal's tools listed with the scope", listed, f"{len(tools)} tools")
        return agent

    def selected(self, agent: Any) -> str:
        return (self.result(agent, "get_context", {}) or {}).get("selected", {}).get("id", "")

    def context(self, agent: Any) -> str:
        print("context: where the reader is", flush=True)
        said, answer = self.call(agent, "get_context", {})
        seen = answer.get("result") or {}
        self.check("the space", seen.get("space") == SPACE, str(seen.get("space")))
        self.check("every tab with an id and a kind", all("id" in one and "kind" in one for one in seen.get("tabs", [])), json.dumps(seen.get("tabs"))[:200])
        self.check("marked as the reader's screen", "<untrusted" in mcp.text(said))
        return (seen.get("selected") or {}).get("id", "")

    def note(self, agent: Any) -> None:
        print("note: made behind, read, renamed, saved", flush=True)
        made = self.result(agent, "workspace_tabs", {"op": "new", "kind": "note", "content": "Hello from the agent"}) or {}
        tab = made.get("id", "")
        self.check("a note tab, unsaved, not selected", bool(tab) and made.get("unsaved") is True and made.get("selected") is False, json.dumps(made))
        read = mcp.text(agent.call("read_note", {"tab": tab}))
        self.check("its words read by its tab", "Hello from the agent" in read, read[:80])
        named = self.result(agent, "workspace_tabs", {"op": "rename", "tab": tab, "name": "Agent note"}) or {}
        self.check("renamed while unsaved", named.get("title") == "Agent note", json.dumps(named))
        saved = self.result(agent, "workspace_tabs", {"op": "save", "tab": tab, "path": "Drafts/Agent note"}) or {}
        on_disk = self.space / "Drafts" / "Agent note.md"
        self.check("saved where asked", saved.get("path") == "Drafts/Agent note.md" and on_disk.is_file(), json.dumps(saved))
        self.check("with its words", on_disk.is_file() and "Hello from the agent" in on_disk.read_text(encoding="utf-8"))

    def canvas(self, agent: Any) -> None:
        print("canvas: drawn on by its tab, never saved", flush=True)
        tab = (self.result(agent, "workspace_tabs", {"op": "new", "kind": "canvas"}) or {}).get("id", "")
        self.result(agent, "edit_canvas", {"tab": tab, "ops": [{"op": "add_card", "text": "From the agent"}]})
        nodes = (self.result(agent, "read_canvas", {"tab": tab}) or {}).get("nodes", [])
        self.check("the card is on the unsaved canvas", any(one.get("text") == "From the agent" for one in nodes), json.dumps(nodes)[:160])

    def pages(self, agent: Any) -> None:
        print("pages: a page note, a page put in, a card on page 2", flush=True)
        self.result(agent, "create_note", {"path": "Lecture", "kind": "pages"})
        self.check("Lecture.pages written", (self.space / "Lecture.pages").is_file())
        self.result(agent, "edit_canvas", {"path": "Lecture.pages", "ops": [{"op": "add_page"}, {"op": "add_card", "page": 2, "text": "Second"}]})
        read = self.result(agent, "read_canvas", {"path": "Lecture.pages"}) or {}
        self.check("two pages", len(read.get("pages", [])) == 2, json.dumps(read.get("pages"))[:160])
        self.check("the card on page 2", any(one.get("text") == "Second" and one.get("page") == 2 for one in read.get("nodes", [])))

    def web(self, agent: Any) -> None:
        print("web: a web note, and a page behind the reader", flush=True)
        self.result(agent, "create_note", {"path": "Example", "kind": "web", "url": "https://example.com/"})
        shortcut = self.space / "Example.url"
        self.check("Example.url written", shortcut.is_file() and "URL=https://example.com/" in shortcut.read_text(encoding="utf-8"))
        opened = self.result(agent, "workspace_tabs", {"op": "open", "url": "https://example.com/"}) or {}
        self.check("a web tab, behind", opened.get("kind") == "web" and opened.get("selected") is False, json.dumps(opened))

    def terminal(self, agent: Any) -> None:
        print("terminal: made behind, read, typed into", flush=True)
        made = self.result(agent, "workspace_tabs", {"op": "new", "kind": "terminal"}) or {}
        tab = made.get("id", "")
        self.check("a terminal tab, behind, its shell not started", made.get("kind") == "terminal" and made.get("running") is False, json.dumps(made))
        before = self.result(agent, "read_terminal", {"tab": tab}) or {}
        self.check("read before it runs", before.get("running") is False, json.dumps(before)[:160])

        said, answer = self.call(agent, "type_terminal", {"tab": tab, "text": f"echo {MARK}", "wait_ms": 8000})
        typed = answer.get("result") or {}
        self.check("an allowed program goes, and answers what it printed", answer.get("status") == "ok" and MARK in typed.get("output", ""), mcp.text(said)[:300])
        after = self.result(agent, "read_terminal", {"tab": tab}) or {}
        self.check("read again: running, the words on its screen", after.get("running") is True and MARK in after.get("output", ""), json.dumps(after)[-200:])

        said, answer = self.call(agent, "type_terminal", {"tab": tab, "text": "Remove-Item nothing-here"})
        self.check("a program not on the list asks", answer.get("status") == "needs_approval", mcp.text(said)[:200])
        said, answer = self.call(agent, "type_terminal", {"tab": tab, "keys": ["Ctrl+C"], "wait_ms": 500})
        self.check("Ctrl+C alone does not ask", answer.get("status") == "ok", mcp.text(said)[:200])

    def renamed(self, agent: Any) -> None:
        print("rename and trash: a note by its tab", flush=True)
        opened = self.result(agent, "workspace_tabs", {"op": "open", "path": "Later.md"}) or {}
        tab = opened.get("id", "")
        self.check("opened behind", bool(tab) and opened.get("selected") is False, json.dumps(opened))
        self.result(agent, "workspace_tabs", {"op": "rename", "tab": tab, "name": "Roadmap"})
        self.check("the file renamed on disk", (self.space / "Roadmap.md").is_file() and not (self.space / "Later.md").exists())
        self.result(agent, "trash_file", {"path": "Roadmap.md"})
        self.check("trashed from a tab behind, gone from the space", not (self.space / "Roadmap.md").exists())
        gone = self.result(agent, "recently_deleted", {"op": "list"}) or []
        row = next((one for one in gone if one.get("name") == "Roadmap.md"), {})
        self.check("in Recently deleted, with where it was", row.get("from") == SPACE, json.dumps(gone)[:200])
        self.result(agent, "recently_deleted", {"op": "restore", "id": row.get("id", "")})
        self.check("restored where it was", (self.space / "Roadmap.md").is_file())

    def focus(self, agent: Any, first: str) -> None:
        print("focus: nothing moved until asked", flush=True)
        now = self.selected(agent)
        self.check("the selected tab never changed", now == first, f"{first} -> {now}")
        tabs = (self.result(agent, "get_context", {}) or {}).get("tabs", [])
        other = next((one["id"] for one in tabs if one["id"] != first), "")
        self.result(agent, "workspace_tabs", {"op": "focus", "tab": other})
        self.check("focus selects it", self.selected(agent) == other)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    options = parser.parse_args()

    exe = options.exe.resolve()
    refuse_updating(exe)
    if not options.identifier.startswith("ch.emilvinu.nib.probe"):
        raise SystemExit("a probe's identifier starts with ch.emilvinu.nib.probe")

    folder = mcp.config_dir(options.identifier)
    if mcp.app_pid(folder, exe):
        raise SystemExit("the probe is running already")
    mcp.fresh(folder)

    spaces = pathlib.Path(tempfile.mkdtemp(prefix="nib-verbs-probe-"))
    (spaces / SPACE).mkdir()
    (spaces / SPACE / "Plan.md").write_text("# Plan\n\nThe plan.\n", encoding="utf-8")
    (spaces / SPACE / "Later.md").write_text("# Later\n\nSomeday.\n", encoding="utf-8")
    drive = Drive(exe, options.identifier, spaces)
    front = user32.GetForegroundWindow()
    app: subprocess.Popen[bytes] | None = None
    try:
        app = run_probe(exe, env=drive.env, quiet=True)
        drive.family.add(app.pid)
        drive.watch_app()
        drive.window_up()

        agent = drive.pair()
        first = drive.context(agent)
        drive.note(agent)
        drive.canvas(agent)
        drive.pages(agent)
        drive.web(agent)
        drive.terminal(agent)
        drive.renamed(agent)
        drive.focus(agent, first)
        drive.shut(agent)
    finally:
        if app is not None and not close_app(app):
            app.kill()
        drive.quit()
        shutil.rmtree(spaces, ignore_errors=True)
    drive.check("the window in front never changed", user32.GetForegroundWindow() == front)
    for name, ms in drive.timings:
        print(f"  time  {name}: {ms:.0f} ms", flush=True)
    time.sleep(3)
    left = [
        one
        for one in psutil.process_iter(["exe", "cmdline"])
        if one.info["exe"] and pathlib.Path(one.info["exe"]).resolve() == exe
    ]
    drive.check("nothing of the drive is left running", not left, ", ".join(str(one.info["cmdline"]) for one in left))
    for one in left:
        one.kill()

    failed = [name for name, ok, _ in drive.results if not ok]
    print(f"\n{len(drive.results) - len(failed)} of {len(drive.results)} passed", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
