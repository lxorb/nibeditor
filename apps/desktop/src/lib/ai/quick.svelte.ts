/** A quick question: Claude Code's /btw for the whole app. A field in the middle of the
 *  window, what the reader is looking at going along with it, the answer streamed in
 *  place, and gone again with Escape.
 *
 *  A thread while it is up - a follow-up goes with the turns before it, as Raycast's
 *  quick AI keeps one - and nothing once it is closed: a question on the side is not a
 *  conversation anybody comes back to, and the Ask panel is the one that is kept. The
 *  next press starts again with what is in front then.
 *
 *  Every request goes through `complete()` with the provider Settings > AI > Used for
 *  gives a quick question, so a key, a ChatGPT plan, Claude Code and Codex all answer
 *  it. What it is sent with is quick.ts; the sheet is QuickQuestion.svelte, fetched by
 *  the first press through the door in surfaces.svelte.ts. */

import type { EditorView } from '@nib/editor'
import { message, t } from '../i18n.svelte'
import { quickSheet } from '../surfaces.svelte'
import { views } from '../views.svelte'
import { pages } from '../web-tab/pages.svelte'
import { workspace } from '../workspace.svelte'
import { complete, wasStopped } from './complete'
import type { Said } from './history'
import { type Context, insertion, quickMessages } from './quick'
import { fitted } from './retrieve'
import { ai } from './store.svelte'

/** How much of a page is read before it is cut down to what goes along; see quick.ts. */
const PAGE_TOKENS = 8000

class Quick {
  open = $state(false)
  question = $state('')
  turns = $state<Said[]>([])
  running = $state(false)
  trouble = $state<string | null>(null)
  /** What goes along with the next question, until its chip is pressed. */
  context = $state<Context | null>(null)

  /** The note a context came from, and where in it the answer goes: under the
   *  selection, or under the caret's line. Null where the context was not a note. */
  private target: { view: EditorView; at: number } | null = null
  /** A page still being read; a question asked meanwhile waits for it. */
  private reading: Promise<void> | null = null
  /** Which opening a page being read belongs to, so one that arrives after its chip was
   *  taken off, or after the sheet was put away, puts nothing back. */
  private round = 0
  private stopper: AbortController | null = null

  /** Whether anything can be asked: a provider set up, the Ask panel's question of
   *  the same store. */
  get ready(): boolean {
    return ai.providerFor('quick') !== null
  }

  /** Opens it, with what is in front as its context. Pressed while it is up, it closes,
   *  the way a key that opens a layer puts it away again. */
  show() {
    if (this.open) {
      this.close()
      return
    }

    void quickSheet.ask()
    this.reset()
    this.gather()
    this.open = true
  }

  close() {
    this.stopper?.abort()
    this.open = false
    this.reset()
  }

  private reset() {
    this.round++
    this.stopper = null
    this.question = ''
    this.turns = []
    this.running = false
    this.trouble = null
    this.context = null
    this.target = null
    this.reading = null
  }

  /** What is in front: the note's selection, else the note, else the page. */
  private gather() {
    const tab = workspace.active
    if (!tab) return

    if (tab.kind === 'note') {
      const view = views.of(workspace.panes.focusedId)
      const range = view?.state.selection.main
      if (view) this.target = { view, at: range?.to ?? 0 }

      const picked =
        view && range && !range.empty ? view.state.doc.sliceString(range.from, range.to) : ''
      const text = picked || tab.note.latest
      if (text.trim()) this.context = { kind: picked ? 'selection' : 'note', name: tab.shown, text }
      return
    }

    if (tab.kind === 'web') this.reading = this.readPage(tab.id, tab.shown, this.round)
  }

  /** A page's selection, else its article, as markdown: what the clipper reads. A
   *  browser build cannot read a site's frame, and has nothing to send. */
  private async readPage(tabId: string, shown: string, round: number): Promise<void> {
    const read = await pages.read(tabId, true)
    if (!read?.html.trim() || round !== this.round) return

    const { htmlToMarkdown } = await import('@nib/markdown/from-html')
    const text = fitted(htmlToMarkdown(read.html).trim(), PAGE_TOKENS)
    if (round === this.round && text) {
      this.context = { kind: 'page', name: read.title || shown, text }
    }
  }

  /** The chip pressed: the next question goes without it. */
  drop() {
    this.round++
    this.context = null
    this.reading = null
  }

  /** Stops the answer on its way; what arrived stays. */
  stop() {
    this.stopper?.abort()
    this.stopper = null
    this.running = false
  }

  /** Asks what is in the field. The question is on screen at once; the answer's turn
   *  is made when its first words arrive, so a refusal leaves the question with a
   *  sentence under it rather than an empty answer. */
  async ask() {
    const question = this.question.trim()
    const provider = ai.providerFor('quick')
    if (!question || this.running || !provider) return

    const before = this.turns
    this.question = ''
    this.trouble = null
    this.turns = [...before, { role: 'you', text: question }]

    const stopper = new AbortController()
    this.stopper = stopper
    this.running = true

    try {
      await this.reading
      if (this.stopper !== stopper) return

      const answer = { yet: false }
      await complete({
        provider,
        model: provider.model,
        messages: quickMessages(this.context, before, question),
        stream: (piece) => {
          if (this.stopper !== stopper) return
          const last = this.turns.at(-1)
          if (!answer.yet || last?.role !== 'model') {
            answer.yet = true
            this.turns = [...this.turns, { role: 'model', text: piece }]
            return
          }
          this.turns = [...this.turns.slice(0, -1), { role: 'model', text: last.text + piece }]
        },
        signal: stopper.signal,
      })

      if (this.stopper === stopper && !answer.yet) this.trouble = t('The model did not answer.')
    } catch (error) {
      if (this.stopper === stopper && !wasStopped(error)) {
        this.trouble = message(error, t('The model did not answer.'))
      }
    } finally {
      if (this.stopper === stopper) {
        this.stopper = null
        this.running = false
      }
    }
  }

  /** An answer into the note it was asked about, on lines of its own under the
   *  selection or the caret's line, and the sheet put away with the caret after it.
   *  Asked about anything else - a page, nothing - it goes on the end of the
   *  scratchpad, which is where a thought with no note yet belongs. */
  async addToNote(text: string) {
    const target = this.target
    if (target && !target.view.state.readOnly && target.view.dom.isConnected) {
      const { view } = target
      const doc = view.state.doc.toString()
      const { from, insert, caret } = insertion(doc, Math.min(target.at, doc.length), text)
      view.dispatch({
        changes: { from, insert },
        selection: { anchor: caret },
        scrollIntoView: true,
        userEvent: 'input.paste',
      })
      this.close()
      view.focus()
      return
    }

    const { scratchpad } = await import('../scratchpad/pad')
    await scratchpad.append(text)
    this.close()
  }
}

export const quick = new Quick()
