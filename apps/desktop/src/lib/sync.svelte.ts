/** The syncing loop: when to look, what to do about spaces that are on one
 *  side and not the other, and what the light in the corner says.
 *
 *  Moving the notes of one space is next door, in sync/mirror.ts. */

import { api } from './api'
import { arriving } from './arriving.svelte'
import { without } from './records'
import { log } from './log'
import { isRecord, keep, stored } from './stored'
import { nudgeDelay, pollDelay, RECONCILE_INTERVAL } from './backoff'
import { planSpaces } from './space-plan'
import { account } from './account.svelte'
import { rooms } from './rooms.svelte'
import { t } from './i18n.svelte'
import { modes } from './modes.svelte'
import { invoke } from './tauri'
import { type Mirror, newMirror, pull, push, readMirror, type Waiting, within } from './sync/mirror'
import { record } from './sync/record.svelte'
import { workspace } from './workspace.svelte'

export const STORAGE_KEY = 'nib:mirrors'

export type Status = 'off' | 'idle' | 'syncing' | 'error'

class Sync {
  status = $state<Status>('off')
  lastError = $state<string | null>(null)
  lastSyncedAt = $state<number | null>(null)

  /** What each local folder mirrors on the account, and what the last pass left
   *  in it. Shallow state rather than plain: a pass gives a new note its id, and
   *  a note with no id has no room to join, so anything watching for one has to
   *  hear about the pass that hands it over. `save` is what says so; see
   *  rooms.svelte.ts. Shallow, because a pass writes into these all the way down
   *  and a proxy on that path would cost every note in the space. */
  private mirrors = $state.raw<Record<string, Mirror>>({})
  private timer: ReturnType<typeof setTimeout> | null = null
  /** When the pass that timer is for comes due, so a nudge can tell whether its
   *  own delay would be sooner than what is already planned; see `nudge`. */
  private dueAt = 0
  private running = false
  /** Passes in a row that found nothing. Each one waits longer than the last. */
  private quiet = 0
  private reconciledAt = 0

  /** Which run of the loop this is. Bumped by every start and every stop, so a
   *  pass still in flight when syncing was turned off can tell that what it is
   *  about to say is out of date. Signing out is the case that matters: the
   *  pass finishes, and without this it would put the light back to "synced"
   *  and set the next timer for an account that is no longer there. */
  private generation = 0
  /** Whether the next pass is this session's first. Only that one is worth
   *  holding the app back for; see `pass`. */
  private first = false
  /** Whether a pass has ever finished for this account on this machine.
   *
   *  Written down beside the mirrors, because it is the same fact about the same
   *  relationship. It is the whole test for whether the first pass of a session
   *  is one somebody is waiting behind or one the light in the corner covers, and
   *  a cursor cannot answer it: a space this machine uploaded and never pulled
   *  anything from has a cursor of nought for as long as it exists. */
  private seen = false

  start() {
    this.generation++
    const held = this.load(account.user?.id ?? null)
    this.mirrors = held.mirrors
    this.seen = held.seen
    this.quiet = 0
    this.reconciledAt = 0
    this.first = true

    document.addEventListener('visibilitychange', this.onVisibility)
    window.addEventListener('focus', this.onReturn)

    // Whether the pass about to run is one somebody is waiting on rather than one
    // the light in the corner covers. Said before the pass asks the account
    // anything, because the asking is itself a round trip; and said either way,
    // because signing in raises the wait before there is a loop to judge it and
    // a machine that already holds everything must not be left behind it. See
    // arriving.svelte.ts.
    if (this.seen) arriving.settled()
    else arriving.begin()

    this.schedule(0)
  }

  /** Whether a pass is still in the air.
   *
   *  The light cannot say: a stop takes it down at once and the pass it interrupted
   *  goes on to its end, writing down what it found; see `run`. Nothing on screen
   *  wants this - the light is what a reader watches - but `run` refuses a second
   *  pass while the first is going, so whoever drives one pass at a time has to be
   *  able to tell that the last one is over. */
  get passing(): boolean {
    return this.running
  }

