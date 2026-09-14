/** One space, as the rest of the service asks for it: making one, what this
 *  account may do in it, and the shape the app reads back.
 *
 *  A space is reached by its owner or by somebody the owner shared it with, and
 *  every route that takes a space id says which of the three roles it needs. An
 *  id nobody may reach is indistinguishable from one that does not exist: the
 *  answer is 404 either way, and nothing about the space leaks. An id they may
 *  reach but not at that role is 403, which is a different thing to say - the
 *  space is theirs to see, this button is not theirs to press. */

import type { Context, MiddlewareHandler } from 'hono'
import { askInChunks, AT_A_TIME, places } from '../bound'
import { newId, now } from '../crypto'
import { dnsRecords } from './addresses'
import { readArchivedFolders } from './archived-folders'
import type { Env, Space, Variables, Whoever } from '../types'
import { readBookmarks } from './bookmarks'
import { readExcluded } from './excluded'
import { readGraph } from './graph'
import { readIcons, readTints } from './icons'
import { presentSite, readSite } from '../blog/site'

/** The same view with the setting up of the site taken out of it.
 *
 *  For an asker who is the account and is still not somebody at a registrar: a
 *  program acting for it through an `nib_` token, whose whole stated reach is the
 *  notes. The TXT record in `dns` is the proof that a domain is this account's,
 *  and a token in somebody's CI has no business holding it. See index.ts, where a
 *  program is told apart, and programs.ts for what one may reach. */
export function withoutSetup<T extends ReturnType<typeof presentSpace>>(view: T): T {
  return { ...view, blog: { ...view.blog, dns: [], site: EMPTY_SITE } }
}

/** What a space's site looks like to somebody who is not its owner: nothing.
 *  The shape is kept so that nothing downstream has to ask whether the field is
 *  there. */
const EMPTY_SITE = {
  rules: { include: [], exclude: [], otherwise: 'all' as const },
  password: false,
}

/** What somebody may do in a space. Ordered: an owner may do what a writer may,
 *  and a writer what a reader may. */
export type Role = 'owner' | 'write' | 'read'

const RANK: Record<Role, number> = { read: 0, write: 1, owner: 2 }

/** A role a person can be given. The third, `owner`, is not one of these: it is
 *  the space's own column, and one owner is what owning means. */
export type Given = 'write' | 'read'

export function isGiven(value: unknown): value is Given {
  return value === 'write' || value === 'read'
}

function isRole(value: unknown): value is Role {
  return value === 'owner' || isGiven(value)
}

export function allows(held: Role, needed: Role): boolean {
  return RANK[held] >= RANK[needed]
}

/** Makes a space for an account and hands it back.
 *
 *  The one place a space comes into being, so where it lands is decided once: at
 *  the end of that account's own rail, holding nothing, published nowhere. The
 *  route below `POST /v1/spaces` calls it for a space somebody asked for, and
 *  `first.ts` for the one every new account starts with. The name arrives
 *  cleaned; the icon is a name from the set the app ships, or nothing. */
