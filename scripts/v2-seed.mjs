#!/usr/bin/env node
/** Synthetic spaces for testing sync at the size and with the mess a real account has
 *  (docs/sync-v2.md section 12; the v2 readiness audit's test plan, 3.1 and 3.2).
 *
 *  Everything is decided by `--seed`, so two runs write the same bytes and a manifest
 *  written once can be checked against any copy later.
 *
 *    node scripts/v2-seed.mjs make <spaces dir> [--seed 1] [--scale 1] [--light] [--only test|big]
 *    node scripts/v2-seed.mjs churn <spaces dir> [--seed 1] [--scale 1]
 *    node scripts/v2-seed.mjs manifest <spaces dir> <out.json>
 *    node scripts/v2-seed.mjs check <manifest.json> <folder>...
 *    NIB_TOKEN=... NIB_API=http://127.0.0.1:8787 node scripts/v2-seed.mjs api "V2 Test"
 *
 *  `make` writes two spaces into a spaces folder (a probe's NIB_SPACES_DIR):
 *
 *  - "V2 Test": 3,000 notes in folders up to five deep, each with words of its own
 *    (`mk-<n>-<six letters>`), front matter on 300, tasks, tables, code fences, CJK and
 *    emoji, links between notes; 30 web notes in the real `.url` format; 10 canvases and
 *    2 page notes; 60 pictures from 2 KB to 14 MB, 3 PDFs and one 70 MB file (above the
 *    64 MB a file travels in one piece); 5 `.term` files; `CON.md`, `aux.md` and a path
 *    of 200 characters.
 *  - "Big": 12,000 small notes, the size `prepare` has to take in one request.
 *
 *  `--scale 0.01` makes a hundredth of every count for a quick run, and `--light` caps
 *  every binary file at 256 KB. The manifest (`<spaces dir>.manifest.json` unless
 *  `--manifest` says) holds a sha256 per path and every marker word.
 *
 *  `churn` is the history to make under v1 with the app running and syncing: 100
 *  renames, 20 folder moves (the first one holding 300 notes), 30 deletes, 300 edits
 *  each adding a marker (`ed-<n>-<six letters>`), and a line added to a day note. It
 *  writes the new markers into the manifest. A restore from Recently deleted is the
 *  app's, so it is not here.
 *
 *  `check` says whether every marker in a manifest is in at least one file under the
 *  folders given: a copy of the spaces, or an account backup (scripts/account-backup.mjs
 *  writes the notes, Recently deleted and every version's words as files).
 *
 *  `api` creates, through the account, the names no Windows disk can hold side by side:
 *  `Plan.md` beside `plan.md`, one name in NFC and in NFD, and folders ending in a dot
 *  and in a space. It needs a token that may write, and refuses the real service unless
 *  `--prod` is given: writing to production is the manager's call.
 *
 *  The `.term` files name a machine and a session that do not exist (a tab says the
 *  terminal is gone and offers a new one); terminals with a running shell are made in
 *  the app, which writes their files itself. */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { deflateSync } from 'node:zlib'

const TEST = 'V2 Test'
const BIG = 'Big'

/** A marker word: unique to one note, so finding it proves those words arrived. */
const MARKER = /\b(?:mk|ed)-[a-z0-9]+-[a-z0-9]{6}\b/g

/** Files the manifest reads as text, so it can find markers in them. */
const TEXT = /\.(md|canvas|pages|url|term)$/i

function say(words) {
  process.stdout.write(`${words}\n`)
}

/** A small generator with a seed: mulberry32 over an FNV-1a hash of the name, so each
 *  file's bytes depend on the seed and its own name and on nothing made before it. */
function random(...parts) {
  let state = 0x811c9dc5
  for (const char of parts.join(':')) {
    state ^= char.codePointAt(0)
    state = Math.imul(state, 0x01000193) >>> 0
  }
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (below) => Math.floor(next() * below),
    pick: (list) => list[Math.floor(next() * list.length)],
    word: (length) =>
      Array.from(
        { length },
        () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(next() * 36)],
      ).join(''),
    bytes(size) {
      const out = Buffer.allocUnsafe(size)
      for (let at = 0; at < size; at += 4) {
        const value = (next() * 4294967296) >>> 0
        for (let one = 0; one < 4 && at + one < size; one++)
          out[at + one] = (value >>> (one * 8)) & 0xff
      }
      return out
    },
  }
}

