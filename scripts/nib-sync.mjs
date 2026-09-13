#!/usr/bin/env node
/** A space, in or out of a folder, without the app.
 *
 *  What it is for: a repository of notes that publishes or mirrors from CI. A
 *  GitHub Action that wants to write the week's notes into a site, or keep a
 *  folder in git as the copy of record, needs the same two things the app needs
 *  and nothing else - what changed, and a note written back.
 *
 *  So this speaks the ordinary sync API rather than a second one of its own:
 *  `GET /v1/spaces/:id/changes` with a cursor, `GET /v1/notes/:id` for the
 *  words, `PUT`/`POST` to send them. Which means there is nothing here for the
 *  service to keep in step with, and anything the app can sync, this can.
 *
 *  Usage:
 *
 *    NIB_TOKEN=nib_... node scripts/nib-sync.mjs pull "Work" ./notes
 *    NIB_TOKEN=nib_... node scripts/nib-sync.mjs push "Work" ./notes
 *    NIB_TOKEN=nib_... node scripts/nib-sync.mjs back "Work" 7 --dry
 *
 *  The token is the one in Settings > LLM access, which is a token for a program
 *  acting for you: read-only, or read and write. `NIB_API` points it somewhere
 *  else for a test; it defaults to the service.
 *
 *  What it deliberately does not do: delete. A note taken away in the app comes
 *  down here as a tombstone and the file is removed, but a file missing from the
 *  folder is never read as "delete it from the account" - a checkout that failed
 *  half way is not an instruction to empty a space. See docs/sync.md. */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'

const API = process.env.NIB_API ?? 'https://nibeditor.com'
const TOKEN = process.env.NIB_TOKEN ?? ''

/** What a note's path may end in, which is what the service accepts. */
const NOTES = /\.(md|markdown|mdown|mkd|canvas)$/i

/** Where the cursor is kept, so a second run only asks for what has changed. */
const CURSOR = '.nib-cursor'

function say(words) {
  process.stdout.write(`${words}\n`)
}

async function ask(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'x-nib-device': 'CI',
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })

  const said = await response.text()
  const body = said ? JSON.parse(said) : {}

  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path}: ${body.error ?? response.status}`)
  }

  return body
}

async function spaceNamed(name) {
  const { spaces } = await ask('/v1/spaces')
  const found = spaces.find((one) => one.name === name || one.id === name)
  if (!found) throw new Error(`no space called ${name}`)

  return found
}

/** Everything that has changed since the cursor the folder remembers. */
async function pull(name, folder) {
  const space = await spaceNamed(name)
  const since = Number(await readFile(join(folder, CURSOR), 'utf8').catch(() => 0)) || 0

  let cursor = since
  let more = true
  let written = 0
  let removed = 0

  while (more) {
    const page = await ask(`/v1/spaces/${space.id}/changes?since=${cursor}`)

    for (const note of page.notes) {
      const where = join(folder, ...note.path.split('/'))

      if (note.deleted) {
        await rm(where, { force: true })
        removed += 1
        continue
      }

      const { content } = await ask(`/v1/notes/${note.id}`)
      await mkdir(dirname(where), { recursive: true })
      await writeFile(where, content, 'utf8')
      written += 1
    }

    more = page.more && page.cursor !== cursor
    cursor = page.cursor
  }

  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, CURSOR), String(cursor), 'utf8')

  say(`pulled ${written} notes, removed ${removed}, cursor ${cursor}`)
}

/** Every note in the folder, sent. A note the account does not hold is created;
 *  one it holds is written when the words differ. */
async function push(name, folder) {
  const space = await spaceNamed(name)
  const held = new Map()

  let cursor = 0
  let more = true
  while (more) {
    const page = await ask(`/v1/spaces/${space.id}/changes?since=${cursor}`)
    for (const note of page.notes) {
      if (note.deleted) held.delete(note.path)
      else held.set(note.path, note)
    }

    more = page.more && page.cursor !== cursor
    cursor = page.cursor
  }

  let sent = 0
  for (const file of await walk(folder, folder)) {
    const content = await readFile(join(folder, ...file.split('/')), 'utf8')
    const note = held.get(file)

    if (!note) {
      await ask(`/v1/spaces/${space.id}/notes`, { body: { path: file, content } })
      sent += 1
      continue
    }

    if (note.hash === (await sha256(content))) continue

    await ask(`/v1/notes/${note.id}`, {
      method: 'PUT',
      body: { path: file, content, baseVersion: note.version },
    })
    sent += 1
  }

  say(`pushed ${sent} notes`)
}

/** How many times a bulk restore will ask. The service puts back four hundred notes
 *  per request, so this is forty thousand - more than a space holds, and a ceiling
 *  all the same, because a loop that talks to a server should have one. The app's
 *  pane loops the same way; see `roll` in SyncPane.svelte. */
const ROUNDS = 100

/** A space, or one folder of it, back to how it read a number of days ago.
 *
 *  The rescue a job needs and the one thing here that undoes rather than sends: a
 *  build that wrote a thousand notes wrong is not something to undo by hand in a
 *  settings pane. It says what would change before it changes anything, the way the
 *  pane does, and `--dry` stops there.
 *
 *  Nothing is thrown away by it: every note it changes keeps what it said as a
 *  version, so a wrong number here is another run of this away from being undone.
 *  Which is why a token may reach it at all; see services/sync/src/programs.ts. */
async function back(name, days, options = {}) {
  const space = await spaceNamed(name)
  const since = Number(days)
  if (!Number.isFinite(since) || since <= 0) throw new Error(`${days}: expected a number of days`)

  const at = Date.now() - since * 24 * 60 * 60 * 1000
  const under = options.under ?? ''

  const would = await ask(`/v1/spaces/${space.id}/rollback`, {
    body: { at, under, dry: true },
  })
  const all = would.notes + (would.left ?? 0)
  say(`${all} notes would go back to what they said ${since} days ago`)
  for (const path of would.paths ?? []) say(`  ${path}`)
  if (would.more) say('  …')

  if (options.dry) return
  if (!all) return

  let put = 0
  for (let round = 0; round < ROUNDS; round++) {
    const done = await ask(`/v1/spaces/${space.id}/rollback`, { body: { at, under } })
    put += done.notes
    if (!done.partial || done.notes === 0) break
  }

  say(`${put} notes went back`)
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Every note under a folder, by its path in the space. */
async function walk(root, folder) {
  const found = []

  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue

    const where = join(folder, entry.name)
    if (entry.isDirectory()) {
      found.push(...(await walk(root, where)))
      continue
    }

    if (NOTES.test(entry.name)) found.push(relative(root, where).split(sep).join('/'))
  }

  return found
}

async function main() {
  const args = process.argv.slice(2).filter((one) => !one.startsWith('--'))
  const flags = new Set(process.argv.slice(2).filter((one) => one.startsWith('--')))
  const [what, name, third] = args

  if (!TOKEN) throw new Error('NIB_TOKEN is not set')
  if (!what || !name || !third) {
    throw new Error('usage: nib-sync.mjs pull|push <space> <folder> | back <space> <days> [--dry]')
  }

  if (what === 'pull') await pull(name, third)
  else if (what === 'push') await push(name, third)
  else if (what === 'back') await back(name, third, { dry: flags.has('--dry') })
  else throw new Error(`${what}: expected pull, push or back`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
