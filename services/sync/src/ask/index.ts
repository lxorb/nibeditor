/** Everything the glasses' question flow needs, behind the account's session.
 *
 *  Six routes, and the reason they are all here rather than in the plugin is one
 *  sentence of Emil's about the key: "it stays in the account, but after you set it
 *  you can't read it anymore." A key nothing can read is a key the plugin cannot
 *  send to OpenAI, so the Worker sends it - and once the Worker is making that
 *  request it is also the place that runs the tools, lists the models and turns
 *  sound into words.
 *
 *    PUT    /v1/ask/key      sets or replaces it; answers only set and the tail
 *    DELETE /v1/ask/key      takes it away
 *    GET    /v1/ask/models   what this key may choose, kept for a day
 *    POST   /v1/ask          a question, answered with the account's own notes
 *    POST   /v1/ask/heard    a WAV, as words; `?piece=1` for one piece of a recording
 *    POST   /v1/ask/summary  a transcript, as takeaways and open tasks
 *
 *  What the plugin sends is a question and nothing else. It holds no key, and
 *  `api.openai.com` is off its manifest's network whitelist: the one origin it may
 *  reach is nibeditor.com. That is the whole point of moving this.
 *
 *  **A guest cannot ask.** Not a special case: the session guard in index.ts opens
 *  only what `guestMayReach` names, everything account-wide is left out of that
 *  list, and a key and a set of notes are as account-wide as it gets. A guest gets
 *  403 from the guard and never reaches this file, which is why every route here
 *  reads `user` without checking. */

import { Hono } from 'hono'
import { readBody } from '../body'
import { mayAsk, mayTranscribe } from '../limits'
import type { Env, Variables } from '../types'
import { askAbout, type Effort, EFFORTS } from './asking'
import { heard, PIECE_SECONDS, shortEnough } from './heard'
import { forgetKey, keyFor, mayStore, setKey } from './key'
import { forgetModels, modelsFor } from './models'
import { MOST_TRANSCRIPT, summarise } from './summary'

/** How long a question may be. A question said out loud in one breath; anything
 *  longer arrived from something other than a person talking. */
const MOST_QUESTION = 500

/** A model id, which is a name and not a sentence. */
const MOST_MODEL = 100

/** How long an utterance may be, as bytes of WAV. A minute of the mono 16 kHz the
 *  glasses send is about two megabytes; four is a generous ceiling and still small
 *  enough that a Worker holding one in memory is nothing. */
const MOST_WAV = 4 * 1024 * 1024

/** What a key may be, as a length. The check that matters is in key.ts; this one
 *  only keeps a novel out of the body reader. */
const MOST_KEY = 200

/** How much of a vocabulary a transcription may be prompted with. A dozen short
 *  phrases; anything longer is not a list of commands and would only be somewhere to
 *  put a paragraph of somebody else's words into a model. */
const MOST_LIKE = 300

export const ask = new Hono<{ Bindings: Env; Variables: Variables }>()

/** Sets the key, or replaces the one that is there. There is no editing a key
 *  nothing can read, so this is the only way to change one. */
ask.put('/key', async (context) => {
  const user = context.get('user')
  const body = await readBody(context)
  const given = body.text('key', MOST_KEY)
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (given === undefined) return context.json({ error: 'send a key' }, 400)

  const state = await setKey(context.env, user.id, given)
  if (typeof state === 'string') {
    // A server with no encryption secret is a server that is not ready, rather
    // than a request that is wrong; see key.ts.
    return context.json({ error: state }, mayStore(context.env) ? 400 : 503)
  }

  // The list that was cached belonged to the key that is gone.
  await forgetModels(context.env, user.id)
  return context.json(state)
})

ask.delete('/key', async (context) => {
  const user = context.get('user')
  await forgetModels(context.env, user.id)
  return context.json(await forgetKey(context.env, user.id))
})

/** Which models this account's key may choose. Empty when there is no key, when the
 *  key is wrong, or when OpenAI could not be reached - all of which the settings
 *  pane says in one line rather than in a dialog. */
ask.get('/models', async (context) => {
  const user = context.get('user')
  const key = await keyFor(context.env, user.id)
  if (!key) return context.json({ models: [] })

  return context.json({ models: await modelsFor(context.env, user.id, key) })
})

