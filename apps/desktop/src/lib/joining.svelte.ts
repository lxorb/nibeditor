/** Following a link into a space somebody shared.
 *
 *  If somebody shares something with you, you should not have to sign in to see
 *  it. So the link is the proof, and what it takes to open one is opening it:
 *
 *  A **mailed invitation** was written to an address and sent to it, so holding
 *  the mail is holding the address. Following the link establishes the session
 *  for it and lands in the space, and nothing is shown or asked at all.
 *
 *  An **open link** names nobody. It hands out a guest instead: a session with a
 *  name taken from this device, in that one space, at that one role. Also
 *  nothing shown, also nothing asked.
 *
 *  A link that **asks first** asks one field, because the owner has to have
 *  something to accept. Then a calm page, which turns into the space when they
 *  accept and says so when they do not.
 *
 *  A link that has been used or has run out shows one line, and the emailed code
 *  is still there behind it.
 *
 *  The link is read out of the address bar, so it works in the web app on any
 *  machine and on a phone. The desktop app registers no URL scheme, so a link
 *  opened there opens the web app instead; see docs/collaboration.md. */

import { api, ApiError, type Invitation, type Joined } from './api'
import { account } from './account.svelte'
import { message, t } from './i18n.svelte'
import { deviceName } from './rooms/who'
import { settleLocalNotes } from './settling'
import { sharedWithYou } from './sharing.svelte'
import { forget, keep, storedText } from './stored'
import { sync } from './sync.svelte'
import { workspace } from './workspace.svelte'

/** What the mail's link looks like. The token is hexadecimal and long; the
 *  bound is here so that nothing else in the address bar is mistaken for one. */
const PATH = /^\/join\/([a-f0-9]{16,128})$/

/** The link somebody is waiting on, kept so that reloading the page while the
 *  owner thinks about it goes back to waiting rather than to nothing. The token
 *  is taken out of the address bar the moment it is read, and this is where it
 *  goes instead. */
const WAITING_KEY = 'nib:waiting'

/** How often to ask whether the owner has answered. Slow enough to be nothing
 *  on either end, quick enough that being let in feels like being let in. */
const ASK_EVERY = 3000

/** What the join page is showing. Null for every link that needs no page at
 *  all, which is every link but one that asks and one that has run out. */
export type Step = 'asking' | 'waiting' | 'declined' | 'gone'

/** Whether what somebody typed into the one field is an address or a name. Both
 *  are offered because both answer the owner's question; an address is worth
 *  telling apart because it is also what later turns the guest into an account. */
function said(text: string): { name: string } | { email: string } {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text) ? { email: text } : { name: text }
}

/** Whether the service itself refused the link, rather than the request never
 *  getting there.
 *
 *  A link that has been used or has run out is answered with a status. A dropped
 *  connection, or a server having a bad minute, says nothing about the link - and
 *  reading either as a link that is finished ends a wait three seconds before the
 *  owner presses Accept. The same distinction the session makes when it comes
 *  back on a machine whose network has not; see account.svelte.ts. */
function refused(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500
}

class Joining {
  /** What the link is about, so the page can say who shared what. */
  invitation = $state<Invitation | null>(null)
  step = $state<Step | null>(null)
  /** The one field a link that asks first asks for: a name, or an address. */
  told = $state('')
  busy = $state(false)
  /** What went wrong, in the app's own voice, under the line. */
  error = $state<string | null>(null)

  private token: string | null = null
  private asking: ReturnType<typeof setInterval> | undefined

  /** Reads the address bar, once, as the app starts. The token is taken out of
   *  the address straight away: a link is followed once, and one left in the
   *  address is one that ends up in a bookmark and in the history. */
  async start() {
    const found = PATH.exec(window.location.pathname)
    if (!found?.[1]) return this.resume()

    this.token = found[1]
    window.history.replaceState(null, '', '/')

    this.invitation = await api.invitation(this.token).catch(() => null)
    if (!this.invitation) {
      this.ranOut()
      return
    }

    // The one link that asks for anything. An account that is already signed in
    // is not asked either: the request carries the address it proved.
    if (this.invitation.asks && !account.signedIn) {
      this.step = 'asking'
      return
    }

    await this.walkThrough()
  }

