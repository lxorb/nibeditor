/** A meeting's transcript, as takeaways and the tasks it left open.
 *
 *  One function, and it is the seam: everything about *who* thinks about a transcript
 *  is here, and the recorder only ever asks for a summary and is told which model
 *  wrote it. There are two answers to that question and the order between them is the
 *  whole design:
 *
 *  1. **The reader's own provider**, through `ai.complete` - the one place nib asks a
 *     model anything, with the key on the device and the request made by the page. See
 *     ai/complete.ts and ai/keys.ts. Preferred, because it is what the AI pane is set
 *     up for, it covers Anthropic, OpenAI and anything OpenAI-compatible including a
 *     model running on this very machine, and nothing of the note passes through
 *     nibeditor's server on the way.
 *  2. **The account's own OpenAI key**, through the Worker, which is the path the
 *     glasses ask their questions through. That key is written and never read back, so
 *     the only thing that can spend it is the Worker; see services/sync/src/ask. It is
 *     the answer for somebody who set a key once for their glasses and has no provider
 *     on this device - a phone, most often.
 *
 *  Both are asked the same thing, in the same words, and both answer markdown the
 *  recorder writes as it stands. */

import { account } from '../account.svelte'
import { api } from '../api'
import { complete } from '../ai/complete'
import { ai } from '../ai/store.svelte'
import { key } from '../i18n.svelte'
import type { Message } from '../ai/providers'
import { modes } from '../modes.svelte'

/** What the model is told before the transcript.
 *
 *  Not translated, and for the reason ai/ask.ts gives for its own: nobody reads it,
 *  and asking for the transcript's own language covers every language there is without
 *  a dictionary entry. The Worker's copy of this is in
 *  services/sync/src/ask/summary.ts, where it has to live because that request is made
 *  there; the two say the same thing on purpose. */
const PROMPT = [
  'You are given the transcript of a meeting, as a speech model heard it. It has',
  'mistakes in it and no speaker names.',
  '',
  'Write markdown, in the language the transcript is in, in this shape and nothing',
  'else:',
  '',
  '## Takeaways',
  '',
  'Three to six bullets. What was decided and what was learned, not what was said.',
  '',
  '## Open tasks',
  '',
  'A markdown task list - `- [ ] ` each - of what somebody now has to do, with who',
  'is to do it where the transcript says. Leave the heading out entirely if nothing',
  'was left open.',
  '',
  'Never invent a decision, a number or a name that is not in the transcript. Where',
  'the transcript is too garbled to summarise, say so in one bullet.',
].join('\n')

/** How much of a transcript is handed over at once. The same number the Worker cuts
 *  one at, so a meeting that is too long to summarise is too long by the same amount
 *  whichever of the two answers it. */
const MOST = 60_000

/** What came back, and who wrote it: the note says which model, by name. */
export interface Summary {
  text: string
  model: string
}

/** Whether anything at all can summarise. What the Meeting notes row reads, so a
 *  meeting is not started on the promise of a summary nothing can write. */
export function canSummarise(): boolean {
  return ai.ready || (!!account.accountToken && !!modes.glassesModel)
}

/** The messages one summary is asked with. */
function messages(transcript: string): Message[] {
  const said =
    transcript.length > MOST
      ? `${transcript.slice(0, MOST)}\n\n[cut here; the meeting goes on]`
      : transcript

  return [
    { role: 'system', content: PROMPT },
    { role: 'user', content: said },
  ]
}

/** The summary, or a thrown sentence saying why there is none. */
export async function summaryOf(transcript: string): Promise<Summary> {
  const provider = ai.providerFor('summary')
  if (provider) {
    // Claude Code and Codex name their model only as they answer; see complete.ts.
    const said = { model: provider.model }
    const text = await complete({
      provider,
      model: provider.model,
      messages: messages(transcript),
      named: (model) => {
        said.model = model
      },
    })
    return { text, model: said.model }
  }

  const token = account.accountToken
  const model = modes.glassesModel
  if (!token || !model) throw new Error(key('Add an AI provider in settings to summarise.'))

  const answered = await api.askSummary(
    token,
    transcript.slice(0, MOST),
    model,
    modes.glassesEffort,
  )
  return { text: answered.summary, model }
}