  stop() {
    this.generation++
    if (this.timer) clearTimeout(this.timer)
    this.timer = null

    document.removeEventListener('visibilitychange', this.onVisibility)
    window.removeEventListener('focus', this.onReturn)

    this.status = 'off'
    // The waiting state is deliberately left standing. Syncing is stopped for the
    // whole of the moment between a code being accepted and the question about
    // the notes already on this machine being answered, which is when somebody is
    // waiting hardest: taking it down here put it up and straight back down
    // again, and left a blank screen where the wait should have been. Signing out
    // is what ends a wait, and it says so itself; see account.svelte.ts.
  }

  /** How many notes the account holds in the spaces nothing has come down from
   *  yet. What the waiting state counts against, and zero when the answer is
   *  that nothing is coming.
   *
   *  A mirror whose cursor is still nought has had no page of changes, so every
   *  note the account holds in that space is one nobody can read here yet. One
   *  the account has never heard of counts for nothing: it is a folder on its way
   *  up, not writing on its way down. */
  private notesOnTheirWay(): number {
    let waiting = 0
    for (const mirror of Object.values(this.mirrors)) {
      if (mirror.cursor !== 0) continue

      waiting += account.spaces.find((one) => one.id === mirror.spaceId)?.notes ?? 0
    }

    return waiting
  }

  /** The folder moved. The account's copy follows it rather than the next pass
   *  deciding this is a brand new space and uploading a second one. */
  async renamed(from: string, to: string, name: string) {
    const mirror = this.mirrors[from]
    if (!mirror) return

    mirror.root = to
    this.mirrors = { ...without(this.mirrors, from), [to]: mirror }
    this.save()

    const token = account.token
    if (token) await api.renameSpace(token, mirror.spaceId, name).catch(() => undefined)
  }

  /** Deleting a space here deletes it from the account too. Anything less and
   *  the next pass downloads it straight back, on this machine and every
   *  other one.
   *
   *  A space somebody shared is not this account's to delete, so the same
   *  gesture lets go of it instead: the membership ends, and the space carries
   *  on being everybody else's. */
  async forget(root: string) {
    const mirror = this.mirrors[root]
    if (!mirror) return

    this.mirrors = without(this.mirrors, root)
    this.save()

    const token = account.token
    if (!token) return

    const letting = mirror.shared
      ? api.leaveSpace(token, mirror.spaceId)
      : api.deleteSpace(token, mirror.spaceId)

    await letting.catch(() => undefined)
  }

  /** An icon chosen here and the colour it is drawn in, sent up so every other
   *  machine shows the same mark. One request: they are one gesture in the picker,
   *  and the account keeps the colour beside the icon. */
  async pushIcon(root: string, icon: string | null, tint: string | null = null) {
    const token = account.token
    const mirror = this.mirrors[root]
    if (!token || !mirror) return

    await api.setSpaceIcon(token, mirror.spaceId, icon, tint).catch(() => undefined)
    await account.loadSpaces().catch(() => undefined)
  }

  /** The space's bookmarks as they now stand. Signed out, in a space the
   *  account has never heard of, or in one shared to read, they stay on this
   *  machine: the first two because there is nowhere to send them yet, and the
   *  last because what somebody keeps above a file list they may only read is
   *  their own business and the account would refuse it anyway. */
  async pushBookmarks(root: string) {
    const token = account.token
    const mirror = this.mirrors[root]
    if (!token || !mirror || this.reads(mirror.spaceId)) return

    await api
      .saveBookmarks(token, mirror.spaceId, workspace.bookmarks.of(root))
      .catch(() => undefined)
  }

