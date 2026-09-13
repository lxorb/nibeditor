#!/usr/bin/env node
/** `nib`: the running app, from a terminal.
 *
 *  What it is, in one line: a request to the socket the app opened on 127.0.0.1,
 *  with the secret out of the app's own config folder, and whatever the app said
 *  printed back. Every verb happens inside the app - the same call the palette, a
 *  key or a click would make - so a note this writes is a note that appears on
 *  screen, is undoable and syncs. The whole of what the verbs are lives in the
 *  app; see apps/desktop/src/lib/automation/verbs.ts.
 *
 *  What is deliberately not here: any knowledge of what a verb does. This script
 *  turns words into `{ verb, args, rest }`, sends it, and prints. That is why it
 *  can stay this short, and why it cannot come to a different answer from the app
 *  about anything. `nib help` asks the app for the list of verbs, so even the help
 *  is the app's answer rather than a second copy of it.
 *
 *  Where it ships: nowhere, on purpose, and that is the lightest thing it could be.
 *  A sidecar would be a second compiled binary in every installer on every platform
 *  for something almost nobody runs, and a sidecar is the only way an installer can
 *  ship a command at all. Node is already this repository's answer for driving nib
 *  without the app - see scripts/nib-sync.mjs - so this is a Node script beside it.
 *  Run it as `node apps/cli/nib.mjs ...`, or put it on the path with
 *  `pnpm --filter @nib/cli link --global`.
 *
 *  There is no browser build of this and there never will be: a tab has no socket
 *  to listen on. `nib` against the web app says so rather than failing to connect.
 *
 *  Usage, and the security notes: docs/automation.md. */

import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir, platform, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Where the app writes the port and the secret, per platform. The same folder
 *  Tauri's own `app_config_dir` answers with for this identifier; see
 *  src-tauri/src/endpoint.rs. */
function endpointFile() {
  if (process.env.NIB_ENDPOINT) return process.env.NIB_ENDPOINT

  const home = homedir()
  const identifier = 'ch.emilvinu.nib'

  if (platform() === 'win32') {
    const roaming = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
    return join(roaming, identifier, 'automation.json')
  }

  if (platform() === 'darwin') {
    return join(home, 'Library', 'Application Support', identifier, 'automation.json')
  }

  const config = process.env.XDG_CONFIG_HOME ?? join(home, '.config')
  return join(config, identifier, 'automation.json')
}

/** The words a caller typed, as something to send.
 *
 *  `nib files read notes/plan.md --json` becomes the verb `files`, the rest
 *  `['read', 'notes/plan.md']` and the flag `json`, which is this script's rather
 *  than the app's. The app joins the first two into `files.read` itself, because
 *  the app is the one that knows which verbs are written as two words; see
 *  `dispatch` in the automation folder.
 *
 *  `--name value` is a named argument; `--name` on its own is a yes, the same way a
 *  query string writes one. */
function parseArgv(argv) {
  const mine = { json: false, out: null, yes: false }
  const args = {}
  const rest = []
  let verb = null

  for (let at = 0; at < argv.length; at++) {
    const word = argv[at]

    if (word === '--json') {
      mine.json = true
      continue
    }
    if (word === '--yes' || word === '-y') {
      mine.yes = true
      args.yes = true
      continue
    }
    if (word === '--out') {
      mine.out = argv[++at] ?? null
      continue
    }
    if (word.startsWith('--')) {
      const [name, ...value] = word.slice(2).split('=')
      if (value.length) args[name] = value.join('=')
      else if (argv[at + 1] !== undefined && !argv[at + 1].startsWith('--')) args[name] = argv[++at]
      else args[name] = ''
      continue
    }

    if (verb === null) {
      verb = word
      continue
    }

    rest.push(word)
  }

  return { verb, args, rest, ...mine }
}

/** What `nib --help` prints when the app is not there to answer. Short on purpose:
 *  the reference is docs/automation.md, and the list of verbs is the app's. */
const USAGE = `nib - drive the running nibeditor

  nib <verb> [words...] [--name value] [--json] [--yes]

  open <path> [--heading H] [--block B]
  new <name> [--content TEXT] [--append] [--prepend] [--silent]
  append <path> [--content TEXT] [--from FILE|-] [--silent]
  search <query>
  files list
  files read [path]
  files write <path> [--content TEXT] [--from FILE|-] --yes
  files move <path> <to> --yes
  files delete <path> --yes
  links [path]
  backlinks [path]
  orphans
  tags
  properties read [path]
  properties set <key> [value] [--path P] --yes
  outline [path]
  bookmarks
  words [path]
  commands list
  commands run <id>
  sync status
  sync now
  publish status
  publish now
  window
  screenshot [--out FILE]
  eval <code> --yes
  verbs

  Every verb takes --space to work in a space other than the one that is open.
  --json answers as JSON rather than as words. Anything that changes a note needs
  --yes, and eval is off until this installation's endpoint file says otherwise.
  See docs/automation.md.`

