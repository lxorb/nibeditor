import { keep, storedText } from './stored'
import { isDesktop } from './tauri'
import {
  announcedVersion,
  asChannel,
  type Channel,
  discard,
  managedBy,
  stageUpdate,
  stagedVersion,
} from './updater'

/** How often the app looks for a new version while it is running.
 *
 *  A few hours. A release is not news that has to arrive within a minute, and
 *  what is found installs itself on the way out whether or not anybody presses
 *  the notice, so looking more often would only be traffic. Looking less often
 *  than this is how a machine that is never restarted ends up months behind. */
const EVERY = 6 * 60 * 60 * 1000

/** How often the timer wakes to ask whether it is time yet.
 *
 *  Short, and it asks the clock rather than trusting itself: a lid closed at
 *  lunch stops the timers and does not make up the difference, so one long timer
 *  would fire late and only once. This wakes, reads the clock, and catches up. */
const TICK = 10 * 60 * 1000

/** Which channel this machine follows, written here rather than sent up to the
 *  account: one machine can run the unstable build while another stays on the
 *  releases, which is the whole point of the choice. */
const CHANNEL_KEY = 'nib:channel'

/** The choice, written down. It holds for this run whichever way that goes; a
 *  machine that cannot keep it follows the releases again after a restart. */
function keepChannel(channel: Channel) {
  keep(CHANNEL_KEY, channel)
}

/** The last version an install a package manager keeps was told of, so it is told once
 *  and not on every launch after: the notice there is news, with nothing to press. */
const TOLD_KEY = 'nib:update-told'

/** How long since the last keystroke before the notice may appear. A box that
 *  arrives between two words is a box in the way; the update is in no hurry, so
 *  it waits for the end of the sentence. */
const QUIET = 5000

/** When the app looks for a new version, which stream it looks on, and the notice
 *  that offers what a look found.
 *
 *  Nothing here installs anything: `updater.ts` downloads in the background and
 *  puts the new version in place as the app closes, so the update arrives on
 *  its own. This is only the offer to get there sooner, and dismissing it costs
 *  nothing - what was downloaded is still installed on the way out.
 *
 *  Except where a package manager keeps the install, which is the manager's to
 *  update: there the notice only says a newer version is out, once per version.
 *
 *  Later holds against the looks nobody asked for, and only those. Asking by name
 *  is somebody wanting the answer, so it shows the notice for what is waiting
 *  whatever was pressed before, as VS Code, Chrome's About page and Obsidian do. */
class Updates {
  /** The version waiting to be installed, once one has been downloaded. Null
   *  when there is nothing new, which is most of the time. */
  ready = $state<string | null>(null)

  /** Whether a package manager keeps this install, so the notice only says what is
   *  out; see updater.ts. */
  managed = $state(false)

  /** Which stream of releases this machine follows; see updater.ts. Stable, until
   *  somebody asks for the other one on this machine. */
  /** What was chosen here last, or the stable channel for a machine that has
   *  never chosen - which is also what a machine that cannot remember follows. */
  // A prerelease build is already on the unstable stream. This also covers
  // edge packages installed outside the app's own updater, regardless of the
  // package manager that delivered them or a stale saved channel preference.
  channel = $state<Channel>(
    __APP_VERSION__.includes('-') ? 'unstable' : asChannel(storedText(CHANNEL_KEY)),
  )

  /** When the last look happened, so that however often the timer and the window
   *  being come back to ask, nothing looks twice inside one interval. Zero before
   *  the first one. */
  private lookedAt = 0
  /** The look in flight and the stream it is on. A download takes long enough for
   *  the window to be left and come back to while one is running, or for somebody
   *  to ask from the menu. */
  private running: { stream: number; done: Promise<void> } | null = null
  /** Which channel the looks belong to, counted up whenever it changes. A look
   *  takes as long as a download, so one can be in flight when the channel is
   *  changed, and what it comes back with is a build from the stream that was
   *  left. */
  private stream = 0
  /** When the last key went down, for the notice that waits for a pause. */
  private typedAt = 0
  private waiting: ReturnType<typeof setTimeout> | undefined

