import { describe, expect, test } from 'vitest'
import { Latest } from './latest'

/** A crate that answers when the test says so, in whatever order it says. */
function crate() {
  const sent: number[] = []
  const answers: { one: number; land: () => void; refuse: () => void }[] = []
  const latest = new Latest<number>(
    (one) =>
      new Promise<void>((land, refuse) => {
        sent.push(one)
        answers.push({ one, land, refuse: () => refuse(new Error('gone')) })
      }),
  )
  return { latest, sent, answers }
}

const settled = () => new Promise((go) => setTimeout(go, 0))

describe('one placement in the air', () => {
  test('the first is sent at once', () => {
    const { latest, sent } = crate()
    void latest.put(1)
    expect(sent).toEqual([1])
  })

  test('nothing more is sent while one is flying', () => {
    const { latest, sent } = crate()
    void latest.put(1)
    void latest.put(2)
    void latest.put(3)
    expect(sent).toEqual([1])
  })

  test('only the newest of those waiting follows it, never one in between', async () => {
    const { latest, sent, answers } = crate()
    void latest.put(1)
    void latest.put(2)
    void latest.put(3)
    void latest.put(4)
    answers[0]?.land()
    await settled()
    expect(sent).toEqual([1, 4])
  })

  test('the last word is always the one that lands last', async () => {
    const { latest, sent, answers } = crate()
    for (let frame = 1; frame <= 30; frame++) {
      void latest.put(frame)
      if (frame % 4 === 0) answers.at(-1)?.land()
      await settled()
    }
    answers.at(-1)?.land()
    await settled()
    answers.at(-1)?.land()
    await settled()
    expect(sent.at(-1)).toBe(30)
    // Each sent after the one before it, so the order the crate sees is the order said.
    expect([...sent].sort((a, b) => a - b)).toEqual(sent)
    expect(latest.idle).toBe(true)
  })

  test('a replaced placement answers when the one that carried it lands', async () => {
    const { latest, answers } = crate()
    void latest.put(1)
    let second = false
    let third = false
    void latest.put(2).then(() => (second = true))
    void latest.put(3).then(() => (third = true))
    answers[0]?.land()
    await settled()
    expect([second, third]).toEqual([false, false])
    answers[1]?.land()
    await settled()
    expect([second, third]).toEqual([true, true])
  })

  test('a refused call does not hold up the one behind it', async () => {
    const { latest, sent, answers } = crate()
    const first = latest.put(1).catch(() => 'refused')
    void latest.put(2)
    answers[0]?.refuse()
    expect(await first).toBe('refused')
    await settled()
    expect(sent).toEqual([1, 2])
  })

  test('the refusal reaches the caller whose placement it was', async () => {
    const { latest, answers } = crate()
    void latest.put(1)
    const second = latest.put(2).then(
      () => 'placed',
      () => 'refused',
    )
    answers[0]?.land()
    await settled()
    answers[1]?.refuse()
    expect(await second).toBe('refused')
  })

  test('idle again once everything has landed', async () => {
    const { latest, answers } = crate()
    void latest.put(1)
    void latest.put(2)
    expect(latest.idle).toBe(false)
    answers[0]?.land()
    await settled()
    answers[1]?.land()
    await settled()
    expect(latest.idle).toBe(true)
  })
})
