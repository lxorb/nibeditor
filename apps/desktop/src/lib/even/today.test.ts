import { describe, expect, test } from 'vitest'
import { spokenTask, Today, type TodayHost } from './today'

function host(found = true) {
  const ticked: [string, string, boolean][] = []
  let drawn = 0
  const answer: TodayHost = {
    load: () =>
      Promise.resolve([
        { at: 'Inbox.md#0:a1', space: 'Home', text: 'Call Mum' },
        { at: 'Work.md#3:b2', space: 'Work', text: 'Send the slides' },
      ]),
    tick: (at, space, done) => {
      ticked.push([at, space, done])
      return Promise.resolve(found)
    },
    redraw: () => void (drawn += 1),
  }
  return { answer, ticked, drawn: () => drawn }
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('today on the glasses', () => {
  test('a box in front of each task, drawn once it is read', async () => {
    const { answer, drawn } = host()
    const today = new Today(answer)
    today.fresh()
    await settled()
    expect(today.rows().map((one) => one.label)).toEqual(['□ Call Mum', '□ Send the slides'])
    expect(drawn()).toBe(1)
  })

  test('a tap fills the box at once and ticks it in its note; a second tap opens it', async () => {
    const { answer, ticked } = host()
    const today = new Today(answer)
    today.fresh()
    await settled()
    const id = today.rows()[1]?.id ?? ''
    today.tick(id)
    expect(today.rows()[1]?.label).toBe('■ Send the slides')
    today.tick(id)
    await settled()
    expect(ticked).toEqual([
      ['Work.md#3:b2', 'Work', true],
      ['Work.md#3:b2', 'Work', false],
    ])
    expect(today.rows()[1]?.label).toBe('□ Send the slides')
  })

  test('a task the note no longer has is put back', async () => {
    const { answer } = host(false)
    const today = new Today(answer)
    today.fresh()
    await settled()
    today.tick(today.rows()[0]?.id ?? '')
    await settled()
    expect(today.rows()[0]?.label).toBe('□ Call Mum')
  })

  test('what was said after the word, its capitals kept', () => {
    expect(spokenTask('Task, call Mum tomorrow at four.')).toBe('call Mum tomorrow at four')
    expect(spokenTask('Aufgabe: Milch kaufen')).toBe('Milch kaufen')
  })
})
