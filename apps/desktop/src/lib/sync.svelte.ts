/** The syncing loop: when to look, what to do about spaces that are on one
 *  side and not the other, and what the light in the corner says.
 *
 *  Moving the notes of one space is next door, in sync/pass.ts. */

import { api, ApiError } from './api'
import { arriving } from './arriving.svelte'
import { without } from './records'
import { log } from './log'
import { isRecord, keep, stored, storedText } from './stored'
import { nudgeDelay, pollDelay, RECONCILE_INTERVAL } from './backoff'
import { type Pairing, pairSpaces } from './space-pairing'
import { untrack } from 'svelte'
import { account } from './account.svelte'
import { startup } from './startup.svelte'
import { rooms } from './rooms.svelte'
import { t } from './i18n.svelte'
import { modes } from './modes.svelte'
import { invoke, joinPath } from './tauri'
import { type Mirror, newMirror, readMirror, type Tracked, within } from './sync/mirror'
import type { Joined, Waiting } from './sync/pass'
import { record } from './sync/record.svelte'
import { workspace } from './workspace.svelte'
import type { FileOp } from './workspace/file-ops'
import { samePath } from './space-paths'

export const STORAGE_KEY = 'nib:mirrors'

/** `offline` is v2's: the account cannot be reached, which the light says hollow and
 *  never red. */
export type Status = 'off' | 'idle' | 'syncing' | 'error' | 'offline'

/** Which engine this device ran last, by the account's word: what a launch goes by
 *  until the account has answered, so an offline launch never starts v1 over the files
 *  v2 has been keeping. */
const VERSION = 'nib:sync-version'

