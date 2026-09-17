/** Who else is in a space, from this side of the wire.
 *
 *  Two things live here. The first is what everything in the app asks before it
 *  offers to change anything: what may this account do in the folder in front of
 *  it. A space nobody shared, and a space on a machine that is signed out, are
 *  both the reader's own, so the answer is `owner` until the account says
 *  otherwise; nothing in the app has to know that sharing exists in order to
 *  behave when it does.
 *
 *  The second is the Share sheet: the people, the link, and the requests waiting
 *  on the owner. Every change answers with the whole of who may reach the space,
 *  so what is drawn is what came back rather than a guess about what the change
 *  did - which is also what keeps two machines editing the same list honest. */

import { isCanvasTarget } from '@nib/markdown/links'
import {
  api,
  ApiError,
  type GivenRole,
  type RemoteSpace,
  type SharedItem,
  type Sharing,
  type SpaceRole,
} from './api'
import { account } from './account.svelte'
import { message } from './i18n.svelte'
import { rooms } from './rooms.svelte'
import { within } from './sync/mirror'
import { sync } from './sync.svelte'
import { type Origin, originOf, trustsHtml } from './trust'
import type { NoteDoc } from './workspace/documents.svelte'
import { type Space, workspace } from './workspace.svelte'

/** The account's copy of a local folder, once one has been paired with it. */
function remoteOf(root: string): RemoteSpace | null {
  const id = sync.remoteIdFor(root)
  if (!id) return null

  return account.spaces.find((one) => one.id === id) ?? null
}

/** What this account may do in the space that folder mirrors. */
export function roleOf(root: string): SpaceRole {
  return remoteOf(root)?.role ?? 'owner'
}

/** Whether the space has anybody in it besides its owner, which is the mark on
 *  its row in the switcher and on the header over the file list. */
export function isShared(root: string): boolean {
  return remoteOf(root)?.shared ?? false
}

/** Whether this one file is shared on its own, which is the same mark on its row
 *  in the tree.
 *
 *  The two marks are about two different things and neither implies the other: a
 *  space everybody is in says so on the space, and one note handed to one person
 *  says so on the note. What the listing brings down is the ids of the shared
 *  files, so this is the id this machine holds for the path; see
 *  sync.tracked. */
export function isSharedItem(path: string): boolean {
  const id = sync.tracked(path)?.id
  if (!id) return false

  return account.spaces.some((one) => one.sharedItems?.includes(id))
}

/** Whether this file can be shared from here: the space behind it is the
 *  account's own, and the account has a copy of the file for a share to be
 *  about. A note this machine has written and not yet handed over has no id, and
 *  an id is what a share names. */
export function canShareItem(path: string | null | undefined): boolean {
  if (!path) return false

  const space = workspace.spaces.find((one) => within(one.root, path) !== null)
  if (!space || !ownsRemotely(space)) return false

  return !!sync.tracked(path)?.id
}

/** Whether somebody else is in this note right now, which is the same mark on
 *  the note's row in the file list.
 *
 *  Asked of the rooms rather than of the account, because this is a fact about
 *  the minute rather than about who was invited: a note in a shared space that
 *  nobody else has open is not a note being worked in with somebody. Which is
 *  also why the mark is not on every row of a shared space - one mark repeated
 *  down a whole list says nothing about any row in it.
 *
 *  Only a note that is open, since a room is only joined for an open file. That
 *  is the honest limit rather than a shortcut: nothing on this machine knows who
 *  is in a file it has not opened. */
export function othersIn(path: string): boolean {
  for (const tab of workspace.tabs) {
    if (tab.path === path && (rooms.present[tab.note.key] ?? 0) > 0) return true
  }

  return false
}

/** Whether this space can be written in. Everything that offers to change a
 *  note asks this, so a reader is never shown a button that would be refused. */
function canWrite(root: string): boolean {
  return roleOf(root) !== 'read'
}

/** What may be done where a note sits. A path in no space this machine knows
 *  about is this machine's own, so it can be written in. */
export function canWriteAt(path: string): boolean {
  const space = workspace.spaces.find((one) => within(one.root, path) !== null)
  return !space || canWrite(space.root)
}