  /** Something changed here, so the next pass should not wait out whatever slow
   *  interval the loop had settled into - and should not be pushed back either. A
   *  note saved in the first instant of a launch used to shove the pass that was
   *  due at once two seconds out, and a hand that kept typing kept shoving it. The
   *  rule is `nudgeDelay`, in backoff.ts beside the interval it answers to. */
  nudge() {
    if (!this.timer) return

    this.quiet = 0
    this.schedule(nudgeDelay(this.dueAt - Date.now()))
  }

  /** Hiding the window re-plans the pending pass at the longer interval;
   *  showing it again syncs at once, so what you look at is never stale. */
  private readonly onVisibility = () => {
    if (document.hidden) this.schedule()
    else this.onReturn()
  }

  private readonly onReturn = () => {
    if (!this.timer) return

    this.quiet = 0
    // Spaces now travel both ways, so coming back to the window is the moment
    // to ask whether the account has any this machine has not seen. One extra
    // request, and only when someone is actually looking.
    this.reconciledAt = 0
    this.schedule(0)
  }

  private schedule(delay = this.delay()) {
    if (this.timer) clearTimeout(this.timer)
    this.dueAt = Date.now() + delay
    this.timer = setTimeout(() => void this.tick(), delay)
  }

  private delay(): number {
    return pollDelay(this.quiet, document.hidden)
  }

  private async tick() {
    const mine = this.generation
    let moved = false

    try {
      moved = await this.pass()
    } catch (error) {
      // A pass can fail anywhere: a request the account refused, a folder that
      // would not read. The loop is the thing that must not stop, so what
      // happened goes on the light and the next pass is scheduled as usual.
      if (mine === this.generation) {
        this.status = 'error'
        this.lastError = error instanceof Error ? error.message : t('sync failed')
      }
    }

    // Syncing may have been turned off while that pass was in the air. Setting
    // the next timer here would restart a loop that was deliberately stopped.
    if (mine !== this.generation) return

    // Eight doublings is far past either cap; stopping there keeps the shift
    // from overflowing on a client left open for days.
    this.quiet = moved ? 0 : Math.min(this.quiet + 1, 8)
    this.schedule()
  }

  /** One pass: pairs every local space with a remote one, then syncs. What
   *  the loop does on every tick, on its own so it can be driven by hand. */
  async pass(): Promise<boolean> {
    // Read before anything is asked of the account, so that whatever the pass
    // runs into, the one thing somebody is waiting behind is lifted; a pass that
    // threw on its way through is a pass with nothing more coming.
    const first = this.first
    this.first = false

    try {
      await this.reconcile()

      // Reconciling is what asks the account what it holds, so this is the first
      // moment the pass can say how much it is bringing down. Later passes say
      // nothing: the waiting state ignores both of these unless it is up.
      if (first) arriving.expect(this.notesOnTheirWay())

      return await this.run()
    } finally {
      if (first) arriving.settled()
    }
  }

