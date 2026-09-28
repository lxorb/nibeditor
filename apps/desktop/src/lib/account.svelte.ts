import { api, ApiError, type Account, type Guest, type RemoteSpace } from './api'
import { arriving } from './arriving.svelte'
import { called } from './person'
import { forget, keep, storedText } from './stored'
import { waited } from './timing'

const STORAGE_KEY = 'nib:session'

/** Where a sign-in is. `second` is the step an account with a second factor
 *  stands on between the emailed code and the one out of an authenticator app;
 *  see services/sync/src/second.ts. */
export type Step = 'email' | 'code' | 'second'

/** A second place to keep the token, for a host whose storage does not outlive a
 *  launch. The Even plugin registers one; nothing else has one, and the plain web
 *  build never loads the code that would. See `everywhere` in lib/even/keep.ts. */
export interface Vault {
  read(): Promise<string | null>
  write(token: string): Promise<void>
  clear(): Promise<void>
}

/** How long to keep trying to reach the account before leaving it for the next
 *  launch, and the waits between tries.
 *
 *  A cold start can begin before the network does, which on a phone is the usual
 *  case rather than the odd one. Three tries over about four seconds is the
 *  difference between a session that settles a moment late and a session the
 *  reader has to type an emailed code to get back. */
const TRIES = [400, 1200, 2500]

/** The statuses that mean the token itself is finished. Anything else is about
 *  the journey, not the credential. */
function rejected(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403)
}

class Session {
  token = $state<string | null>(null)
  user = $state<Account | null>(null)
  /** Whoever a share link let in, when that is what the session is. A guest has
   *  no account: it reaches the spaces its links granted and nothing else, so
   *  everything account-wide asks for `user` rather than for a session. */
  guest = $state<Guest | null>(null)
  spaces = $state<RemoteSpace[]>([])
  /** Ids the account says were deleted, so a machine that was away can tell
   *  that apart from a space it has simply not uploaded yet. */
  deletedSpaces = $state<string[]>([])

  /** Sign-in dialog state. One surface serves both signing in and signing up. */
  #open = $state(false)
  /** Which door the sheet was opened through, as Obsidian's first launch offers
   *  both: only its heading differs. Reset on close. */
  mode = $state<'sign-in' | 'create'>('sign-in')

  get open(): boolean {
    return this.#open
  }

  set open(value: boolean) {
    this.#open = value
    if (!value) this.mode = 'sign-in'
  }

  /** Opens the sheet for one of the two; see `mode`. */
  ask(mode: 'sign-in' | 'create') {
    this.mode = mode
    this.#open = true
  }
  step = $state<Step>('email')
  email = $state('')
  error = $state<string | null>(null)
  busy = $state(false)
  resendIn = $state(0)

  /** Half a sign-in, for an account that asks for a second code: what the
   *  emailed code answered with, which the second one is sent back with. Not a
   *  session and never kept - a sign-in nobody finishes is a sign-in that did
   *  not happen. */
  private holding: string | null = null

  /** Raised while a fresh sign-in waits for the question about the notes
   *  already on this machine. Syncing holds off until it is answered: a pass
   *  that ran meanwhile would upload the very notes about to be erased, and
   *  adopt the account's spaces into the list that erasing then deletes. */
  settling = $state(false)

  /** True while the stores are still being asked whether there is a session.
   *
   *  On a phone the answer takes as long as the phone app takes to put its
   *  channel on the page, which is seconds. Signed out is not the same as not
   *  known yet, and offering somebody a sign-in form during those seconds is how
   *  a session that was there all along gets typed in again. */
  restoring = $state(false)

  /** Whether there is a session at all, of either kind. What the panel's foot,
   *  the syncing and the rooms ask: a guest's spaces come down the same way. */
  readonly signedIn = $derived(!!this.token && (!!this.user || !!this.guest))
  /** The session token when it belongs to an account rather than to a guest.
   *  What everything account-wide asks for - the settings, the storage, Recently
   *  deleted, the connector, publishing - because a guest has none of those and
   *  a request the service would refuse is not one worth making. */
  readonly accountToken = $derived(this.user ? this.token : null)
  /** What to call whoever is at this device: the name on the account, else the
   *  part of their address in front of the at sign, else the name a guest was
   *  given by their device. Null while there is nobody to name. */
  readonly name = $derived(this.user ? called(this.user) : (this.guest?.name ?? null))
  /** When syncing may run: signed in, and not waiting on that question. */
  readonly syncable = $derived(this.signedIn && !this.settling)

  /** A second store, for a host whose own does not last. Handed over before the
   *  app is mounted, so `restore` below already has it. */
  private vault: Vault | null = null

  alsoKeepIn(vault: Vault) {
    this.vault = vault
  }