type Runner = (typeof import('./sync2/runner.svelte'))['runner']

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
  /** Notes that have just moved and whose new name the account has not taken yet,
   *  by where each is now. The table is re-keyed only once the account has answered
   *  (see `movedHere` in sync/pass.ts, which says why that order is the safety of
   *  it), and until then a note at its new name is still the note it always was: the
   *  same id, and so the same room. Held in memory only, and gone when the account
   *  has answered either way. */
  private moving = $state.raw<readonly { path: string; tracked: Tracked }[]>([])
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

  /** The mirrors, as space-pairing.ts reads and writes a pairing. */
  private readonly pairing: Pairing = {
    pairs: () =>
      Object.values(this.mirrors).map((one) => ({
        root: one.root,
        spaceId: one.spaceId,
        shared: one.shared,
      })),
    pair: (root, spaceId, shared) => {
      this.mirrors[root] = newMirror(spaceId, root, shared)
    },
    unpair: (root) => {
      this.mirrors = without(this.mirrors, root)
    },
    share: (root, shared) => {
      const mirror = this.mirrors[root]
      if (mirror) mirror.shared = shared
    },
  }

  /** Which engine runs this session (docs/sync-v2.md section 11): v2 where the account
   *  says so, chosen at start and kept until the next one. */
  version = $state<1 | 2>(1)
  /** v2's runner, once it is fetched; see sync2/runner.svelte.ts. */
  private v2: Runner | null = null
  private unmirror: (() => void) | null = null

  /** Whether this session runs v2: the account's word, or, before it has spoken, the
   *  word it gave last. Never a guest, who has no account, nor the glasses' plugin. */
  private wantsV2(): boolean {
    if (__EVEN_PLUGIN__ || account.guest) return false
    const said = account.user?.syncVersion ?? Number(storedText(VERSION))
    return said === 2
  }

  start() {
    this.generation++
    if (account.user) keep(VERSION, String(account.user.syncVersion ?? 1))
    if (this.wantsV2()) {
      this.startV2()
      return
    }
    this.startV1()
  }

  /** v2, after the first paint: the runner fetched at the launch's `rooms` turn and
   *  started once the account is known. An account that has gone back to v1 meanwhile
   *  is handed back: the mirrors are written from the sync store first, so v1 meets
   *  every note as one it knows (section 11's rollback). */
  private startV2() {
    const mine = this.generation
    this.version = 2
    arriving.settled()
    void (async () => {
      await startup.turn('rooms')
      const { runner } = await import('./sync2/runner.svelte')
      await known()
      if (mine !== this.generation || !account.user) return
      keep(VERSION, String(account.user.syncVersion ?? 1))
      if (account.user.syncVersion !== 2) {
        await runner.rollBack()
        if (mine !== this.generation) return
        this.version = 1
        this.startV1()
        return
      }
      this.v2 = runner
      this.unmirror = $effect.root(() => {
        $effect(() => {
          const status = runner.status
          const error = runner.lastError
          const at = runner.lastSyncedAt
          untrack(() => {
            this.status = status
            this.lastError = error
            this.lastSyncedAt = at
          })
        })
      })
      await runner.start()
    })()
  }

  private startV1() {
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
    return this.v2 ? this.v2.passing : this.running
  }

  stop() {
    this.generation++
    if (this.v2) {
      const runner = this.v2
      this.v2 = null
      this.unmirror?.()
      this.unmirror = null
      void runner.stop()
    }
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

  /** A file operation, heard the way everything kept by path hears one; see
   *  workspace/file-ops.ts. A space's folder moving re-keys the table in the same
   *  moment as its notes' paths change, so no note is ever at a path the account
   *  has no id for; a note or a folder moving is told to the account. */
  follow(op: FileOp): Promise<void> | undefined {
    if (this.v2) return this.v2.follow(op)
    if (op.op !== 'moved') return undefined
    if (op.kind !== 'space') return this.moved(op.from, op.to)

    const name = workspace.spaces.find((one) => samePath(one.root, op.to))?.name
    return name === undefined ? undefined : this.renamed(op.from, op.to, name)
  }

  /** The folder moved. The account's copy follows it rather than the next pass
   *  deciding this is a brand new space and uploading a second one. The table is
   *  re-keyed before anything is awaited, which is what `follow` counts on. */
  async renamed(from: string, to: string, name: string) {
    const mirror = this.mirrors[from]
    if (!mirror) return

    mirror.root = to
    this.mirrors = { ...without(this.mirrors, from), [to]: mirror }
    this.save()

    const token = account.token
    if (token) await api.renameSpace(token, mirror.spaceId, name).catch(() => undefined)
  }

  /** A note or a folder that moved here, said to the account so that the note keeps
   *  the id it has always had. Beside `renamed` above, which is the same sentence
   *  about a space; `movedHere` in sync/pass.ts is the whole of the reasoning.
   *
   *  Signed out there is nobody to tell, and the next pass reads the move off the
   *  folder the way it always has. */
  async moved(from: string, to: string) {
    const token = account.token
    if (!token) return

    const moving = this.movingFrom(from, to)
    if (moving.length) this.moving = [...this.moving, ...moving]

    try {
      const { movedHere } = await import('./sync/pass')
      for (const mirror of Object.values(this.mirrors)) {
        if (await movedHere(mirror, token, from, to)) this.save()
      }
    } finally {
      if (moving.length) this.moving = this.moving.filter((one) => !moving.includes(one))
    }
  }

  /** The notes a move of `from` to `to` carries, each at its new name. */
  private movingFrom(from: string, to: string): { path: string; tracked: Tracked }[] {
    const out: { path: string; tracked: Tracked }[] = []

    for (const mirror of Object.values(this.mirrors)) {
      const was = within(mirror.root, from)
      const now = within(mirror.root, to)
      if (was === null || now === null) continue

      for (const [path, tracked] of Object.entries(mirror.notes)) {
        if (path !== was && !path.startsWith(`${was}/`)) continue
        out.push({ path: joinPath(mirror.root, now + path.slice(was.length)), tracked })
      }
    }

    return out
  }

  /** Deleting a space here deletes it from the account too. Anything less and
   *  the next pass downloads it straight back, on this machine and every
   *  other one.
   *
   *  A space somebody shared is not this account's to delete, so the same
   *  gesture lets go of it instead: the membership ends, and the space carries
   *  on being everybody else's. */
  async forget(root: string) {
    const spaceId = this.remoteIdFor(root)
    if (spaceId === null) return
    const role = account.spaces.find((one) => one.id === spaceId)?.role
    const theirs = this.v2 ? role !== undefined && role !== 'owner' : !!this.mirrors[root]?.shared

    if (this.v2) {
      await this.v2.forget(root)
    } else {
      this.mirrors = without(this.mirrors, root)
      this.save()
    }

    const token = account.token
    if (!token) return

    const letting = theirs ? api.leaveSpace(token, spaceId) : api.deleteSpace(token, spaceId)

    await letting.catch(() => undefined)
  }

  /** An icon chosen here and the colour it is drawn in, sent up so every other
   *  machine shows the same mark. One request: they are one gesture in the picker,
   *  and the account keeps the colour beside the icon. */
  async pushIcon(root: string, icon: string | null, tint: string | null = null) {
    const token = account.token
    const spaceId = this.remoteIdFor(root)
    if (!token || spaceId === null) return

    await api.setSpaceIcon(token, spaceId, icon, tint).catch(() => undefined)
    await account.loadSpaces().catch(() => undefined)
  }

  /** The space's bookmarks as they now stand. Signed out, in a space the
   *  account has never heard of, or in one shared to read, they stay on this
   *  machine: the first two because there is nowhere to send them yet, and the
   *  last because what somebody keeps above a file list they may only read is
   *  their own business and the account would refuse it anyway. */
  async pushBookmarks(root: string) {
    const token = account.token
    const spaceId = this.remoteIdFor(root)
    if (!token || spaceId === null || this.reads(spaceId)) return

    await api.saveBookmarks(token, spaceId, workspace.bookmarks.of(root)).catch(() => undefined)
  }

  /** Autosave wrote a note. Under v2 that write is also the moment what was typed
   *  becomes a pending update in the sync store; v1 reads the file at its next pass. */
  wrote(path: string, content: string): void {
    if (this.v2) void this.v2.wrote(path, content)
    else this.nudge()
  }

  /** Something changed here, so the next pass should not wait out whatever slow
   *  interval the loop had settled into - and should not be pushed back either. A
   *  note saved in the first instant of a launch used to shove the pass that was
   *  due at once two seconds out, and a hand that kept typing kept shoving it. The
   *  rule is `nudgeDelay`, in backoff.ts beside the interval it answers to. */
  nudge() {
    if (this.v2) {
      this.v2.nudge()
      return
    }
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
    if (this.v2) return await this.v2.passNow()
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

    // What should happen is worked out on its own and done in space-pairing.ts, which
    // the v2 engine shares; the mirrors are where this engine keeps a pairing.
    await pairSpaces(token, this.pairing)

    this.save()
  }

  /** Sends the order of the spaces up. Local spaces the account has never heard of are
   *  simply left out; the server keeps them where they were. */
  async pushSpaceOrder() {
    const token = account.token
    if (!token) return

    const order = workspace.spaces
      .map((space) => this.remoteIdFor(space.root))
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
    if (this.v2) return this.v2.remoteIdFor(root)
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
    if (this.v2) return this.v2.tracked(path)
    for (const mirror of Object.values(this.mirrors)) {
      const relative = within(mirror.root, path)
      const held = relative === null ? undefined : mirror.notes[relative]
      if (held) return { id: held.id, version: held.version, hash: held.hash }
    }

    const moving = this.moving.find((one) => samePath(one.path, path))?.tracked
    return moving ? { id: moving.id, version: moving.version, hash: moving.hash } : null
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
   *  sync/pass.ts. */
  private waiting(mirror: Mirror, joined: Joined): Waiting {
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
      // Nothing archived is deleted, whatever another device says; see `deletedThere`.
      kept: (path) => workspace.archive.holdsIn(mirror.root, path),
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
   *  every time.
   *
   *  Never for a note a room is carrying: the room is that note's truth and the
   *  document is already joined to it keystroke by keystroke, so putting a file into
   *  it would offer a whole text to the room as one edit - which is the write this
   *  batch is about. See rooms/join.ts. */
  private async refresh(path: string, joined: Joined) {
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
    if (this.v2) return await this.v2.passNow()
    if (this.running || !account.token) return false

    const token = account.token
    const mine = this.generation
    // Which notes a room is carrying: the ones a pass leaves alone, since the room
    // is already writing them into the account itself. Asked of the store as the
    // pass reaches each note rather than read once here, because a room settles
    // whenever somebody stops typing and a pass is seconds long - and the note whose
    // room settled halfway through one was the second copy Emil kept finding. See
    // `Joined` in sync/pass.ts.
    const joined: Joined = { has: (id) => rooms.carries(id) }
    this.running = true
    this.status = 'syncing'
    this.lastError = null
    let moved = false
    /** Whether something landed in the space on screen. */
    let shown = false

    try {
      // Fetched with the first pass rather than carried by the launch: nothing in
      // it is needed to draw a note.
      const { pull, push } = await import('./sync/pass')

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

      // The account itself is gone - deleted on another device, or its session ended
      // there - and every pass from here would say so again. Signed out now, the way
      // the next launch would sign it out, rather than a light saying error until then.
      if (error instanceof ApiError && error.status === 401) {
        void account.signOut()
        return moved
      }

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

/** Resolves once the account has said who this is - or that nobody is. */
function known(): Promise<void> {
  if (account.user || !account.token) return Promise.resolve()
  return new Promise((resolve) => {
    const stop = $effect.root(() => {
      $effect(() => {
        if (!account.user && account.token) return
        untrack(() => {
          queueMicrotask(() => stop())
          resolve()
        })
      })
    })
  })
}

export const sync = new Sync()

workspace.fileOps.follow((op) => sync.follow(op))
