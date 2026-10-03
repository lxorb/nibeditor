/** The conversation the Ask panel holds: the turns, the question on its way, and the
 *  passages each answer was given, by reference.
 *
 *  One conversation per space, because a question is about a space: the notes it
 *  reaches and the notes it cites are that space's. Switching space switches the
 *  conversation the way it switches the file list.
 *
 *  Kept on this device and nowhere else - `localStorage`, beside the window's layout;
 *  never the account, never a note, never sync - and only the words that were said and
 *  where each citation points. The passages themselves are not written down: a
 *  conversation is worth keeping, a page of somebody's notes copied into the storage
 *  their preferences share is not. The pen at the top of the panel starts again.
 *
 *  Every request goes through `complete()`, the one place nib asks a model anything:
 *  the same provider, key and stream as the fence and the rewrites. See complete.ts,
 *  and retrieve.ts for what a question is sent with. */

import { message, t } from '../i18n.svelte'
import { withinSpace } from '../space-paths'
import { isRecord, isString, keep, stored } from '../stored'
import { views } from '../views.svelte'
import { workspace } from '../workspace.svelte'
import { complete, wasStopped } from './complete'
import { history } from './history'
import { contextFor, type Passage, retrieve } from './retrieve'
import { ai } from './store.svelte'

const STORAGE_KEY = 'nib:ask'

/** Where a citation points: a note of the space and a line of it. */
export type Source = Omit<Passage, 'text'>

/** One thing said. `you` and `model` rather than the wire's words, because this is
 *  what the panel draws. */
export interface Turn {
  role: 'you' | 'model'
  text: string
  /** The passages an answer was given, in the order its citations count them. */
  sources?: Source[]
}

/** Twenty exchanges: far more than anybody scrolls back through, and a ceiling on one
 *  space's share of the storage every preference shares. */
const MOST_TURNS = 40

/** What the model is told before anything else. Not translated: nobody reads it, and
 *  asking for the question's own language covers every language the app has. */
const SYSTEM = [
  'You answer questions about the reader’s own markdown notes, in a narrow panel beside',
  'them. The numbered passages are your source: after each statement that uses one,',
  'cite it by its number in brackets, like [2], or [1][3] for several. Cite only numbers',
  'you were given. Where the passages do not answer the question, say so plainly in one',
  'sentence, and if you then answer from general knowledge, say that you are. Reply in',
  'the language of the question, in markdown, briefly: no preamble, no sign-off.',
].join(' ')

function sourceIn(value: unknown): Source | null {
  if (!isRecord(value)) return null
  const { path, name, line } = value
  if (!isString(path) || !isString(name) || typeof line !== 'number') return null

  return { path, name, line }
}

function turnIn(value: unknown): Turn | null {
  if (!isRecord(value)) return null
  const { role, text, sources } = value
  if (!isString(text) || !text || (role !== 'you' && role !== 'model')) return null

  const read = Array.isArray(sources) ? sources.map(sourceIn) : []
  const kept = read.filter((one): one is Source => one !== null)
  return kept.length ? { role, text, sources: kept } : { role, text }
}

/** The passages a question was sent with, as a citation needs them. */
function sourcesOf(passages: readonly Passage[]): Source[] {
  return passages.map(({ path, name, line }) => ({ path, name, line }))
}

class Asking {
  /** Every space's conversation, by space id. */
  private kept = $state.raw<Record<string, Turn[]>>({})

  /** The question being typed, kept while the panel is shut. */
  question = $state('')
  running = $state(false)
  /** What went wrong, in the provider's own words where it said anything. */
  trouble = $state<string | null>(null)
  /** Whether the note in front goes with the next question. On, because "this" in a
   *  question means it; the chip over the field takes it off. */
  withNote = $state(true)

  private stopper: AbortController | null = null

  private get space(): string {
    return workspace.activeSpaceId ?? ''
  }

  /** The open space's turns, oldest first. */
  get turns(): Turn[] {
    return this.kept[this.space] ?? []
  }

  /** Whether anything can be asked at all: a provider set up, the same question the
   *  fence asks of the same store. */
  get ready(): boolean {
    return ai.providerFor('ask') !== null
  }

  /** What is written down, read; whatever was held is replaced, so this says the same
   *  thing whenever it is called. */
  restore() {
    const saved = stored(STORAGE_KEY)
    const spaces = isRecord(saved) && isRecord(saved.spaces) ? saved.spaces : {}
    const out: Record<string, Turn[]> = {}

    for (const [id, value] of Object.entries(spaces)) {
      if (!Array.isArray(value)) continue
      const turns = value.map(turnIn).filter((one): one is Turn => one !== null)
      if (turns.length) out[id] = turns.slice(-MOST_TURNS)
    }

    this.kept = out
  }

