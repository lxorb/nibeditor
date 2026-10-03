/** Commands, agents and output styles written as notes (docs/ai-sidebar.md 4.7).
 *
 *  A note whose front matter says `command: weekly` is `/weekly`: its body is the prompt,
 *  `description:` its words in the menu, and `model:`, `effort:` and `mode:` what that one
 *  send does differently. `agent: researcher` is a profile for `/agents`, its body the
 *  instructions and `model:`, `effort:`, `mode:` and `tools:` its defaults.
 *  `output-style: terse` is a style for `/output-style`, its body the line the model is
 *  told. Obsidian Copilot's and Raycast's way: the reader's own extensions are text they
 *  can read, sync and version, not a folder of the program's.
 *
 *  Arguments are Claude Code's: `$ARGUMENTS` for everything after the name,
 *  `$ARGUMENTS[0]` for the first word, `$1`, `$2` for the first and second, and a name
 *  from `arguments:` for its place. A body that asks for none gets them on the end. Pure:
 *  found.ts is what finds the notes. */

import { frontMatterList, frontMatterValue, stripFrontMatter } from '@nib/markdown/front-matter'
import { isEffort } from '../chat/effort'
import type { Effort, Mode } from '../chat/types'

export type NoteKind = 'command' | 'agent' | 'output-style'

/** The front matter keys each kind is found by, which are also its kind. */
export const NOTE_KEYS: readonly NoteKind[] = ['command', 'agent', 'output-style']

export interface NoteCommand {
  kind: NoteKind
  /** The name it answers to, without the slash, folded to lower case. */
  name: string
  path: string
  /** The prompt, the instructions or the style's line. */
  body: string
  description?: string
  model?: string
  effort?: Effort
  mode?: Mode
  /** A command's named arguments, in their order. */
  arguments: string[]
  /** An agent's tools, by name; empty for all of them. */
  tools: string[]
}

const MODES: readonly Mode[] = ['ask', 'plan', 'agent']

/** A name as a command can be typed: no slash, no spaces, lower case. */
export function commandName(value: string): string {
  return value
    .trim()
    .replace(/^\/+/, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
}

/** What a note is, for each of the three keys it carries. */
export function rolesOf(path: string, text: string): NoteCommand[] {
  const body = stripFrontMatter(text).trim()
  const value = (name: string) => frontMatterValue(text, name) ?? undefined
  const effort = value('effort')?.toLowerCase()
  const mode = value('mode')?.toLowerCase()
  const description = value('description')
  const model = value('model')
  const shared = {
    path,
    body,
    ...(description ? { description } : {}),
    ...(model ? { model } : {}),
    ...(isEffort(effort) ? { effort } : effort === 'extra' ? { effort: 'xhigh' as const } : {}),
    ...(MODES.find((one) => one === mode) ? { mode: mode as Mode } : {}),
    arguments: frontMatterList(text, 'arguments').map(commandName).filter(Boolean),
    tools: frontMatterList(text, 'tools'),
  }
  return NOTE_KEYS.flatMap((kind) => {
    const name = commandName(frontMatterValue(text, kind) ?? '')
    return name ? [{ kind, name, ...shared }] : []
  })
}

/** The words after a command's name, split as a shell splits them: on spaces, with
 *  quoted words kept whole. */
export function splitArgs(args: string): string[] {
  const out: string[] = []
  for (const found of args.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    out.push(found[1] ?? found[2] ?? found[3] ?? '')
  }
  return out
}

/** A command's body with its arguments in place. */
export function expand(command: Pick<NoteCommand, 'body' | 'arguments'>, args: string): string {
  const words = splitArgs(args)
  const used = { any: false }
  const ask = (value: string) => {
    used.any = true
    return value
  }
  let text = command.body
    .replace(/\$ARGUMENTS\[(\d+)\]/g, (_whole, at: string) => ask(words[Number(at)] ?? ''))
    .replace(/\$ARGUMENTS\b/g, () => ask(args.trim()))
    .replace(/\$(\d)\b/g, (_whole, at: string) => ask(words[Number(at) - 1] ?? ''))
  command.arguments.forEach((name, at) => {
    const pattern = new RegExp(`\\$${name.replace(/[-]/g, '\\-')}(?![\\w-])`, 'g')
    text = text.replace(pattern, () => ask(words[at] ?? ''))
  })
  if (!used.any && args.trim()) text = `${text}\n\n${args.trim()}`
  return text
}