  private async reconcile() {
    const token = account.token
    if (!token) return

    // The space list changes when someone makes or deletes one, which is rare.
    // A local space with no mirror yet is the case that cannot wait.
    const missing = workspace.spaces.some((space) => !this.mirrors[space.root])
    const due = Date.now() - this.reconciledAt >= RECONCILE_INTERVAL

    if (!missing && !due) return

    try {
      await account.loadSpaces()
      this.reconciledAt = Date.now()
    } catch {
      return
    }

    // What should happen is worked out on its own, away from the doing, so it
    // can be tested against a plain pair of lists - see `space-plan.ts`.
    const plan = planSpaces({
      local: workspace.spaces.map((space) => ({ name: space.name, root: space.root })),
      remote: account.spaces.map((space) => ({
        id: space.id,
        name: space.name,
        shared: space.role !== 'owner',
      })),
      mirrors: Object.values(this.mirrors).map((one) => ({
        root: one.root,
        spaceId: one.spaceId,
        shared: one.shared,
      })),
      deleted: account.deletedSpaces,
    })

    // Removals come first. Adopting runs after, and adopting reuses a folder
    // of the same name if it finds one - which would be the very folder about
    // to be deleted. Deleting a space and making a new one of the same name
    // has to settle in a single pass, not leave a gap.
    for (const root of plan.remove) {
      const space = workspace.spaces.find((one) => one.root === root)
      // A space somebody stopped sharing is in nobody's Recently deleted, so
      // the copy on this disk is the only one left of what was read here. It
      // goes to this device's trash rather than for good; a space the account
      // says was deleted is in the account's own Recently deleted already.
      const shared = this.mirrors[root]?.shared === true
      this.mirrors = without(this.mirrors, root)
      if (space) await workspace.deleteSpace(space.id, shared)
    }

    // Missing without a marker: not uploaded yet as far as anyone can tell, so
    // the mirror goes and the next pass sends the folder up again.
    for (const root of [...plan.detach, ...plan.drop]) {
      this.mirrors = without(this.mirrors, root)
    }

    const mine = (id: string) => account.spaces.find((one) => one.id === id)?.role !== 'owner'

    for (const { root, spaceId } of plan.pair) {
      this.mirrors[root] = newMirror(spaceId, root, mine(spaceId))
    }

    // A guest has no account for a folder to become a space in. What a link
    // lent them is the whole of what syncing is about for them, and the notes
    // already on this machine are their own: those stay here.
    if (account.user) {
      for (const space of plan.upload) {
        const { space: remote } = await api.createSpace(token, space.name)
        this.mirrors[space.root] = newMirror(remote.id, space.root)
      }
    }

    for (const space of plan.adopt) {
      // A folder of its own where a folder of that name is already here and
      // already answers for something - and always, for a space somebody
      // shared, which has no claim on anything on this machine.
      const taken =
        mine(space.id) ||
        workspace.spaces.some((one) => one.name === space.name && !!this.mirrors[one.root])

      const root = await workspace.adoptSpace(space.name, taken)
      if (root) this.mirrors[root] = newMirror(space.id, root, mine(space.id))
    }

    // The icon and the bookmarks belong to the space, so they travel with it.
    // Whatever the account holds wins: it is the one copy every machine can
    // see. The exception is the first time an account meets a space on this
    // machine, where whatever was bookmarked here joins the account's list
    // instead of being replaced by it - and is sent straight back up.
    const accountId = account.user?.id ?? null
    for (const remote of account.spaces) {
      const mirror = Object.values(this.mirrors).find((one) => one.spaceId === remote.id)
      if (!mirror) continue

      // The colour rides with the icon, and a listing with no word about it at all is
      // a service older than the column: then this machine's colour is the one there
      // is, and it is this machine's to send. Only for a space of this account's -
      // the icon and its colour are the owner's, so somebody else's would be
      // refused.
      const unsaid = workspace.applyIcon(mirror.root, remote.icon ?? null, remote.tint)
      if (unsaid && remote.role === 'owner') {
        await this.pushIcon(mirror.root, remote.icon ?? null, unsaid)
      }

      // Kept current, because a space that stops being shared - or starts -
      // changes what happens when it later goes missing from the listing.
      mirror.shared = remote.role !== 'owner'

      // Whatever this machine had bookmarked in a space it may only read is
      // its own business: the account would refuse the list, and asking on
      // every pass is a refusal on every pass.
      if (accountId === null || remote.role === 'read') continue
      const merged = workspace.bookmarks.adopt(mirror.root, remote.bookmarks, accountId)
      if (merged) await api.saveBookmarks(token, remote.id, merged).catch(() => undefined)
    }

    // The account already lists spaces in the order it holds them, so adopting
    // that order is what makes a second machine look like the first.
    workspace.applySpaceOrder(account.spaces.map((space) => space.name))

    this.save()
  }

  /** Sends the order of the spaces up. Local spaces the account has never heard of are
   *  simply left out; the server keeps them where they were. */
  async pushSpaceOrder() {
    const token = account.token
    if (!token) return

    const order = workspace.spaces
      .map((space) => this.mirrors[space.root]?.spaceId)
      .filter((id): id is string => !!id)

    if (!order.length) return

    try {
      await api.reorderSpaces(token, order)
      await account.loadSpaces()
    } catch {
      // The next reconcile will notice; an order is not worth an error banner.
    }
  }

