/** Sound, as words, by whichever road this reader has.
 *
 *  Two, and the first one is theirs. A reader who has set up a provider of their own -
 *  their OpenAI key, or a whisper server on this machine - is transcribed through it:
 *  `POST /v1/audio/transcriptions`, the route OpenAI serves and every OpenAI-compatible
 *  transcriber serves under the same name. Nothing leaves the machine at all for a local
 *  one, which is the whole reason somebody runs one.
 *
 *  The other is the account: `POST /v1/ask/heard`, the route the glasses' voice commands
 *  go through, Whisper on Workers AI first and the account's own OpenAI key behind that.
 *  See services/sync/src/ask/heard.ts.
 *
 *  A provider that is there is the one that answers, and a failure on it is a failure:
 *  a recording is not quietly sent somewhere else because the server somebody chose said
 *  no. The account is the road for a reader who has chosen no provider, which is most of
 *  them, and it is why transcribing works with no key at all.
 *
 *  Two callers. A meeting hands over a piece every twenty seconds while somebody is
 *  still talking; a Transcribe row hands over a whole file that may be half an hour
 *  long. Both end up sending the same thing - a WAV of 16 kHz mono, in pieces small
 *  enough for one request - and both come back with words and the language the model
 *  heard them in.
 *
 *  **Pieces go one at a time.** Twenty of them at once would be twenty requests
 *  against an hourly allowance the glasses share, from a phone that may be on a
 *  train, and the answers are wanted in order anyway. A failed piece is tried again
 *  on the same curve a room rejoins on, and a piece that will not go after that is
 *  said out loud rather than quietly dropped: the pill shows it, and the transcript
 *  says where the gap is. */

import { api } from '../api'
import { account } from '../account.svelte'
import { roomDelay } from '../backoff'
import { transcriberNow } from '../ai/hears'
import type { Provider } from '../ai/providers'
import { key, message, t } from '../i18n.svelte'
import { waited } from '../timing'
import { mono, pieces, RATE, resampled, wavOf } from './wav'

/** How long a piece of a live transcript is.
 *
 *  Twenty seconds. It is the delay between somebody speaking and their words being in
 *  the note, so shorter would be better - but every piece is a request, a model run
 *  and a sentence cut in half at each end, and under about fifteen seconds the cuts
 *  start landing inside sentences often enough to read badly. Twenty is three requests
 *  a minute, which an hour-long meeting spends 180 of an allowance of 600 on. */
export const LIVE_SECONDS = 20

/** And how long a piece of a file is.
 *
 *  Sixty seconds, which is nearly two megabytes of WAV and comfortably inside the
 *  route's four. Nobody is watching the words arrive one piece at a time here, so the
 *  pieces are as long as they may be: a ten-minute recording is ten requests rather
 *  than thirty. */
const FILE_SECONDS = 60

/** How much of a file will be decoded in one go.
 *
 *  Twelve megabytes, which is something like twenty-five minutes of Opus. Decoding is
 *  the memory ceiling rather than the request: a file becomes samples before it
 *  becomes pieces, and half an hour of them is a hundred megabytes even at the low
 *  rate this decodes to. A meeting longer than that is transcribed as it goes and
 *  never reaches this at all; a file longer than that is told so plainly. */
const MOST_DECODED = 12 * 1024 * 1024

/** How many times a piece is tried. Three: a phone changing cell loses one request,
 *  not three. */
const TRIES = 3

/** What came back: the words, and the language tag the model settled on. */
export interface Words {
  text: string
  /** Empty where the model did not say, which is most models. */
  language: string
}

/** What wrote a transcript through the account's road, as the note says it.
 *
 *  The name of the model rather than "AI", and Whisper whichever of the two behind the
 *  route answered: both are Whisper, one on Workers AI and one at OpenAI, and the route
 *  does not say which listened because a reader has no use for the difference. See
 *  services/sync/src/ask/heard.ts. */
export const WHISPER = 'whisper'

/** The transcription models, in the order they are tried.
 *
 *  OpenAI has two that listen and they are not the same model: the newer one is better
 *  and cheaper and answers plain JSON, and `whisper-1` is the one that also says which
 *  language it heard. A server on this machine is asked for `whisper-1`, which is what
 *  whisper.cpp, faster-whisper and LM Studio all call theirs, and then for whatever
 *  model the provider itself names - so somebody whose server wants another name has a
 *  way to say it.
 *
 *  Walked once per provider and then remembered: a piece of a meeting every twenty
 *  seconds must not spend a request finding out what it already knows. */