const WORDS =
  'the a sync note space folder file device offline online merge version history paper ink page tab window draft rename move delete restore keep quiet room settle push pull account token share link canvas card edge stroke picture table task fence term machine session'.split(
    ' ',
  )
const AREAS = ['Projects', 'Areas', 'Reading', 'Journal', 'Work', 'Uni', 'Archive', 'Ideas']
const TOPICS = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Notes', 'Drafts', 'Meetings', 'Lists', 'Misc']
const CJK = ['同期のテストです。', '离线编辑会被合并。', '동기화 시험 문장입니다.']
const EMOJI = ['🧪', '📓', '🔁', '✅', '🌙', '🦊', '👩🏽‍💻', '🇨🇭']
const SITES = [
  ['https://svelte.dev/docs', 'Svelte docs'],
  ['https://developer.mozilla.org/en-US/docs/Web/API/fetch', 'fetch() - MDN'],
  ['https://github.com/yjs/yjs', 'yjs/yjs: Shared data types'],
  ['https://jsoncanvas.org/spec/1.0/', 'JSON Canvas spec'],
  ['https://www.ethz.ch/de.html', 'ETH Zürich'],
  ['https://news.ycombinator.com/item?id=1&q=a?b:c', 'HN: a title with ? and : in it'],
]

function sentence(rng, length) {
  const words = Array.from({ length }, () => rng.pick(WORDS))
  return `${words[0][0].toUpperCase()}${words.join(' ').slice(1)}.`
}

/** Where note `n` of the test space lives: up to five folders deep. */
function folderOf(rng) {
  const depth = rng.int(6)
  const parts = []
  for (let level = 0; level < depth; level++) {
    parts.push(level === 0 ? rng.pick(AREAS) : `${rng.pick(TOPICS)} ${rng.int(4) + 1}`)
  }
  return parts
}

/** A note's words, with its marker and whichever features its number asks for. */
function noteText(seed, n, title, total) {
  const rng = random(seed, 'note', n)
  const marker = `mk-${n}-${rng.word(6)}`
  const lines = []

  if (n % 10 === 0) {
    lines.push(
      '---',
      `title: ${title}`,
      `tags: [seed, n${n % 7}]`,
      `created: 2026-0${1 + (n % 9)}-1${n % 10}`,
      'status: draft',
      '---',
      '',
    )
  }
  lines.push(`# ${title}`, '', `${sentence(rng, 8 + rng.int(12))} ${marker}`, '')
  if (n % 5 === 0)
    lines.push(
      `See [[Note ${(n * 7 + 3) % total}]] and [[Note ${(n * 13 + 1) % total}|another one]].`,
      '',
    )
  if (n % 7 === 0)
    lines.push(
      `- [ ] ${sentence(rng, 4)}`,
      `- [x] ${sentence(rng, 3)} 📅 2026-10-0${1 + (n % 9)}`,
      `- [ ] ${sentence(rng, 5)}`,
      '',
    )
  if (n % 11 === 0) {
    lines.push('| key | value | count |', '| --- | :-: | --: |')
    for (let row = 0; row < 3; row++)
      lines.push(`| ${rng.pick(WORDS)} | ${rng.pick(WORDS)} | ${rng.int(1000)} |`)
    lines.push('')
  }
  if (n % 13 === 0)
    lines.push(
      '```ts',
      `const n${n} = ${rng.int(99)} // ${rng.pick(WORDS)}`,
      'export default n' + n,
      '```',
      '',
    )
  if (n % 17 === 0) lines.push(rng.pick(CJK), '')
  if (n % 19 === 0) lines.push(`${rng.pick(EMOJI)} ${sentence(rng, 5)} ${rng.pick(EMOJI)}`, '')
  for (let paragraph = rng.int(4); paragraph > 0; paragraph--)
    lines.push(sentence(rng, 10 + rng.int(30)), '')

  return { text: lines.join('\n'), marker }
}

