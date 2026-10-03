/** A session of Claude Code or Codex on this machine, through the crate: the AI
 *  sidebar's thread when the reader's plan answers it (docs/ai-sidebar.md 5.2), and
 *  every question Codex is asked.
 *
 *  The crate starts the program and writes everything it reads; this side names a tool,
 *  a provider, a mode, a model and an effort, says one of the things say.rs lists, and
 *  hears back each line the program printed, the answers to what it asked, and the end
 *  (see src-tauri/src/ai_cli.rs). Nothing here is a flag or a protocol message. */

import { identifier } from '../../identifier'
import { Channel } from '../../native'
import { invoke } from '../../tauri'
import { EDITS, READER_TABS } from '../chat/choices'
import type { LocalKind } from '../providers'
import type { Ending } from './trouble'

/** The tools a thread may use: a mode of the sidebar's, or none for words only. */
type ToolsOf = 'ask' | 'plan' | 'agent' | null

/** nib's effort scale as the crate takes it: `null` is the model's own default. */
export type Level = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** How a session starts. */
export interface Opening {
  tool: LocalKind
  /** The provider in Settings > AI whose built-in grant the tools are asked as. */
  agent: { id: string; name: string }
  mode: ToolsOf
  model: string | null
  effort: Level | null
  /** Codex: a copy of another open session's thread. */
  forkOf?: string
}

/** A picture with a message. */
interface Picture {
  mime: string
  data: string
}

/** What may be said to a session; see src-tauri/src/ai_cli/say.rs. */
type Say =
  | { kind: 'turn'; text: string; images: Picture[] }
  | { kind: 'steer'; text: string }
  | { kind: 'interrupt' }
  | { kind: 'model'; model: string }
  | { kind: 'effort'; effort: Level | null }
  | { kind: 'fast'; on: boolean }
  | { kind: 'compact'; focus: string }
  | { kind: 'context' }
  | {
      kind: 'goal'
      goal:
        | { do: 'set'; objective: string; budget?: number }
        | { do: 'pause' | 'resume' | 'clear' | 'get' }
    }

/** What a session says back. */
export type Heard =
  | { kind: 'line'; line: string }
  | { kind: 'reply'; to: string; result: unknown; error: string | null }
  | { kind: 'end'; end: Ending }

/** One message off the crate's channel, read rather than trusted. A question's channel
 *  (`ai_cli_ask`) carries the same `line` and `end`. */
export function heardIn(value: unknown): Heard | null {
  if (typeof value !== 'object' || value === null) return null
  const said = value as Record<string, unknown>
  if (said.kind === 'line' && typeof said.line === 'string')
    return { kind: 'line', line: said.line }
  if (said.kind === 'reply' && typeof said.to === 'string') {
    return {
      kind: 'reply',
      to: said.to,
      result: said.result ?? null,
      error: typeof said.error === 'string' ? said.error : null,
    }
  }
  if (said.kind !== 'end') return null
  return {
    kind: 'end',
    end: {
      code: typeof said.code === 'number' ? said.code : null,
      timedOut: said.timedOut === true,
      stopped: said.stopped === true,
      err: typeof said.err === 'string' ? said.err : '',
    },
  }
}

/** An open session. */
export interface Session {
  readonly id: string
  readonly opening: Opening
  /** Whether it has ended, by itself or by `close`. */
  readonly ended: boolean
  say(say: Say): Promise<void>
  close(): Promise<void>
}

/** Opens a session; everything it says goes to `heard`, its end last. A refusal to
 *  start is thrown with the crate's words (`missing`: not installed). */
export async function openSession(
  opening: Opening,
  heard: (said: Heard) => void,
): Promise<Session> {
  const id = `s-${identifier()}`
  let ended = false
  const channel = new Channel<unknown>()
  channel.onmessage = (value) => {
    const said = heardIn(value)
    if (!said) return
    if (said.kind === 'end') ended = true
    heard(said)
  }
  await invoke('ai_cli_open', {
    id,
    opening: {
      tool: opening.tool,
      // The grant's two choices, as the API loop makes it (lib/ai/chat/tools.ts): whichever
      // road a provider's thread takes first, the grant is the same.
      agent: { ...opening.agent, readerTabs: READER_TABS, askFirst: EDITS === 'ask-first' },
      mode: opening.mode,
      model: opening.model,
      effort: opening.effort,
      ...(opening.forkOf ? { forkOf: opening.forkOf } : {}),
    },
    output: channel,
  })
  return {
    id,
    opening,
    get ended() {
      return ended
    },
    async say(say) {
      await invoke('ai_cli_say', { id, say })
    },
    async close() {
      ended = true
      await invoke('ai_cli_close', { id }).catch(() => undefined)
    },
  }
}

/** The models a program offers, as it lists them; see models.ts. */
export async function listedModels(tool: LocalKind): Promise<unknown> {
  return await invoke<unknown>('ai_cli_models', { tool })
}