  /** Somebody who was waiting when the page was closed. Their guest session came
   *  back with the rest of the launch, so the only thing missing is the link,
   *  and asking again is how anybody finds out they were let in. */
  private async resume() {
    const held = storedText(WAITING_KEY)
    if (!held || !PATH.test(`/join/${held}`) || !account.signedIn) return

    this.token = held
    this.invitation = await api.invitation(held).catch(() => null)
    await this.walkThrough()
  }

  /** The field is filled in and the button pressed. */
  async tell() {
    if (!this.told.trim()) return
    await this.walkThrough()
  }

  /** Walking through the link, which is also how somebody waiting asks again:
   *  the answer to "let me in" and the answer to "am I in yet" are the same
   *  answer, so there is one request here and not two. */
  async walkThrough() {
    const token = this.token
    // One ask at a time: the timer behind the wait and the button both reach
    // here, and two in flight together would be two sessions handed out with the
    // second answer applied over the first.
    if (!token || this.busy) return

    this.busy = true
    this.error = null

    let joined: Joined
    try {
      joined = await api.join(token, {
        ...(account.token ? { token: account.token } : {}),
        // What to call the guest a link hands out, if it hands one out. The same
        // answer the carets give for this device, because it is the same
        // question: which of these is which.
        device: deviceName('Browser'),
        ...(this.told.trim() ? said(this.told.trim()) : {}),
      })
    } catch (error) {
      this.error = message(error, t('Ask for another one.'))
      // A wait survives anything but a refusal. The owner may be about to
      // answer, the next ask is three seconds away, and the link is still
      // written down for the launch after this one.
      if (this.step === 'waiting' && !refused(error)) return

      this.stopAsking()
      this.step = 'gone'
      return
    } finally {
      this.busy = false
    }

    await this.landed(joined)
  }

  /** What came back. One of four things: a session and a space, a session and a
   *  wait, a refusal, or - for a link followed by an account that was already
   *  signed in - the space on its own. */
  private async landed(joined: Joined) {
    // Half a sign-in: once the second code is in, SignIn.svelte walks this link again.
    if (joined.second && joined.holding) {
      account.askForSecond(joined.holding)
      return
    }

    // A session the link established, which is the whole of what a link is for.
    if (joined.token) await account.arrive(joined.token, joined)
    else if (joined.guest) account.guest = joined.guest

    // A link that opened an account meets whatever this machine already holds,
    // the same question the emailed code asks and before the space arrives: the
    // answer to it can be to erase what is here. A guest is not asked.
    if (joined.user) await settleLocalNotes()

    if (joined.waiting) {
      this.wait()
      return
    }

    if (joined.declined) {
      this.stopAsking()
      this.step = 'declined'
      return
    }

    // A link to one file rather than to a space. There is no folder to make and
    // nothing to bring down: the file goes into the switcher's Shared-with-you
    // section and opens in a tab whose words travel through its room. See
    // sharing.svelte.ts and docs/sharing.md.
    if (joined.item) {
      this.arrived()
      await sharedWithYou.load()
      await sharedWithYou.open(joined.item)
      return
    }

    const space = joined.space
    if (!space) return

    this.arrived()

    // The space is theirs to reach now. One pass makes the folder, brings the
    // notes down, and leaves the switcher holding it.
    await account.loadSpaces().catch(() => undefined)
    await sync.pass()

    const here = workspace.spaces.find((one) => sync.remoteIdFor(one.root) === space.id)
    if (here) await workspace.showSpace(here.id)
  }

  /** In, whatever was shared: the page goes and the link is spent. Both ways in
   *  end here, so neither can forget half of it. */
  private arrived() {
    this.stopAsking()
    this.step = null
    this.token = null
    this.invitation = null
  }

  /** The calm page, and the asking behind it. */
  private wait() {
    this.step = 'waiting'
    if (this.token) keep(WAITING_KEY, this.token)
    if (this.asking) return

    this.asking = setInterval(() => void this.walkThrough(), ASK_EVERY)
  }

  private stopAsking() {
    clearInterval(this.asking)
    this.asking = undefined
    forget(WAITING_KEY)
  }

  /** A link that has been used, or has run out, or was never one. One line, and
   *  the code is still there behind it. */
  private ranOut() {
    this.token = null
    this.step = 'gone'
  }

  /** The line is read, and the app underneath it is what is left. */
  dismiss() {
    this.stopAsking()
    this.step = null
    this.token = null
    this.invitation = null
    this.error = null
    this.told = ''
  }
}

export const joining = new Joining()
