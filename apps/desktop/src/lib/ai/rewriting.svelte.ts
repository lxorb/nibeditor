/** Rewriting what is selected, with a look at the change before it is kept.
 *
 *  One entry in the editor's menu and four verbs behind it, because a rewrite is a
 *  thing done to a paragraph you have already written and the four are what anybody
 *  ever asks: shorter, longer, the grammar fixed, or the same words in another
 *  language. See rewrite.ts for what each one sends.
 *
 *  Nothing is written into the note until it has been read. A model replacing a
 *  paragraph is the one AI gesture that can lose work, so the answer arrives beside
 *  the selection as a diff and the reader keeps it or throws it away. Undo would be
 *  the other answer, and it is not as good: by the time you have read what it did,
 *  the paragraph is gone from the screen.
 *
 *  The selection is held as two positions rather than read again at the end. The
 *  sheet is over the note and holds the focus, so nothing can be typed into it
 *  meanwhile, but the caret is still free to have been somewhere else by then - a
 *  click on the scrim, a note swapped in another pane - and what is replaced has to
 *  be the text the diff was about. */

import type { EditorView } from '@nib/editor'
import { i18n, message, t } from '../i18n.svelte'
import { complete, wasStopped } from './complete'
import { defaultLanguage, nameOfLanguage, rewriteMessages, type Verb } from './rewrite'
import { rewriteSheet } from '../surfaces.svelte'
import { ai } from './store.svelte'

class Rewriting {
  open = $state(false)
  /** Which verb is running or ran, or null while the four are still being offered. */
  verb = $state<Verb | null>(null)
  /** Which language `translate` translates into. */
  language = $state('en')
  /** What was selected, as it was when the sheet opened. */
  before = $state('')
  /** What came back, as it arrives. */
  after = $state('')
  running = $state(false)
  trouble = $state<string | null>(null)

  private view: EditorView | null = null
  /** Where the selection was when the sheet opened, which is what a kept rewrite
   *  replaces. */
  private place: { from: number; to: number } | null = null
  private stopper: AbortController | null = null

  /** Opens it on the selection. Nothing at all without one: the menu row is not
   *  offered then, and this is the same answer said twice. */
  /** Opens the sheet on what is selected, and asks for the sheet.
   *
   *  The knock is here rather than at the call site because this is the one way in;
   *  App.svelte mounts the sheet off that door rather than off `open`, so neither the
   *  sheet nor anything behind it is in front of the first paint. See
   *  surfaces.svelte.ts. */
  show(view: EditorView) {
    const range = view.state.selection.main
    if (range.empty || view.state.readOnly) return

    void rewriteSheet.ask()

    this.view = view
    this.place = { from: range.from, to: range.to }
    this.before = view.state.doc.sliceString(range.from, range.to)
    this.after = ''
    this.verb = null
    this.running = false
    this.trouble = null
    this.language = defaultLanguage(i18n.language)
    this.open = true
  }

  /** Runs one verb. Pressing another while one is running replaces it, so nobody
   *  has to stop one before changing their mind. */
  run(verb: Verb) {
    const provider = ai.providerFor('rewrite')
    this.verb = verb
    this.after = ''
    this.trouble = null

    if (!provider) {
      this.trouble = t('Add an AI provider in Settings first.')
      return
    }

    this.stopper?.abort()
    const stopper = new AbortController()
    this.stopper = stopper
    this.running = true

    void complete({
      provider,
      model: provider.model,
      messages: rewriteMessages(verb, nameOfLanguage(this.language), this.before),
      stream: (piece) => {
        // Only the run that is still the current one: a verb pressed again while the
        // last one was still arriving would otherwise write into the same box.
        if (this.stopper === stopper) this.after += piece
      },
      signal: stopper.signal,
    })
      .catch((error: unknown) => {
        if (this.stopper !== stopper || wasStopped(error)) return
        this.trouble = message(error, t('The model did not answer.'))
      })
      .finally(() => {
        if (this.stopper === stopper) this.running = false
      })
  }

  /** Writes the rewrite over what was selected, and closes.
   *
   *  Through the positions rather than through the selection as it is now: the caret
   *  may have moved, and what this replaces is the text the reader was shown a diff
   *  of. */
  accept() {
    const view = this.view
    const place = this.place
    const text = this.after.trim()
    if (!view || !place || !text) return

    view.dispatch({
      changes: { from: place.from, to: place.to, insert: text },
      selection: { anchor: place.from, head: place.from + text.length },
    })
    view.focus()
    this.close()
  }

  /** Leaves the note as it was. */
  close() {
    this.stopper?.abort()
    this.stopper = null
    this.open = false
    this.view = null
    this.place = null
    this.before = ''
    this.after = ''
    this.verb = null
    this.running = false
    this.trouble = null
  }
}

export const rewriting = new Rewriting()