  /** What else has to be let go of when the session is.
   *
   *  Nothing read for one account describes the next, and some of it is a secret:
   *  the connector's freshly minted token is a bearer credential handed out once.
   *  Registered from below rather than reached for from here, because everything
   *  holding such a thing already reads this store and an import the other way
   *  would be a circle. */
  private readonly alsoForget = new Set<() => void>()

  forgetWithSession(clear: () => void) {
    this.alsoForget.add(clear)
  }

  async restore() {
    this.restoring = true
    try {
      await this.lookForSession()
    } finally {
      this.restoring = false
    }
  }

  private async lookForSession() {
    // Every store, together, rather than the page's own first: the page's own is
    // the one a packed plugin loses, so preferring it means preferring the empty
    // answer. The vault reads all of them and answers with whichever kept it.
    const saved = (await this.vault?.read()) ?? storedText(STORAGE_KEY)
    if (!saved) return

    // Read back out of the other store: the page's own is what everything else
    // here writes, so putting it back keeps the two saying the same thing.
    keep(STORAGE_KEY, saved)
    this.token = saved

    for (const [attempt, pause] of [0, ...TRIES].entries()) {
      if (pause) await waited(pause)

      try {
        // Either kind of session answers here, and which one it is decides what
        // the app offers: a guest is somebody in a space, not an account.
        const who = await api.me(saved)
        this.user = who.user ?? null
        this.guest = who.guest ?? null
        break
      } catch (error) {
        // Only the account saying so signs anybody out. A request that never
        // arrived says nothing about the token, and throwing one away because
        // the radio was not ready yet costs a reader their session for the
        // sake of a second.
        if (rejected(error)) {
          this.forget()
          return
        }

        if (attempt === TRIES.length) return
      }
    }

    // The same reasoning as signing in: the spaces are wanted, and failing to
    // list them is not a failed session. This used to share the catch above,
    // which turned one unreachable listing into a sign-out.
    await this.loadSpaces().catch(() => undefined)
  }

  async requestCode() {
    const address = this.email.trim()
    // One at a time: Enter in the address field submits the form whatever the
    // button is doing, and the service invalidates the first code when it writes
    // the second - which is the one already in the reader's hand.
    if (!address || this.busy) return

    this.busy = true
    this.error = null

    try {
      const { resendIn } = await api.requestCode(address)
      this.step = 'code'
      this.startResendTimer(resendIn)
    } catch (error) {
      this.error = error instanceof ApiError ? error.message : 'could not reach the server'
    } finally {
      this.busy = false
    }
  }

  /** Six digits from the row of boxes, on whichever half of the sign-in it is.
   *
   *  One row serves both halves - the code that was emailed, and then the code an
   *  authenticator app is showing - because six digits are six digits and a second
   *  row of boxes would say otherwise. Which half they are is this store's own
   *  business rather than the sheet's, and it was the sheet's: it always asked
   *  `verify`, so an account with a second factor could not be signed in on a new
   *  device at all. See SignIn.svelte and account.test.ts. */
  async code(digits: string): Promise<boolean> {
    return this.step === 'second' ? this.second(digits) : this.verify(digits)
  }

  /** Resolves true when the code was accepted, so the caller can reset the form. */
  async verify(code: string): Promise<boolean> {
    this.busy = true
    this.error = null

    // What this device was as a guest, handed over so that whatever a link let
    // it into follows it into the account; see services/sync/src/guests.ts.
    const held = this.guest ? this.token : null

    let session
    try {
      session = await api.verifyCode(this.email.trim(), code, held ?? undefined)
    } catch (error) {
      this.error = error instanceof ApiError ? error.message : 'could not reach the server'
      return false
    } finally {
      this.busy = false
    }

    // An account with a second factor is not signed in yet: what came back is
    // half a sign-in, and the code out of the app finishes it.
    if (session.second && session.holding) {
      this.askForSecond(session.holding)
      return false
    }

    const { token, user } = session
    if (!token || !user) {
      this.error = 'that code is not right'
      return false
    }

    await this.settleIn(token, user)
    return true
  }

  /** Half a sign-in: the sheet asks for the code out of the app. */
  askForSecond(holding: string) {
    this.holding = holding
    this.error = null
    this.step = 'second'
    this.open = true
  }