  /** The remote space a local folder mirrors, if any. Publishing needs it, and
   *  so does everything that asks what may be done in a space. */
  remoteIdFor(root: string): string | null {
    return this.mirrors[root]?.spaceId ?? null
  }

  /** Whether the account shared this space to be read and not written in. */
  private reads(spaceId: string): boolean {
    return account.spaces.find((one) => one.id === spaceId)?.role === 'read'
  }

  /** What the account holds for a note on this machine: the id its room is named
   *  after, the version, and the hash of the copy the last pass left here.
   *
   *  Null for a note in no space, and for one the account has never been handed -
   *  a note with no id has no room, and a note whose hash nobody knows has nothing
   *  to be compared against. See rooms.svelte.ts, which asks. */
  tracked(path: string): { id: string; version: number; hash: string } | null {
    for (const mirror of Object.values(this.mirrors)) {
      const relative = within(mirror.root, path)
      const held = relative === null ? undefined : mirror.notes[relative]
      if (held) return { id: held.id, version: held.version, hash: held.hash }
    }

    return null
  }

  /** What a pull over this space tells whoever is waiting on it, and what it
   *  fetches first.
   *
   *  Three things, and all three are about the half minute a first sync takes on a
   *  slow connection. The names go into the file list as soon as the page of
   *  changes names them, so the list is right long before the writing is here. Each
   *  body that lands takes its row out of that set and, if somebody has that note
   *  open on the strength of the row, fills the tab in. And the notes on screen are
   *  fetched before the rest, because a page is a few hundred notes and the one
   *  being read should not be at the back of it.
   *
   *  The reading is the workspace's and the counting is `arriving`'s; this is the
   *  wiring between them and the pass, which knows about neither. See
   *  sync/mirror.ts. */
  private waiting(mirror: Mirror, joined: ReadonlySet<string>): Waiting {
    const open = new Set(
      workspace.openNotes
        .map((one) => within(mirror.root, one.path))
        .filter((one): one is string => one !== null),
    )

    return {
      listed: (paths) => arriving.listing(paths),
      wrote: (path) => {
        arriving.arrived()
        void workspace.arrived(path)
        void this.refresh(path, joined)
        this.pulled += 1
      },
      wanted: open,
      // The reader's answer to "what if the same note was written twice", and
      // the notes still waiting for one. See sync/conflicts.ts.
      rule: modes.conflicts,
      clashed: (clash) => {
        record.clash(clash)
        this.clashed += 1
      },
      held: record.held,
    }
  }

  /** A note the pass has just written, put into the document if that note is open
   *  and there is nothing unsaved in it.
   *
   *  Which is the rule the app already states for a file that changed underneath it:
   *  one nobody has edited quietly becomes what is on disk, and one with unsaved
   *  words in it is touched by nothing and said out loud instead. Space notes are
   *  not watched - nothing else writes them - and a pass was the exception nobody
   *  had noticed: the file changed, the tab did not, and the next save wrote the
   *  tab's older words back over it. A device that could not reach a note's room
   *  then offered them again on every pass, and the account kept what it replaced
   *  every time. See watch.svelte.ts, which says the same thing about files from
   *  outside a space.
   *
   *  Never for a note a room is carrying: the room is that note's truth and the
   *  document is already joined to it keystroke by keystroke, so putting a file into
   *  it would offer a whole text to the room as one edit - which is the write this
   *  batch is about. See rooms/join.ts. */
  private async refresh(path: string, joined: ReadonlySet<string>) {
    const id = this.tracked(path)?.id
    if (id !== undefined && joined.has(id)) return

    const note = workspace.openNotes.find((one) => one.path === path)?.note
    if (!note || note.dirty) return

    const content = await invoke<string>('read_note', { path }).catch(() => null)
    if (content !== null && content !== note.text) workspace.reload(path, content)
  }

