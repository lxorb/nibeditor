/** What a room says over a socket.
 *
 *  Two messages, and they are the ones every Yjs client has spoken since
 *  y-websocket: a sync message, which carries either a state vector or the
 *  updates the other side is missing, and an awareness message, which carries
 *  who is there and where their caret is. The framing is a single number in
 *  front; the bodies are `y-protocols`, the reference implementation, so nothing
 *  about the wire is invented here.
 *
 *  One module for both ends. The app's client and the Worker's room do exactly
 *  the same thing with an arriving message - hand it to the protocol, send back
 *  whatever the protocol wrote - and the only difference is what each does with
 *  an update afterwards. Written once so the two cannot drift apart. */

import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import type { Awareness } from 'y-protocols/awareness'
import {
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness'
import { readSyncMessage, writeSyncStep1, writeUpdate } from 'y-protocols/sync'
import type * as Y from 'yjs'

/** The one shared value in a room: the note's markdown, under a name both ends
 *  ask for. */
export const TEXT = 'note'

/** The two message kinds, as y-websocket numbered them. */
const SYNC = 0
const AWARENESS = 1

/** The sync messages: the question (step 1), what the other end was missing (step 2),
 *  and one update on its way round. Their own numbers, inside a sync message, as
 *  `y-protocols` numbers them. */
const STEP1 = 0
const STEP2 = 1
const UPDATE = 2

/** How a socket carries the session it was opened with.
 *
 *  In the subprotocol, because a browser will not put a header on a WebSocket and a
 *  token in the address is a token in a log. A subprotocol is a header the browser
 *  sets itself, and the server names it back so the handshake completes. Both ends
 *  are here, so the name the client offers and the name the server reads cannot
 *  drift apart. */
const TOKEN = 'nib.token.'

export function subprotocol(token: string): string {
  return `${TOKEN}${token}`
}

/** The session token a socket announced, or null. */
export function tokenOf(header: string | undefined): string | null {
  const offered = (header ?? '').split(',').map((one) => one.trim())
  const carrying = offered.find((one) => one.startsWith(TOKEN))

  return carrying ? carrying.slice(TOKEN.length) : null
}

function framed(kind: number, write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, kind)
  write(encoder)
  return encoding.toUint8Array(encoder)
}

/** "Here is what I have; send me what I am missing." What either end opens with. */
export function syncStep1(doc: Y.Doc): Uint8Array {
  return framed(SYNC, (encoder) => writeSyncStep1(encoder, doc))
}

/** "Here is what I have", said with a state vector rather than a document: sync v2's
 *  device opening with pending edits names its confirmed state, so the room answers
 *  with what the account holds beyond it and nothing of the device's own. */
export function syncStep1Of(sv: Uint8Array): Uint8Array {
  return framed(SYNC, (encoder) => {
    encoding.writeVarUint(encoder, STEP1)
    encoding.writeVarUint8Array(encoder, sv)
  })
}

/** "Here is what you were missing", sent when this end chooses rather than as the
 *  protocol's automatic answer: what a v2 device sends once it has classified. */
export function syncStep2Of(update: Uint8Array): Uint8Array {
  return framed(SYNC, (encoder) => {
    encoding.writeVarUint(encoder, STEP2)
    encoding.writeVarUint8Array(encoder, update)
  })
}

/** A sync message read rather than applied: what a v2 device holding pending edits does
 *  with everything the room says until it has decided whether to meet it. Null for an
 *  awareness message or bytes that are not this protocol. Updates are y-protocols' own
 *  encoding (V1). */
export type SyncMessage =
  | { kind: 'step1'; sv: Uint8Array }
  | { kind: 'step2'; update: Uint8Array }
  | { kind: 'update'; update: Uint8Array }

export function readSync(message: Uint8Array): SyncMessage | null {
  try {
    const decoder = decoding.createDecoder(message)
    if (decoding.readVarUint(decoder) !== SYNC) return null
    const kind = decoding.readVarUint(decoder)
    const bytes = decoding.readVarUint8Array(decoder)
    if (kind === STEP1) return { kind: 'step1', sv: bytes }
    if (kind === STEP2) return { kind: 'step2', update: bytes }
    if (kind === UPDATE) return { kind: 'update', update: bytes }
    return null
  } catch {
    return null
  }
}

/** One update, on its way to everybody else. */
export function syncUpdate(update: Uint8Array): Uint8Array {
  return framed(SYNC, (encoder) => writeUpdate(encoder, update))
}

/** What some of the room knows about itself, on its way to everybody else. */
export function awarenessUpdate(awareness: Awareness, clients: readonly number[]): Uint8Array {
  return framed(AWARENESS, (encoder) =>
    encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(awareness, [...clients])),
  )
}

