/** A conversation as the one message a program on this machine is sent.
 *
 *  Claude Code and Codex each take a question on stdin and answer it; neither takes a
 *  conversation from outside. So what the other providers are sent as separate messages
 *  is written into one: the app's instructions for this request first (the rules, the
 *  note, the passages of a question - what the others get as system messages), then
 *  the conversation so far, then the question. Tags rather than headings, so a note's
 *  own headings can never be read as the prompt's.
 *
 *  Claude Code is told, in the one line of system prompt the crate gives it, that the
 *  message begins with the app's instructions; see `SYSTEM` in src-tauri/src/ai_cli/args.rs.
 *  Pure. */

import type { Message } from '../providers'

export function promptFor(messages: readonly Message[]): string {
  const rules = messages.filter((one) => one.role === 'system').map((one) => one.content)
  const said = messages.filter((one) => one.role !== 'system')
  const question = said.at(-1)
  const before = said.slice(0, -1)

  const parts: string[] = []
  if (rules.length) parts.push(`<instructions>\n${rules.join('\n\n')}\n</instructions>`)
  if (before.length) {
    const turns = before.map((one) => `<${one.role}>\n${one.content}\n</${one.role}>`)
    parts.push(`<conversation>\n${turns.join('\n')}\n</conversation>`)
  }
  if (question) parts.push(`<${question.role}>\n${question.content}\n</${question.role}>`)
  return parts.join('\n\n')
}
