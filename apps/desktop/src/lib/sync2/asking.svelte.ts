/** The one question sync v2 asks, and when it is asked.
 *
 *  Two devices rewrote the same passage of a note while apart, and the engine held the
 *  note rather than guess (docs/sync-v2.md section 5.4). Everything the reader sees of
 *  that is this store and the three pieces it opens: the sheet (Diverged.svelte), the
 *  mark on a held note's row and tab (HeldMark.svelte), and the Sync pane's list.
 *
 *  **When it asks** is the part with rules, and they are the whole of why this is a
 *  store rather than a flag on the sheet (open question 6):
 *
 *  - only about the note in the active tab, and only while nothing else is over it (a
 *    menu, another sheet, a phone's drawer), so it is never over a note somebody is
 *    reading and never under another question;
 *  - only once the typing has paused, so it does not come up under a hand that is
 *    still writing and take the next Enter for an answer;
 *  - one at a time, which the first rule gives for nothing: there is one active tab;
 *  - closed without an answer, it stays closed while that note stays on screen and asks
 *    again the next time it comes on screen, or at once from the Sync pane.
 *
 *  The engine is not imported: it hands itself over with `connect`, once it has
 *  started, and takes itself back with what that returns. So nothing here is fetched
 *  until a v2 engine runs, and the v1 app never carries any of it. */

import { mount, untrack } from 'svelte'
import type { Excerpt } from '@nib/sync-core/diverge'
import { message, t } from '../i18n.svelte'
import { howFor } from '../new-tab'
import { overlays } from '../overlays'
import { settings } from '../settings.svelte'
import { heldMark, undoToastNotice } from '../surfaces.svelte'
import { afterQuiet } from '../timing'
import { workspace } from '../workspace.svelte'
import type { LogRow, SyncStore } from './store'

// ---------------------------------------------------------------------------
// What the engine hands over (docs/sync-v2.md section 13.1)

/** One of the two versions of a held note. */
export interface Side {
  /** The device, by the name the account knows it under. */
  device: string
  /** When this side last wrote in the note, in milliseconds. */
  at: number
  /** The first contested passage as it reads on this side; `excerpt` in
   *  @nib/sync-core/diverge. */
  excerpt: Excerpt
  /** A canvas or a page note: the contested cards as this side has them, as JSON
   *  Canvas text, drawn instead of the excerpt. */
  plane?: string
  /** A file that is not a note: what stands in for words. `picture` is an address an
   *  image can be drawn from, for a picture. */
  file?: { name: string; size: number; picture: string | null }
}

/** A note the engine is holding for the question. */
export interface Held {
  id: string
  /** Where the note is on this disk, as the workspace names it. */
  path: string
  /** The note's name, as its row shows it. */
  name: string
  mine: Side
  theirs: Side
}

/** Keep this device's version, the other device's, or both. */
export type HeldAnswer = 'mine' | 'theirs' | 'both'

export interface HeldNotes {
  readonly notes: readonly Held[]
  /** Carries an answer out (section 5.4, "The three answers"). Keep both answers with
   *  the path of the copy it made, so the copy can be opened beside the note. */
  answer(id: string, answer: HeldAnswer): Promise<string | undefined>
}

/** A note this device deleted that another device was writing in, back where it was. */
export interface Resurrected {
  id: string
  name: string
  device: string
}

export interface EngineEvents {
  resurrected: Resurrected
  /** A pass wrote a row to the store's log. */
  pass: LogRow
}

/** The v2 engine, as the notes' side of the interface sees it. */
export interface Engine {
  held: HeldNotes
  /** Its store, which the Sync pane reads the pass log from. */
  store: Pick<SyncStore, 'read'>
  on<T extends keyof EngineEvents>(type: T, listener: (event: EngineEvents[T]) => void): () => void
}

// ---------------------------------------------------------------------------

/** How long the keys have to have been still before the question comes up over a note:
 *  longer than the gap between two words, shorter than a reader's glance away. */
export const QUIET = 1500

class Asking {
  /** The engine while v2 runs, and null under v1. What the Sync pane asks. */
  engine = $state.raw<Engine | null>(null)

  /** What is being carried out, while it is: the sheet's buttons wait for it. */
  answering = $state<HeldAnswer | null>(null)
  /** Why the last answer did not go through, said in the sheet that is still up. */
  wrong = $state<string | null>(null)

  /** Which note the sheet is up for. Only ever set by `looked`, which decides. */
  private open = $state<string | null>(null)
  /** Nothing else is over the note. */
  private clear = $state(true)
  /** The keys have been still for `QUIET`. */
  private quiet = $state(true)
  /** Moved to make the decision be taken again, after a press in the Sync pane. */
  private again = $state(0)

