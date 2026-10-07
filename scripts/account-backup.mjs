#!/usr/bin/env node
/** Everything an account holds, copied to a folder, without changing anything.
 *
 *  What it is for: the copy to keep before a change to how an account syncs (the move
 *  to sync v2), and any time after. A folder copy of a computer's spaces holds what
 *  that computer has; this holds what the account has: every space it can reach, the
 *  notes in Recently deleted, and every version the account kept of every note.
 *
 *  It only reads. Every request is a GET of the ordinary sync API, so a read-only
 *  token from Settings > LLM access is enough and is the one to use:
 *
 *    NIB_TOKEN=nib_... node scripts/account-backup.mjs ./nib-backup-2026-10-07
 *    NIB_TOKEN=nib_... node scripts/account-backup.mjs ./backup --no-history
 *
 *  What it writes:
 *
 *    spaces/<space>/<path>     every live note, the tree as the account names it
 *    deleted/<space>/<path>    every note in Recently deleted whose words are still held
 *    versions/<sha256>.txt     every version's words, stored once per distinct text
 *    blobs/<sha256>.<ext>      every file a note links at /i/<hash>
 *    index.json                each space and note: id, path, version, hash, deleted,
 *                              the file it was written as, and its versions
 *    SHA256SUMS                a checksum per file, for `sha256sum -c`
 *
 *  A name a disk cannot hold (`CON.md`, a trailing dot, `:`), or two names one disk
 *  cannot tell apart (`Plan.md` beside `plan.md`), is written under a safe spelling
 *  and `index.json` says which file is which note. Run it again into the same folder
 *  and it fetches only what changed since; a file an earlier run wrote for a note that
 *  has since moved stays, and `index.json` and `SHA256SUMS` name only what is current.
 *
 *  What it cannot reach with a program token: a whole space in Recently deleted (a
 *  session token lists their names, which is all the API gives), and the files of a
 *  space other than notes, which v1 never sent (pictures live in the space's folder on
 *  each computer; copy that folder too). `NIB_API` points it somewhere else for a test,
 *  such as `wrangler dev` on http://127.0.0.1:8787. */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'

const API = (process.env.NIB_API || 'https://nibeditor.com').replace(/\/$/, '')
const TOKEN = process.env.NIB_TOKEN ?? ''

/** How many requests are in flight at once: enough to be quick, few enough that
 *  the service's limits never notice. */
const AT_ONCE = 6

/** How many times one request is tried before the backup says it failed. */
const TRIES = 6

/** A file a note links on the service, by its hash. */
const LINKED = /\/i\/([a-f0-9]{64})(\.[a-z0-9]{1,8})?/gi

function say(words) {
  process.stdout.write(`${words}\n`)
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** One GET, tried again on a refusal that passes (429, 5xx, a dropped connection),
 *  waiting longer each time and as long as the service asks. */
async function get(path, { auth = true, bytes = false } = {}) {
  for (let attempt = 1; ; attempt++) {
    let response
    try {
      response = await fetch(`${API}${path}`, {
        headers: auth ? { authorization: `Bearer ${TOKEN}`, 'x-nib-device': 'backup' } : {},
      })
    } catch (error) {
      if (attempt >= TRIES) throw new Error(`GET ${path}: ${error.message}`, { cause: error })
      await pause(500 * 2 ** attempt)
      continue
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt >= TRIES) throw new Error(`GET ${path}: ${response.status}`)
      const after = Number(response.headers.get('retry-after'))
      await pause(Number.isFinite(after) && after > 0 ? after * 1000 : 500 * 2 ** attempt)
      continue
    }

    if (bytes) {
      if (!response.ok) return { status: response.status, body: null }
      return { status: response.status, body: Buffer.from(await response.arrayBuffer()) }
    }

    const text = await response.text()
    let body
    try {
      body = text ? JSON.parse(text) : {}
    } catch {
      body = { error: text.slice(0, 200) }
    }
    return { status: response.status, body }
  }
}

async function need(path) {
  const { status, body } = await get(path)
  if (status !== 200) throw new Error(`GET ${path}: ${body.error ?? status}`)
  return body
}

/** Runs `work` over every item, `AT_ONCE` at a time. */
async function pool(items, work) {
  let next = 0
  const lanes = Array.from({ length: Math.min(AT_ONCE, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]
      await work(item)
    }
  })
  await Promise.all(lanes)
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

/** What Windows holds in no name, which a backup avoids on every disk so that the
 *  folder can be carried to any computer. The same rule the app spells a space's files
 *  with on Windows (apps/desktop/src/lib/sync2/places.ts). */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i
const FORBIDDEN = '<>:"\\|?*'

