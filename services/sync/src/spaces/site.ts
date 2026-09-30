/** Writing what the site decides.
 *
 *  The column itself, and the decision every page is served through, are
 *  blog/site.ts; this is the one route that changes them. The owner's, not the
 *  space's: whether a folder of somebody's notes is on the internet is not a
 *  thing a collaborator settles, which is the same answer publishing itself
 *  gives; see spaces/publish.ts. */

import { Hono } from 'hono'
import { NOT_AN_OBJECT } from '../refused'
import { objectBody } from '../body'
import { now } from '../crypto'
import { fits } from './columns'
import type { Env, Space, Variables } from '../types'
import { isCanvasTarget } from '@nib/markdown/links'
import { fillFronts } from '../blog/fill'
import { readFront } from '../blog/front'
import { readSpaceFiles } from './files'
import { hashPassword, newSiteKey } from '../blog/gate'
import {
  folders,
  LONGEST_ICON,
  presentSite,
  publishes,
  readSite,
  type Site,
  type SiteRules,
  words,
  wrong,
} from '../blog/site'
import { atLeast, presentSpace, spaceOf } from './space'

export const site = new Hono<{ Bindings: Env; Variables: Variables }>()

/** How many names the answer below lists. Enough to read before pressing a
 *  button, and the count says how many there are in all. */
const SHOWN = 50
/** And how many notes it decides about. The same ceiling the site itself
 *  publishes under; see blog.ts. */
const MOST_LISTED = 2000

/** What a publish would change, before anything changes.
 *
 *  A nib site is live: the page is the note, so there is no upload to hold back
 *  and no "publish" that copies anything anywhere. What can change, then, is
 *  which notes are on the site - and that is exactly what somebody is about to
 *  decide when they are looking at the rules. So this answers the only honest
 *  version of "what will this do": which pages appear, which disappear, and how
 *  many there will be, worked out by the same function that serves them.
 *
 *  The rules in the body rather than the ones on the row, so the sheet can ask
 *  about what is on screen. Reads nothing out of storage: every note's own
 *  answer is on its row. */
site.post('/:id/site/preview', atLeast('owner'), async (context) => {
  const space = spaceOf(context)

  const body = await objectBody(context)
  if (!body) return context.json({ error: NOT_AN_OBJECT }, 400)

  const sent = body
  const problem = wrong(sent)
  if (problem) return context.json({ error: problem }, 400)

  // Read before it is answered, for the same reason the rules are: the whole
  // point of this route is to be right about what will be on the site.
  await fillFronts(context.env, space.id).catch(() => 0)

  const held = readSite(space.site)
  const given = (sent.rules ?? {}) as Record<string, unknown>
  const asked: SiteRules = {
    include: folders(given.include),
    exclude: folders(given.exclude),
    otherwise: given.otherwise === 'none' ? 'none' : 'all',
  }

  const { results } = await context.env.DB.prepare(
    `select path, front, size from notes where space_id = ? and deleted = 0 and kind != 'file'
      order by path limit ?`,
  )
    .bind(space.id, MOST_LISTED)
    .all<{ path: string; front: string | null; size: number }>()

  const adds: string[] = []
  const removes: string[] = []
  let after = 0
  let before = 0
  /** How many bytes of notes the site would serve, for the line in the sheet
   *  that says what a site costs; see docs/publishing.md. */
  let bytes = 0

  for (const row of results) {
    if (isCanvasTarget(row.path)) continue

    const front = readFront(row.front)
    // What the site shows now, which for a space that has never been published
    // is nothing at all: everything on it would be new.
    const was = space.blog_enabled ? publishes(held.rules, row.path, front) : false
    const is = publishes(asked, row.path, front)

    if (was) before += 1
    if (is) {
      after += 1
      bytes += row.size
    }
    if (is && !was) adds.push(row.path)
    if (was && !is) removes.push(row.path)
  }

  // And whether the space carries the two files an author dresses their own site
  // with, so the sheet can say they are in use rather than leaving somebody to
  // wonder whether the name was right. See blog/shell.ts.
  const beside = readSpaceFiles(space.files).map((one) => one.path.toLowerCase())

  return context.json({
    pages: after,
    bytes,
    dressing: { css: beside.includes('publish.css'), js: beside.includes('publish.js') },
    before,
    adds: adds.slice(0, SHOWN),
    removes: removes.slice(0, SHOWN),
    more: adds.length > SHOWN || removes.length > SHOWN,
  })
})