  private save() {
    const spaces = Object.fromEntries(Object.entries(this.kept).filter(([, turns]) => turns.length))
    keep(STORAGE_KEY, JSON.stringify({ spaces }))
  }

  /** Starts this space's conversation again, and nobody else's. */
  clear() {
    this.stop()
    this.trouble = null
    const here = this.space
    this.kept = Object.fromEntries(Object.entries(this.kept).filter(([id]) => id !== here))
    this.save()
  }

  /** Stops the answer on its way; what arrived stays. */
  stop() {
    this.stopper?.abort()
    this.stopper = null
    this.running = false
  }

  /** One space's turns, written. The space is named rather than read, because an
   *  answer takes seconds and the space can change inside them: a question asked of
   *  one space must not be answered into another. */
  private put(space: string, turns: Turn[]) {
    this.kept = { ...this.kept, [space]: turns.slice(-MOST_TURNS) }
  }

  private turnsOf(space: string): Turn[] {
    return this.kept[space] ?? []
  }

  /** Asks the last question again, in place of the answer it had. */
  again() {
    const turns = this.turns
    const last = turns.map((one) => one.role).lastIndexOf('you')
    const question = turns[last]?.text
    if (!question || this.running) return

    this.put(this.space, turns.slice(0, last))
    void this.ask(question)
  }

  /** Asks whatever is in the field.
   *
   *  The question is on screen the moment it is pressed. The answer's turn is made when
   *  its first words arrive, as the fence's is, so a refused request leaves a question
   *  with a sentence under it rather than an empty answer. */
  async ask(asked?: string) {
    const question = (asked ?? this.question).trim()
    const provider = ai.providerFor('ask')
    if (!question || this.running || !provider) return

    const here = this.space
    const before = this.turns
    if (asked === undefined) this.question = ''
    this.trouble = null
    this.put(here, [...before, { role: 'you', text: question }])

    const stopper = new AbortController()
    this.stopper = stopper
    this.running = true

    try {
      const passages = await this.gather(question)
      if (this.stopper !== stopper) return

      const sources = sourcesOf(passages)
      // An object rather than a flag, because the stream sets it inside a callback the
      // compiler cannot see run.
      const answer = { yet: false }

      await complete({
        provider,
        model: provider.model,
        messages: [
          { role: 'system', content: SYSTEM },
          ...contextFor(passages, this.withNote ? views.selectedText() : ''),
          ...history(before),
          { role: 'user', content: question },
        ],
        stream: (piece) => {
          if (this.stopper !== stopper) return

          const turns = this.turnsOf(here)
          const last = turns.at(-1)
          if (!answer.yet || last?.role !== 'model') {
            answer.yet = true
            this.put(here, [...turns, { role: 'model', text: piece, sources }])
            return
          }

          this.put(here, [...turns.slice(0, -1), { ...last, text: last.text + piece }])
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
      this.save()
    }
  }

  /** The passages this question goes with: the note in front's, while it goes, and
   *  the space's. A note taken off the chip is taken out of the search as well, since
   *  taking it off is saying not to send it. A search that fails is not a failed
   *  question - the model is still asked, with whatever there is. */
  private async gather(question: string): Promise<Passage[]> {
    const root = workspace.activeSpace?.root
    if (!root) return []

    const front = this.frontNote(root)
    const kept = this.withNote || !front ? [] : [front.path]
    return await retrieve(
      question,
      {
        root,
        excluded: [...workspace.leftOutOf(root), ...kept],
        relative: (path) => withinSpace(root, path),
        read: (path) => workspace.noteText(path),
      },
      this.withNote ? front : null,
    ).catch(() => [])
  }

  /** The note the panel is about, while it is a note of this space. */
  private frontNote(root: string): { path: string; name: string; text: string } | null {
    const tab = workspace.panelTab
    const path = tab?.kind === 'note' && tab.path ? withinSpace(root, tab.path) : null
    if (!tab || path === null) return null

    return { path, name: tab.shown, text: tab.note.latest }
  }
}

export const asking = new Asking()

// Read as this module arrives rather than at launch: everything about talking to a
// model is fetched by whatever asks for it, and the moment it is fetched is the
// moment to read what was kept. See store.svelte.ts, which does the same.
asking.restore()