const MODELS: Record<'openai' | 'compatible', readonly string[]> = {
  openai: ['gpt-4o-mini-transcribe', 'whisper-1'],
  compatible: ['whisper-1'],
}

/** Which model each provider turned out to answer with, by its id. */
const answering = new Map<string, string>()

function modelsFor(provider: Provider): string[] {
  const listed = provider.kind === 'openai' ? MODELS.openai : MODELS.compatible
  // The provider's own model last, and only where it is not already in the list: it is
  // the chat model, so it is a guess - but it is the reader's own guess, and a server
  // that wants `Systran/faster-whisper-small` has nowhere else to say so.
  const own = provider.model && !listed.includes(provider.model) ? [provider.model] : []
  const every = [...listed, ...own]

  // The one that answered last time in front, and the rest still behind it rather than
  // instead of it: a server somebody swapped under us is a name that stops working, and
  // the way out of that is the list it came from.
  const remembered = answering.get(provider.id)
  return remembered ? [remembered, ...every.filter((one) => one !== remembered)] : every
}

/** The name to write under a transcript, before a word of it has arrived.
 *
 *  A meeting's note is headed the moment it is made, so this says who is about to write
 *  it: the model a provider will be asked for, or Whisper for the account's road. One
 *  answer for both the meeting's heading and a file's callout, so a note cannot say one
 *  thing and mean another. */
export function transcribedBy(): string {
  const provider = transcriberNow()
  if (!provider) return WHISPER

  return modelsFor(provider)[0] ?? WHISPER
}

/** One piece, through the reader's own provider.
 *
 *  A multipart form, because that is what the route takes: the WAV as a file, the model
 *  by name, and the shape to answer in. `whisper-1` is the only one of them that says
 *  which language it heard, and it says so under `verbose_json`; the others answer plain
 *  JSON and nothing about the language, which is a heading without a language in it
 *  rather than a failure.
 *
 *  A model the server has never heard of is the one failure worth walking past, because
 *  the list above is a guess about somebody else's server. Anything else - a key
 *  refused, a server that is not running - is said out loud. */
async function heardByProvider(provider: Provider, wav: Uint8Array<ArrayBuffer>): Promise<Words> {
  // Fetched here rather than imported: what a provider is, where its key lives and the
  // request itself are some fifteen kilobytes, and this module is in front of the first
  // paint because two menu rows ask it a question. See test/weight.test.ts.
  const { readKey } = await import('../ai/keys')
  const { headersWithoutType, heardUrl, reachable, troubleIn } = await import('../ai/providers')

  const apiKey = await readKey(provider)
  if (!reachable(provider, !!apiKey)) throw new Error(t('That provider is not set up yet.'))

  let refused: Error | null = null

  for (const model of modelsFor(provider)) {
    const form = new FormData()
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'said.wav')
    form.append('model', model)
    form.append('response_format', model === 'whisper-1' ? 'verbose_json' : 'json')

    const response = await fetch(heardUrl(provider), {
      method: 'POST',
      headers: headersWithoutType(provider, apiKey),
      body: form,
    }).catch(() => null)

    if (!response) throw new Error(t('Could not reach {url}', { url: heardUrl(provider) }))

    const said = await response.text().catch(() => '')

    if (!response.ok) {
      refused = new Error(refusal(response.status, said, troubleIn))
      // Only a model this server does not have is worth trying the next name for.
      if (!aboutTheModel(said)) throw refused

      // And a remembered name that has stopped working is not worth remembering.
      if (answering.get(provider.id) === model) answering.delete(provider.id)
      continue
    }

    answering.set(provider.id, model)
    return wordsIn(said)
  }

  throw refused ?? new Error(t('The provider answered {status}.', { status: 0 }))
}

/** What a provider answered, as words and a language.
 *
 *  Every shape of the route answers `text`; `verbose_json` adds `language`. A body that
 *  is not JSON at all is the words themselves, which is what `response_format: text`
 *  answers - no server is asked for that here, and reading it anyway costs a line. */
