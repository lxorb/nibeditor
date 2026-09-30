/** Codex's `exec --json`, in the shapes https://learn.chatgpt.com/docs/non-interactive-mode
 *  and codex-rs/exec/src/exec_events.rs give it. */

import { describe, expect, test } from 'vitest'
import { againAt, codexReader } from './codex'

const said = (event: object) => JSON.stringify(event)

describe('an answer', () => {
  test('is the agent message, and nothing the turn thought or ran', () => {
    const read = codexReader()
    const heard = [
      said({ type: 'thread.started', thread_id: 't' }),
      said({ type: 'turn.started' }),
      said({ type: 'item.completed', item: { id: 'item_0', type: 'reasoning', text: 'Hmm.' } }),
      said({
        type: 'item.completed',
        item: { id: 'item_1', type: 'command_execution', command: 'ls', aggregated_output: 'x' },
      }),
      said({ type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: 'ok' } }),
      said({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }),
    ].map(read)

    expect(heard.map((one) => one.text ?? '').join('')).toBe('ok')
  })

  test('a message updated and then completed says each word once', () => {
    const read = codexReader()
    const text = [
      said({ type: 'item.updated', item: { id: 'a', type: 'agent_message', text: 'Herons ' } }),
      said({ type: 'item.updated', item: { id: 'a', type: 'agent_message', text: 'Herons wait' } }),
      said({
        type: 'item.completed',
        item: { id: 'a', type: 'agent_message', text: 'Herons wait.' },
      }),
    ]
      .map(read)
      .map((one) => one.text ?? '')
      .join('')
    expect(text).toBe('Herons wait.')
  })

  test('a second message is a new paragraph', () => {
    const read = codexReader()
    const text = [
      said({ type: 'item.completed', item: { id: 'a', type: 'agent_message', text: 'One.' } }),
      said({ type: 'item.completed', item: { id: 'b', type: 'agent_message', text: 'Two.' } }),
    ]
      .map(read)
      .map((one) => one.text ?? '')
      .join('')
    expect(text).toBe('One.\n\nTwo.')
  })
})

describe('a failure', () => {
  const LIMIT =
    "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 3:05 PM."

  test('the plan at its limit says when, as Codex wrote it', () => {
    const heard = codexReader()(said({ type: 'turn.failed', error: { message: LIMIT } }))
    expect(heard.trouble).toBe(LIMIT)
    expect(heard.limit).toEqual({ state: 'reached', until: null, untilWords: '3:05 PM' })
  })

  test('an error event is read too, and signed out is told apart', () => {
    const heard = codexReader()(said({ type: 'error', message: 'Not logged in. Run codex login.' }))
    expect(heard.signedOut).toBe(true)
  })

  test('when to try again, in either of its spellings', () => {
    expect(againAt('Try again in 2 days 3 hours.')).toBe('2 days 3 hours')
    expect(againAt("You've hit your usage limit. Try again later.")).toBeNull()
  })
})