  /** What the pass being run has moved, for the log. Counted on the store rather
   *  than passed back, because the two halves answer a boolean each and what a
   *  line in the log says is how many. */
  private pulled = 0
  private pushed = 0
  private clashed = 0

  /** One line in the log for one space, unless there is nothing to say about it.
   *  See sync/record.svelte.ts, which decides that. */
  private noted(mirror: Mirror, began: number, failed: string | null) {
    record.wrote({
      at: began,
      space: workspace.spaces.find((one) => one.root === mirror.root)?.name ?? mirror.root,
      pulled: this.pulled,
      pushed: this.pushed,
      clashed: this.clashed,
      failed,
    })
  }

  /** One full pass: take what the server has, then offer what we have.
   *  Answers whether anything actually moved, which is what paces the loop. */
  async run(): Promise<boolean> {
    if (this.running || !account.token) return false

    const token = account.token
    const mine = this.generation
    // Which notes a room is already carrying, read once for the whole pass: they
    // are the ones a pass leaves alone, and one that changed halfway would leave a
    // note either pushed twice or not at all.
    const joined = rooms.joined
    this.running = true
    this.status = 'syncing'
    this.lastError = null
    let moved = false
    /** Whether something landed in the space on screen. */
    let shown = false

    try {
      for (const mirror of Object.values(this.mirrors)) {
        // A folder the workspace no longer lists is left alone until the next
        // reconcile decides what becomes of its mirror. Syncing it would read
        // every note as deleted here, and delete them from the account.
        if (!workspace.spaces.some((space) => space.root === mirror.root)) continue

        this.pulled = 0
        this.pushed = 0
        this.clashed = 0
        const began = Date.now()

        if (await pull(mirror, token, joined, this.waiting(mirror, joined))) {
          moved = true
          if (mirror.root === workspace.activeSpace?.root) shown = true
        }

        // A space shared to read only comes down. Offering what is here would
        // be refused by the account, and a folder somebody is reading is not a
        // statement about what the space should hold.
        if (this.reads(mirror.spaceId)) {
          this.noted(mirror, began, null)
          continue
        }

        const sending = { held: record.held, sent: () => (this.pushed += 1) }
        if (await push(mirror, token, joined, sending)) moved = true

        // A whole pass has been through this space, so every note in the folder has
        // an entry again and the table is a record rather than a hole. Said here
        // because reaching this line is what makes it true; see `dropped`.
        mirror.dropped = false
        this.noted(mirror, began, null)
      }

      // Nothing else re-reads the folder for notes that arrived from another
      // machine, so they would otherwise sit there unseen until the next save.
      if (shown) await workspace.loadTree()

      // A browser opens the welcome note because on a first visit there is
      // nothing else to read. Once an account has brought its own notes down
      // there is, and leaving somebody looking at "Welcome to Nib" beside their
      // own writing is the app failing to notice it has been introduced.
      if (moved) await workspace.leaveTheWelcomeNote()

      // Every mirror has been through, so this machine has now seen the account
      // and no later launch holds anybody behind a wait. Written here rather than
      // in `pass` because reaching this line is what finishing means: a pass that
      // threw is one whose spaces have not all come down.
      this.seen = true
      this.save()
      // Syncing may have been turned off while the pass was running, and the
      // light is already saying so. What it found is still worth writing down;
      // what it thinks the state is no longer is.
      if (mine !== this.generation) return moved

      this.lastSyncedAt = Date.now()
      this.status = Object.keys(this.mirrors).length ? 'idle' : 'off'
    } catch (error) {
      // What the pass got through before it fell over is written down all the same.
      //
      // It used to be thrown away, and a run of failing passes therefore left
      // storage holding a picture of this machine from before any of them: cursors
      // that had moved, notes that had been sent, and - worst - the record of a
      // write that was in the air when the failure came. The next launch read that
      // stale picture, found the account ahead of it and the file ahead of both,
      // and put a conflict copy beside a note nobody else had ever opened. A pass
      // that failed halfway still learned the first half. See `save` and `offered`
      // in sync/mirror.ts.
      this.save()

      // What went wrong is worth a line even though the pass is over: the words
      // the server used are the whole of what a reader can act on.
      const said = error instanceof Error ? error.message : String(error)
      record.wrote({
        at: Date.now(),
        space: '',
        pulled: this.pulled,
        pushed: this.pushed,
        clashed: this.clashed,
        failed: said,
      })

      if (mine !== this.generation) return moved

      this.status = 'error'
      this.lastError = error instanceof Error ? error.message : t('sync failed')
    } finally {
      this.running = false
    }

    return moved
  }