/** Everyone the sender knows about, for a client that has just arrived. Null
 *  when it knows about nobody, which is a message not worth sending. */
export function awarenessState(awareness: Awareness): Uint8Array | null {
  const clients = [...awareness.getStates().keys()]
  return clients.length ? awarenessUpdate(awareness, clients) : null
}

/** A message that arrived, applied. Answers what to send straight back to
 *  whoever sent it - the missing updates in answer to a state vector - and null
 *  when there is nothing to say.
 *
 *  `origin` is what marks the changes as having come from this sender, so that
 *  whoever is watching the document for updates knows not to send them back the
 *  way they came.
 *
 *  A message that does not read as one is answered with nothing at all. What
 *  arrives here is bytes off a socket - from a build that speaks something else,
 *  a frame that was cut in half, or somebody in the room sending whatever they
 *  like - and the only thing to do with bytes that are not this protocol is
 *  drop them. Letting the decoder throw instead would take down the room the
 *  frame arrived on: on a client an unhandled rejection and a note that never
 *  finishes joining, and in the Worker a socket that dies mid-conversation. */
export function receive(
  message: Uint8Array,
  doc: Y.Doc,
  awareness: Awareness,
  origin: unknown,
): Uint8Array | null {
  try {
    return applied(message, doc, awareness, origin)
  } catch {
    return null
  }
}

function applied(
  message: Uint8Array,
  doc: Y.Doc,
  awareness: Awareness,
  origin: unknown,
): Uint8Array | null {
  const decoder = decoding.createDecoder(message)
  const kind = decoding.readVarUint(decoder)

  if (kind === AWARENESS) {
    applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), origin)
    return null
  }

  if (kind !== SYNC) return null

  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, SYNC)
  readSyncMessage(decoder, encoder, doc, origin)

  // One byte is the kind and nothing after it: the protocol had no answer, and
  // sending the bare frame would only make the other end decode a nothing.
  return encoding.length(encoder) > 1 ? encoding.toUint8Array(encoder) : null
}

/** Whether a message is the other end answering with everything this one was
 *  missing, which is the moment a client knows it has caught up. What tells a
 *  device that has just joined that it may now compare the room's words with the
 *  ones in the file it opened.
 *
 *  A message that cannot be read is not that answer, for the reason `receive`
 *  gives: this is asked of every frame that arrives, and one bad frame must not
 *  be the end of the conversation. */
export function isCatchUp(message: Uint8Array): boolean {
  try {
    const decoder = decoding.createDecoder(message)
    return decoding.readVarUint(decoder) === SYNC && decoding.readVarUint(decoder) === STEP2
  } catch {
    return false
  }
}

/** Whether a message would write into the shared text.
 *
 *  What the room asks before it hands anything from a read-only socket to the
 *  protocol. Being in a room and reading it are two things a reader may do -
 *  asking what the room holds, and saying where their caret is - and writing
 *  into it is the one they may not. A message that cannot be read at all counts
 *  as an edit: the only thing to do with one is drop it, and dropping it here
 *  is where that is decided. */
export function isEdit(message: Uint8Array): boolean {
  try {
    const decoder = decoding.createDecoder(message)
    if (decoding.readVarUint(decoder) !== SYNC) return false

    const kind = decoding.readVarUint(decoder)
    return kind === STEP2 || kind === UPDATE
  } catch {
    return true
  }
}

/** Takes away the clients a socket had announced. What a room does when one
 *  leaves, so the carets go with it. */
export function forget(awareness: Awareness, clients: readonly number[], origin: unknown) {
  if (clients.length) removeAwarenessStates(awareness, [...clients], origin)
}

/** A room is a place rather than somebody in it, and it never sleeps on a timer.
 *
 *  The protocol gives whoever holds an awareness an entry of their own and starts
 *  a timer to keep it fresh. Neither is right for a room. Its own entry would
 *  show up in every editor as a caret nobody owns, and its timer would keep the
 *  object awake for as long as anybody had the note open, when sleeping is
 *  exactly what makes a note nobody is typing in cost nothing. Nothing is lost:
 *  the room has no caret to renew, and a socket closing is what tells it that
 *  somebody left. */
export function unattended(awareness: Awareness) {
  awareness.setLocalState(null)

  // The protocol's own field, typed as whatever the runtime it was written for
  // returns from `setInterval`. Read as a number, which is what a browser and
  // workerd both hand back and what `clearInterval` takes either way.
  const timer: unknown = awareness._checkInterval
  if (typeof timer === 'number') clearInterval(timer)
}
