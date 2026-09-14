/** The microphone, and the two things done with what it hears.
 *
 *  A recording is written by `MediaRecorder`, into the best container the platform
 *  gives, and that file is what lands beside the note: Opus at 24 kB a minute rather
 *  than a WAV at two megabytes, and a file a phone, a browser and a desktop player
 *  will all open.
 *
 *  A live transcript cannot come out of that same recorder. What `ondataavailable`
 *  hands over while a recording is running is a *piece* of a container - the first
 *  one carries the header and the rest carry none - so no decoder anywhere will read
 *  one on its own, and a route that was sent one would be sent bytes that are not a
 *  file. So the same stream is tapped a second time, as plain samples, and the pieces
 *  a transcript is made of are cut out of those. Two readers of one microphone,
 *  each getting the shape it can actually use.
 *
 *  Nothing here knows about notes, commands or the status bar. It opens a microphone,
 *  it answers with a file when it is stopped, and it calls back with a piece of sound
 *  every so often while it runs. */

import { key } from '../i18n.svelte'
import { bestContainer, extensionOf } from './container'
import { spoken } from './wav'

/** How much sound one callback carries at the tap. A power of two, as the node
 *  demands, and the largest it takes: the work per callback is a copy, and four times
 *  fewer callbacks is four times less of it. */
const BLOCK = 16_384

/** How often the file is asked for a piece.
 *
 *  Every five seconds, which is not how often anything is *sent* - that is the
 *  transcript's business - but how often the recorder hands over what it has. A
 *  recorder asked only at the end holds the whole recording in one buffer inside the
 *  engine; asked as it goes, the pieces are ours and the ceiling below can be
 *  measured against them. */
const HANDOVER = 5_000

/** How long the microphone is waited for before the recorder gives up on it.
 *
 *  `getUserMedia` is documented to resolve or to reject, and there is one case where it
 *  does neither: a `WebView2` webview with nothing listening for `PermissionRequested`
 *  answers a request with neither an allow nor a deny, and the promise simply never
 *  settles. That is a bug and it is fixed on the other side of the bridge - the window's
 *  own page has that listener now; see `hearing` in web_tabs.rs - and this is here
 *  because a recorder that can hang for ever is a pill stuck at 0:00 with nothing said
 *  and nothing written, which is the worst way to be wrong. Whatever the reason, after
 *  this the reader is told.
 *
 *  Twenty seconds. Long enough for a system prompt somebody has to find and press, and
 *  short enough that nobody sits watching a clock that will never move. */
const PATIENCE = 20_000

/** The microphone, or a refusal, but never neither.
 *
 *  Races the platform's own promise against a clock. The timer is cleared either way, so
 *  a recording that started does not carry a pending timeout for twenty seconds. */
async function opened(): Promise<MediaStream> {
  let ran = 0

  try {
    return await Promise.race([
      navigator.mediaDevices.getUserMedia({
        // What the browser's own processing is for. A recording of a meeting is a room
        // and several voices, and the three of these together are the difference between
        // a transcript and a guess.
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      }),
      new Promise<never>((_resolve, reject) => {
        ran = window.setTimeout(
          () => reject(new Error(key('That microphone could not be opened.'))),
          PATIENCE,
        )
      }),
    ])
  } finally {
    window.clearTimeout(ran)
  }
}

/** What a recording may grow to.
 *
 *  Twenty-four megabytes, which is something like fifty minutes of Opus and an hour
 *  of AAC. Two things set it. It is a file landing in somebody's notes folder and
 *  travelling through sync to every device they own; and it crosses into the Rust
 *  side as an array of numbers, which is the one place the write is not free. Past it
 *  the recording stops itself and keeps what it has: a ceiling that threw the
 *  recording away would be the worst way to enforce a ceiling. */
export const MOST_BYTES = 24 * 1024 * 1024

/** What a running recording answers to. */
export interface Recording {
  /** What a file of this recording is called on disk, from the container the platform
   *  actually chose - which is not always the one it was asked for. */
  extension: string
  /** Stops it, and answers with the file, how long it ran, and the last few seconds
   *  of sound that had not filled a piece yet. */
  stop: () => Promise<{ bytes: ArrayBuffer; seconds: number; spare?: Uint8Array<ArrayBuffer> }>
}

/** What a caller wants to hear about while it runs. */
export interface Listening {
  /** A piece of sound, as the WAV the transcriber takes. Only while `pieces` is
   *  asked for; a plain recording taps nothing. */
  piece?: (wav: Uint8Array<ArrayBuffer>) => void
  /** How long a piece is, in seconds. */
  seconds?: number
  /** The recording grew past what one file may be. It has stopped itself. */
  full?: () => void
}