  /** The note the reader closed the sheet on while it stayed on screen. A plain field:
   *  it is read and written only inside the decision, never followed. */
  private shut: string | null = null

  readonly held: readonly Held[] = $derived(this.engine?.held.notes ?? [])

  private readonly paths = $derived(new Set(this.held.map((note) => note.path)))

  /** The held note in the active tab, if there is one. */
  private readonly here = $derived(
    this.held.find((note) => note.path === workspace.active?.path) ?? null,
  )

  /** What the sheet asks about now, or null while it is down. */
  readonly asked: Held | null = $derived(this.here?.id === this.open ? this.here : null)

  /** Whether the note at `path` is waiting for an answer. */
  isHeld(path: string | null): boolean {
    return path !== null && this.paths.has(path)
  }

  /** Takes the engine on, and answers how to let go of it. */
  connect(engine: Engine): () => void {
    this.engine = engine
    // A pause cut short by an engine let go of is no reason to wait for the next one.
    this.quiet = true

    const typing = afterQuiet(() => (this.quiet = true), QUIET)
    const typed = () => {
      if (this.quiet) this.quiet = false
      typing()
    }
    window.addEventListener('keydown', typed, true)
    this.clear = overlays.depth === 0
    const watching = overlays.watch(() => (this.clear = overlays.depth === 0))
    const heard = engine.on('resurrected', (event) => void resurrected(event))

    const watched = $effect.root(() => {
      // The sheet and the mark are fetched the first time anything is held.
      $effect(() => {
        if (this.held.length) untrack(() => void Promise.all([sheet(), heldMark.ask()]))
      })

      let was: string | null = null
      let asked = 0
      $effect(() => {
        const id = this.here?.id ?? null
        const ready = this.clear && this.quiet
        const again = this.again
        untrack(() => {
          this.looked(id, id !== was || again !== asked, ready)
          was = id
          asked = again
        })
      })
    })

    return () => {
      watched()
      heard()
      watching()
      typing.cancel()
      window.removeEventListener('keydown', typed, true)
      this.engine = null
      this.open = null
      this.shut = null
    }
  }

  /** The decision, taken whenever the held note on screen, what is over it or the
   *  keys change. `fresh` is a note that has just come on screen, or one the Sync pane
   *  asked for again, which is what lets a note closed without an answer ask again. */
  private looked(id: string | null, fresh: boolean, ready: boolean) {
    if (fresh) {
      this.shut = null
      this.open = null
      this.wrong = null
    }
    if (id !== null && ready && this.open === null && this.shut !== id) this.open = id
  }

  /** Escape, the scrim, back or the cross: nothing changes, and the note asks again
   *  the next time it comes on screen. */
  dismiss() {
    this.shut = this.open
    this.open = null
    this.wrong = null
  }

  /** A press on a held note in the Sync pane: the note, and the question over it as
   *  soon as the settings have gone. */
  async revisit(note: Held) {
    this.again++
    settings.open = false
    await workspace.open(note.path)
  }

  /** Carries an answer out. The sheet stays up, saying why, if it does not go
   *  through; the note is still held, so nothing was lost. */
  async answer(note: Held, answer: HeldAnswer) {
    const engine = this.engine
    if (!engine || this.answering) return

    this.answering = answer
    this.wrong = null
    try {
      const copy = await engine.held.answer(note.id, answer)
      this.shut = note.id
      if (this.open === note.id) this.open = null
      // Beside the note and behind it, as a Ctrl+click opens a tab: the note
      // stays in front with what the account had, and the copy is one tab away.
      if (answer === 'both' && copy) await workspace.openRow(copy, howFor('behind'))
    } catch (error) {
      this.wrong = message(error, t('That did not work.'))
    } finally {
      this.answering = null
    }
  }
}

/** The sheet, mounted into the page the first time a note is held and kept there, so
 *  its way out can play: the theme picker's door (theme-picker/picking.svelte.ts), which
 *  costs the first paint nothing. Never the plugin's, which stays on v1. */
let mounted: Promise<void> | null = null

function sheet(): Promise<void> {
  if (__EVEN_PLUGIN__) return Promise.resolve()
  return (mounted ??= import('./Diverged.svelte').then(({ default: Diverged }) => {
    mount(Diverged, { target: document.body })
  }))
}

/** The toast for a note that came back, fetched with the first one. The toast's own
 *  component is in the notices row already, so asking for it is a formality. */
async function resurrected(event: Resurrected) {
  await undoToastNotice.ask()
  const { back } = await import('./resurrected.svelte')
  back.show(event)
}

export const asking = new Asking()
