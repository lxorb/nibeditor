// /loop's words and its pacing, against a fake turn.

import { describe, expect, test } from 'vitest'
import type { Turn } from '../chat/types'
import {
  CARRY_ON,
  intervalIn,
  loopAsk,
  loopPrompt,
  nextIn,
  PACED,
  PACING,
  runLoop,
  SHORTEST,
} from './loop'
import type { Ended } from './types'

const said = (text: string): Ended => ({
  stop: 'end',
  turn: { id: 'm', role: 'model', at: 0, parts: [{ kind: 'text', text }] },
  usage: null,
})

describe('/loop', () => {
  test('reads an interval first, and the prompt after it', () => {
    expect(loopAsk('5m check the inbox')).toEqual({ every: 5 * 60_000, prompt: 'check the inbox' })
    expect(loopAsk('2h')).toEqual({ every: 2 * 3_600_000, prompt: '' })
    expect(loopAsk('check the inbox')).toEqual({ every: null, prompt: 'check the inbox' })
    expect(intervalIn('10s')).toBe(SHORTEST)
    expect(intervalIn('15 minutes')).toBe(15 * 60_000)
    expect(intervalIn('9d')).toBe(24 * 3_600_000)
    expect(intervalIn('soon')).toBeNull()
  })

  test("runs the prompt given, else the reader's last message, else carries on", () => {
    const you = (text: string): Turn => ({
      id: text,
      role: 'you',
      at: 0,
      parts: [],
      draft: { text, attachments: [] },
    })
    expect(loopPrompt({ every: null, prompt: 'x' }, null)).toBe('x')
    expect(loopPrompt({ every: null, prompt: '' }, { turns: [you('a'), you('b')] })).toBe('b')
    expect(loopPrompt({ every: null, prompt: '' }, { turns: [] })).toBe(CARRY_ON)
  })

  test("reads the model's own pace from its last next: line", () => {
    expect(nextIn('All good.\nnext: 20m')).toBe(20 * 60_000)
    expect(nextIn('next: 5m\nmore\n`next: done`')).toBe('done')
    expect(nextIn('nothing said')).toBeNull()
  })

  test('paces itself, and ends when the model says it is done', async () => {
    const answers = [said('one\nnext: 3m'), said('two'), said('three\nnext: done')]
    const sent: string[] = []
    const waits: number[] = []
    const ends: string[] = []
    await runLoop(
      { every: null, prompt: 'look' },
      'look',
      {
        turn: (text) => {
          sent.push(text)
          return Promise.resolve(answers[sent.length - 1] ?? said('next: done'))
        },
        wait: (ms) => {
          waits.push(ms)
          return Promise.resolve()
        },
        ended: (why) => ends.push(why),
      },
      new AbortController().signal,
    )
    expect(sent).toEqual([`look\n\n${PACING}`, `look\n\n${PACING}`, `look\n\n${PACING}`])
    expect(waits).toEqual([3 * 60_000, PACED])
    expect(ends).toEqual([''])
  })

  test('keeps its interval until stopped, and stops on an error the reader has to fix', async () => {
    const stopper = new AbortController()
    let runs = 0
    await runLoop(
      { every: 60_000, prompt: 'p' },
      'p',
      {
        turn: (text) => {
          expect(text).toBe('p')
          if (++runs === 3) stopper.abort()
          return Promise.resolve(said('ok'))
        },
        wait: () => Promise.resolve(),
        ended: () => undefined,
      },
      stopper.signal,
    )
    expect(runs).toBe(3)

    const ends: string[] = []
    await runLoop(
      { every: 60_000, prompt: 'p' },
      'p',
      {
        turn: () =>
          Promise.resolve({ stop: 'error', error: 'signed out', turn: null, usage: null }),
        wait: () => Promise.resolve(),
        ended: (why) => ends.push(why),
      },
      new AbortController().signal,
    )
    expect(ends).toEqual(['signed out'])
  })
})