  /** Looks now, and goes on looking for as long as the app runs: on a timer
   *  every few hours, and again whenever the window is come back to after that
   *  long away. Answers the teardown for both.
   *
   *  Desktop only, because that is the only build that installs anything: a page
   *  is the new version the moment it is reloaded, and a phone app is the store's
   *  business. Nothing at all runs on those, rather than a timer that would ask
   *  and always be told no. */
  start(): () => void {
    if (!isDesktop) return () => undefined

    // The launch's own look, which is not held to the interval: this session has
    // not looked yet.
    void this.look()

    const timer = setInterval(() => void this.lookIfDue(), TICK)
    const returned = () => void this.lookIfDue()
    const typed = () => (this.typedAt = Date.now())

    window.addEventListener('focus', returned)
    // Captured, so a keystroke the editor swallows still counts as typing.
    window.addEventListener('keydown', typed, true)

    return () => {
      clearInterval(timer)
      clearTimeout(this.waiting)
      window.removeEventListener('focus', returned)
      window.removeEventListener('keydown', typed, true)
    }
  }

  /** A look, if it has been long enough since the last one. What the timer and
   *  the window coming back both ask for: the two are one question, since a
   *  machine that was asleep is exactly the machine whose timer is behind. */
  private async lookIfDue() {
    if (Date.now() - this.lookedAt < EVERY) return
    await this.look()
  }

  /** Asked for by name, from the menu or the palette: a look, then the notice at
   *  once for whatever is waiting to be installed, found now or by an earlier look
   *  whose notice was put away with Later. At once rather than after a pause in
   *  the typing, because the Enter that chose it in the palette counts as typing.
   *
   *  Nothing waiting says nothing, as it always has. */
  async check() {
    await this.look()
    const waiting = stagedVersion() ?? announcedVersion()
    if (waiting) this.show(waiting)
  }

  /** One quiet look, whatever the clock says. What the launch does, what a change
   *  of channel does, and what the engine row asks for when it needs the update's
   *  version. What it finds is offered once the typing stops; a version it found
   *  before is not offered again, because the updater answers nothing for one it
   *  has already downloaded, and that is how Later holds.
   *
   *  A look already in flight on this stream is the answer, since a second would
   *  be told the same. One still downloading from a stream that was left is waited
   *  out first, so this one is made on the stream followed now.
   *
   *  A machine with no network simply has no update to offer: `stageUpdate`
   *  answers nothing for that as it does for a version already downloaded and
   *  for a release that does not exist, so there is nothing here to report. */
  look(): Promise<void> {
    const stream = this.stream
    const before = this.running
    if (before?.stream === stream) return before.done

    const made = before ? before.done.then(() => this.lookOn(stream)) : this.lookOn(stream)
    const done: Promise<void> = made.finally(() => {
      if (this.running?.done === done) this.running = null
    })
    this.running = { stream, done }
    return done
  }

  private async lookOn(stream: number) {
    // Changed again while this waited for the look before it; the look the
    // change asked for comes after this one.
    if (this.stream !== stream) return

    this.lookedAt = Date.now()
    const found = await stageUpdate(this.channel)
    // The channel changed while this was running, so what it fetched is a build
    // of the stream nobody is following any more.
    if (this.stream !== stream) {
      await discard()
      return
    }

    // A package manager's install is told of each version once, across launches.
    this.managed = (await managedBy()) !== null
    if (this.managed && storedText(TOLD_KEY) === found) return

    // Only ever set, never cleared: a second look answers nothing for the
    // version it downloaded on the first, and clearing the notice then would
    // take away the offer while the update sat there waiting.
    if (found) this.offer(found)
  }

  /** Follows the other stream from now on, and looks again straight away so that
   *  the choice answers instead of waiting hours for the next look.
   *
   *  Whatever was downloaded from the stream being left is thrown away rather than
   *  installed: an unstable build is not what somebody who has just asked for the
   *  releases wants started next time. Nothing is installed the other way round
   *  either - the updater only ever offers a higher version, so a machine on a
   *  unstable build that asks for the releases stays on it until a release passes
   *  it, while one on a release is offered the next push. */
  setChannel(channel: Channel) {
    if (channel === this.channel) return

    this.channel = channel
    keepChannel(channel)
    this.stream++
    this.dismiss()
    void discard().then(() => this.look())
  }

  /** Says so, once whoever is at the keyboard has stopped for a moment. */
  private offer(version: string) {
    const since = Date.now() - this.typedAt
    if (since >= QUIET) {
      this.show(version)
      return
    }

    clearTimeout(this.waiting)
    this.waiting = setTimeout(() => this.offer(version), QUIET - since)
  }

  private show(version: string) {
    clearTimeout(this.waiting)
    this.ready = version
    if (this.managed) keep(TOLD_KEY, version)
  }

  dismiss() {
    clearTimeout(this.waiting)
    this.ready = null
  }
}

export const updates = new Updates()
