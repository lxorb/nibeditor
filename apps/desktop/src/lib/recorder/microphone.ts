/** The microphone, and the file written from what it hears.
 *
 *  A recording is written by `MediaRecorder`, into the best container the platform
 *  gives, and that file is what lands beside the note: Opus at 24 kB a minute rather
 *  than a WAV at two megabytes, and a file a phone, a browser and a desktop player
 *  will all open.
 *
 *  Nothing here knows about notes, commands or the status bar. It opens a microphone
 *  and answers with a file when it is stopped. */

import { key } from '../i18n.svelte'
import { bestContainer, extensionOf } from './container'

/** How often the file is asked for a piece.
 *
 *  Every five seconds: how often the recorder hands over what it has. A recorder asked only at the end holds the whole recording in one buffer inside the
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
        // What the browser's own processing is for. A recording is often a room and
        // several voices, and the three of these together are the difference between a
        // transcript of it later and a guess.
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
  /** Stops it, and answers with the file and how long it ran. */
  stop: () => Promise<{ bytes: ArrayBuffer; seconds: number }>
}

/** What a caller wants to hear about while it runs. */
export interface Listening {
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

  const close = () => {
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
            .then((bytes) => resolve({ bytes, seconds: (performance.now() - started) / 1000 }))
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
