"""The sync store in the packaged app: the six commands over the real bridge, bytes as
bytes both ways, and what a batch costs.

Windows only, and the one thing no unit test can answer: whether a write's frame really
arrives in the crate as a raw request body and a read's answer really comes back as raw
bytes, through WebView2 and Tauri's IPC, and how long that takes. The crate's own tests
hold the store to its rules; this holds the bridge to them.

What it checks, through the app's own automation endpoint (`eval`):

* **Open**: a device id, the schema, and a first session that reads as clean.
* **Ten thousand documents** written in twenty batches of five hundred, each one raw
  envelope of 4 KB updates, and every byte read back intact from raw answers.
* **What JSON would cost**: the same five hundred documents spelled as number arrays,
  encoded and parsed in the same webview, against the envelope.
* **A refused batch** writes nothing, and a read past the envelope's ceiling says so.
* **Clean exit**: said, closed, opened again, and the store says the last session ended
  cleanly; then the store is forgotten and its file is gone.
* **A file's identity** through `file_identity`.

The spaces are made in a temp folder named by `NIB_SPACES_DIR`; see docs/automation.md.
Every launch goes through `run_probe`, off the screen and without the keyboard.

    npx vite build --mode drive                     # in apps/desktop
    pnpm --dir apps/desktop tauri build --no-bundle \\
      --config '{"identifier":"ch.emilvinu.nib.probe.sync-client-store","version":"99.0.0",
                 "build":{"beforeBuildCommand":""},
                 "plugins":{"updater":{"endpoints":["https://127.0.0.1:9/latest.json"]}}}'
    python scripts/sync-store-probe.py --exe apps/desktop/src-tauri/target/release/nib.exe

This wipes that identifier's settings folder and webview profile at the start of every
run, and refuses to wipe one whose name does not say `probe`.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

from probe_app import close_app, main_window, refuse_updating, run_probe

SPACES_DIR = "NIB_SPACES_DIR"
SPACE = "Sync store probe"
ACCOUNT = "probe-account"

failures: list[str] = []


def say(words: str) -> None:
    print(words, flush=True)


def wrong(words: str) -> None:
    failures.append(words)
    say(f"WRONG: {words}")


def roaming(identifier: str) -> pathlib.Path:
    base = os.environ.get("APPDATA") or str(pathlib.Path.home() / "AppData" / "Roaming")
    return pathlib.Path(base) / identifier


def local(identifier: str) -> pathlib.Path:
    base = os.environ.get("LOCALAPPDATA") or str(pathlib.Path.home() / "AppData" / "Local")
    return pathlib.Path(base) / identifier


def wipe(identifier: str) -> None:
    """Everything the last run left. Refused for anything but a probe."""
    if "probe" not in identifier:
        raise SystemExit(f"{identifier} is not a probe identifier; refusing to wipe it")
    for path in (roaming(identifier), local(identifier)):
        shutil.rmtree(path, ignore_errors=True)


def endpoint(identifier: str, seconds: float, unlike: int = 0) -> tuple[int, str]:
    """The port and the secret this launch listens behind; see src-tauri/src/endpoint.rs."""
    path = roaming(identifier) / "automation.json"
    until = time.perf_counter() + seconds
    while time.perf_counter() < until:
        try:
            said = json.loads(path.read_text(encoding="utf-8"))
            if said.get("port") and said.get("secret") and int(said["port"]) != unlike:
                return int(said["port"]), str(said["secret"])
        except (OSError, ValueError):
            pass
        time.sleep(0.2)
    raise SystemExit(f"the app never wrote {path}")


def allow_eval(identifier: str) -> None:
    path = roaming(identifier) / "automation.json"
    said = json.loads(path.read_text(encoding="utf-8"))
    said["eval"] = True
    path.write_text(json.dumps(said), encoding="utf-8")


def ran(port: int, secret: str, code: str) -> object:
    """One expression in the window, and what it came back as."""
    body = json.dumps({"verb": "eval", "args": {"code": code, "yes": True}, "rest": []}).encode()
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/",
        data=body,
        headers={"authorization": f"Bearer {secret}", "content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as answer:
            said = answer.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as refused:
        return f"the app answered {refused.code}"
    except Exception as error:  # noqa: BLE001 - a frozen app fails in its own ways
        return f"no answer: {error}"
    try:
        answer = json.loads(said)
    except ValueError:
        return said
    if isinstance(answer, dict) and "value" in answer:
        return answer["value"]
    return answer


# The envelope, the same few lines as `frame` and `unframe` in packages/sync-core/src/
# frame.ts, because the bundle's own modules cannot be imported from an eval.
FRAME = """
const frame = (value) => {
  const parts = []
  const header = new TextEncoder().encode(JSON.stringify(value, (_key, held) => {
    if (!(held instanceof Uint8Array)) return held
    parts.push(held)
    return { $part: parts.length - 1 }
  }))
  const out = new Uint8Array(9 + header.length + parts.reduce((sum, part) => sum + 4 + part.length, 0))
  const view = new DataView(out.buffer)
  out[0] = 1
  view.setUint32(1, header.length)
  out.set(header, 5)
  let at = 5 + header.length
  view.setUint32(at, parts.length)
  at += 4
  for (const part of parts) {
    view.setUint32(at, part.length)
    out.set(part, at + 4)
    at += 4 + part.length
  }
  return out
}
const unframe = (raw) => {
  const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : Uint8Array.from(raw)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const length = view.getUint32(1)
  const header = new TextDecoder().decode(bytes.subarray(5, 5 + length))
  let at = 5 + length
  const count = view.getUint32(at)
  at += 4
  const parts = []
  for (let part = 0; part < count; part += 1) {
    const size = view.getUint32(at)
    parts.push(bytes.subarray(at + 4, at + 4 + size))
    at += 4 + size
  }
  return JSON.parse(header, (_key, held) =>
    held && typeof held === 'object' && typeof held.$part === 'number' ? parts[held.$part] : held,
  )
}
const median = (all) => [...all].sort((a, b) => a - b)[Math.floor(all.length / 2)]
"""

STORE = (
    """