/** Whether the document in front of the reader may be written in.
 *
 *  A path answers it for almost everything, which is `canWriteAt` above: what may
 *  be done is decided by where the file sits. A file somebody shared on its own
 *  has no path - it is one note out of their space and there is no copy of it
 *  here - so its own share is what says it, and one shared to be read is
 *  read-only exactly as a space shared to be read is.
 *
 *  Asked of the document rather than of the path, because the document is what
 *  every pane, every bar and every surface already has to hand. */
export function canWriteIn(
  note: { path: string | null; shared: string | null } | null | undefined,
): boolean {
  if (!note) return true
  if (note.shared !== null) return sharedWithYou.mayWrite(note.shared)

  return note.path === null || canWriteAt(note.path)
}

/** Whether the space a note sits in is one somebody else can reach: shared with
 *  anybody, or somebody else's to begin with. A note in no space at all is this
 *  machine's own. */
function sharedAt(path: string | null): boolean {
  if (path === null) return false

  const space = workspace.spaces.find((one) => within(one.root, path) !== null)
  if (!space) return false

  return isShared(space.root) || roleOf(space.root) !== 'owner'
}

/** Where a document's words came from, as much as this side of the wire knows:
 *  who may reach the space it sits in, whether anybody else is in the file right
 *  now, and whether markup has been pasted into it. What the answer means is
 *  trust.ts, which is the one place that decides it. */
export function originOfDocument(note: NoteDoc): Origin {
  return originOf({
    guest: account.guest !== null,
    pasted: note.pasted,
    shared: sharedAt(note.path),
    peers: (rooms.present[note.key] ?? 0) > 0,
  })
}

/** Whether this document's raw HTML is markup rather than characters. What the
 *  reading view and a canvas card both ask before they render one. */
export function trustsHtmlIn(note: NoteDoc): boolean {
  return trustsHtml(originOfDocument(note))
}

/** The same question for a note that is not the document in the pane: the note
 *  inside an `![[embed]]`, and the note behind a hover preview. Both show another
 *  file, which has no `NoteDoc` to ask.
 *
 *  Two of the four facts are about the account and the space and are known from
 *  the path. The other two are about a document this session has open, and
 *  neither can change the answer: a space somebody else can reach is untrusted
 *  whether or not they are in the file at this moment - `room` and `space` are the
 *  same answer - and a paste lands in the document being typed in. So the one
 *  reading this cannot make is a note being typed in, in a space nobody else is
 *  in, previewed through a link to itself after markup was pasted into it; it is
 *  read as words there, which is the safe side of the question. */
export function trustsHtmlAt(path: string | null): boolean {
  return trustsHtml(
    originOf({
      guest: account.guest !== null,
      pasted: false,
      shared: sharedAt(path),
      peers: false,
    }),
  )
}

/** Anybody in a space who is not its owner, as the sheet names them: an address
 *  they were invited at, or the guest a link handed out. Exactly one of the two. */
interface Someone {
  email: string | null
  guest: string | null
}

/** What one call from the sheet is about, read once where the press happens.
 *
 *  Every route the sheet reaches takes these three and nothing else: whose account
 *  is asking, which space, and which file of it - empty for the space itself. Handed
 *  to the call rather than reached for from inside it, so that no control anywhere
 *  below can read a field that has moved on since the press. */
interface Asking {
  token: string
  id: string
  item: string
}

/** The addresses in what was typed into the field.
 *
 *  Commas, semicolons and spaces all separate, because a list copied out of a
 *  mail client arrives written in any of the three, and inviting four people
 *  should not be four separate presses. */
export function addressesIn(typed: string): string[] {
  return typed
    .split(/[,;\s]+/)
    .map((one) => one.trim())
    .filter(Boolean)
}

/** Whether something typed could be an address at all. The server decides for
 *  real - it is the one that knows what it will accept - but a round trip to be
 *  told about a missing at sign is a round trip nobody should wait for. */
export function looksLikeAddress(one: string): boolean {
  return /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(one)
}

class Share {
  open = $state(false)
  /** The folder the sheet is about, and the space on the account behind it. */
  space = $state<Space | null>(null)
  spaceId = $state<string | null>(null)

  /** The one file the sheet is about, when it is about one file rather than the
   *  whole space: its id on the account, and the path its row and its mark come
   *  off. Null for a space.
   *
   *  Held here rather than read off the answer so that the head of the sheet says
   *  what it is about from the first frame, before the account has said who is in
   *  it - the same reason the address field is drawn before the list is. */
  item = $state<{ id: string; path: string } | null>(null)