function safeName(name) {
  let out = Array.from(name.normalize('NFC'), (char) =>
    char < ' ' || FORBIDDEN.includes(char) ? '_' : char,
  ).join('')
  if (RESERVED.test(out)) out = `_${out}`
  out = out.replace(/[. ]+$/, (tail) => '_'.repeat(tail.length))
  return out || '_'
}

/** Hands out local paths under one root, so two names a disk cannot tell apart (case,
 *  composition, the safe spelling) never land in one file: the second gets its id. */
function namer() {
  const taken = new Set()
  return (path, id) => {
    const safe = path.split('/').map(safeName).join('/')
    let local = safe
    if (taken.has(local.toLowerCase())) {
      const ext = extname(safe)
      local = `${safe.slice(0, safe.length - ext.length)} ~${id.slice(0, 8)}${ext}`
    }
    taken.add(local.toLowerCase())
    return local
  }
}

/** Writes a file unless the one there already says exactly this. */
async function put(root, local, data) {
  const where = join(root, ...local.split('/'))
  if (existsSync(where)) {
    const held = await readFile(where)
    if (held.equals(Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'))) return
  }
  await mkdir(dirname(where), { recursive: true })
  await writeFile(where, data)
}

/** What an earlier run into this folder wrote down, so a second run fetches only what
 *  moved. */
async function earlier(root) {
  try {
    const index = JSON.parse(await readFile(join(root, 'index.json'), 'utf8'))
    const notes = new Map()
    for (const space of index.spaces ?? [])
      for (const note of space.notes ?? []) notes.set(note.id, note)
    return notes
  } catch {
    return new Map()
  }
}

/** Every note of a space the feed lists, tombstones included, newest row per id. */
async function feedOf(space) {
  const notes = new Map()
  let cursor = 0
  for (;;) {
    const page = await need(`/v1/spaces/${encodeURIComponent(space.id)}/changes?since=${cursor}`)
    for (const note of page.notes) notes.set(note.id, note)
    if (!page.more || page.cursor === cursor) break
    cursor = page.cursor
  }
  return [...notes.values()]
}

async function backup(root, { history }) {
  const before = await earlier(root)
  const problems = []
  const blobs = new Map()
  const counts = { notes: 0, deleted: 0, versions: 0, fetched: 0 }

  const listing = await need('/v1/spaces')

  // Recently deleted as the account lists it: a session token reads it, a program
  // token is refused, and a refusal is not a failure of the backup.
  const trash = await get('/v1/trash')
  const deletedSpaces = trash.status === 200 ? (trash.body.spaces ?? []) : null

  const folders = namer()
  const spaces = []
  for (const space of listing.spaces) {
    // A space's name is one folder, whatever it holds.
    const folder = folders(space.name.replaceAll('/', '_'), space.id)
    const live = namer()
    const gone = namer()
    const notes = []

    // Named before anything is fetched, in one order, so a collision always gives the
    // same note the same file and a second run finds it where the first put it.
    const rows = (await feedOf(space))
      .sort((one, two) => (one.path + one.id < two.path + two.id ? -1 : 1))
      .map((row) => ({
        row,
        local: row.deleted
          ? `deleted/${folder}/${gone(row.path, row.id)}`
          : `spaces/${folder}/${live(row.path, row.id)}`,
      }))

    await pool(rows, async ({ row, local }) => {
      const kept = before.get(row.id)
      const entry = {
        id: row.id,
        path: row.path,
        version: row.version,
        hash: row.hash,
        size: row.size,
        updatedAt: row.updatedAt,
        deleted: row.deleted,
        file: local,
        versions: [],
      }

      const same =
        kept && kept.version === row.version && kept.hash === row.hash && kept.file === local
      let content = null
      if (same && existsSync(join(root, ...local.split('/')))) {
        content = await readFile(join(root, ...local.split('/')), 'utf8')
      } else {
        const { status, body } = await get(`/v1/notes/${encodeURIComponent(row.id)}`)
        if (status !== 200) {
          problems.push(`${space.name}/${row.path}: ${body.error ?? status}`)
          entry.file = null
        } else {
          content = body.content ?? ''
          counts.fetched++
        }
      }

      if (content !== null) {
        if (sha256(content) !== row.hash) {
          // A note in Recently deleted whose words were taken away for good reads as
          // nothing; anything else that disagrees is worth a look.
          if (row.deleted && content === '') entry.purged = true
          else
            problems.push(
              `${space.name}/${row.path}: words do not match the hash the account lists`,
            )
        }
        if (!entry.purged) await put(root, local, content)
        else entry.file = null
        linkedIn(content, blobs)
      }

      if (history) await versionsOf(root, entry, kept, problems, counts, blobs)
      if (row.deleted) counts.deleted++
      else counts.notes++
      notes.push(entry)
    })

    notes.sort((one, two) => (one.path < two.path ? -1 : one.path > two.path ? 1 : 0))
    spaces.push({ id: space.id, name: space.name, role: space.role, folder, notes })
  }

  const linked = []
  await pool([...blobs], async ([hash, ext]) => {
    const local = `blobs/${hash}${ext}`
    if (existsSync(join(root, ...local.split('/')))) {
      linked.push({ hash, file: local })
      return
    }
    const { status, body } = await get(`/i/${hash}${ext}`, { auth: false, bytes: true })
    if (status !== 200 || !body) {
      // Documents are served only from a published space; say so rather than fail.
      linked.push({ hash, file: null, status })
      return
    }
    if (sha256(body) !== hash) problems.push(`/i/${hash}: bytes do not match their hash`)
    await put(root, local, body)
    linked.push({ hash, file: local })
  })

  const index = {
    at: new Date().toISOString(),
    api: API,
    history,
    spaces,
    deletedSpaces:
      deletedSpaces ?? 'not listed: a program token cannot read Recently deleted spaces',
    blobs: linked.sort((one, two) => (one.hash < two.hash ? -1 : 1)),
    problems,
  }
  await put(root, 'index.json', `${JSON.stringify(index, null, 2)}\n`)
  await sums(root, index)

  // A document is served only from a published space, so a link to one can be a 404.
  const unserved = linked.filter((one) => !one.file).length
  say(
    `${spaces.length} spaces, ${counts.notes} notes, ${counts.deleted} in Recently deleted, ` +
      `${counts.versions} versions, ${linked.length - unserved} files` +
      `${unserved ? ` (${unserved} linked but not served)` : ''} ` +
      `(${counts.fetched} notes fetched) into ${root}`,
  )
  for (const problem of problems) say(`  ! ${problem}`)
  if (problems.length) process.exitCode = 2
}

/** Every file a text links on the service, into `blobs` as hash and extension. */
function linkedIn(text, blobs) {
  for (const match of text.matchAll(LINKED))
    blobs.set(match[1].toLowerCase(), (match[2] ?? '').toLowerCase())
}

/** A note's versions: the list, and each text once by its hash. */
async function versionsOf(root, entry, kept, problems, counts, blobs) {
  const { status, body } = await get(`/v1/notes/${encodeURIComponent(entry.id)}/versions`)
  if (status !== 200) {
    problems.push(`${entry.path}: versions: ${body.error ?? status}`)
    return
  }
  const known = new Map((kept?.versions ?? []).map((one) => [one.at, one]))

  for (const version of body.versions ?? []) {
    const had = known.get(version.at)
    const file = had?.hash ? join(root, 'versions', `${had.hash}.txt`) : null
    if (file && existsSync(file)) {
      linkedIn(await readFile(file, 'utf8'), blobs)
      entry.versions.push(had)
      counts.versions++
      continue
    }
    const words = await get(`/v1/notes/${encodeURIComponent(entry.id)}/versions/${version.at}`)
    if (words.status !== 200) {
      problems.push(`${entry.path}: version ${version.at}: ${words.body.error ?? words.status}`)
      continue
    }
    const content = words.body.content ?? ''
    const hash = sha256(content)
    await put(root, `versions/${hash}.txt`, content)
    linkedIn(content, blobs)
    entry.versions.push({ at: version.at, by: version.by, size: version.size, hash })
    counts.versions++
  }
}

/** `SHA256SUMS` over every file the index names, in the format `sha256sum -c` reads. */
async function sums(root, index) {
  const files = new Set(['index.json'])
  for (const space of index.spaces) {
    for (const note of space.notes) {
      if (note.file) files.add(note.file)
      for (const version of note.versions) files.add(`versions/${version.hash}.txt`)
    }
  }
  for (const blob of index.blobs) if (blob.file) files.add(blob.file)

  const lines = []
  for (const file of [...files].sort()) {
    lines.push(`${sha256(await readFile(join(root, ...file.split('/'))))}  ${file}`)
  }
  await put(root, 'SHA256SUMS', `${lines.join('\n')}\n`)
}

async function main() {
  const args = process.argv.slice(2)
  const root = args.find((one) => !one.startsWith('--'))
  if (!TOKEN) throw new Error('NIB_TOKEN is not set')
  if (!root) throw new Error('usage: account-backup.mjs <folder> [--no-history]')

  await mkdir(root, { recursive: true })
  await backup(root, { history: !args.includes('--no-history') })
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