  /** What this machine has written down about its relationship with an account:
   *  the mirrors, and whether a pass has ever finished. */
  private load(accountId: string | null): { mirrors: Record<string, Mirror>; seen: boolean } {
    const saved = stored(STORAGE_KEY)
    if (!isRecord(saved)) return { mirrors: {}, seen: false }

    // An older version wrapped the mirrors in an object of their own, and one
    // older still kept no account beside them: what is there belongs to
    // whoever is signing in now, which is what the next pass writes down.
    const held = isRecord(saved.mirrors) ? saved.mirrors : saved
    const whose = typeof saved.account === 'string' ? saved.account : null

    // A mirror is this machine's relationship with one account. Another
    // account's mirrors are not spaces that went; they are nothing to do with
    // this account at all, and reading them as absences would reach into the
    // disk on the strength of somebody else's listing.
    if (whose !== null && whose !== accountId) return { mirrors: {}, seen: false }

    const mirrors: Record<string, Mirror> = {}
    for (const [root, one] of Object.entries(held)) {
      const mirror = readMirror(root, one)
      if (mirror) mirrors[root] = mirror
    }

    // Absent in what an older version wrote. A machine that has mirrors from
    // before this field existed has plainly seen the account, and reading it as
    // unseen would hold the app back once, on the next launch only.
    return { mirrors, seen: saved.seen === true || Object.keys(mirrors).length > 0 }
  }

  /** Reads what this machine wrote down again, and fills in whatever it did not
   *  have. For a storage that answers in two goes.
   *
   *  A packed plugin has one: its page belongs to a fresh port every launch, so
   *  what is read before the first paint is a cookie, and everything the cookie
   *  had no room for arrives from the phone app's own store seconds later. `load`
   *  above runs once, early, and would otherwise have captured the half of it that
   *  fits in four kilobytes - which for these mirrors is about thirteen notes,
   *  since each one costs its path and a hundred and thirty odd bytes. Past that
   *  the whole table is missing, every note reads as one the account has never
   *  been told about, and a pass has to work every one of them out again. See
   *  lib/even/local.ts, and `reread` in workspace/device.svelte.ts, which is the
   *  same fact about the same storage.
   *
   *  Filled in, never replaced, for two reasons. What is here was written by a
   *  pass that has already run, so it is newer than anything storage is only now
   *  getting round to mentioning. And a pass may be running right now, writing
   *  into these very objects: they are added to in place rather than swapped for
   *  new ones, so nothing a pass has settled is dropped on the floor by this. The
   *  cursor is left alone for the same reason - a note this replays is a note
   *  found already agreeing, which costs a hash and no writing at all. */
  reread() {
    const held = this.load(account.user?.id ?? null)
    let grew = !this.seen && held.seen
    this.seen = this.seen || held.seen

    for (const [root, stored] of Object.entries(held.mirrors)) {
      const mine = this.mirrors[root]
      if (!mine) {
        this.mirrors[root] = stored
        grew = true
        continue
      }

      for (const [path, tracked] of Object.entries(stored.notes)) {
        if (mine.notes[path]) continue

        mine.notes[path] = tracked
        grew = true
      }

      for (const [path, file] of Object.entries(stored.files)) {
        if (mine.files[path]) continue

        mine.files[path] = file
        grew = true
      }

      // A write that was in the air when this storage was last written. Filled in
      // like the rest, and for a sharper reason: it is what says a note the account
      // holds is this machine's own writing, and a machine that forgets it puts a
      // conflict copy beside its own note. See `offered` in sync/mirror.ts.
      for (const [path, hash] of Object.entries(stored.offered)) {
        if (mine.offered[path]) continue

        mine.offered[path] = hash
        grew = true
      }
    }

    // Nothing to say when storage held nothing this did not, which is every
    // machine but the one this exists for.
    if (grew) this.save()
  }

