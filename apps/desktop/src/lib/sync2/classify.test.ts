import { describe, expect, test } from 'vitest'
import { classifier, inline, LARGE } from './classify'

/** The window's classifier hands large meetings to a worker (classify.ts); what it
 *  answers is the verdict `judge` gives, which this holds for the inline one both share. */

const line = 'A line of an ordinary long note, with nothing much in it.\n'
const base = line.repeat(Math.ceil(LARGE / line.length))
const meeting = {
  shape: 'words' as const,
  base,
  local: `Mine. ${base}`,
  remote: `${base}Theirs.\n`,
  times: { local: 1, remote: 2 },
}

describe('classifying a meeting', () => {
  test('a note well past the size a worker takes is classified the same', async () => {
    const judged = await inline(meeting)
    expect(judged.verdict).toBe('clean')
    expect(judged.resolution).toBe(`Mine. ${base}Theirs.\n`)
  })

  test('with no worker to be had, a large meeting is classified here', async () => {
    const judged = await classifier()(meeting)
    expect(judged.resolution).toBe(`Mine. ${base}Theirs.\n`)
  })
})