/** The site's own decisions, written whole.
 *
 *  The owner's, not the space's: whether a folder of somebody's notes is on the
 *  internet is not a thing a collaborator settles. The same answer publishing
 *  itself gives; see spaces/publish.ts.
 *
 *  Every field is optional and what is absent is left as it was, except a
 *  password, where `null` is the way to say "take it off" - which is a different
 *  statement from "leave it alone" and has to be sayable. */
site.put('/:id/site', atLeast('owner'), async (context) => {
  const space = spaceOf(context)

  const body = await objectBody(context)
  if (!body) return context.json({ error: NOT_AN_OBJECT }, 400)

  const sent = body
  const problem = wrong(sent)
  if (problem) return context.json({ error: problem }, 400)

  // The rules are about what the notes say, so any note nobody has read for it
  // is read before the rules take effect - waited for rather than left to the
  // night, because a note that says `publish: false` and has not been read is a
  // page on the internet that was meant to be private. As much as one request
  // can; a space bigger than that finishes in the nightly sweep. See
  // blog/fill.ts.
  await fillFronts(context.env, space.id).catch(() => 0)

  const held = readSite(space.site)
  const given = (sent.rules ?? {}) as Record<string, unknown>

  const kept: Site = {
    rules: {
      include: sent.rules === undefined ? held.rules.include : folders(given.include),
      exclude: sent.rules === undefined ? held.rules.exclude : folders(given.exclude),
      otherwise:
        sent.rules === undefined
          ? held.rules.otherwise
          : given.otherwise === 'none'
            ? 'none'
            : 'all',
    },
  }

  const description = sent.description === undefined ? held.description : words(sent.description)
  if (description) kept.description = description

  const image = sent.image === undefined ? held.image : words(sent.image, 500)
  if (image) kept.image = image

  const icon = sent.icon === undefined ? held.icon : words(sent.icon, LONGEST_ICON)
  if (icon?.startsWith('<svg')) kept.icon = icon

  // A theme by name, and a counter's script. Both take null to mean "none",
  // which is a different statement from saying nothing about them.
  if (sent.theme === undefined) {
    if (held.theme) kept.theme = held.theme
  } else if (sent.theme && typeof sent.theme === 'object') {
    const said = sent.theme as Record<string, unknown>
    const name = words(said.name)
    const hash = words(said.hash, 64)
    if (name && hash) kept.theme = { name, hash }
  }

  if (sent.analytics === undefined) {
    if (held.analytics) kept.analytics = held.analytics
  } else if (sent.analytics && typeof sent.analytics === 'object') {
    const said = sent.analytics as Record<string, unknown>
    const url = words(said.url, 400)
    const domain = words(said.domain)
    if (url) kept.analytics = { url, ...(domain ? { domain } : {}) }
  }

  // A password arriving is a new password, whatever there was: a fresh salt and a
  // fresh signing key, so every reader let in by the old one is asked again.
  if (sent.password === undefined) {
    if (held.password) kept.password = held.password
  } else if (typeof sent.password === 'string' && sent.password) {
    kept.password = { ...(await hashPassword(sent.password)), key: newSiteKey(), at: now() }
  }

  const written = JSON.stringify(kept)
  if (!fits(written, 'site')) {
    return context.json({ error: 'that is more than a site keeps' }, 413)
  }

  const at = now()
  await context.env.DB.prepare('update spaces set site = ?, updated_at = ? where id = ?')
    .bind(written, at, space.id)
    .run()

  const updated: Space = { ...space, site: written, updated_at: at }
  return context.json({ space: presentSpace(updated, context.env), site: presentSite(kept) })
})
