/** Every file of a space that is not a note: a picture, a recording, a PDF, anything
 *  (docs/sync-v2.md section 5.8).
 *
 *  In the tree such a file is an entry of kind `file` with a hash and a size, and its
 *  bytes are a blob addressed by that hash - the same `blobs` rows and the same
 *  `blobs/<hash>` objects pictures already use, counted against the uploading account
 *  as they always were. Nothing merges: a replacement is a new hash, the later arrival
 *  stands, and a device replacing a file another replaced while it was away is told
 *  so and asks its person.
 *
 *  Three roads in, one out. Bytes up to 64 MB go up in one request, larger ones in
 *  8 MB parts through R2's multipart upload; either way the hash is checked against the
 *  bytes, since a blob named by a hash is shared by everybody who holds the same file
 *  and a wrong name would hand them somebody else's. And the bytes come back down
 *  through the space, to its members only: `/i/<hash>` serves what a published page
 *  points at and nothing else. */

import { Hono } from 'hono'
import { now } from '../crypto'
import { laterOf, pokeSpace } from '../hub/poke'
import { nextSeq } from '../notes'
import { OUT_OF_SPACE } from '../refused'
import { atLeast, spaceOf } from '../spaces/space'
import { fits } from '../storage'
import type { Env, Note, Variables } from '../types'
import { deviceOf } from './device'
import { revive } from './ops'

interface App {
  Bindings: Env
  Variables: Variables
}

const HASH = /^[a-f0-9]{64}$/

/** The largest file that goes up in one request; past it, parts. A Worker holds a
 *  request's body in 128 MB of memory, and hashes it there. */
const ONE_REQUEST = 64 * 1024 * 1024

/** How big a part is. R2 takes parts of at least 5 MB, all but the last the same size. */
const PART = 8 * 1024 * 1024

/** The largest file a space keeps: the account's whole quota is the other bound. */
const LARGEST = 1024 * 1024 * 1024

/** A file nobody can reach, or one that is not a file. A reader can bring it about -
 *  opening a file somebody removed a moment ago - so it has a row in every catalogue. */
export const NO_SUCH_FILE = 'no such file'

/** Bytes whose hash is not the name they arrived under. A correct client never sends
 *  these, so it reaches no reader and stays English. */
const WRONG_BYTES = 'those bytes are not that hash'
const NOT_A_HASH = 'that is not a hash'
const TOO_BIG = 'that file is too big'

/** The types a blob keeps as they were declared: what `/i/` serves a published page,
 *  and what the v1 routes take. Anything else is kept as bytes and nothing more, so no
 *  file anybody syncs is ever served as a page on this origin. */
const DECLARED = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'application/pdf',
])
export const BYTES = 'application/octet-stream'

