/** One call of an agent's workspace verb: what it said, who said it, and the few ways a
 *  verb answers.
 *
 *  Arguments crossed a boundary and are read through automation/args.ts, the reader
 *  both roads in already use. A verb that is missing what it needs says which
 *  argument, so the agent can put it right in one try. */

import { said, type Said, words, yes } from '../../automation/args'
import type { AgentAnswer, Caller } from '../../automation/caller'
import type { Agent as Writer } from '../docs/presence'
import { Refused } from './problem'

export interface Call {
  /** The verb, as the table names it: what a question is filed under. */
  verb: string
  args: Said
  caller: Caller
}

/** An argument the verb cannot go without, as words that say something. */
export function need(call: Call, name: string): string {
  const value = said(call.args, name)
  if (value === null) throw new Refused('bad_arguments', `say ${name}`)

  return value
}

/** An argument that may be left out, as words that say something. */
export function maybe(call: Call, name: string): string | null {
  return said(call.args, name)
}

/** An argument as written, an empty string included: a note's words. */
export function text(call: Call, name: string): string | null {
  return words(call.args, name)
}

export function flag(call: Call, name: string): boolean {
  return yes(call.args, name)
}

/** A whole number, or the fallback when it is not one; clamped to what the verb takes. */
export function count(call: Call, name: string, fallback: number, most: number): number {
  const value = Number(call.args[name])
  if (!Number.isFinite(value)) return fallback

  return Math.min(Math.max(1, Math.floor(value)), most)
}

/** A verb's answer when it did what it was asked. `untrusted` says where its words came
 *  from when that is outside nib: a page, a PDF, a space somebody shares (9.6). */
export function done(result: unknown, untrusted?: string | null): AgentAnswer {
  return untrusted
    ? { ok: true, status: 'ok', result, untrusted }
    : { ok: true, status: 'ok', result }
}

/** Who a version kept for a write was kept for, as the versions list says it: the
 *  agent's name, or nothing for the reader's own command line. */
export function sourceOf(call: Call): string | undefined {
  return call.caller.agent?.name
}

/** Who writes, as a note's caret and its versions name it. The reader's own command
 *  line writes as itself. */
export function writerOf(call: Call): Writer {
  const agent = call.caller.agent
  return agent ? { id: agent.id, name: agent.name } : { id: 'cli', name: 'nib' }
}

/** The agent's hold on a scope beyond the one its verb's row checked. */
function holding(call: Call, scope: string): boolean {
  return call.caller.agent === null || call.caller.agent.scopes.includes(scope)
}

/** The same, refusing without it. */
export function needScope(call: Call, scope: string, why: string): void {
  if (!holding(call, scope)) {
    throw new Refused('not_granted', `${why} needs ${scope}, which this agent was not granted`)
  }
}