  /** Who may reach it, as the account last said. Null while it is being read,
   *  which is when the sheet draws the shape of the rows instead. */
  who = $state<Sharing | null>(null)

  /** What is being asked of the server, named by the row or the control it is
   *  about; null while nothing is.
   *
   *  Named rather than counted, so every button can be told apart from the one
   *  that was pressed: the row being changed says so, the rest go quiet, and a
   *  second press cannot ask for the same change twice while the first is still
   *  in the air. */
  working = $state<string | null>(null)

  /** Which sheet the answers coming back are about.
   *
   *  Bumped every time the sheet is pointed at something - a space, a file, or the
   *  same file a second time - and every request carries the number it went out
   *  under. Nothing an older number brings back is ever drawn.
   *
   *  A number and not the file's id, because the id cannot tell one question from
   *  the next: a sheet closed on a note and opened on it again is a second question,
   *  and the first answer is a list from before whatever was changed in between. And
   *  a number and not a flag, because what is being guarded against is the sheet
   *  having moved on, which happens as often as somebody presses Share.
   *
   *  This is the one thing standing between a reader and another file's people. The
   *  sheet is opened from a row, a tab, the palette and a web tab, each of them one
   *  press, so opening it on one note and on another inside a single round trip is
   *  an ordinary minute - and what was drawn was the first note's list under the
   *  second note's name, with Remove sending somebody who was never in the second
   *  file against the second file's id. */
  private sheet = 0

  error = $state<string | null>(null)

  /** The addresses being typed into the invite field, and the role beside it. */
  email = $state('')
  role = $state<GivenRole>('write')

  /** Something in the field is not an address. Said under the field rather than
   *  at the top of the sheet: it is about what was typed, and nothing was asked
   *  of the server. */
  wrongAddress = $state(false)

  /** Whether anything at all is in flight. What every control that is not the
   *  one being pressed reads. */
  get busy(): boolean {
    return this.working !== null
  }

  /** Whether this is the row or control being changed, so it can say so while
   *  the rest simply go quiet. */
  waiting(about: string): boolean {
    return this.working === about
  }

  async show(space: Space) {
    await this.about(space, null)
  }

  /** The same sheet about one file of the space: a note, or a canvas.
   *
   *  The same sheet, because it is the same question - who else may have this,
   *  and at what - and a second sheet for a smaller thing would be two designs
   *  for one idea. What differs is the mark and the name in its head, and a line
   *  saying so where the space is already shared with somebody. */
  async showItem(space: Space, path: string) {
    const id = sync.tracked(path)?.id
    if (!id) return

    await this.about(space, { id, path })
  }

  private async about(space: Space, item: { id: string; path: string } | null) {
    const id = sync.remoteIdFor(space.root)
    if (!id) return

    // The sheet moves before the read begins, so whatever is already in the air is
    // stale from this line on rather than from the line its answer lands at.
    this.sheet += 1

    this.space = space
    this.spaceId = id
    this.item = item
    this.who = null
    this.error = null
    this.email = ''
    this.wrongAddress = false
    this.role = 'write'
    // Nothing in the air is about this sheet, so no control on it is waiting on
    // anything: the one-at-a-time gate below is about two presses on one sheet, and
    // a sheet the reader has just opened is not a second press on the one before it.
    this.working = null
    this.open = true

    await this.run((asking) => api.sharing(asking.token, asking.id, asking.item), 'sheet')
  }

  close() {
    this.open = false
  }

  /** Everybody in the field, at the role beside it.
   *
   *  Whatever has not gone in yet stays in the field, so a list of four with a
   *  refusal in the middle leaves the refused address and the ones after it where
   *  they can be seen and dealt with, rather than three people invited and one
   *  silently lost. */
  async invite() {
    const addresses = addressesIn(this.email)
    if (!addresses.length) return

    this.wrongAddress = addresses.some((one) => !looksLikeAddress(one))
    if (this.wrongAddress) return

    const left = [...addresses]
    while (left.length) {
      const address = left[0] ?? ''
      const role = this.role
      if (
        !(await this.change(
          (asking) => api.invite(asking.token, asking.id, address, role, asking.item),
          'invite',
        ))
      ) {
        break
      }

      left.shift()
      this.email = left.join(', ')
    }
  }