function typeOf(header: string | undefined): string {
  const type = (header ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  return DECLARED.has(type) ? type : BYTES
}

/** Where a file's bytes are kept: by their hash, so one blob serves every copy. */
export function blobKey(hash: string): string {
  return `blobs/${hash}`
}

function hex(digest: ArrayBuffer): string {
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** A Worker's streaming hasher, which Node has no equivalent of. */
type DigestStreaming = new (algorithm: string) => WritableStream & { digest: Promise<ArrayBuffer> }

/** The hash of an object in the bucket, read as a stream where the runtime can hash
 *  one (a Worker's `DigestStream`), and whole where it cannot. */
async function hashOf(object: R2ObjectBody): Promise<string> {
  // Read off the runtime rather than its types, which describe only one of the two.
  const Streaming = (crypto as unknown as { DigestStream?: DigestStreaming }).DigestStream
  if (Streaming) {
    const stream = new Streaming('SHA-256')
    await object.body.pipeTo(stream)
    return hex(await stream.digest)
  }
  return hex(await crypto.subtle.digest('SHA-256', await object.arrayBuffer()))
}

/** A row saying this account keeps a blob, once its bytes are there. */
async function keepBlob(env: Env, user: string, hash: string, size: number, type: string) {
  await env.DB.prepare(
    `insert into blobs (hash, user_id, size, type, created_at) values (?, ?, ?, ?, ?)
     on conflict(hash, user_id) do nothing`,
  )
    .bind(hash, user, size, type, now())
    .run()
}

/** Whether this account keeps a blob already, and whether anybody's bytes are there. */
async function held(
  env: Env,
  user: string,
  hash: string,
): Promise<{ mine: boolean; there: boolean }> {
  const row = await env.DB.prepare(
    'select max(user_id = ?) as mine, count(*) as rows from blobs where hash = ?',
  )
    .bind(user, hash)
    .first<{ mine: number | null; rows: number }>()
  return { mine: row?.mine === 1, there: (row?.rows ?? 0) > 0 }
}

export const v2Blobs = new Hono<App>()

/** A file's bytes, in one request. The object already there - somebody else's copy of
 *  the same file - is not written again, so what a published page is served stays
 *  what it was. */
v2Blobs.put('/:hash', async (context) => {
  const user = context.get('user')
  const hash = context.req.param('hash').toLowerCase()
  if (!HASH.test(hash)) return context.json({ error: NOT_A_HASH }, 400)
  if (Number(context.req.header('content-length') ?? 0) > ONE_REQUEST) {
    return context.json({ error: TOO_BIG }, 413)
  }

  const { mine, there } = await held(context.env, user.id, hash)
  if (mine) return context.json({ hash, stored: false })

  const body = await context.req.arrayBuffer()
  if (body.byteLength > ONE_REQUEST) return context.json({ error: TOO_BIG }, 413)
  if (hex(await crypto.subtle.digest('SHA-256', body)) !== hash) {
    return context.json({ error: WRONG_BYTES }, 400)
  }
  if (!(await fits(context.env, user.id, body.byteLength))) {
    return context.json({ error: OUT_OF_SPACE }, 507)
  }

  const type = typeOf(context.req.header('content-type'))
  if (!there) {
    await context.env.NOTES.put(blobKey(hash), body, { httpMetadata: { contentType: type } })
  }
  await keepBlob(context.env, user.id, hash, body.byteLength, type)
  return context.json({ hash, stored: true }, 201)
})

/** What a multipart upload in flight remembers: whose, which hash, how big. Kept in
 *  `cached` for a day, as `user:hash:size:type`, which is also how deleting the account
 *  finds it; see erase.ts. */
const UPLOADS = 'upload'
const A_DAY = 24 * 60 * 60 * 1000

interface Upload {
  user: string
  hash: string
  size: number
  type: string
}

async function uploadOf(env: Env, id: string, user: string): Promise<Upload | null> {
  const row = await env.DB.prepare(
    'select value from cached where scope = ? and key = ? and until > ?',
  )
    .bind(UPLOADS, id, now())
    .first<{ value: string }>()
  const [owner, hash, size, type] = (row?.value ?? '').split(':')
  if (owner !== user || !hash || !size || !type) return null
  return { user: owner, hash, size: Number(size), type: decodeURIComponent(type) }
}

/** A large file, started: answers the upload to send parts to, and how big a part is;
 *  or that nothing needs sending. */
v2Blobs.post('/parts', async (context) => {
  const user = context.get('user')
  const body: unknown = await context.req.json().catch(() => null)
  const { hash, size, type } = (typeof body === 'object' && body !== null ? body : {}) as Record<
    string,
    unknown
  >
  if (typeof hash !== 'string' || !HASH.test(hash)) return context.json({ error: NOT_A_HASH }, 400)
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > LARGEST) {
    return context.json({ error: TOO_BIG }, 413)
  }

  const { mine, there } = await held(context.env, user.id, hash)
  if (mine) return context.json({ hash, stored: false })
  if (!(await fits(context.env, user.id, size))) return context.json({ error: OUT_OF_SPACE }, 507)

  const declared = typeOf(typeof type === 'string' ? type : undefined)
  // Somebody else's copy is already here: this account keeps it too, and sends nothing.
  if (there) {
    await keepBlob(context.env, user.id, hash, size, declared)
    return context.json({ hash, stored: false })
  }

  const upload = await context.env.NOTES.createMultipartUpload(blobKey(hash), {
    httpMetadata: { contentType: declared },
  })
  await context.env.DB.prepare(
    'insert or replace into cached (scope, key, value, until) values (?, ?, ?, ?)',
  )
    .bind(
      UPLOADS,
      upload.uploadId,
      `${user.id}:${hash}:${String(size)}:${encodeURIComponent(declared)}`,
      now() + A_DAY,
    )
    .run()

  return context.json({ upload: upload.uploadId, part: PART }, 201)
})

/** One part of a large file. */
v2Blobs.put('/parts/:upload/:part', async (context) => {
  const user = context.get('user')
  const upload = await uploadOf(context.env, context.req.param('upload'), user.id)
  if (!upload) return context.json({ error: NO_SUCH_FILE }, 404)

  const part = Number(context.req.param('part'))
  if (!Number.isSafeInteger(part) || part < 1 || part > 10_000) {
    return context.json({ error: TOO_BIG }, 413)
  }
  const body = await context.req.arrayBuffer()
  if (body.byteLength > PART) return context.json({ error: TOO_BIG }, 413)

  const uploading = context.env.NOTES.resumeMultipartUpload(
    blobKey(upload.hash),
    context.req.param('upload'),
  )
  const uploaded = await uploading.uploadPart(part, body)
  return context.json({ part: uploaded.partNumber, etag: uploaded.etag })
})

/** A large file, finished: the parts put together, measured and hashed, and kept only
 *  when they are the bytes the upload named. */
v2Blobs.post('/parts/:upload', async (context) => {
  const user = context.get('user')
  const id = context.req.param('upload')
  const upload = await uploadOf(context.env, id, user.id)
  if (!upload) return context.json({ error: NO_SUCH_FILE }, 404)

  const body: unknown = await context.req.json().catch(() => null)
  const listed =
    typeof body === 'object' && body !== null ? (body as { parts?: unknown }).parts : null
  if (!Array.isArray(listed)) return context.json({ error: WRONG_BYTES }, 400)
  const parts: R2UploadedPart[] = []
  for (const one of listed as unknown[]) {
    const { part, etag } = (typeof one === 'object' && one !== null ? one : {}) as Record<
      string,
      unknown
    >
    if (typeof part !== 'number' || typeof etag !== 'string')
      return context.json({ error: WRONG_BYTES }, 400)
    parts.push({ partNumber: part, etag })
  }

  const key = blobKey(upload.hash)
  await context.env.NOTES.resumeMultipartUpload(key, id).complete(parts)
  await context.env.DB.prepare('delete from cached where scope = ? and key = ?')
    .bind(UPLOADS, id)
    .run()

  const object = await context.env.NOTES.get(key)
  const right =
    object !== null && object.size === upload.size && (await hashOf(object)) === upload.hash
  if (!right) {
    // Only if nobody's row names it: a copy somebody else finished meanwhile stays.
    if (!(await held(context.env, user.id, upload.hash)).there) await context.env.NOTES.delete(key)
    return context.json({ error: WRONG_BYTES }, 400)
  }

  await keepBlob(context.env, user.id, upload.hash, upload.size, upload.type)
  return context.json({ hash: upload.hash, stored: true }, 201)
})

export const v2Files = new Hono<App>()

/** The file entry a route names, in the space it names. */
async function fileIn(env: Env, spaceId: string, id: string): Promise<Note | null> {
  return await env.DB.prepare("select * from notes where id = ? and space_id = ? and kind = 'file'")
    .bind(id, spaceId)
    .first<Note>()
}

/** A file's bytes, for somebody in its space. */
v2Files.get('/:space/:id', atLeast('read', 'space'), async (context) => {
  const space = spaceOf(context)
  const file = await fileIn(context.env, space.id, context.req.param('id'))
  if (!file || file.deleted) return context.json({ error: NO_SUCH_FILE }, 404)

  const object = await context.env.NOTES.get(blobKey(file.hash))
  if (!object) return context.json({ error: NO_SUCH_FILE }, 404)

  return new Response(object.body, {
    headers: {
      'content-type': BYTES,
      'content-length': String(object.size),
      // Its bytes never change under one hash, and they are this space's, not the
      // world's: kept by the device that asked and by nothing in between.
      'cache-control': 'private, max-age=31536000, immutable',
      etag: `"${file.hash}"`,
      'x-content-type-options': 'nosniff',
    },
  })
})

/** A file replaced: its entry now names new bytes, which this account keeps. Written
 *  only over the bytes the device replaced (`base`); a file replaced elsewhere since
 *  answers `moved` with what it is now, and the device asks its person (section 5.8).
 *  A file deleted meanwhile comes back, since an edit beats a delete. */
v2Files.put('/:space/:id', atLeast('write', 'space'), async (context) => {
  const space = spaceOf(context)
  const id = context.req.param('id')
  const body: unknown = await context.req.json().catch(() => null)
  const { hash, base } = (typeof body === 'object' && body !== null ? body : {}) as Record<
    string,
    unknown
  >
  if (typeof hash !== 'string' || !HASH.test(hash) || typeof base !== 'string') {
    return context.json({ error: NOT_A_HASH }, 400)
  }

  const file = await fileIn(context.env, space.id, id)
  if (!file) return context.json({ error: NO_SUCH_FILE }, 404)
  if (file.hash !== base) {
    return context.json({ moved: { hash: file.hash, size: file.size, at: file.updated_at } })
  }

  // Bytes the asker or the space's owner keeps, for the reason `blobSizes` in ops.ts
  // gives.
  const who = context.get('who')
  const asker = who.kind === 'user' ? who.user.id : space.user_id
  const blob = await context.env.DB.prepare(
    'select max(size) as size from blobs where hash = ? and user_id in (?, ?)',
  )
    .bind(hash, asker, space.user_id)
    .first<{ size: number | null }>()
  if (blob?.size === null || blob?.size === undefined)
    return context.json({ error: NO_SUCH_FILE }, 404)

  const device = await deviceOf(context)
  if (file.deleted) await revive(context.env, space.id, device, id)

  const seq = await nextSeq(context.env, space.id)
  const written = await context.env.DB.prepare(
    `update notes set hash = ?, size = ?, seq = ?, doc_seq = ?, doc_by = ?, updated_by = ?,
                      version = version + 1, updated_at = ?
      where id = ? and hash = ?`,
  )
    .bind(hash, blob.size, seq, seq, device, device, now(), id, base)
    .run()
  if (!written.meta.changes) {
    const current = await fileIn(context.env, space.id, id)
    return context.json({
      moved: { hash: current?.hash ?? '', size: current?.size ?? 0, at: current?.updated_at ?? 0 },
    })
  }

  await pokeSpace(context.env, laterOf(context), space.id, seq, device)
  return context.json({ ok: true, seq })
})
