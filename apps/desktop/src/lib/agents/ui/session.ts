/** An agent's session as the audit log has it: the list the panel shows, and the same
 *  list written into a note (docs/agent-native.md 9.5).
 *
 *  The log is one JSON line a call, from a file the crate writes; nothing in it is
 *  trusted to have a shape until it has been read here. What the panel wants of a line
 *  is when, what it was in a word, what it was about - the page's address or the
 *  note's path - and whether it went through. */

import { i18n } from '../../i18n.svelte'
import { nameOf } from '../../space-paths'
import { wordFor } from './words'

/** One call, read. */
export interface Call {
  /** Which line of the day it is: the one thing two calls in the same millisecond do
   *  not share. */
  seq: number
  /** Milliseconds since 1970. */
  at: number
  agent: string
  verb: string
  tab: string | null
  /** The address a call went to, when it named one. */
  url: string | null
  /** The note a call was about, relative to its space, when it named one. */
  path: string | null
  status: 'ok' | 'needs_approval' | 'error'
}

/** How many calls the panel keeps of a session: an afternoon's work, and not a list
 *  that takes a second to draw. */
const KEPT = 200

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/** One line of the log, or null for a line that is not a call anybody would want to
 *  read about: bookkeeping, or a shape this build does not know. */
export function readCall(line: unknown, seq = 0): Call | null {
  if (!isRecord(line)) return null

  const { at, agent, verb, tab, args, status } = line
  if (typeof at !== 'number' || typeof agent !== 'string' || typeof verb !== 'string') return null
  if (status !== 'ok' && status !== 'needs_approval' && status !== 'error') return null
  if (wordFor(verb) === null) return null

  const named = isRecord(args) ? args : {}
  const url = text(named.url)

  return {
    seq,
    at,
    agent,
    verb,
    tab: text(tab),
    url: url !== null && /^https?:\/\//i.test(url) ? url : null,
    path: text(named.path),
    status,
  }
}

/** One agent's calls, newest first, at most `KEPT` of them. */
export function callsOf(lines: readonly unknown[], agent: string): Call[] {
  const calls: Call[] = []

  for (let at = lines.length - 1; at >= 0 && calls.length < KEPT; at--) {
    const call = readCall(lines[at], at)
    if (call?.agent === agent) calls.push(call)
  }

  return calls
}

/** Today, as the log names its files: the date in UTC, which is what the crate writes
 *  them under. */
export function today(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10)
}

/** What a call was about, as words: the site's name, the note's, or nothing. */
export function aboutOf(call: Call, titleOf: (tab: string) => string | null): string | null {
  if (call.path !== null) return nameOf(call.path).replace(/\.md$/i, '')
  if (call.url !== null) return hostOf(call.url)
  return call.tab === null ? null : titleOf(call.tab)
}

/** A site's name out of an address, or the words as they are where they are not one:
 *  `about:blank`, or a question that named the site already. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    // Not an address a parser takes: said as it is.
    return url
  }
}

/** The session written into a note: a heading with the agent and the day, and one line
 *  a call, oldest first, with a link to each page and each note it touched. */
export function sessionMarkdown(name: string, calls: readonly Call[]): string {
  const ordered = [...calls].reverse()
  const first = ordered[0]
  const day = first ? i18n.when(first.at, { day: 'numeric', month: 'long', year: 'numeric' }) : ''
  const lines = ordered.map((call) => {
    const time = i18n.when(call.at, { hour: '2-digit', minute: '2-digit' })
    const word = wordFor(call.verb) ?? call.verb
    const link =
      call.path !== null
        ? ` [[${call.path.replace(/\.md$/i, '')}]]`
        : call.url !== null
          ? ` [${hostOf(call.url)}](${call.url})`
          : ''
    const mark = call.status === 'error' ? ' ✗' : call.status === 'needs_approval' ? ' ?' : ''
    return `- ${time} ${word}${link}${mark}`
  })

  return `## ${name}, ${day}\n\n${lines.join('\n')}\n`
}
