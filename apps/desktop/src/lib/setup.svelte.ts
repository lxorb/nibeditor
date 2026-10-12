/** The first run's optional questions, after the space chooser's required step; kept
 *  small because the window reads `armed` to keep the card up. See SpaceChooser.svelte. */

export const QUESTIONS = ['theme', 'developer', 'markdown'] as const
export type Question = (typeof QUESTIONS)[number]

class Setup {
  armed = $state(false)
  /** The question showing, or null for "all set". */
  at = $state<number | null>(null)

  get question(): Question | null {
    return this.at === null ? null : (QUESTIONS[this.at] ?? null)
  }

  arm() {
    this.armed = true
  }

  personalize() {
    this.at = 0
  }

  next() {
    const at = (this.at ?? -1) + 1
    if (at >= QUESTIONS.length) this.finish()
    else this.at = at
  }

  /** What was not answered keeps its default. */
  finish() {
    this.armed = false
    this.at = null
  }
}

export const setup = new Setup()