(async () => {
  const invoke = window.__TAURI_INTERNALS__.invoke
"""
    + FRAME
    + """
  const account = %(account)s
  const out = {}
  await invoke('sync_store_forget', { account })
  out.opened = await invoke('sync_store_open', { account })

  const confirmed = Uint8Array.from({ length: 4096 }, (_, at) => at %% 251)
  const sv = Uint8Array.from({ length: 24 }, (_, at) => at)
  const docs = (from, count) =>
    Array.from({ length: count }, (_, at) => ({
      t: 'put',
      table: 'docs',
      row: {
        id: `doc-${String(from + at).padStart(6, '0')}`,
        epoch: 1,
        client_id: from + at,
        confirmed,
        confirmed_sv: sv,
        pending: null,
        pending_at: null,
      },
    }))

  const writes = []
  let counted = 0
  for (let batch = 0; batch < 20; batch += 1) {
    const body = frame(docs(batch * 500, 500))
    const started = performance.now()
    const counts = await invoke('sync_store_write', body)
    writes.push(performance.now() - started)
    counted += counts.reduce((sum, one) => sum + one, 0)
  }
  out.written = counted
  out.write500 = median(writes)

  // The same five hundred rows without a document in them: a tree's entries, which is
  // what most batches a pass writes look like.
  const small = []
  for (let time = 0; time < 5; time += 1) {
    const body = frame(
      Array.from({ length: 500 }, (_, at) => ({
        t: 'put',
        table: 'entries',
        row: {
          id: `entry-${at}`,
          space_id: 's',
          kind: 'note',
          parent: null,
          name: `Note ${at}.md`,
          local_path: `Note ${at}.md`,
          file_key: `2a:${at}`,
          written_hash: 'abcdef0123456789',
          mtime: 1_700_000_000_000,
          size: 1234,
          seq: at,
          deleted: false,
        },
      })),
    )
    const started = performance.now()
    await invoke('sync_store_write', body)
    small.push(performance.now() - started)
  }
  out.write500Entries = median(small)
  out.frameBytes500 = frame(docs(0, 500)).length

  // Every document back, in batches of 2,500 (5,000 parts an answer, under the
  // envelope's ceiling of 10,000), by key.
  let started = performance.now()
  const rows = []
  out.read10kBytes = 0
  for (let batch = 0; batch < 4; batch += 1) {
    const all = await invoke('sync_store_read', {
      queries: Array.from({ length: 2500 }, (_, at) => ({
        t: 'get',
        table: 'docs',
        key: `doc-${String(batch * 2500 + at).padStart(6, '0')}`,
      })),
    })
    out.answeredAs = Object.prototype.toString.call(all)
    out.read10kBytes += all.byteLength ?? all.length
    rows.push(...unframe(all))
  }
  out.read10k = performance.now() - started
  out.docs = rows.length
  out.intact = rows.every(
    (row, at) =>
      row.client_id === at &&
      row.confirmed.length === 4096 &&
      row.confirmed.every((byte, place) => byte === place %% 251) &&
      row.confirmed_sv.length === 24,
  )

  const some = []
  for (let time = 0; time < 5; time += 1) {
    started = performance.now()
    await invoke('sync_store_read', {
      queries: Array.from({ length: 500 }, (_, at) => ({
        t: 'get',
        table: 'docs',
        key: `doc-${String(at).padStart(6, '0')}`,
      })),
    })
    some.push(performance.now() - started)
  }
  out.read500 = median(some)

  // What the same five hundred would cost spelled as JSON number arrays, the way
  // Tauri's IPC spells bytes that are not sent raw: encoded and parsed here, in this
  // webview, on the same rows.
  const five = rows.slice(0, 500)
  started = performance.now()
  const json = JSON.stringify(
    five.map((row) => ({ ...row, confirmed: Array.from(row.confirmed), confirmed_sv: Array.from(row.confirmed_sv) })),
  )
  out.jsonEncode500 = performance.now() - started
  out.jsonBytes500 = json.length
  started = performance.now()
  JSON.parse(json).map((row) => Uint8Array.from(row.confirmed))
  out.jsonDecode500 = performance.now() - started
  started = performance.now()
  const framed = frame(five.map((row) => ({ t: 'put', table: 'docs', row })))
  out.frameEncode500 = performance.now() - started
  started = performance.now()
  unframe(framed.buffer)
  out.frameDecode500 = performance.now() - started

  try {
    await invoke('sync_store_write', frame([
      { t: 'put', table: 'files', row: { hash: 'a', state: 'here' } },
      { t: 'put', table: 'files', row: { hash: 'b', state: 3 } },
    ]))
    out.refused = false
  } catch (error) {
    out.refused = String(error)
  }
  const [files] = unframe(await invoke('sync_store_read', { queries: [{ t: 'scan', table: 'files' }] }))
  out.filesAfterRefusal = files.length
  try {
    await invoke('sync_store_read', { queries: [{ t: 'scan', table: 'docs' }] })
    out.tooMany = false
  } catch (error) {
    out.tooMany = String(error)
  }

  await invoke('sync_store_close')
  started = performance.now()
  const crashed = await invoke('sync_store_open', { account })
  out.open10k = performance.now() - started
  out.crashedWasClean = crashed.wasClean
  await invoke('sync_store_clean_exit', { clean: true })
  await invoke('sync_store_close')
  out.again = await invoke('sync_store_open', { account })

  out.identity = await invoke('file_identity', { path: %(note)s })
  out.noIdentity = await invoke('file_identity', { path: %(missing)s })
  await invoke('sync_store_forget', { account })
  return JSON.stringify(out)
})()
"""
)


def launch(exe: pathlib.Path, environment: dict[str, str], identifier: str, was: int) -> tuple:
    app = run_probe(exe, env=environment)
    until = time.perf_counter() + 120
    while not main_window(app.pid) and time.perf_counter() < until:
        time.sleep(0.25)
    if not main_window(app.pid):
        raise SystemExit("the window never appeared")
    port, secret = endpoint(identifier, 150, unlike=was)
    time.sleep(3.0)
    if ran(port, secret, "1 + 1") != 2:
        raise SystemExit("the endpoint would not run anything; is eval on?")
    return app, port, secret


def check(said: dict, store_file: pathlib.Path) -> None:
    opened = said.get("opened", {})
    if not (isinstance(opened.get("device"), str) and len(opened["device"]) == 36):
        wrong(f"no device id: {opened}")
    if opened.get("schema") != 1 or opened.get("wasClean") is not True:
        wrong(f"a first open is schema 1 and clean: {opened}")
    if said.get("written") != 10_000 or said.get("docs") != 10_000:
        wrong(f"ten thousand documents in and out: {said.get('written')} / {said.get('docs')}")
    if said.get("intact") is not True:
        wrong("a document's bytes came back changed")
    if said.get("answeredAs") not in ("[object ArrayBuffer]", "[object Uint8Array]"):
        wrong(f"a read came back as {said.get('answeredAs')}, not bytes")
    if said.get("refused") is False or said.get("filesAfterRefusal") != 0:
        wrong(f"a refused batch wrote something: {said.get('refused')}, {said.get('filesAfterRefusal')}")
    if "ask in batches" not in str(said.get("tooMany")):
        wrong(f"a read of 20,000 parts was not refused in words: {said.get('tooMany')!r}")
    if said.get("crashedWasClean") is not False or said.get("again", {}).get("wasClean") is not True:
        wrong(f"clean exit: {said.get('crashedWasClean')}, {said.get('again')}")
    if said.get("again", {}).get("device") != opened.get("device"):
        wrong("the device id changed between two opens")
    if not isinstance(said.get("identity"), str) or said.get("noIdentity") is not None:
        wrong(f"identity: {said.get('identity')!r}, {said.get('noIdentity')!r}")
    if store_file.exists():
        wrong(f"forgetting left {store_file}")


def main() -> int:
    if sys.platform != "win32":
        raise SystemExit("this probe is Windows only")

    parsed = argparse.ArgumentParser(description=__doc__)
    parsed.add_argument("--exe", required=True)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe.sync-client-store")
    args = parsed.parse_args()

    exe = pathlib.Path(args.exe).resolve()
    if not exe.exists():
        raise SystemExit(f"no such exe: {exe}")

    spaces = pathlib.Path(tempfile.mkdtemp(prefix="nib-sync-store-"))
    space = spaces / SPACE
    space.mkdir(parents=True, exist_ok=True)
    note = space / "Plan.md"
    note.write_text("# Plan\n\nWords.\n", encoding="utf-8")
    say(f"spaces root {spaces}")

    refuse_updating(exe)
    wipe(args.identifier)
    environment = {**os.environ, SPACES_DIR: str(spaces)}

    # Twice, because `eval` is read once when the endpoint starts listening: the first
    # launch writes the file this turns it on in. See src-tauri/src/endpoint.rs.
    first = run_probe(exe, env=environment)
    was, _ = endpoint(args.identifier, 150)
    allow_eval(args.identifier)
    first.terminate()
    try:
        first.wait(timeout=15)
    except subprocess.TimeoutExpired:
        first.kill()
    time.sleep(6.0)

    app = None
    try:
        app, port, secret = launch(exe, environment, args.identifier, was)
        code = STORE % {
            "account": json.dumps(ACCOUNT),
            "note": json.dumps(str(note)),
            "missing": json.dumps(str(space / "Nothing here.md")),
        }
        answer = ran(port, secret, code)
        if not isinstance(answer, str) or not answer.startswith("{"):
            wrong(f"the store did not answer: {answer!r}")
        else:
            said = json.loads(answer)
            for key in (
                "write500", "write500Entries", "read500", "read10k", "open10k", "frameBytes500", "read10kBytes",
                "jsonBytes500", "jsonEncode500", "jsonDecode500", "frameEncode500", "frameDecode500",
            ):
                value = said.get(key)
                shown = f"{value:.1f} ms" if isinstance(value, float) else value
                say(f"{key:>16} {shown}")
            check(said, local(args.identifier) / "sync" / f"{ACCOUNT}.db")
    finally:
        if app is not None and not close_app(app, 15):
            app.kill()
        shutil.rmtree(spaces, ignore_errors=True)

    if failures:
        print(f"\n{len(failures)} thing(s) wrong:")
        for one in failures:
            print(f"  - {one}")
        return 1
    print("\nall good")
    return 0


if __name__ == "__main__":
    sys.exit(main())
