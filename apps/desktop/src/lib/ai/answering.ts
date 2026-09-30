/** Which provider answers a ```` ```ai ```` block, what the model is told, and what a
 *  reader sees when it goes wrong.
 *
 *  The editor owns the block: it finds the question, writes the answer under it and
 *  stops a stream that is still coming; see ai/run.ts there. This is the other half of
 *  that seam, and it is fetched by the first press rather than carried into the first
 *  paint - the whole of what talking to a model costs is behind this one import, and a
 *  reader who never presses the glyph never pays for it. The press itself is a request
 *  to somebody's server, so a module fetched from beside the page is not something
 *  anybody can see. See ask.ts, which is the stub that gets here. */

import type { AiAsk } from '@nib/editor'
import { busy } from '../busy.svelte'
import { message, t } from '../i18n.svelte'
import { complete, wasStopped } from './complete'
import { ai } from './store.svelte'

/** What the model is told before the question.
 *
 *  Short on purpose. Three things it cannot work out for itself: that the answer is
 *  going into a markdown note, that the note is read in whatever language the
 *  question was written in, and that nobody wants a paragraph of preamble in front
 *  of the answer. Not translated, because nobody reads it: it is instructions to a
 *  model, and asking it to answer in the question's own language covers every
 *  language the app has without a dictionary entry.
 *
 *  No code fence around the whole answer, because the answer is written into the
 *  note as markdown: one that came back fenced would render as a block of grey. */
const SYSTEM = [
  'You are answering inside a markdown note, and your answer is written straight',
  'into it. Reply in markdown, in the same language the question is written in.',
  'No preamble, no sign-off, and never wrap the whole reply in a code fence.',
].join(' ')

/** How the note is handed over for a question that said `@note`. Fenced, so the
 *  model can tell the note from the question, and labelled so it knows what it is
 *  looking at. */
function noteContext(note: string): string {
  return `The note this question is in:\n\n<note>\n${note}\n</note>`
}

/** What a press on the glyph runs. Takes the same two arguments the editor hands a
 *  runner, because it is the runner; see ask.ts, which registers the stub that fetches
 *  this. */
export async function answer(ask: AiAsk, signal: AbortSignal) {
  const provider = ai.providerFor('block')
  if (!provider) {
    busy.failed(t('Add an AI provider in Settings first.'))
    throw new Error('no provider')
  }

  // The answer's span is written when the first words arrive rather than when the
  // request is made, so a question that was refused - a key that has expired, a
  // model that is gone - leaves the note exactly as it was.
  //
  // A holder rather than a variable, because it is written inside the callback
  // below and read outside it: the compiler can see a field change and cannot see
  // a local one, and read it back as false for ever.
  const began = { yet: false, model: provider.model }
  const wrote = (piece: string) => {
    if (!began.yet) {
      began.yet = true
      ask.started(began.model)
    }
    ask.wrote(piece)
  }

  try {
    await complete({
      provider,
      model: provider.model,
      messages: [
        { role: 'system', content: SYSTEM },
        ...(ask.note ? [{ role: 'system' as const, content: noteContext(ask.note) }] : []),
        { role: 'user', content: ask.prompt },
      ],
      stream: wrote,
      // Claude Code and Codex name their model only as they answer; see complete.ts.
      named: (model) => {
        began.model = model
      },
      signal,
    })

    // A stream that ended without a word in it. Nothing was written, so without a
    // line saying so the press would look like nothing happened at all.
    if (!began.yet) busy.failed(t('The model did not answer.'))
  } catch (error) {
    // Stopping is not a failure: the reader pressed the square, and what arrived
    // before they did is in the note where they can see it.
    if (!wasStopped(error)) busy.failed(message(error, t('The model did not answer.')))
    throw error
  }
}