export async function addSpace(
  env: Env,
  userId: string,
  name: string,
  icon: string | null = null,
): Promise<Space> {
  const last = await env.DB.prepare(
    'select max(position) as last from spaces where user_id = ? and deleted = 0',
  )
    .bind(userId)
    .first<{ last: number | null }>()

  const space: Space = {
    id: newId(),
    user_id: userId,
    name,
    position: (last?.last ?? -1) + 1,
    icon,
    // A space is made with an icon at most, never with a colour: the one place a
    // space is given an icon without being asked is the first space of an account,
    // and that one wears it in the plain foreground.
    tint: null,
    deleted: 0,
    deleted_at: null,
    created_at: now(),
    updated_at: now(),
    blog_enabled: 0,
    blog_subdomain: null,
    blog_domain: null,
    blog_domain_token: null,
    blog_domain_verified_at: null,
    blog_note: null,
    blog_title: null,
    bookmarks: '[]',
    files: '[]',
    icons: '{}',
    tints: '{}',
    graph: '{}',
    excluded: '[]',
    archived_folders: '{}',
    site: '{}',
  }

  await env.DB.prepare(
    `insert into spaces (id, user_id, name, position, icon, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      space.id,
      space.user_id,
      space.name,
      space.position,
      space.icon,
      space.created_at,
      space.updated_at,
    )
    .run()

  return space
}

/** A space together with what the account asking may do in it. */
export interface Reached extends Space {
  role: Role
}

/** The one question everything here asks: is this space this person's to reach,
 *  and as what.
 *
 *  One query, because it runs in front of every request that names a space. The
 *  owner is the space's own column; everybody else is a row keyed by their
 *  address, which is why the address rather than the account id is bound: a
 *  membership written before the person had an account is already theirs on the
 *  day they prove it. */
const REACHED = `select sp.*,
    case when sp.user_id = ?2 then 'owner' else m.role end as role
  from spaces sp
  left join space_members m on m.space_id = sp.id and m.email = ?3 and m.item = ''
 where sp.id = ?1 and sp.deleted = 0`

/** And the same question from a guest, whose row is keyed by the guest rather
 *  than by an address, and who owns nothing. `joined_at` is what says they are
 *  in: a link that asks first writes the row before the owner has answered. */
const GUEST_REACHED = `select sp.*, g.role as role
  from spaces sp
  join guest_members g on g.space_id = sp.id and g.guest_id = ?2 and g.item = ''
 where sp.id = ?1 and sp.deleted = 0 and g.joined_at is not null`

/** Somebody who was given one file of a space and not the space: the space the
 *  file sits in, and what they may do to that one file.
 *
 *  A membership about an item is deliberately invisible to the question above,
 *  which is what every route that names a space asks. Being handed one note is
 *  not being let into the drawer it came out of: the listing, the change feed,
 *  the bookmarks and the sharing of a space all answer 404 to somebody holding
 *  one of its notes, and this is the one question they answer yes to. */
const ITEM_REACHED = `select sp.*, m.role as role
  from spaces sp
  join space_members m on m.space_id = sp.id and m.email = ?2 and m.item = ?3
 where sp.id = ?1 and sp.deleted = 0`

const GUEST_ITEM_REACHED = `select sp.*, g.role as role
  from spaces sp
  join guest_members g on g.space_id = sp.id and g.guest_id = ?2 and g.item = ?3
 where sp.id = ?1 and sp.deleted = 0 and g.joined_at is not null`

export async function reachedSpace(
  env: Env,
  who: Whoever,
  spaceId: string,
): Promise<Reached | null> {
  const row =
    who.kind === 'user'
      ? await env.DB.prepare(REACHED)
          .bind(spaceId, who.user.id, who.user.email)
          .first<Space & { role: string | null }>()
      : await env.DB.prepare(GUEST_REACHED)
          .bind(spaceId, who.guest.id)
          .first<Space & { role: string | null }>()

  if (!row || !isRole(row.role)) return null
  return { ...row, role: row.role }
}

/** And the same for one file: the space it sits in, at the role this person was
 *  given over that file alone. Null for anybody who was not given it.
 *
 *  Asked only after `reachedSpace` has said no, so somebody who can reach the
 *  whole space costs one query and never takes this path: what they hold is the
 *  space, and an item share on top of it says nothing new. */
export async function reachedItem(
  env: Env,
  who: Whoever,
  note: { id: string; space_id: string },
): Promise<Reached | null> {
  const row =
    who.kind === 'user'
      ? await env.DB.prepare(ITEM_REACHED)
          .bind(note.space_id, who.user.email, note.id)
          .first<Space & { role: string | null }>()
      : await env.DB.prepare(GUEST_ITEM_REACHED)
          .bind(note.space_id, who.guest.id, note.id)
          .first<Space & { role: string | null }>()

  if (!row || !isRole(row.role)) return null
  return { ...row, role: row.role }
}

/** Middleware: the space named in the path, at the role the route behind it
 *  needs, put on the request. Written once so that no route can forget it and
 *  so that the two answers - not there, not yours to do - are always the same
 *  two answers. */
export function atLeast(
  needed: Role,
  param = 'id',
): MiddlewareHandler<{
  Bindings: Env
  Variables: Variables
}> {
  return async (context, next) => {
    const asked = context.req.param(param) ?? ''
    const space = await reachedSpace(context.env, context.get('who'), asked)
    if (!space) return context.json({ error: 'no such space' }, 404)
    if (!allows(space.role, needed)) return context.json({ error: refusal(needed) }, 403)

    context.set('space', space)
    await next()
  }
}

/** Why a role was not enough, in the app's own voice. */
export function refusal(needed: Role): string {
  return needed === 'owner' ? 'only the owner can do that' : 'you can only read this space'
}

/** The space a route behind `atLeast` is working in. */
export function spaceOf(context: Context<{ Bindings: Env; Variables: Variables }>): Reached {
  return context.get('space')
}

/** Which spaces hold anybody besides their owner, so the rail can mark them.
 *  One query for the whole listing rather than one per space, and a guest counts
 *  as somebody: the mark says the space is not only yours, and how the other
 *  person got in is not what it is about. */
export async function sharedAmong(env: Env, spaceIds: readonly string[]): Promise<Set<string>> {
  if (!spaceIds.length) return new Set<string>()

  // A chunk at a time, and this one names the list twice, so a rail past about
  // fifty spaces was a statement D1 would not take; see src/bound.ts.
  const found = await askInChunks(
    spaceIds,
    async (chunk) => {
      const list = places(chunk.length)
      const { results } = await env.DB.prepare(
        `select space_id from space_members where space_id in (${list}) and item = ''
       union select space_id from guest_members
        where space_id in (${list}) and item = '' and joined_at is not null`,
      )
        .bind(...chunk, ...chunk)
        .all<{ space_id: string }>()

      return results
    },
    AT_A_TIME / 2,
  )

  return new Set(found.map((row) => row.space_id))
}

/** How many files of one space may be shared on their own. The sheet lists two
 *  hundred people, and this is the same number for the same reason: a space
 *  whose listing cannot name every share it has is a space whose owner cannot
 *  find the one they want to end. */
export const MOST_ITEMS = 200

/** Which files of these spaces are shared on their own, so the tree can mark
 *  the rows. One query for the whole listing rather than one per space, the way
 *  `sharedAmong` is, and for the same reason: the app reads the listing on every
 *  reconcile pass.
 *
 *  Only what somebody actually holds counts. A request nobody answered is not
 *  somebody in the file, and a mark that appeared while the owner was still
 *  deciding would say the wrong thing. */
export async function itemsSharedIn(
  env: Env,
  spaceIds: readonly string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (!spaceIds.length) return out

  // Names the list twice, so half the usual chunk; see sharedAmong above.
  const found = await askInChunks(
    spaceIds,
    async (chunk) => {
      const list = places(chunk.length)
      const { results } = await env.DB.prepare(
        `select space_id, item from space_members
          where space_id in (${list}) and item <> ''
         union select space_id, item from guest_members
          where space_id in (${list}) and item <> '' and joined_at is not null`,
      )
        .bind(...chunk, ...chunk)
        .all<{ space_id: string; item: string }>()

      return results
    },
    AT_A_TIME / 2,
  )

  for (const row of found) {
    const held = out.get(row.space_id) ?? []
    if (held.length < MOST_ITEMS && !held.includes(row.item)) held.push(row.item)
    out.set(row.space_id, held)
  }

  return out
}

/** How many notes each of these spaces holds. One query for the whole listing,
 *  the way `sharedAmong` is one query rather than one per space.
 *
 *  It is what lets a machine that has just signed in say how much of the account
 *  is still on its way: the number is known before the first note has arrived,
 *  where counting the pages of a pull only ever knows what has come already. */
export async function notesAmong(
  env: Env,
  spaceIds: readonly string[],
): Promise<Map<string, number>> {
  if (!spaceIds.length) return new Map<string, number>()

  const found = await askInChunks(spaceIds, async (chunk) => {
    const { results } = await env.DB.prepare(
      `select space_id, count(*) as notes from notes
        where space_id in (${places(chunk.length)}) and deleted = 0
        group by space_id`,
    )
      .bind(...chunk)
      .all<{ space_id: string; notes: number }>()

    return results
  })

  return new Map(found.map((row) => [row.space_id, row.notes]))
}

export function presentSpace(
  space: Space,
  env: Env,
  role: Role = 'owner',
  shared = false,
  notes = 0,
  sharedItems: readonly string[] = [],
) {
  return {
    id: space.id,
    name: space.name,
    position: space.position,
    icon: space.icon,
    /** And the colour it is drawn in, where one was chosen. Beside the icon rather
     *  than folded into it, the way a note keeps `icon-color:` beside `icon:`. */
    tint: space.tint,
    /** How many notes it holds, so a machine bringing the account down can say
     *  how far through it is rather than only that it is working. */
    notes,
    // What this account may do here, so the app knows which affordances to
    // show before it has asked for anything else.
    role,
    // Whether anybody else is in it, which is the mark the rail draws. About the
    // space itself: a file of it shared on its own is a mark on that row, not on
    // the whole drawer; see `sharedItems`.
    shared: shared || role !== 'owner',
    /** Which of its files are shared on their own, by note id, so the tree can
     *  mark those rows. Empty for a space somebody else owns: what they hold is
     *  the space, and who else was given one of its notes is the owner's to see. */
    sharedItems: [...sharedItems],
    // Carried on the listing rather than fetched per space: the app reads the
    // list on every reconcile pass, and one request for every space's
    // bookmarks would be one request per space.
    bookmarks: readBookmarks(space.bookmarks),
    // And for the same reason: the app draws the file tree on every reconcile
    // pass, and asking each space which of its folders wear an icon would be one
    // request per space.
    icons: readIcons(space.icons),
    // And the colour each of those icons is drawn in, under the same keys. The same
    // request writes both, so the same listing carries both.
    tints: readTints(space.tints),
    // And for the same reason again: the graph of a space is drawn from what the
    // listing already brings down.
    graph: readGraph(space.graph),
    // And again: the search, the picture and the mentions all read this, and all
    // three are drawn from what the listing already brought down.
    excluded: readExcluded(space.excluded),
    // And which of its folders have been put away, beside the icons those folders
    // wear, for the reason the icons are here: the tree is drawn on every reconcile
    // pass, and a folder that is away is a row that is not drawn at all.
    archivedFolders: readArchivedFolders(space.archived_folders),
    createdAt: space.created_at,
    updatedAt: space.updated_at,
    blog: {
      enabled: !!space.blog_enabled,
      subdomain: space.blog_subdomain,
      domain: space.blog_domain,
      title: space.blog_title,
      note: space.blog_note,
      // Carried on the listing as well, so the pane can show what to add at
      // the registrar after a reload and not only right after publishing.
      //
      // The owner alone, and that is not tidiness: one of these records is the
      // TXT token that proves the domain is this account's, and it went out to
      // everybody who could list the space - somebody the space is shared with,
      // and a program token whose whole stated reach is notes. Whoever is setting
      // a domain up is the owner; nobody else has anything to add at a registrar.
      dns: role === 'owner' ? dnsRecords(env, space) : [],
      // What the site itself decides: which folders it publishes, what it falls
      // back on, whether it has a password. On the listing for the same reason
      // the bookmarks are - the sheet opens on what the account already holds
      // rather than on a request of its own - and the owner's for the same reason
      // the records are: it is the pane's own state, and only they have the pane.
      // See spaces/site.ts.
      site: role === 'owner' ? presentSite(readSite(space.site)) : EMPTY_SITE,
    },
  }
}
