/** What the three halves of the extension say to each other.
 *
 *  The popup draws, the service worker clips and saves, the content script
 *  reads the page. `chrome.runtime.sendMessage` hands whatever it is given
 *  straight across, so every message is checked on arrival into one of the
 *  shapes below, and a message that does not fit is a message that never
 *  happened. */

import { absolute, runsCode } from '@nib/markdown/addresses'
import type { Origin } from '@nib/markdown/article'
import type { Filled } from './interpret/values'
import { type Kind, KINDS } from './kinds'
import { isRecord, isString, listOf } from './stored'

/** A clip that has been read and converted but not yet saved: what the popup
 *  previews, and what it sends back when Save is pressed. The article's HTML is
 *  deliberately not in here - the markdown has replaced it, and a megabyte of
 *  it would cross between the two contexts twice for nothing. */
export interface Clip {
  origin: Origin
  /** When the page was read, so the preview and the saved note record the same
   *  instant rather than two a few seconds apart. */
  clipped: string
  /** With `nib:0` style placeholders where the pictures go; see `markdown.ts`. */
  markdown: string
  images: string[]
  /** What the interpreter filled in about the page, empty until it has been asked
   *  and empty for good where nobody asked. It travels with the clip so that the
   *  preview and the note that is saved say the same thing, the way the instant
   *  above does; see `interpret/`. */
  filled: Filled[]
}

export type Ask =
  { ask: 'clip'; kind: Kind } | { ask: 'save'; clip: Clip; spaceId: string; folder: string }

/** Either half of a clip, answered. Each carries what it produced or the one
 *  sentence saying why it produced nothing. */
export type Clipped = { clip: Clip } | { problem: string }
export type Saved = { path: string } | { problem: string }
export type Answer = Clipped | Saved

/** What the worker asks the page for. `link` is the address the context menu
 *  was opened on, and is null everywhere else. */
export interface Reading {
  read: Kind
  link: string | null
}

function readKind(value: unknown): Kind | null {
  return KINDS.find((one) => one === value) ?? null
}

/** An address, normalised the way a browser writes it, or null for anything
 *  else.
 *
 *  Normalised rather than merely checked: the note states it in its front matter
 *  and, for a clipped link, as the one thing in its body, so a `>`, a space or a
 *  line break left in it would end the field it sits in. A right clicked link is
 *  whatever the markup wrote, so a `data:` document is refused here as well as
 *  code the browser would run. */
function readUrl(value: unknown): string | null {
  if (!isString(value)) return null

  const address = absolute(value)
  if (!address || runsCode(address) || address.protocol === 'data:') return null

  return address.href
}

function readOrigin(value: unknown): Origin | null {
  if (!isRecord(value)) return null

  const kind = readKind(value.kind)
  const url = readUrl(value.url)
  if (!kind || url === null || !isString(value.title)) return null

  return {
    kind,
    url,
    title: value.title,
    tags: listOf(value.tags, (one) => (isString(one) ? one : null)),
  }
}

/** One property the interpreter filled, coming back from the popup with the clip
 *  it belongs to.
 *
 *  Checked here as strictly as `interpret/values.ts` checked it when it came out of
 *  the model, because this is a second boundary and not the same one: what arrives
 *  is whatever the sender put in the message, and it is about to be written into a
 *  file. A row whose key is not a name, or whose value is neither a line nor a list
 *  of lines, is a row that never happened. */
const PROPERTY = /^[A-Za-z_][\w-]*$/

function readFilledRow(value: unknown): Filled | null {
  if (!isRecord(value) || !isString(value.key) || !PROPERTY.test(value.key)) return null

  if (isString(value.value)) return { key: value.key, value: value.value }
  if (!Array.isArray(value.value)) return null

  const items = listOf(value.value, (one) => (isString(one) ? one : null))
  return items.length === value.value.length ? { key: value.key, value: items } : null
}

export function readClip(value: unknown): Clip | null {
  if (!isRecord(value)) return null

  const origin = readOrigin(value.origin)
  if (!origin || !isString(value.markdown) || !isString(value.clipped)) return null

  // The instant is written into the front matter as a date, and a `Date` that
  // did not parse throws on the way there rather than where it was read.
  if (!Number.isFinite(Date.parse(value.clipped))) return null

  return {
    origin,
    clipped: value.clipped,
    markdown: value.markdown,
    images: listOf(value.images, (one) => (isString(one) ? one : null)),
    filled: listOf(value.filled, readFilledRow),
  }
}

export function readAsk(value: unknown): Ask | null {
  if (!isRecord(value)) return null

  if (value.ask === 'clip') {
    const kind = readKind(value.kind)
    return kind ? { ask: 'clip', kind } : null
  }

  if (value.ask === 'save') {
    const clip = readClip(value.clip)
    if (!clip || !isString(value.spaceId) || !isString(value.folder)) return null

    return { ask: 'save', clip, spaceId: value.spaceId, folder: value.folder }
  }

  return null
}

export function readReading(value: unknown): Reading | null {
  if (!isRecord(value)) return null

  const kind = readKind(value.read)
  return kind ? { read: kind, link: isString(value.link) ? value.link : null } : null
}

export function readAnswer(value: unknown): Answer | null {
  if (!isRecord(value)) return null
  if (isString(value.problem)) return { problem: value.problem }
  if (isString(value.path)) return { path: value.path }

  const clip = readClip(value.clip)
  return clip ? { clip } : null
}

/** The worker, asked. A worker that was stopped and could not start, or one
 *  that threw before answering, reads as no answer rather than as a throw at
 *  the call site. */
export async function ask(request: Ask): Promise<Answer | null> {
  try {
    return readAnswer(await chrome.runtime.sendMessage(request))
  } catch {
    return null
  }
}
