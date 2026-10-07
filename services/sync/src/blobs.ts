import { Hono } from 'hono'
import { NOT_A_HASH, OUT_OF_SPACE } from './refused'
import { spaceForHost } from './blog'
import { readSite, SVG_POLICY } from './blog/site'
import { now } from './crypto'
import { readSpaceFiles } from './spaces/files'
import { BYTES } from './sync2/files'
import { fits } from './storage'
import type { Env, Variables } from './types'

/** What may be stored, and how much of each.
 *
 *  Sixteen megabytes of picture is already far more than a note needs, and the
 *  limit keeps one paste from eating a tenth of the quota. A PDF is a whole
 *  document rather than an illustration - a scanned paper of a few hundred pages
 *  is tens of megabytes - so it gets its own, four times as much. Not more than
 *  that: the body is read whole to hash and store it, and a worker has 128 MB of
 *  memory to do it in. */
const LIMITS: Record<string, number> = {
  'image/png': 16 * 1024 * 1024,
  'image/jpeg': 16 * 1024 * 1024,
  'image/gif': 16 * 1024 * 1024,
  'image/webp': 16 * 1024 * 1024,
  'image/avif': 16 * 1024 * 1024,
  'application/pdf': 64 * 1024 * 1024,
  // What a site is dressed in: the theme the app installed, and the stylesheet
  // and script an author wrote for their own pages. Small, because none of the
  // three is a file anybody writes by hand at any size; see docs/publishing.md.
  'text/css': 512 * 1024,
  'text/javascript': 512 * 1024,
  // A diagram the app drew for a published page, which is the same kind of thing:
  // a few kilobytes of machine-written SVG, never a file anybody typed. See
  // packages/markdown/src/diagrams.ts.
  'image/svg+xml': 512 * 1024,
}

/** The kinds that are a document rather than a picture in a note, and that are
 *  therefore served only where a published page could point a reader at one. */
const DOCUMENTS = new Set(['application/pdf'])

const HASH = /^[a-f0-9]{64}$/

/** The type a request declares, with any parameters after it left off:
 *  `application/pdf; charset=binary` is a PDF. */
function typeOf(header: string): string {
  return (header.split(';')[0] ?? '').trim().toLowerCase()
}

const key = (hash: string) => `blobs/${hash}`

/** Uploading and accounting. Behind the session, like everything else here. */
export const blobs = new Hono<{ Bindings: Env; Variables: Variables }>()

/** The picture is named by its own contents, so an upload of something already
 *  stored is just a row saying this account keeps it too. */
blobs.put('/:hash', async (context) => {
  const user = context.get('user')
  const hash = context.req.param('hash').toLowerCase()
  if (!HASH.test(hash)) return context.json({ error: NOT_A_HASH }, 400)

  const type = typeOf(context.req.header('content-type') ?? '')
  const limit = LIMITS[type]
  if (limit === undefined) {
    return context.json({ error: 'images, PDFs and a site’s own css or js only' }, 415)
  }

  // Read before the body is: a request that says it is bringing a hundred
  // megabytes is turned away without spending the memory to find out.
  const declared = Number(context.req.header('content-length') ?? 0)
  if (declared > limit) return context.json({ error: 'that file is too big' }, 413)

  const already = await context.env.DB.prepare(
    'select hash from blobs where hash = ? and user_id = ?',
  )
    .bind(hash, user.id)
    .first()

  if (already) return context.json({ hash, stored: false })

  const body = await context.req.arrayBuffer()
  if (!body.byteLength) return context.json({ error: 'nothing to store' }, 400)
  if (body.byteLength > limit) return context.json({ error: 'that file is too big' }, 413)

  if (!(await fits(context.env, user.id, body.byteLength))) {
    return context.json({ error: OUT_OF_SPACE }, 507)
  }

  // The object may already be there from someone else; writing it again is the
  // same bytes either way, and cheaper than asking first.
  await context.env.NOTES.put(key(hash), body, { httpMetadata: { contentType: type } })
  // And the row may already be this account's by the time this runs: the check
  // above is not a lock, and a paste that went up twice at once used to answer
  // the second one with a 500. The same bytes under the same hash are the same
  // row, so there is nothing to write and nothing to say about it.
  await context.env.DB.prepare(
    `insert into blobs (hash, user_id, size, type, created_at) values (?, ?, ?, ?, ?)
     on conflict(hash, user_id) do nothing`,
  )
    .bind(hash, user.id, body.byteLength, type, now())
    .run()

  return context.json({ hash, stored: true }, 201)
})