function wordsIn(body: string): Words {
  try {
    const held: unknown = JSON.parse(body)
    if (typeof held === 'object' && held !== null) {
      const said = held as { text?: unknown; language?: unknown }
      return {
        text: typeof said.text === 'string' ? said.text : '',
        language: typeof said.language === 'string' ? said.language : '',
      }
    }
  } catch {
    // Not JSON, so it is the words.
  }

  return { text: body.trim(), language: '' }
}

/** Whether a refusal is about the name of the model rather than about anything else,
 *  which is what says to try the next name. Read off what the server said, because the
 *  status is the same 400 or 404 for half a dozen other reasons. */
function aboutTheModel(body: string): boolean {
  return /model/i.test(body)
}

function refusal(
  status: number,
  body: string,
  troubleIn: (body: unknown) => string | null,
): string {
  const said = troubleIn(parsed(body))
  if (said) return said

  if (status === 401 || status === 403) return t('That key was refused.')
  return t('The provider answered {status}.', { status })
}

function parsed(body: string): unknown {
  try {
    return JSON.parse(body) as unknown
  } catch {
    return null
  }
}

/** One piece, as words, tried again where the network was the problem.
 *
 *  Throws when it will not go: a piece that silently became nothing is a hole in a
 *  transcript that nothing on screen accounts for. */
export async function heardPiece(
  wav: Uint8Array<ArrayBuffer>,
  /** Told each time a try fails, so the pill can say a piece is being tried again
   *  rather than a transcript quietly falling behind. */
  failed?: (round: number) => void,
): Promise<Words> {
  const provider = transcriberNow()
  const token = account.accountToken
  if (!provider && !token) {
    throw new Error(key('Add an AI provider or sign in to turn speech into words.'))
  }

  let trouble: unknown = null

  for (let round = 1; round <= TRIES; round++) {
    try {
      if (provider) return await heardByProvider(provider, wav)

      const said = await api.askPiece(token ?? '', wav)
      return { text: said.said ?? '', language: said.language }
    } catch (error) {
      trouble = error
      failed?.(round)
      if (round < TRIES) await waited(roomDelay(round))
    }
  }

  throw new Error(message(trouble, key('That recording could not be turned into words.')))
}

/** A whole recording, as words.
 *
 *  The file is decoded here rather than sent as it stands. The route takes the one
 *  format both models are happiest with, and the browser already holds a decoder for
 *  every container it can record into - which is a thing a Worker does not. So what
 *  crosses the internet is the same WAV a spoken command crosses it as, and the file
 *  in the note stays the small modern container the platform wrote. */
export async function wordsInFile(bytes: ArrayBuffer): Promise<Words> {
  if (bytes.byteLength > MOST_DECODED) {
    throw new Error(key('That recording is too long to turn into words in one go.'))
  }

  const samples = await decoded(bytes)
  const parts = pieces(samples, RATE, FILE_SECONDS)

  const said: string[] = []
  let language = ''

  for (const part of parts) {
    const heard = await heardPiece(wavOf(part, RATE))
    if (heard.text) said.push(heard.text)
    // The first model to say. They are pieces of one recording, so the language the
    // first of them settled on is the language of all of them.
    if (!language) language = heard.language
  }

  return { text: said.join('\n\n'), language }
}

/** A file as samples at the rate the route listens at.
 *
 *  Decoded in a context that runs at 16 kHz, so the engine's own resampler does the
 *  work on the way out of the decoder rather than this doing it afterwards over an
 *  array forty-eight thousand samples a second long. Mixed to one channel, because a
 *  transcriber listens to one. */
async function decoded(bytes: ArrayBuffer): Promise<Float32Array> {
  // One frame: the context is here to decode, not to play, and its length has nothing
  // to do with the length of what it decodes.
  const context = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate: RATE })

  // A copy, because decoding detaches the buffer it is given and the caller still
  // wants its own bytes to write to a file.
  const buffer = await context.decodeAudioData(bytes.slice(0))
  const channels: Float32Array[] = []
  for (let one = 0; one < buffer.numberOfChannels; one++) channels.push(buffer.getChannelData(one))

  // The rate is already what was asked for on every engine that honours it; resampling
  // answers the one that does not.
  return resampled(mono(channels), buffer.sampleRate, RATE)
}
