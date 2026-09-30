/** A chunk that did not arrive, heard through Vite's `vite:preloadError`. The answer is
 *  reload-when.ts, or the notices row's Reload when that did not arrive either. */

/** A button held, heard from the launch on. */
const PRESSES = ['pointerdown', 'pointerup', 'pointercancel']

class Reloading {
  /** Whether the notices row offers Reload. */
  offered = $state(false)

  private asking = false
  private answered = false
  private unanswered = false

  private pressed = false
  private readonly holders = new Set<() => boolean>()

  /** What the page must not go from under while it answers true. */
  holds(busy: () => boolean): void {
    this.holders.add(busy)
  }

  /** `settled`: whether the disk has what it is owed. */
  watch(settled: () => Promise<boolean>): () => void {
    const missed = () => void this.missed(settled)
    const back = () => {
      if (this.unanswered) missed()
    }
    const press = (event: Event) => {
      this.pressed = event.type === 'pointerdown'
    }

    addEventListener('vite:preloadError', missed)
    addEventListener('online', back)
    for (const one of PRESSES) addEventListener(one, press, { capture: true, passive: true })

    return () => {
      removeEventListener('vite:preloadError', missed)
      removeEventListener('online', back)
      for (const one of PRESSES) removeEventListener(one, press, true)
    }
  }

  private async missed(settled: () => Promise<boolean>): Promise<void> {
    if (this.asking || this.answered) return
    this.asking = true

    try {
      const { answer } = await import('./reload-when')
      this.unanswered = !(await answer({
        held: () => this.pressed || [...this.holders].some((holding) => holding()),
        settled,
        offer: () => (this.offered = true),
      }))
      this.answered = !this.unanswered
    } catch {
      // The answer is a chunk too.
      this.answered = true
      this.offered = true
    } finally {
      this.asking = false
    }
  }
}

export const reloading = new Reloading()