/** A PNG of noise, about `size` bytes: stored rather than compressed, so the size is
 *  what was asked and the bytes cannot be shrunk by anything on the way. */
function png(rng, size) {
  const width = 256
  const height = Math.max(1, Math.round(size / (width * 3 + 1)))
  const raw = Buffer.alloc((width * 3 + 1) * height)
  const noise = rng.bytes(width * 3 * height)
  for (let row = 0; row < height; row++)
    noise.copy(raw, row * (width * 3 + 1) + 1, row * width * 3, (row + 1) * width * 3)

  const chunk = (type, data) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(data.length, 0)
    head.write(type, 4, 'ascii')
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
    return Buffer.concat([head, data, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 0 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(data) {
  let c = 0xffffffff
  for (const byte of data) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A one-page PDF that says `words`, with a correct cross-reference table. */
function pdf(words) {
  const stream = `BT /F1 18 Tf 72 720 Td (${words.replace(/[()\\]/g, '')}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((body, at) => {
    offsets.push(out.length)
    out += `${at + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

function shortcut(url, title, when) {
  return `[InternetShortcut]\r\nURL=${url}\r\nTitle=${title}\r\nNib-Added=${when}\r\n`
}

/** A canvas the way the app writes one: JSON Canvas, tabs, a closing newline. */
function canvas(rng, n) {
  const nodes = []
  const edges = []
  for (let card = 0; card < 4 + rng.int(6); card++) {
    nodes.push({
      id: rng.word(16),
      type: 'text',
      text: `${sentence(rng, 5)} mk-c${n}${card}-${rng.word(6)}`,
      x: card * 300,
      y: rng.int(600),
      width: 250,
      height: 120,
    })
  }
  nodes.push({
    id: rng.word(16),
    type: 'link',
    url: rng.pick(SITES)[0],
    x: 0,
    y: 800,
    width: 400,
    height: 300,
  })
  for (let at = 1; at < nodes.length - 1; at++)
    edges.push({ id: rng.word(16), fromNode: nodes[at - 1].id, toNode: nodes[at].id })
  return `${JSON.stringify({ nodes, edges }, null, '\t')}\n`
}

/** A page note: the pages as labelled groups, and their paper under `nib.pages`. */
function pages(rng, count) {
  const nodes = []
  const records = []
  for (let page = 0; page < count; page++) {
    const id = rng.word(16)
    nodes.push({
      id,
      type: 'group',
      x: -397,
      y: page * (1123 + 40),
      width: 794,
      height: 1123,
      label: `Page ${page + 1}`,
    })
    records.push({ id, paper: 'a4', pattern: page % 2 ? 'lined' : 'blank' })
  }
  return `${JSON.stringify({ nodes, edges: [], nib: { version: 1, pages: records } }, null, '\t')}\n`
}

function scaled(count, scale) {
  return Math.max(1, Math.round(count * scale))
}

async function put(root, path, data) {
  const where = join(root, ...path.split('/'))
  await mkdir(dirname(where), { recursive: true })
  await writeFile(where, data)
}

async function makeTest(root, seed, scale, light) {
  const space = join(root, TEST)
  const total = scaled(3000, scale)
  const notes = []

  for (let n = 0; n < total; n++) {
    const rng = random(seed, 'place', n)
    const path = [...folderOf(rng), `Note ${n}.md`].join('/')
    await put(space, path, noteText(seed, n, `Note ${n}`, total).text)
    notes.push(path)
  }

  // Names a Windows disk holds only with care, and a path at the account's long end.
  await put(space, 'Tricky/CON.md', noteText(seed, 'con', 'CON', total).text)
  await put(space, 'Tricky/aux.md', noteText(seed, 'aux', 'aux', total).text)
  await put(space, 'Tricky/Café ☕ & 100% «quotes».md', noteText(seed, 'cafe', 'Café', total).text)
  const long = `Tricky/${'Very long folder name '.repeat(4).trim()}/${'And another long folder '.repeat(3).trim()}/`
  await put(
    space,
    `${long}${'n'.repeat(200 - long.length - 3)}.md`,
    noteText(seed, 'long', 'Long', total).text,
  )

  const day = new Date(Date.UTC(2026, 8, 1) + (seed % 30) * 86400000).toISOString()
  for (let n = 0; n < scaled(30, scale); n++) {
    const rng = random(seed, 'url', n)
    const [url, title] = SITES[n % SITES.length]
    await put(
      space,
      `Web/${title.replace(/[<>:"/\\|?*]/g, ' ').trim()} ${n}.url`,
      shortcut(`${url}${n ? `#s${rng.word(4)}` : ''}`, title, day),
    )
  }
  for (let n = 0; n < scaled(10, scale); n++)
    await put(space, `Boards/Board ${n}.canvas`, canvas(random(seed, 'canvas', n), n))
  for (let n = 0; n < scaled(2, scale); n++)
    await put(space, `Boards/Pages ${n}.pages`, pages(random(seed, 'pages', n), 3 + n))

  // Pictures between 2 KB and 14 MB, spread evenly on a log scale.
  const cap = light ? 256 * 1024 : Infinity
  const pictures = scaled(60, scale)
  for (let n = 0; n < pictures; n++) {
    const size = Math.min(
      cap,
      Math.round(2048 * ((14 * 1024 * 1024) / 2048) ** (pictures > 1 ? n / (pictures - 1) : 0)),
    )
    await put(
      space,
      `assets/picture-${String(n).padStart(2, '0')}.png`,
      png(random(seed, 'png', n), size),
    )
  }
  for (let n = 0; n < scaled(3, scale); n++)
    await put(
      space,
      `Papers/Paper ${n}.pdf`,
      pdf(`Seed paper ${n} mk-pdf${n}-${random(seed, 'pdf', n).word(6)}`),
    )
  await put(
    space,
    'assets/recording.bin',
    random(seed, 'big').bytes(Math.min(cap, 70 * 1024 * 1024)),
  )

  for (let n = 0; n < scaled(5, scale); n++) {
    const rng = random(seed, 'term', n)
    await put(
      space,
      `Terminals/Shell ${n}.term`,
      `${JSON.stringify({ v: 1, machine: `seed-${rng.word(12)}`, session: `seed-${rng.word(16)}` })}\n`,
    )
  }

  await put(
    space,
    `Daily/${day.slice(0, 10)}.md`,
    `# ${day.slice(0, 10)}\n\n- started mk-day-${random(seed, 'day').word(6)}\n`,
  )
  return notes.length
}

async function makeBig(root, seed, scale) {
  const space = join(root, BIG)
  const total = scaled(12000, scale)
  for (let n = 0; n < total; n++) {
    const rng = random(seed, 'big', n)
    await put(
      space,
      `Batch ${String(Math.floor(n / 100)).padStart(3, '0')}/Small ${n}.md`,
      `# Small ${n}\n\n${sentence(rng, 6)} mk-${100000 + n}-${rng.word(6)}\n`,
    )
  }
  return total
}

/** Every file under a folder, by its path inside it, forward-slashed. */
async function walk(root, folder = root) {
  const found = []
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const where = join(folder, entry.name)
    if (entry.isDirectory()) found.push(...(await walk(root, where)))
    else found.push(relative(root, where).split(sep).join('/'))
  }
  return found
}

/** A sha256 per path and every marker each text file holds. */
async function manifest(root) {
  const files = {}
  const markers = {}
  for (const path of await walk(root)) {
    const data = await readFile(join(root, ...path.split('/')))
    files[path] = createHash('sha256').update(data).digest('hex')
    if (!TEXT.test(path)) continue
    for (const marker of data.toString('utf8').match(MARKER) ?? []) markers[marker] = path
  }
  return { files, markers }
}

async function writeManifest(where, body) {
  await writeFile(where, `${JSON.stringify(body, null, 1)}\n`)
}

/** The history: renames, folder moves, deletes, edits and a day note, all by seed. */
async function churn(root, seed, scale, manifestPath) {
  const space = join(root, TEST)
  const rng = random(seed, 'churn')
  const isNote = (path) => /(?:^|\/)Note \d+\.md$/.test(path)
  const log = []
  const markers = {}

  // Folder moves first, while the folders are whole. The top folder holding the most
  // notes goes first, so one move carries some hundreds of them; then folders one
  // level down, from the other top folders.
  const before = (await walk(space)).filter(isNote)
  const held = new Map()
  for (const path of before.filter((one) => one.includes('/'))) {
    const top = path.split('/')[0]
    held.set(top, (held.get(top) ?? 0) + 1)
  }
  const biggest = [...held].sort((one, two) => two[1] - one[1])[0]?.[0]
  const seconds = [
    ...new Set(
      before
        .filter((path) => path.split('/').length > 2)
        .map((path) => path.split('/').slice(0, 2).join('/')),
    ),
  ]
    .filter((folder) => folder.split('/')[0] !== biggest)
    .sort()
  const moves = [biggest, ...seconds].filter(Boolean).slice(0, scaled(20, scale))
  await mkdir(join(space, 'Moved'), { recursive: true })
  for (const [at, folder] of moves.entries()) {
    const to = `Moved/${folder.split('/').at(-1)} ${at}`
    await rename(join(space, ...folder.split('/')), join(space, ...to.split('/')))
    log.push({
      op: 'move',
      from: folder,
      notes: before.filter((path) => path.startsWith(`${folder}/`)).length,
      to,
    })
  }

  const notes = (await walk(space)).filter(isNote).sort()
  const take = (count) => {
    const out = []
    while (out.length < count && notes.length) out.push(notes.splice(rng.int(notes.length), 1)[0])
    return out
  }

  for (const path of take(scaled(100, scale))) {
    const to = path.replace(/Note (\d+)\.md$/, (_, n) => `Renamed ${n} ${rng.word(4)}.md`)
    await rename(join(space, ...path.split('/')), join(space, ...to.split('/')))
    log.push({ op: 'rename', from: path, to })
    notes.push(to)
  }
  for (const path of take(scaled(30, scale))) {
    await rm(join(space, ...path.split('/')))
    log.push({ op: 'delete', path })
  }
  for (const [n, path] of take(scaled(300, scale)).entries()) {
    const marker = `ed-${n}-${rng.word(6)}`
    const where = join(space, ...path.split('/'))
    await writeFile(
      where,
      `${await readFile(where, 'utf8')}\nEdited: ${sentence(rng, 6)} ${marker}\n`,
    )
    markers[marker] = path
    log.push({ op: 'edit', path, marker })
  }
  const daily = (await walk(space)).find((path) => path.startsWith('Daily/'))
  if (daily) {
    const marker = `ed-9999-${rng.word(6)}`
    const where = join(space, ...daily.split('/'))
    await writeFile(where, `${await readFile(where, 'utf8')}- churned ${marker}\n`)
    markers[marker] = daily
    log.push({ op: 'edit', path: daily, marker })
  }

  if (existsSync(manifestPath)) {
    const held = JSON.parse(await readFile(manifestPath, 'utf8'))
    held.markers = {
      ...held.markers,
      ...Object.fromEntries(Object.entries(markers).map(([one, path]) => [one, `${TEST}/${path}`])),
    }
    held.churn = [...(held.churn ?? []), ...log]
    await writeManifest(manifestPath, held)
  }
  const count = (op) => log.filter((one) => one.op === op).length
  say(
    `churned ${TEST}: ${count('move')} folder moves, ${count('rename')} renames, ${count('delete')} deletes, ${count('edit')} edits`,
  )
}

/** Whether every marker of a manifest is somewhere in the text under these folders. */
async function check(manifestPath, folders) {
  const { markers } = JSON.parse(await readFile(manifestPath, 'utf8'))
  const found = new Set()
  for (const folder of folders) {
    for (const path of await walk(folder)) {
      if (!/\.(md|canvas|pages|url|term|txt|pdf)$/i.test(path)) continue
      for (const marker of (await readFile(join(folder, ...path.split('/')), 'utf8')).match(
        MARKER,
      ) ?? [])
        found.add(marker)
    }
  }
  const missing = Object.keys(markers).filter((one) => !found.has(one))
  say(
    `${Object.keys(markers).length - missing.length} of ${Object.keys(markers).length} markers found`,
  )
  for (const one of missing.slice(0, 50)) say(`  missing ${one} (${markers[one]})`)
  if (missing.length > 50) say(`  … ${missing.length - 50} more`)
  if (missing.length) process.exitCode = 2
}

/** The names a disk cannot hold side by side, made through the account. */
async function viaApi(spaceName, prod) {
  const api = (process.env.NIB_API || 'https://nibeditor.com').replace(/\/$/, '')
  const token = process.env.NIB_TOKEN ?? ''
  if (!token) throw new Error('NIB_TOKEN is not set')
  if (/nibeditor\.com/.test(api) && !prod)
    throw new Error(`${api} is production: pass --prod once the manager has said yes`)

  const ask = async (path, body) => {
    const response = await fetch(`${api}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    return { status: response.status, json: await response.json().catch(() => ({})) }
  }

  const { json } = await ask('/v1/spaces')
  const space = (json.spaces ?? []).find((one) => one.name === spaceName || one.id === spaceName)
  if (!space) throw new Error(`no space called ${spaceName}`)

  const names = [
    'Tricky/Plan.md',
    'Tricky/plan.md',
    'Tricky/Café composed.md',
    'Tricky/Café composed.md',
    'Tricky/Ends with a dot./inside.md',
    'Tricky/Ends with a space /inside.md',
  ]
  for (const path of names) {
    const made = await ask(`/v1/spaces/${space.id}/notes`, {
      path,
      content: `# ${path}\n\nmk-api-${createHash('sha256').update(path).digest('hex').slice(0, 6)}\n`,
    })
    say(`${made.status} ${JSON.stringify(path)}${made.json.error ? ` ${made.json.error}` : ''}`)
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const words = []
  const flags = {}
  for (let at = 0; at < argv.length; at++) {
    const one = argv[at]
    if (['--seed', '--scale', '--only', '--manifest'].includes(one))
      flags[one.slice(2)] = argv[++at]
    else if (one.startsWith('--')) flags[one.slice(2)] = true
    else words.push(one)
  }
  const [what, first, ...rest] = words
  const seed = Number(flags.seed ?? 1)
  const scale = Number(flags.scale ?? 1)
  if (!Number.isFinite(seed) || !(scale > 0))
    throw new Error('--seed is a number and --scale above 0')

  if (what === 'make' && first) {
    await mkdir(first, { recursive: true })
    const made = []
    if (flags.only !== 'big')
      made.push(`${await makeTest(first, seed, scale, flags.light === true)} notes in ${TEST}`)
    if (flags.only !== 'test') made.push(`${await makeBig(first, seed, scale)} in ${BIG}`)
    const where = flags.manifest ?? `${first.replace(/[\\/]+$/, '')}.manifest.json`
    await writeManifest(where, {
      seed,
      scale,
      light: flags.light === true,
      ...(await manifest(first)),
    })
    say(`made ${made.join(' and ')}; manifest ${where}`)
  } else if (what === 'churn' && first) {
    await churn(
      first,
      seed,
      scale,
      flags.manifest ?? `${first.replace(/[\\/]+$/, '')}.manifest.json`,
    )
  } else if (what === 'manifest' && first && rest[0]) {
    await writeManifest(rest[0], await manifest(first))
    say(`manifest ${rest[0]}`)
  } else if (what === 'check' && first && rest.length) {
    await check(first, rest)
  } else if (what === 'api' && first) {
    await viaApi(first, flags.prod === true)
  } else {
    throw new Error(
      'usage: v2-seed.mjs make|churn <dir> | manifest <dir> <out> | check <manifest> <folder>... | api <space>',
    )
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