  /** Writes down where this machine is with the account, and does not let a full
   *  storage undo it.
   *
   *  Two very different things are in one blob and only one of them matters. The
   *  cursors are a number per space. The tracked notes are an id, a version and a
   *  hash per note - a hundred and thirty odd bytes and the path - which for an
   *  account of a few thousand notes is most of a megabyte, and localStorage is
   *  five. So the notes are what fills storage up and the cursors are what a pass
   *  cannot afford to lose.
   *
   *  Losing them is what an unguarded setter did: it threw, the pass reported a
   *  failure, and the cursor it had just moved was never written. The next pass
   *  asked for changes since the cursor before it, got the whole account back, and
   *  threw again - every pass, for as long as storage stayed full. Seen from the
   *  server as the same handful of cursors walked round and round, and from the
   *  machine as a launch that reads every note it already has.
   *
   *  So the whole thing is offered to storage first, and if storage will not take
   *  it, the same again without the note and file caches. A mirror read back
   *  without those re-hashes its notes once, which costs a read each and no
   *  download and no write; a mirror read back without its cursor is the whole
   *  account again, and again after that. */
  private save() {
    // A new object, so whoever is watching what the account holds hears that a
    // pass changed it. The mirrors themselves are written into in place; this is
    // the one moment that says so out loud.
    this.mirrors = { ...this.mirrors }

    if (this.write(this.mirrors)) return
    if (this.write(withoutCaches(this.mirrors))) {
      log('warn', 'sync: storage is full, so the note caches went and the cursors stayed')
      return
    }

    log('error', 'sync: storage would take no cursors, so the next pass reads the account again')
  }

  /** One offer to storage. Answers whether it was taken.
   *
   *  Never throws. A storage that is full and a browser told to keep no site data
   *  both throw from the setter, and neither is a reason for a pass that found
   *  something to report a failure: what it found is in memory and true, and the
   *  only thing lost is the next launch's head start. */
  private write(mirrors: Record<string, Mirror>): boolean {
    return keep(
      STORAGE_KEY,
      JSON.stringify({
        account: account.user?.id ?? null,
        seen: this.seen,
        mirrors,
      }),
    )
  }
}

/** The mirrors with their caches left out: everything that says where this machine
 *  is with a space, and nothing that says what it holds. What is offered to a
 *  storage that would not take the whole table; see `save`.
 *
 *  It says that it did so. A mirror with no entry for a note the account holds can
 *  mean two opposite things - a folder newly paired with a space somebody else has
 *  been writing in, or this, a table thrown overboard to save the cursors - and a
 *  pass that cannot tell them apart reads its own gap as a stranger and puts a
 *  second copy of a note beside itself. See `dropped` in sync/mirror.ts.
 *
 *  What a write in the air said is kept whatever happens. It is a hash per note
 *  still waiting for its answer, which is normally nothing at all, and it is the
 *  one record that says a note up there is this machine's own writing. */
function withoutCaches(mirrors: Record<string, Mirror>): Record<string, Mirror> {
  const out: Record<string, Mirror> = {}
  for (const [root, mirror] of Object.entries(mirrors)) {
    out[root] = { ...mirror, notes: {}, files: {}, dropped: true }
  }

  return out
}

export const sync = new Sync()
