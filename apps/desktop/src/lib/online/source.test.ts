import { describe, expect, test } from 'vitest'
import type { ServerFrame } from '@nib/online/wire'
import type { Said } from '../terminal/source'
import { OnlineSource } from './source'

/** What the socket's frames become for the terminal, read off the source's own seam. */
function hearing(frame: ServerFrame): Said[] {
  const source = new OnlineSource(
    () => '/space/Terminal.term',
    () => Promise.resolve('device'),
    { tab: () => 't1', front: () => true, offer: () => undefined },
    { pages: false, native: false },
  )
  const said: Said[] = []
  ;(source as unknown as { heard(frame: ServerFrame, said: (what: Said) => void): void }).heard(
    frame,
    (what) => said.push(what),
  )
  return said
}

describe('an online source told it is refused', () => {
  test('a session that is gone is said as gone, which only a new terminal answers', () => {
    expect(hearing({ t: 'refused', error: 'gone' })).toEqual([
      { refused: 'This terminal is gone', gone: true },
    ])
  })

  test('any other refusal is its words alone', () => {
    expect(hearing({ t: 'refused', error: 'allowance' })).toEqual([
      { refused: 'This month’s online hours are used' },
    ])
    expect(hearing({ t: 'refused', error: 'role' })).toEqual([{ typing: false }])
  })
})