/** Opens the microphone and starts writing.
 *
 *  Throws where there is no microphone or the reader said no, with the browser's own
 *  error: "permission denied" and "no device" are two different things to be told,
 *  and only the platform knows which happened. And throws where the platform answers
 *  nothing at all, which is what `PATIENCE` is about: this never hangs. */
export async function record(listening: Listening = {}): Promise<Recording> {
  const type = bestContainer()
  if (type === null) throw new Error('this build cannot record')

  const stream = await opened()

  const recorder = new MediaRecorder(stream, type ? { mimeType: type } : {})
  const chunks: Blob[] = []
  let held = 0
  let full = false

  const started = performance.now()
  const tap = listening.piece ? listen(stream, listening.piece, listening.seconds ?? 20) : null

  const close = () => {
    tap?.close()
    for (const track of stream.getTracks()) track.stop()
  }

  recorder.ondataavailable = (event) => {
    if (!event.data.size) return

    chunks.push(event.data)
    held += event.data.size
    if (held <= MOST_BYTES || full) return

    // Stopped here rather than refused later: the next five seconds would be five
    // more megabytes, and what is already recorded is worth keeping.
    full = true
    listening.full?.()
    if (recorder.state !== 'inactive') recorder.stop()
  }

  recorder.start(HANDOVER)

  return {
    get extension() {
      return extensionOf(recorder.mimeType || type)
    },
    stop: () =>
      new Promise((resolve) => {
        const done = () => {
          close()
          const kind = recorder.mimeType || type || 'audio/webm'
          void new Blob(chunks, { type: kind })
            .arrayBuffer()
            .then((bytes) =>
              resolve({ bytes, seconds: (performance.now() - started) / 1000, ...tap?.last() }),
            )
        }

        if (recorder.state === 'inactive') {
          done()
          return
        }

        recorder.onstop = done
        recorder.stop()
      }),
  }
}

/** The second reader: plain samples, cut into pieces of `seconds` and handed over as
 *  WAVs the transcriber takes.
 *
 *  A `ScriptProcessorNode` rather than an `AudioWorklet`, deliberately, and it is the
 *  one deprecated thing in this batch. A worklet wants its code at a URL of its own,
 *  and the app runs from three origins - `tauri://localhost`, a fresh port inside the
 *  glasses plugin, its own domain on the web - so the one thing a worklet needs is the
 *  one thing that is different everywhere. The way round that is a `blob:` URL holding
 *  the processor as source, which is exactly the shape the Even store's review already
 *  objects to in this bundle; see vite.even.config.ts. So: the node every one of the
 *  three engines still has, on the main thread, where the work per callback is a copy
 *  of sixteen thousand floats - about a third of a millisecond, which is nothing beside
 *  what it buys. */
/* eslint-disable @typescript-eslint/no-deprecated -- the paragraph above: a worklet
   needs its code at a URL, and the only portable URL is a `blob:` one holding source,
   which the glasses plugin's store review objects to. */
function listen(
  stream: MediaStream,
  piece: (wav: Uint8Array<ArrayBuffer>) => void,
  seconds: number,
): { close: () => void; last: () => { spare?: Uint8Array<ArrayBuffer> } } {
  const context = new AudioContext()
  const source = context.createMediaStreamSource(stream)
  const node = context.createScriptProcessor(BLOCK, 1, 1)
  // Silent: the point is to make the graph pull samples through the node, not to play
  // the room back into the room, which is a feedback loop and a fright.
  const quiet = context.createGain()
  quiet.gain.value = 0

  let held: Float32Array[] = []
  let count = 0
  const wanted = Math.round(seconds * context.sampleRate)

  /** Everything held, as one piece, and the buffer emptied. */
  const taken = (): Float32Array => {
    const whole = new Float32Array(count)
    let at = 0
    for (const block of held) {
      whole.set(block, at)
      at += block.length
    }

    held = []
    count = 0
    return whole
  }

  const wav = (samples: Float32Array): Uint8Array<ArrayBuffer> =>
    spoken([samples], context.sampleRate)

  node.onaudioprocess = (event) => {
    // Copied, because the node hands the same buffer back on the next callback.
    held.push(new Float32Array(event.inputBuffer.getChannelData(0)))
    count += event.inputBuffer.length
    if (count < wanted) return

    piece(wav(taken()))
  }

  source.connect(node)
  node.connect(quiet)
  quiet.connect(context.destination)

  return {
    close: () => {
      node.onaudioprocess = null
      source.disconnect()
      node.disconnect()
      quiet.disconnect()
      void context.close().catch(() => undefined)
    },
    /** What was left over when it was closed: the last few seconds, which are a
     *  sentence like any other and would otherwise be the one part of a meeting the
     *  transcript is missing. */
    last: () => {
      // A tenth of a second of a door closing is not a sentence.
      if (count < context.sampleRate / 10) return {}
      return { spare: wav(taken()) }
    },
  }
}
/* eslint-enable @typescript-eslint/no-deprecated */