ask.post('/', async (context) => {
  const user = context.get('user')
  const body = await readBody(context)
  const question = body.text('question', MOST_QUESTION)
  const model = body.text('model', MOST_MODEL)
  const effort = body.text('effort', 20)
  if (body.problem) return context.json({ error: body.problem }, 400)

  if (!question?.trim()) return context.json({ error: 'ask something' }, 400)
  if (!model) return context.json({ error: 'choose a model first' }, 400)
  if (effort !== undefined && !(EFFORTS as readonly string[]).includes(effort)) {
    return context.json({ error: `effort must be one of ${EFFORTS.join(', ')}` }, 400)
  }

  const key = await keyFor(context.env, user.id)
  if (!key) return context.json({ error: 'set an OpenAI key in nibeditor’s settings first' }, 400)

  if (!(await mayAsk(context.env, user.id))) {
    return context.json({ error: 'that is a lot of questions - try again later' }, 429)
  }

  try {
    const answer = await askAbout(context.env, user.id, question, {
      key,
      model,
      effort: (effort ?? 'low') as Effort,
    })
    return context.json({ answer })
  } catch (error) {
    // Whatever OpenAI refused with, in its own words: the reader is standing there
    // and "something went wrong" tells them nothing they can act on.
    return context.json(
      { error: error instanceof Error ? error.message : 'the model refused' },
      502,
    )
  }
})

/** One utterance, as words, or one piece of a recording.
 *
 *  Two callers with one shape. The glasses send half a second of somebody saying
 *  "next" and the phone does the same where its WebView has no recogniser of its
 *  own; the recorder sends a piece of something somebody is dictating or a meeting
 *  it is sitting through, in pieces small enough to hold. `?piece=1` says which,
 *  and the only difference it makes is how many seconds are allowed: the model, the
 *  ceiling on the bytes and the account's hourly allowance are the same for both.
 *
 *  One route rather than two because it is one question. A second route would be a
 *  second place for the model list to fall out of step, and the pieces a recording
 *  is cut into are exactly what this has always taken: a WAV of 16 kHz mono. */
ask.post('/heard', async (context) => {
  const user = context.get('user')

  // Read from the header before the body is read at all: measuring afterwards is
  // how a Worker with a hundred and twenty-eight megabytes is asked to hold more.
  const declared = Number(context.req.header('content-length') ?? '')
  if (Number.isFinite(declared) && declared > MOST_WAV) {
    return context.json({ error: 'that is too much audio' }, 413)
  }

  const wav = await context.req.arrayBuffer()
  if (!wav.byteLength) return context.json({ error: 'send some audio' }, 400)
  if (wav.byteLength > MOST_WAV) return context.json({ error: 'that is too much audio' }, 413)

  // Nothing about a key here. With one, OpenAI listens; without one, Whisper on
  // Workers AI does. A reader with no OpenAI account still has a microphone and still
  // has this Worker, and "no way to listen" was the wrong answer to give them.
  const ofRecording = context.req.query('piece') === '1'
  if (!shortEnough(wav, ofRecording ? PIECE_SECONDS : undefined)) {
    return context.json(
      { error: ofRecording ? 'that piece is too long' : 'that is more than a spoken command' },
      413,
    )
  }

  if (!(await mayTranscribe(context.env, user.id))) {
    return context.json({ error: 'that is a lot of listening - try again later' }, 429)
  }

  // The words the caller is hoping to hear, if it said. The plugin sends its own
  // spoken commands, which is what turns half a second of "next" into "next" rather
  // than "text"; see apps/desktop/src/lib/api.ts.
  const like = (context.req.query('like') ?? '').slice(0, MOST_LIKE)

  const key = await keyFor(context.env, user.id)
  // `said` and `language`, and the plugin reads only the first of them: a spoken
  // command has no language to name, and a transcript in a note does.
  return context.json(await heard(context.env, wav, key, like))
})

/** A transcript, as takeaways and the tasks it left open.
 *
 *  Here rather than in the app for the reason the question flow is here: the key is
 *  here. The account's own model answers, the same one the glasses ask, so an account
 *  chooses a model once and everything that thinks on its behalf uses it. */
ask.post('/summary', async (context) => {
  const user = context.get('user')
  const body = await readBody(context)
  const text = body.text('text', MOST_TRANSCRIPT)
  const model = body.text('model', MOST_MODEL)
  const effort = body.text('effort', 20)
  if (body.problem) return context.json({ error: body.problem }, 400)

  if (!text?.trim()) return context.json({ error: 'send a transcript' }, 400)
  if (!model) return context.json({ error: 'choose a model first' }, 400)
  if (effort !== undefined && !(EFFORTS as readonly string[]).includes(effort)) {
    return context.json({ error: `effort must be one of ${EFFORTS.join(', ')}` }, 400)
  }

  const key = await keyFor(context.env, user.id)
  if (!key) return context.json({ error: 'set an OpenAI key in nibeditor’s settings first' }, 400)

  // The same hourly allowance a question counts against. A summary is one request to
  // the same endpoint on the same credit, and a second ceiling would be a second
  // number to keep in step for no reader's benefit.
  if (!(await mayAsk(context.env, user.id))) {
    return context.json({ error: 'that is a lot of questions - try again later' }, 429)
  }

  try {
    const summary = await summarise(text, { key, model, effort: effort ?? 'low' })
    return context.json({ summary })
  } catch (error) {
    return context.json(
      { error: error instanceof Error ? error.message : 'the model refused' },
      502,
    )
  }
})