  /** The invitation again, to somebody who has not opened it. The same route the
   *  first one took, which mints a fresh link and writes a fresh mail. */
  resend(person: Someone & { role: GivenRole }) {
    return this.change(
      (asking) => api.invite(asking.token, asking.id, person.email ?? '', person.role, asking.item),
      whoIs(person),
    )
  }

  /** The four things the owner can do to somebody, each of which reaches one of
   *  two routes: a member is an address the owner wrote down, and a guest is
   *  whoever followed the link. The sheet hands over the person and does not
   *  have to know which it got. */
  setRole(person: Someone, role: GivenRole) {
    return this.change(
      ({ token, id, item }) =>
        person.guest
          ? api.setGuestRole(token, id, person.guest, role, item)
          : api.setMemberRole(token, id, person.email ?? '', role, item),
      whoIs(person),
    )
  }

  remove(person: Someone) {
    return this.change(
      ({ token, id, item }) =>
        person.guest
          ? api.removeGuest(token, id, person.guest, item)
          : api.removeMember(token, id, person.email ?? '', item),
      whoIs(person),
    )
  }

  /** Makes the link on the first ask and changes what it hands out afterwards.
   *  The link itself stays the same, so a copy already in somebody's message
   *  keeps working and starts meaning this instead. */
  setLink(role: GivenRole, mode: 'open' | 'approval') {
    return this.change(
      ({ token, id, item }) => api.setShareLink(token, id, role, mode, item),
      'link',
    )
  }

  revoke() {
    return this.change(({ token, id, item }) => api.revokeShareLink(token, id, item), 'link')
  }

  /** A new link in place of the one there is: the old address stops opening
   *  anything and the space is reachable at a new one. Both halves under one
   *  press, so the sheet never shows the moment in between where the space has no
   *  link at all. */
  reset(role: GivenRole, mode: 'open' | 'approval') {
    return this.change(async ({ token, id, item }) => {
      await api.revokeShareLink(token, id, item)
      return api.setShareLink(token, id, role, mode, item)
    }, 'link')
  }

  accept(person: Someone) {
    return this.change(
      ({ token, id, item }) =>
        person.guest
          ? api.acceptGuest(token, id, person.guest, item)
          : api.acceptRequest(token, id, person.email ?? '', item),
      whoIs(person),
    )
  }

  decline(person: Someone) {
    return this.change(
      ({ token, id, item }) =>
        person.guest
          ? api.removeGuest(token, id, person.guest, item)
          : api.declineRequest(token, id, person.email ?? '', item),
      whoIs(person),
    )
  }

  /** A change, and then whatever the account says the space now looks like. The
   *  space listing is asked for again as well: a role that changed here changes
   *  what the switcher and the editor offer. */
  private async change(
    work: (asking: Asking) => Promise<Sharing>,
    about: string,
  ): Promise<boolean> {
    const done = await this.run(work, about)
    if (done) await account.loadSpaces().catch(() => undefined)
    return done
  }

  /** The one door every call on the sheet goes through.
   *
   *  It reads what the call is about once, before anything is sent, and answers
   *  only into the sheet that sent it. Which is why no control above reaches for
   *  `spaceId` or for the file: a field read after an await is a field that may
   *  have moved, and there is no way to see from a call site that it has. */
  private async run(work: (asking: Asking) => Promise<Sharing>, about: string): Promise<boolean> {
    // The owner's, always: everything on this sheet is theirs to change, and a
    // guest has no account for any of it to be about.
    const token = account.accountToken
    const id = this.spaceId
    if (!token || !id) return false

    // One at a time. Every control goes quiet while one is in flight, so this is
    // the machine agreeing with the screen rather than a second guard.
    if (this.working !== null) return false

    const asking: Asking = { token, id, item: this.item?.id ?? '' }
    const sheet = this.sheet

    this.working = about
    this.error = null

    try {
      return this.landed(sheet, await work(asking))
    } catch (error) {
      // Somebody who is no longer in the space has already gone, which is what
      // the press was asking for. It is not a failure to report: the list is
      // simply older than the space, so it is read again.
      if (gone(error)) return await this.reread(asking, sheet)

      if (sheet === this.sheet) this.error = message(error, 'could not reach the server')
      return false
    } finally {
      // A sheet that has moved on is already not waiting on anything: it has its
      // own read in the air, under its own name.
      if (sheet === this.sheet) this.working = null
    }
  }