/** Gives a file back and stops keeping it. The object survives while any other
 *  account still references it. */
blobs.delete('/:hash', async (context) => {
  const user = context.get('user')
  const hash = context.req.param('hash').toLowerCase()
  // Checked as it is on the way in, so a name that could never have been
  // stored cannot become a delete against the bucket.
  if (!HASH.test(hash)) return context.json({ error: NOT_A_HASH }, 400)

  await letGo(context.env, user.id, hash)
  return context.json({ ok: true })
})

/** One account stops keeping a file: its row goes, and the object with it once no
 *  other account keeps the same bytes. What a face that was replaced is given back
 *  through as well; see people/routes.ts. */
export async function letGo(env: Env, userId: string, hash: string): Promise<void> {
  await env.DB.prepare('delete from blobs where hash = ? and user_id = ?').bind(hash, userId).run()

  const others = await env.DB.prepare('select 1 from blobs where hash = ? limit 1')
    .bind(hash)
    .first()

  if (!others) await env.NOTES.delete(key(hash))
}

/** Serving, which carries no session: a note is read by whoever it was shared
 *  with, and a published blog has no reader to authenticate. The hash is the
 *  capability - it cannot be guessed, and it is all the note reveals.
 *
 *  Which is a real cost, and worth writing down rather than leaving as an
 *  assumption. A hash is the same for the same bytes whoever holds them, and it
 *  is derivable from the bytes: anybody who already has a copy of a document can
 *  work out its hash and ask this route whether Nib is holding it, and be given
 *  it. And a hash learned once - out of a note somebody was shown, off a
 *  published page, out of a proxy log - keeps working for ever, including for
 *  somebody who has since been taken out of the space it came from. Two ways out
 *  of that were considered:
 *
 *  **A salt per account in the key.** `blobs/<sha256(salt + hash)>` would make one
 *  account's URL unrelated to another's, which closes the "does Nib hold this
 *  document" question: knowing the bytes is no longer knowing the address. It
 *  costs the deduplication - the same picture in two accounts becomes two objects
 *  in R2, and the quota counts it twice - and it costs a migration of every object
 *  already stored. What it does not fix is the other half: the URL in the note is
 *  the salted one, so a hash somebody has already seen still works for ever.
 *
 *  **An access check here, by space membership.** The right answer in principle,
 *  and mostly impossible: an `<img>` tag cannot carry an `Authorization` header,
 *  auth here is a bearer token and never a cookie, and the URL of a picture is
 *  written into the note's own markdown - so the editor, an export, a published
 *  page and the clipper all fetch these with no session at all. Checking the
 *  requester would break every picture in the app before it stopped anybody.
 *
 *  So the capability stands for pictures, and what is checked is the thing that
 *  can be: a PDF is a whole document rather than an illustration inside a note,
 *  and the only thing that ever fetches one of those from here is a published
 *  page. The app opens the file in the space's own folder, the web build reads it
 *  out of its own store, and the clipper deals in pictures. So a PDF is served
 *  where a published page could link to it and nowhere else, and a paper in a
 *  private space is not something a hash gets anybody any more. */
export const publicBlobs = new Hono<{ Bindings: Env }>()

