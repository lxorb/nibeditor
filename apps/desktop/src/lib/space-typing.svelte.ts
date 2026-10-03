/** What has been typed into an open list of spaces, and the wait a number may be in.
 *
 *  No field holds it: the letters show in the rows as the hits they are, and Backspace
 *  takes one back. One of these per open list, the title bar's and the one in the
 *  middle of the window alike, so a key does the same in both. What a key means is
 *  space-pick.ts; this is the part with a clock. */

import { chorded } from './keys'
import { read, type Reading, typedBy, typedOn, WAIT } from './space-pick'
import { type Space, workspace } from './workspace.svelte'

const names = () => workspace.spaces.map((space) => space.name)

export class SpaceTyping {
  typed = $state('')
  readonly reading: Reading = $derived(read(this.typed, names()))

  private waiting: ReturnType<typeof setTimeout> | undefined

  /** `go` switches to a space, and puts the list away. */
  constructor(private readonly go: (space: Space) => void) {}

  /** A key pressed in the list, ahead of the list's own keys so a letter finds a name
   *  rather than a row that starts with it; spent when it was the list's, since the
   *  app reads its own keys off the window. */
  readonly press = (event: KeyboardEvent): void => {
    if (!this.key(event)) return
    event.preventDefault()
    event.stopPropagation()
  }

  /** True when the key was this list's to spend. */
  private key(event: KeyboardEvent): boolean {
    if (chorded(event) || event.isComposing) return false

    if (event.key === 'Backspace') {
      if (!this.typed) return false
      this.set(this.typed.slice(0, -1))
      return true
    }

    // A number still waiting for a second digit goes now. Anything else Enter does
    // is the row's own, which the keyboard already stands on.
    if (event.key === 'Enter') {
      if (!this.reading.waits) return false
      this.went(this.reading.best)
      return true
    }

    const character = typedBy(event.key, event.code, this.typed)
    if (character === null) return false
    // A space with nothing typed is the list's own key, which opens the row it is on.
    if (character === ' ' && !this.typed) return false

    const next = typedOn(this.typed, character, names())
    // Refused, and spent: nothing in the list may answer a letter that matched nothing.
    if (next !== null) this.set(next)
    return true
  }

  /** Nothing waiting any more: the list is going. */
  stop(): void {
    clearTimeout(this.waiting)
  }

  private set(typed: string) {
    this.stop()
    this.typed = typed

    const { go, waits, best } = this.reading
    if (go !== null) this.went(go)
    else if (waits) this.waiting = setTimeout(() => this.went(best), WAIT)
  }

  private went(at: number) {
    this.stop()
    const space = workspace.spaces[at]
    if (space) this.go(space)
  }
}
