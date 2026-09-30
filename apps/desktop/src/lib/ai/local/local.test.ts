/** The pure half of the programs on this machine: a conversation as one prompt, a run
 *  that did not answer as nib's sentence, and whether a program is signed in, from its
 *  own answer. */

import { describe, expect, test } from 'vitest'
import { promptFor } from './prompt'
import { loginLine } from './signin'
import { saidIn, standingOf } from './standing'
import { troubleOf } from './trouble'

describe('a conversation as one prompt', () => {
  test('the rules, the conversation, then the question', () => {
    const prompt = promptFor([
      { role: 'system', content: 'Cite by number.' },
      { role: 'system', content: '<passage n="1">Herons</passage>' },
      { role: 'user', content: 'What waits?' },
      { role: 'assistant', content: 'Herons [1].' },
      { role: 'user', content: 'For how long?' },
    ])

    expect(prompt).toBe(
      [
        '<instructions>\nCite by number.\n\n<passage n="1">Herons</passage>\n</instructions>',
        '<conversation>\n<user>\nWhat waits?\n</user>\n<assistant>\nHerons [1].\n</assistant>\n</conversation>',
        '<user>\nFor how long?\n</user>',
      ].join('\n\n'),
    )
  })

  test('a lone question is just the question', () => {
    expect(promptFor([{ role: 'user', content: 'Hi' }])).toBe('<user>\nHi\n</user>')
  })
})

const ENDED = { code: 0, timedOut: false, stopped: false, err: '' }

describe('a run that did not answer', () => {
  test('an answer is no trouble', () => {
    expect(troubleOf('Claude Code', 'Claude', {}, ENDED, true)).toBeNull()
  })

  test('the plan at its limit is the reader’s own plan', () => {
    const said = troubleOf(
      'Claude Code',
      'Claude',
      { limit: { state: 'reached', until: null, untilWords: null } },
      { ...ENDED, code: 1 },
      false,
    )
    expect(said).toBe('Your Claude plan is at its limit for now.')

    const until = troubleOf(
      'Codex',
      'ChatGPT',
      { limit: { state: 'reached', until: null, untilWords: '3:05 PM' } },
      { ...ENDED, code: 1 },
      false,
    )
    expect(until).toBe('Your ChatGPT plan is at its limit until 3:05 PM.')
  })

  test('signed out, out of time and out of date each say what to do', () => {
    expect(troubleOf('Codex', 'ChatGPT', { signedOut: true, trouble: 'x' }, ENDED, false)).toBe(
      'Sign in to Codex first.',
    )
    expect(troubleOf('Codex', 'ChatGPT', {}, { ...ENDED, code: null, timedOut: true }, false)).toBe(
      'Codex took too long to answer.',
    )
    expect(
      troubleOf(
        'Claude Code',
        'Claude',
        {},
        { ...ENDED, code: 1, err: "error: unknown option '--tools'" },
        false,
      ),
    ).toBe('Claude Code is out of date. Update it and try again.')
  })

  test('anything else is the program’s own last word', () => {
    expect(
      troubleOf(
        'Codex',
        'ChatGPT',
        {},
        { ...ENDED, code: 3, err: 'warn\nthe real reason\n' },
        false,
      ),
    ).toBe('the real reason')
    expect(troubleOf('Codex', 'ChatGPT', {}, { ...ENDED, code: 3 }, false)).toBe(
      'The model did not answer.',
    )
  })
})

describe('whether a program is signed in, as it says', () => {
  const said = (out: string, code: number, err = '') =>
    saidIn({ program: 'C:\\bin\\claude.cmd', out, code, err, timedOut: false })

  test('not installed', () => {
    expect(standingOf('claude-code', null).state).toBe('missing')
    expect(saidIn({ out: 'no program' })).toBeNull()
  })

  test('Claude Code names its plan and whose it is', () => {
    const status = JSON.stringify(
      { loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max', email: 'r@example.com' },
      null,
      2,
    )
    expect(standingOf('claude-code', said(status, 0))).toEqual({
      state: 'in',
      program: 'C:\\bin\\claude.cmd',
      plan: 'Max',
      account: 'r@example.com',
    })
    expect(standingOf('claude-code', said('{"loggedIn": false}', 1)).state).toBe('out')
    expect(
      standingOf('claude-code', said('{"loggedIn": true, "authMethod": "console"}', 0)).plan,
    ).toBe('API key')
  })

  test('an older Claude Code with no status is left to the question', () => {
    expect(standingOf('claude-code', said('', 0)).state).toBe('unknown')
    expect(standingOf('claude-code', said('', 1, 'error: unknown command')).state).toBe('out')
  })

  test('Codex says it on stderr', () => {
    expect(standingOf('codex', said('', 0, 'Logged in using ChatGPT')).plan).toBe('ChatGPT')
    expect(standingOf('codex', said('', 0, 'Logged in using an API key - sk-...')).plan).toBe(
      'API key',
    )
    expect(standingOf('codex', said('', 1, 'Not logged in')).state).toBe('out')
  })
})

describe('the line a terminal signs in with', () => {
  test('Command Prompt gets the path in double quotes', () => {
    expect(loginLine('claude-code', 'C:/Users/A B/npm/claude.cmd', true)).toBe(
      '"C:/Users/A B/npm/claude.cmd" auth login',
    )
  })

  test('a POSIX shell gets it in single quotes, a quote in it closed and reopened', () => {
    expect(loginLine('codex', "/Users/o'neil/.local/bin/codex", false)).toBe(
      String.raw`'/Users/o'\''neil/.local/bin/codex' login`,
    )
  })
})
