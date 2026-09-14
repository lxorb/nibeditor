/** Spaces: the rail the app shows, in the order the person put them in.
 *
 *  A space is the unit of everything else - notes belong to one, publishing is
 *  a property of one - so this file is only the space itself: asking for one,
 *  naming it, ordering the rail, taking one away. Making one is in space.ts,
 *  because a new account is given one without asking. What a published space
 *  answers on is in publish.ts, under the same paths. */

import { Hono } from 'hono'
import { readBody } from '../body'
import { chunks } from '../bound'
import { now } from '../crypto'
import { releaseDomain } from '../hostnames'
import type { Env, Space, Variables, Whoever } from '../types'
import { spaceArranged } from './arranged'
import { bookmarks } from './bookmarks'
import { spaceExcluded } from './excluded'
import { spaceFiles } from './files'
import { spaceGraph } from './graph'
import { folderIcons, isIcon, isTint } from './icons'
import { answers } from './answers'
import { site } from './site'
import { publish } from './publish'
import { share } from './share'
import {
  addSpace,
  atLeast,
  itemsSharedIn,
  notesAmong,
  presentSpace,
  sharedAmong,
  spaceOf,
  type Role,
  withoutSetup,
} from './space'

/** How long a space's name may be. Longer than a person's, which is 60: a space is
 *  named after what is in it, and a folder on disk holds more than a person does. */
const SPACE_NAME_LIMIT = 80

/** A space's name as it is stored. Control characters go: nothing can show them,
 *  and the name travels into a mail's subject, a published page and a folder on
 *  somebody's disk, where a newline in one is not part of a name.
 *
 *  Inner whitespace stays, which is the one thing this does not share with a
 *  person's name - see `personName` in crypto.ts. `My  Notes` is the name of a
 *  folder on somebody's disk, and a service that quietly made it `My Notes` would
 *  be naming a space the app then could not find. */
function spaceName(given: string): string {
  return given.replace(/\p{Cc}/gu, '').trim()
}
/** An id is a UUID; the length is all this needs to know. */
const ID_LIMIT = 64
/** More spaces than anyone has, and a bound on the one statement below that
 *  grows with what was sent. */
const MOST_IN_ORDER = 500

export const spaces = new Hono<{ Bindings: Env; Variables: Variables }>()

/** Every space this account can reach: its own, and the ones it was shared
 *  with. Its own come first and keep the order the rail was put in; a shared
 *  space sits after them, because `position` belongs to the space and moving
 *  it would move somebody else's rail. */
const REACHABLE = `select sp.*,
    case when sp.user_id = ?1 then 'owner' else m.role end as role
  from spaces sp
  left join space_members m on m.space_id = sp.id and m.email = ?2 and m.item = ''
 where sp.deleted = ?3 and (sp.user_id = ?1 or m.role is not null)
 order by case when sp.user_id = ?1 then 0 else 1 end, sp.position, sp.created_at
 limit ?4`

/** And the same listing for a guest, which is only the spaces its links let it
 *  into: a guest owns nothing, so there is no rail of its own for them to sit
 *  after and no order but the one their owners put them in. */
const GUEST_REACHABLE = `select sp.*, g.role as role
  from spaces sp
  join guest_members g on g.space_id = sp.id and g.guest_id = ?1 and g.item = ''
 where sp.deleted = ?2 and g.joined_at is not null
 order by sp.position, sp.created_at
 limit ?3`

/** Every space somebody can reach, alive or deleted. The deleted ones are what
 *  a machine that has been away needs in order to tell a space that went from
 *  one it has simply not uploaded yet. */
function reachable(env: Env, who: Whoever, deleted: 0 | 1) {
  if (who.kind === 'guest') {
    return env.DB.prepare(GUEST_REACHABLE)
      .bind(who.guest.id, deleted, MOST_IN_ORDER)
      .all<Space & { role: Role }>()
  }

  return env.DB.prepare(REACHABLE)
    .bind(who.user.id, who.user.email, deleted, MOST_IN_ORDER)
    .all<Space & { role: Role }>()
}

spaces.get('/', async (context) => {
  const who = context.get('who')
  const mine = who.kind === 'user' ? who.user.id : null
  const { results } = await reachable(context.env, who, 0)

  // Which of them anybody else is in, so the rail can mark them. One query for
  // the listing rather than one per space.
  const own = results.filter((one) => one.user_id === mine).map((one) => one.id)
  const shared = await sharedAmong(context.env, own)

  // And which files of them are shared on their own, which is the same mark on a
  // row of the tree. Also one query, and only about the account's own spaces:
  // who else was given a note of somebody else's space is that owner's to see.
  const items = await itemsSharedIn(context.env, own)

  // A space somebody shared leaves the same marker for everybody who was in it.
  const gone = await reachable(context.env, who, 1)

  // How much each of them holds. Read here because a machine that has just
  // signed in reads this listing before it pulls anything, so the listing is
  // where it can learn how much is coming.
  const held = await notesAmong(
    context.env,
    results.map((one) => one.id),
  )

  // A program acting for the account is the account everywhere else, and here it
  // is not: setting a domain up is done by somebody at a registrar. See
  // `withoutSetup`.
  const asking = context.get('who').program === true

  return context.json({
    spaces: results.map((one) => {
      const view = presentSpace(
        one,
        context.env,
        one.role,
        shared.has(one.id),
        held.get(one.id) ?? 0,
        items.get(one.id) ?? [],
      )

      return asking ? withoutSetup(view) : view
    }),
    deleted: gone.results.map((one) => one.id),
  })
})