  /** Everything about a session that has just been established, whichever of the
   *  two ways established it: one code, or a code and then a second one. */
  private async settleIn(token: string, user: Account): Promise<void> {
    this.guest = null
    keep(STORAGE_KEY, token)
    // Nothing waits on the other store: the session is already in hand, and a
    // host that cannot be told is a host that will ask again next launch.
    void this.vault?.write(token).catch(() => undefined)
    this.stopResendTimer()

    // Before the session exists, so whatever starts syncing on sign-in finds
    // the wait already in place.
    this.settling = true
    this.token = token
    this.user = user
    this.open = false
    this.step = 'email'
    this.email = ''

    // The sheet has closed and the account's own writing is not here yet, so from
    // here until the first pass lands the surface says so. Raised before the
    // listing below rather than after it: on a slow connection that request is
    // itself seconds of a screen that would otherwise be saying nothing. The
    // loop takes it down again the moment it turns out nothing is coming; see
    // arriving.svelte.ts and sync.svelte.ts.
    arriving.begin()

    // The spaces are wanted for the question that follows, but failing to
    // fetch them is not a failed sign-in. Letting it read as one would answer
    // false to the caller, which skips the question about the notes already
    // here - and syncing would then start and upload them unasked.
    await this.loadSpaces().catch(() => undefined)
  }

  /** The other half of a sign-in that asks for two: the code out of the app, or
   *  one of the recovery codes. Answers whether it was accepted, the way `verify`
   *  does, so the form knows whether to clear itself. */
  async second(code: string): Promise<boolean> {
    if (!this.holding) return false

    this.busy = true
    this.error = null

    let session
    try {
      session = await api.verifySecond(this.holding, code)
    } catch (error) {
      this.error = error instanceof ApiError ? error.message : 'could not reach the server'
      return false
    } finally {
      this.busy = false
    }

    this.holding = null
    await this.settleIn(session.token, session.user)
    return true
  }

  /** A session a link established rather than a code: an invitation that proved
   *  its own address, or a guest the space's own link handed out. Everything the
   *  sign-in does about a new session happens here too, so a link and a code
   *  leave the app in the same state.
   *
   *  A guest is not asked what should become of the notes already here. There is
   *  no account for them to join and nothing to erase: what a link lent them is
   *  a space beside their own writing. */
  async arrive(token: string, who: { user?: Account; guest?: Guest }) {
    this.stopResendTimer()
    keep(STORAGE_KEY, token)
    void this.vault?.write(token).catch(() => undefined)

    if (who.user) this.settling = true
    this.token = token
    this.user = who.user ?? null
    this.guest = who.guest ?? null
    this.open = false
    this.step = 'email'
    this.email = ''

    arriving.begin()
    await this.loadSpaces().catch(() => undefined)
  }

  /** The notes already on this machine have been dealt with, one way or the
   *  other. Syncing has been waiting on this. */
  settled() {
    this.settling = false
  }

  async signOut() {
    const token = this.token
    this.forget()
    if (token) await api.signOut(token).catch(() => undefined)
  }

  /** What to call whoever is here: the name on anything the account publishes,
   *  or the one over a guest's caret. Throws on refusal, so whatever is asking
   *  can say why. */
  async rename(name: string) {
    if (!this.token) return

    const who = await api.rename(this.token, name)
    if (who.user) this.user = who.user
    if (who.guest) this.guest = who.guest
  }

  async loadSpaces() {
    if (!this.token) return
    const listed = await api.listSpaces(this.token)
    this.spaces = listed.spaces
    this.deletedSpaces = listed.deleted

    // And the files other people shared on their own, which belong to no space
    // and so are not in that listing. On the same beat, because it is the same
    // question - what can this account open - and a file that was shared or taken
    // back should show up or stop showing up when a space would have.
    //
    // Imported here rather than at the top: the sharing store reads the account,
    // and the two would import each other. See docs/sharing.md.
    const { sharedWithYou } = await import('./sharing.svelte')
    await sharedWithYou.load()
  }

  private forget() {
    arriving.reset()
    forget(STORAGE_KEY)
    void this.vault?.clear().catch(() => undefined)
    this.stopResendTimer()
    this.token = null
    this.user = null
    this.guest = null
    // Half a sign-in is a sign-in that did not happen, which is what the field
    // says of itself: it was let go of when one finished and held onto for the
    // life of the app when somebody walked away from one.
    this.holding = null
    this.settling = false
    this.spaces = []
    this.deletedSpaces = []
    for (const clear of this.alsoForget) clear()
  }

  private resendTimer: ReturnType<typeof setInterval> | undefined

  /** Counts down to when another code may be asked for. One timer at a time:
   *  asking again used to start a second one beside the first, and the two
   *  together took a second off the count twice a second. */
  private startResendTimer(seconds: number) {
    this.stopResendTimer()
    this.resendIn = seconds

    this.resendTimer = setInterval(() => {
      this.resendIn -= 1
      if (this.resendIn <= 0) this.stopResendTimer()
    }, 1000)
  }

  private stopResendTimer() {
    clearInterval(this.resendTimer)
    this.resendTimer = undefined
  }
}

export const account = new Session()
