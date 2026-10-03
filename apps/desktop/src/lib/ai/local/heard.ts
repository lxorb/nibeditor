/** What one line from Claude Code or Codex comes to, whichever of the two said it.
 *
 *  Both programs print one JSON event per line, in shapes of their own; claude.ts and
 *  codex.ts each read their own into this, so the rest - the answer as it grows, the
 *  model that wrote it, the plan's limit, the sentence a failure ends in - is written
 *  once. Pure. */

/** Where a plan stands, as its program last said. */
export interface Limit {
  /** `near` when the program warned, `reached` when it refused. */
  state: 'fine' | 'near' | 'reached'
  /** When the window resets, in milliseconds since the epoch, where the program said
   *  so as a time. */
  until: number | null
  /** The same, as the program wrote it, where it wrote words rather than a time. */
  untilWords: string | null
}

/** A call of one of nib's tools, as the program says it started or was answered. */
export interface ToolHeard {
  id: string
  /** The tool's name in `nib mcp`, without the program's prefix (`read_note`). */
  name: string
  args?: unknown
  /** Its answer, once there is one. */
  done?: { text: string; error: boolean }
}

/** A request's counts, as far as the program said them; see `Usage` in lib/ai/chat. */
export interface Counted {
  /** Everything sent, cached or not. */
  input?: number
  cached?: number
  output?: number
  reasoning?: number
  /** The model's window, where the program says. */
  window?: number
}

/** How a turn ended, in a session. A stop the engine asked for is told by the engine. */
export type TurnEnd = 'end' | 'stopped' | 'error'

export interface Heard {
  /** More of the answer. */
  text?: string
  /** More of the thinking, in words, where the program gives them. */
  thinking?: string
  /** A tool call started or answered. */
  tool?: ToolHeard
  /** The counts of the request that just ended. */
  usage?: Counted
  /** The turn is over. */
  ended?: TurnEnd
  /** The older turns became a summary. */
  compacted?: boolean
  /** Which model is answering. */
  model?: string
  /** Where the plan stands. */
  limit?: Limit
  /** Why the answer failed, in the program's own words. */
  trouble?: string
  /** Whether that failure is the program not being signed in. */
  signedOut?: boolean
}

/** A line as JSON, or null for one that is not. A program prints the odd line that is
 *  not an event - a warning, an update notice - and that is no reason to stop reading. */
export function eventIn(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    // Not JSON: not an event; see above.
    return null
  }
}

/** Whether a program's words say it is not signed in. */
export function saysSignedOut(words: string): boolean {
  return /not logged in|please run \/login|not signed in|invalid api key|401|unauthori[sz]ed|oauth token (?:has )?expired/i.test(
    words,
  )
}

/** Whether a program's words are its plan's limit being reached. */
export function saysLimit(words: string): boolean {
  return /usage limit|hit your (?:usage )?limit|limit reached|rate limit/i.test(words)
}