spaces.post('/', async (context) => {
  const user = context.get('user')
  const body = await readBody(context)
  const name = body.text('name', SPACE_NAME_LIMIT)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const label = spaceName(name ?? '')
  if (!label) return context.json({ error: 'give the space a name' }, 400)

  const space = await addSpace(context.env, user.id, label)

  return context.json({ space: presentSpace(space, context.env) }, 201)
})

/** The whole rail order in one go: ids in the order they should appear.
 *  Anything the account holds but the list leaves out keeps its place at the
 *  end, so a machine that has not seen a space yet cannot lose it. */
spaces.put('/order', async (context) => {
  const user = context.get('user')
  const body = await readBody(context)
  const order = body.texts('order', MOST_IN_ORDER, ID_LIMIT)
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (!order) return context.json({ error: 'send an order' }, 400)

  const { results } = await context.env.DB.prepare(
    'select id from spaces where user_id = ? and deleted = 0 limit ?',
  )
    .bind(user.id, MOST_IN_ORDER)
    .all<{ id: string }>()

  const owned = new Set(results.map((row) => row.id))
  const listed = order.filter((id) => owned.has(id))
  const rest = results.map((row) => row.id).filter((id) => !listed.includes(id))

  // One batch, which D1 runs in a single transaction, so a half-applied order is
  // not a state the rail can end up in. A statement apiece rather than one for
  // the lot, because D1 binds a hundred parameters and a rail may hold five
  // hundred spaces; see src/bound.ts. The positions are array indexes, never
  // anything sent in.
  const ids = [...listed, ...rest]
  const statements = chunks(ids.map((id, index) => ({ id, index }))).map((chunk) => {
    const cases = chunk.map((one) => `when ? then ${one.index}`).join(' ')
    return context.env.DB.prepare(
      `update spaces set position = case id ${cases} else position end where user_id = ?`,
    ).bind(...chunk.map((one) => one.id), user.id)
  })

  if (statements.length) await context.env.DB.batch(statements)

  return context.json({ ok: true })
})

// The space itself - its name, its icon and the colour of it, its address, whether
// it exists - is the owner's. What is inside it is what a writer writes.
spaces.patch('/:id', atLeast('owner'), async (context) => {
  const space = spaceOf(context)

  const body = await readBody(context)
  const name = body.text('name', SPACE_NAME_LIMIT)
  const chosen = body.nullableText('icon', ID_LIMIT)
  const painted = body.nullableText('tint', ID_LIMIT)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const label = name === undefined ? space.name : spaceName(name)
  if (!label) return context.json({ error: 'give the space a name' }, 400)

  // An icon is a value out of one of the sets the app ships, read the same way a
  // folder's is: a name, `set:name`, or an emoji written in a name's place. One
  // that is none of those leaves the icon as it was rather than being written - a
  // newer app may know sets this version does not, but nothing that is not an icon
  // has any business in the column. See isIcon in spaces/icons.ts.
  const icon =
    chosen === undefined
      ? space.icon
      : chosen === null
        ? null
        : isIcon(chosen)
          ? chosen
          : space.icon

  // And the colour that icon is drawn in, beside it. One of the app's own accents
  // by its id, read the way a folder's colour is; anything else leaves the colour
  // as it was. An icon taken away takes its colour with it: a colour with nothing
  // to colour is not a colour, which is what the app says too.
  const tint =
    icon === null
      ? null
      : painted === undefined
        ? space.tint
        : painted === null
          ? null
          : isTint(painted)
            ? painted
            : space.tint

  await context.env.DB.prepare(
    'update spaces set name = ?, icon = ?, tint = ?, updated_at = ? where id = ?',
  )
    .bind(label, icon, tint, now(), space.id)
    .run()

  return context.json({ space: presentSpace({ ...space, name: label, icon, tint }, context.env) })
})

spaces.delete('/:id', atLeast('owner'), async (context) => {
  const space = spaceOf(context)

  // The notes stay with it, so the space can be put back whole from Recently
  // deleted; the purge in trash.ts empties it after 14 days. Its published
  // address is released now, or nobody could claim that name meanwhile.
  const at = now()
  await context.env.DB.prepare(
    `update spaces
        set deleted = 1, deleted_at = ?, blog_enabled = 0, blog_subdomain = null, blog_domain = null,
            blog_domain_token = null, blog_domain_verified_at = null,
            blog_note = null, updated_at = ?
      where id = ?`,
  )
    .bind(at, at, space.id)
    .run()

  if (space.blog_domain) await releaseDomain(context.env, space.blog_domain)

  return context.json({ ok: true })
})

// A space's published side, its bookmarks, the icons its folders wear, the order its
// folders were arranged into, how its graph is drawn, what it leaves out, the files
// beside its notes and who else may reach it answer under these same paths.
// Mounted last, so `/order` above is still read as a word and not as an id. Which is
// also why the arranged order answers on `/arranged`: `/order` is a word this file has
// already spent on the rail of spaces itself.
spaces.route('/', publish)
spaces.route('/', site)
spaces.route('/', answers)
spaces.route('/', bookmarks)
spaces.route('/', folderIcons)
spaces.route('/', spaceArranged)
spaces.route('/', spaceGraph)
spaces.route('/', spaceExcluded)
spaces.route('/', spaceFiles)
spaces.route('/', share)