async function main() {
  const argv = process.argv.slice(2)
  const asked = parseArgv(argv)

  if (!asked.verb || asked.verb === 'help' || argv.includes('--help') || argv.includes('-h')) {
    return help()
  }

  if (asked.verb === 'screenshot') return screenshot(asked)
  await fromFile(asked)

  const answered = await ask(asked.verb, asked.args, asked.rest)
  return show(answered, asked)
}

/** The help, with the app's own list of verbs under it when the app is running. */
async function help() {
  console.log(USAGE)

  const answered = await ask('verbs', {}, []).catch(() => null)
  if (answered?.ok) console.log(`\nthe app answers: ${answered.value.verbs.join(', ')}`)

  return 0
}

/** `files write --from FILE`, or `--from -` for what is on the standard input, so
 *  a note does not have to be a shell argument. */
async function fromFile(asked) {
  const from = asked.args.from
  if (from === undefined) return

  delete asked.args.from
  asked.args.content = from === '-' ? await readStdin() : await readFile(from, 'utf8')
}

function readStdin() {
  return new Promise((settle, fail) => {
    let held = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => (held += chunk))
    process.stdin.on('end', () => settle(held))
    process.stdin.on('error', fail)
  })
}

/** One request to the app. */
async function ask(verb, args, rest) {
  const { port, secret } = await endpoint()

  const response = await fetch(`http://127.0.0.1:${port}/`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ verb, args, rest }),
  }).catch((error) => {
    throw new Error(`nibeditor is not answering on 127.0.0.1:${port}: ${error.message}`)
  })

  const said = await response.text()
  const body = said ? JSON.parse(said) : {}

  if (!response.ok) throw new Error(body.error ?? `the app answered ${response.status}`)
  return body
}

async function endpoint() {
  const path = endpointFile()
  const held = await readFile(path, 'utf8').catch(() => null)
  if (held === null) {
    throw new Error(
      `no endpoint file at ${path}: open nibeditor once, and note that the browser build has no command line`,
    )
  }

  const { port, secret } = JSON.parse(held)
  if (!port || !secret) throw new Error(`${path} says no port or no secret`)

  return { port, secret }
}

/** A picture of the window.
 *
 *  The app says where its window is; the picture is taken by the platform, because
 *  a webview cannot photograph the window it is drawn in. Windows has the script
 *  this repository already uses to eyeball the app, which finds the window itself.
 *  macOS is handed the rectangle. Linux is told the truth: X11 and Wayland have no
 *  one tool between them, so there is nothing honest to shell out to. */
async function screenshot(asked) {
  const out = asked.out ?? join(tmpdir(), 'nib-window.png')
  const rect = await ask('window', {}, [])
  if (!rect.ok) return show(rect, asked)

  if (platform() === 'win32') {
    const script = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../scripts/capture-window.ps1',
    )
    const ran = spawnSync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Out', out],
      { encoding: 'utf8' },
    )
    if (ran.status !== 0) throw new Error(ran.stderr.trim() || 'the capture failed')
  } else if (platform() === 'darwin') {
    const { x, y, width, height, scale } = rect.value
    const points = [x / scale, y / scale, width / scale, height / scale].map(Math.round)
    const ran = spawnSync('screencapture', ['-x', `-R${points.join(',')}`, out], {
      encoding: 'utf8',
    })
    if (ran.status !== 0) throw new Error(ran.stderr.trim() || 'the capture failed')
  } else {
    throw new Error(
      'no screenshot on this platform: X11 and Wayland share no capture tool, so take one yourself',
    )
  }

  return show({ ok: true, value: { file: out, ...rect.value } }, asked)
}

/** What the app said, printed.
 *
 *  `--json` is the whole answer as it came. Without it the answer is read for the
 *  shape it has: a list of things becomes a line each, and anything else becomes
 *  its own fields, because a wall of JSON is not an answer to a person. */
function show(answered, asked) {
  if (asked.json) {
    console.log(JSON.stringify(answered, null, 2))
    return answered.ok ? 0 : 1
  }

  if (!answered.ok) {
    console.error(answered.error)
    return 1
  }

  const value = answered.value
  if (value === null || typeof value !== 'object') {
    console.log(String(value))
    return 0
  }

  for (const [name, held] of Object.entries(value)) {
    if (Array.isArray(held)) {
      for (const one of held) console.log(asLine(one))
      continue
    }
    if (held !== null && typeof held === 'object') {
      console.log(`${name}: ${JSON.stringify(held)}`)
      continue
    }

    console.log(`${name}: ${String(held)}`)
  }

  return 0
}

/** One row of a list, as a line. A string is itself; anything else is its values
 *  with tabs between them, which is what a shell can cut on. */
function asLine(one) {
  if (one === null || typeof one !== 'object') return String(one)

  return Object.values(one)
    .filter((held) => held === null || typeof held !== 'object')
    .map((held) => String(held))
    .join('\t')
}

main()
  .then((code) => {
    process.exitCode = code ?? 0
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