/** What an SVG served from here may do, which is nothing, and the same answer a
 *  site's own tab icon gets: see `SVG_POLICY` in blog/site.ts. The app strips
 *  scripts and handlers before it uploads a diagram; the policy is the half that
 *  does not depend on which version of the app drew it. */

/** Whether any published space says it keeps this file beside its notes, which is
 *  the one condition under which a page here writes its URL.
 *
 *  A scan of the published spaces, narrowed by the hash appearing anywhere in the
 *  column and then read properly: the column is a JSON list rather than a table,
 *  so there is nothing to index, and this runs for a PDF rather than for a
 *  picture - which is what keeps it off the path that carries the requests. */
/** What dresses a site rather than sitting inside a note: the stylesheet a theme
 *  was installed from, the author's own sheet, and the author's own script.
 *
 *  These are the two types a browser does something with rather than shows, and
 *  every published site is a host under the one shared domain - so a script served
 *  to every one of them is a script inside every one of their origins, which is
 *  what `script-src 'self'` on a page here would then be granting to whoever
 *  uploaded it. A picture cannot be checked that way and the header above says why;
 *  these can, because a page writes their address only for the site that declares
 *  them. */
const DRESSING = new Set(['text/css', 'text/javascript'])

/** Whether the site being asked is a site that dresses itself in this file: its
 *  theme's stylesheet, or a `publish.css` or `publish.js` it keeps beside its
 *  notes. Asked of the host the request names, so one account's script is not a
 *  file inside another account's origin - nor inside the app's. */
async function dressesThisSite(env: Env, host: string, hash: string): Promise<boolean> {
  const space = await spaceForHost(env, host)
  if (!space) return false

  const site = readSite(space.site)
  if (site.theme?.hash === hash) return true

  return readSpaceFiles(space.files).some((one) => one.hash === hash)
}

async function publishedAnywhere(env: Env, hash: string): Promise<boolean> {
  const { results } = await env.DB.prepare(
    `select files from spaces
      where blog_enabled = 1 and deleted = 0 and files like ?1 limit 50`,
  )
    .bind(`%${hash}%`)
    .all<{ files: string }>()

  return results.some((row) => readSpaceFiles(row.files).some((one) => one.hash === hash))
}

publicBlobs.get('/:name', async (context) => {
  // The name carries an extension so that saving the image keeps a sensible
  // filename; only the hash in front of it decides what is served.
  const hash = context.req.param('name').split('.')[0]?.toLowerCase() ?? ''
  if (!HASH.test(hash)) return context.notFound()

  const object = await context.env.NOTES.get(key(hash))
  if (!object) return context.notFound()

  const type = object.httpMetadata?.contentType ?? 'application/octet-stream'

  // A document, and nothing that reads one of those from here has a session to
  // show; see the header. Answered as missing rather than as refused, because to
  // anybody who has not been given the file that is what it is.
  //
  // And a file of a space's tree that is not a picture or a PDF, which was kept as
  // bytes and nothing more: it is reached through its space (`GET /v2/files`), never
  // by hash, and is not something a published page points at.
  if (type === BYTES) return context.notFound()
  if (DOCUMENTS.has(type) && !(await publishedAnywhere(context.env, hash))) {
    return context.notFound()
  }

  // And a sheet or a script only on the site whose pages ask for it; see
  // `dressesThisSite`.
  if (DRESSING.has(type)) {
    const host = new URL(context.req.url).host
    if (!(await dressesThisSite(context.env, host, hash))) return context.notFound()
  }

  return new Response(object.body, {
    headers: {
      'content-type': type,
      // Addressed by content, so it can never go stale.
      'cache-control': 'public, max-age=31536000, immutable',
      etag: `"${hash}"`,
      // The type is the one that was accepted on the way in; nothing here is to
      // be read as anything else, whatever the bytes look like.
      'x-content-type-options': 'nosniff',
      ...(type === 'image/svg+xml' ? { 'content-security-policy': SVG_POLICY } : {}),
    },
  })
})