  /** Draws what came back, if the sheet that asked is still the sheet.
   *
   *  An answer to an older one is not merely out of date, which would be a reason
   *  to draw it and read again. It is another file's list of people and another
   *  file's invite link, and there is nowhere on this sheet either belongs. */
  private landed(sheet: number, who: Sharing): boolean {
    if (sheet !== this.sheet) return false

    this.who = who
    return true
  }

  /** The list again, after a change that turned out to have happened already. */
  private async reread(asking: Asking, sheet: number): Promise<boolean> {
    try {
      return this.landed(sheet, await api.sharing(asking.token, asking.id, asking.item))
    } catch {
      // The change itself is not in doubt; only this list is out of date, and it
      // is read again the next time the sheet is opened.
      return false
    }
  }
}

/** What names the row a request is about, so the row that was pressed can say so
 *  while the others go quiet. The same key the sheet draws its rows under. */
function whoIs(person: Someone): string {
  return `person:${person.guest ?? person.email ?? ''}`
}

/** Whether what came back means the person was already out of the space.
 *
 *  A second press on Remove is the ordinary way this happens - the row is still
 *  on screen while the first is in the air - and so is another device having
 *  taken them out a moment ago. Either way what was asked for is now true. */
function gone(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}

export const share = new Share()

/** Whether this account owns the space on the server. Sharing and publishing
 *  both ask it and neither can do anything without it: there is nothing to share
 *  and nothing to put on the web until the folder has a copy on the account, and
 *  a space somebody shared is not the reader's to hand on.
 *
 *  Not exported: the three questions below are what the app asks, and each of them
 *  is a sentence about what a reader may do rather than about who owns a row. */
function ownsRemotely(space: Space): boolean {
  return !!account.user && !!sync.remoteIdFor(space.root) && roleOf(space.root) === 'owner'
}

/** Whether a space can be shared from here. */
export function canShare(space: Space): boolean {
  return ownsRemotely(space)
}

/** And whether it can be published: the same question, because it is the same folder
 *  on the same server, and it lives here beside the other half of it rather than with
 *  the publishing store - which is a sheet's worth of code the shell has no reason to
 *  carry in order to grey out a menu row. See publishing.svelte.ts. */
export function canPublish(space: Space): boolean {
  return ownsRemotely(space)
}

/** Who else may have this one file, from the row it is on. The same sheet the
 *  space opens; see ShareSheet.svelte. */
export async function shareThisFile(path: string) {
  const space = workspace.spaces.find((one) => within(one.root, path) !== null)
  if (!space) return

  await share.showItem(space, path)
}

/* ── The files other people shared with you ───────────────────────────── */

/** How often the list is asked for again while it holds anything. Slow enough to
 *  be nothing on either end, quick enough that a file taken back stops being
 *  there while somebody is still looking at it. */
const ASK_EVERY = 15_000

/** A note or a canvas somebody handed over on its own.
 *
 *  It is not a space and is never turned into one. There is no folder for it, no
 *  row in the tree and no file on this machine: it is one document out of
 *  somebody else's space, so it lives at the foot of the space switcher, grouped
 *  under whoever shared it, and it opens in a tab whose words travel through the
 *  file's room. Which is the whole mechanism - the room is what carries a
 *  keystroke to the owner's space, exactly as it does for two people in a note
 *  they both hold.
 *
 *  Read on every pass rather than pushed: the same listing the spaces get, on
 *  the same beat, so a file that was shared or taken back shows up or stops
 *  showing up without anything having to be told. */
class SharedWithYou {
  items = $state<SharedItem[]>([])
  /** What is being opened, so the row can say so. Null while nothing is. */
  opening = $state<string | null>(null)

  /** Asks again while there is something here to lose.
   *
   *  A file somebody handed over is the one thing in the app that can be taken
   *  away by somebody else while you are looking at it: a space of your own is
   *  yours, and a space shared with you goes with the same listing pass that
   *  brings the spaces. So while this list holds anything, it is asked about on
   *  its own beat - and nobody who holds none pays for it, because the timer only
   *  runs while there is one.
   *
   *  A file newly shared with somebody arrives with the spaces, on the pass that
   *  reconciles them; see backoff.ts. That is the same wait a space shared with
   *  them has always had. */
  private asking: ReturnType<typeof setInterval> | undefined

  /** Which list the rows are.
   *
   *  Bumped by everything here that changes them a row at a time - handing one back,
   *  and the session going - and a listing carries the number it was asked under.
   *  The listing is the whole list at once and it is read as it stood when it was
   *  asked, so one that was already in the air when a row went puts the row back:
   *  the file is handed back, the tab closes, and it is in the switcher again until
   *  the next pass a quarter of a minute later. */
  private listed = 0

  /** Whether one of these may be written in. Read-only for a file that is not in
   *  the list at all: it was taken back, and the tab on it is on its way out. */
  mayWrite(id: string): boolean {
    return this.items.find((one) => one.id === id)?.role === 'write'
  }

  /** The rows, grouped by whoever shared them: one heading per person and their
   *  files under it, because "who gave me this" is the first thing a row of
   *  somebody else's documents has to answer. */
  get byOwner(): { owner: string; items: SharedItem[] }[] {
    const out: { owner: string; items: SharedItem[] }[] = []

    for (const item of this.items) {
      const held = out.find((one) => one.owner === item.owner.name)
      if (held) held.items.push(item)
      else out.push({ owner: item.owner.name, items: [item] })
    }

    return out
  }

  /** The list again. Quiet about failure: this is part of a pass, and a listing
   *  that could not be read is last pass's listing rather than an empty one. */
  async load() {
    const token = account.token
    if (!token) {
      this.forget()
      return
    }

    const listed = this.listed

    try {
      const { shared } = await api.shared(token)
      // A row went while this was on its way back, so what came back is the list
      // from before it went. Dropped rather than drawn: the next pass asks again,
      // and this one would put back what the reader has already let go of.
      if (listed !== this.listed) return

      const before = new Set(this.items.map((one) => one.id))
      this.items = shared

      // Anything that was here and is not any more has been taken back. Every tab
      // of it closes, which is the same calm answer a revoked space gives: the
      // words were never this machine's, and a tab on a room that will not have it
      // back is not a document. See joining.svelte.ts.
      const now = new Set(shared.map((one) => one.id))
      for (const id of before) if (!now.has(id)) workspace.closeShared(id)

      if (shared.length) this.keepAsking()
      else this.stop()
    } catch {
      // Nothing to say. The next pass asks again.
    }
  }

  /** Stops asking. Signing out, and a list that has emptied. */
  stop() {
    clearInterval(this.asking)
    this.asking = undefined
  }

  /** And lets go of the rows, for a session that has ended. Somebody else's files
   *  go with the account that reached them, and so does a listing still in the air
   *  for it. */
  forget() {
    this.stop()
    this.listed += 1
    this.items = []
  }

  private keepAsking() {
    if (this.asking) return

    this.asking = setInterval(() => void this.load(), ASK_EVERY)
  }

  /** Opening one: its words come down once to fill the tab, and travel through
   *  its room from then on. */
  async open(item: SharedItem) {
    const token = account.token
    if (!token || this.opening) return

    // Already open: bring it forward rather than asking for the words again.
    if (workspace.showingShared(item.id)) {
      workspace.openShared({ id: item.id, name: item.name, canvas: isCanvasTarget(item.path) }, '')
      return
    }

    this.opening = item.id
    try {
      const { content } = await api.readNote(token, item.id)
      workspace.openShared(
        { id: item.id, name: item.name, canvas: isCanvasTarget(item.path) },
        content,
      )
    } catch {
      // A file that is no longer shared answers 404, which the next pass reads as
      // it going from the list. Nothing is said here: the row is about to leave.
      await this.load()
    } finally {
      this.opening = null
    }
  }

  /** Handing one back, which is the same gesture as leaving a space. */
  async leave(item: SharedItem) {
    const token = account.token
    if (!token) return

    // The row goes here and now, so the listing that is already in the air is a
    // list from before it went; see `listed`.
    this.listed += 1
    this.items = this.items.filter((one) => one.id !== item.id)
    workspace.closeShared(item.id)

    try {
      await api.leaveShared(token, item.id)
    } catch {
      // Already out of it, or the request never got there; the next pass settles
      // which, and the row comes back if it is still theirs.
      await this.load()
    }
  }
}

export const sharedWithYou = new SharedWithYou()

// Somebody else's files go with the session that reached them, and so does the
// asking behind them. Registered rather than reached for, the way everything that
// holds something of an account's does; see `forgetWithSession`.
account.forgetWithSession(() => sharedWithYou.forget())
