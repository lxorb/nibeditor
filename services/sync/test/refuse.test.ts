/** A socket the door turns away for good (refuse.ts): let in, told why, and closed, so
 *  the app reads a refusal rather than a drop it would try again. */

import { serverFrameOf } from '@nib/online/wire'
import { expect, test } from 'vitest'
import { REFUSED_CLOSE, refuse } from '../src/machines/refuse'

test('a refused socket is accepted, says why and closes', () => {
  const did: string[] = []
  const said: string[] = []
  const server = {
    accept: () => did.push('accept'),
    send: (data: string) => {
      did.push('send')
      said.push(data)
    },
    close: (code: number, reason: string) => did.push(`close ${String(code)} ${reason}`),
  }

  refuse(server as unknown as WebSocket, 'gone')

  expect(did).toEqual(['accept', 'send', `close ${String(REFUSED_CLOSE)} gone`])
  expect(said.map((one) => serverFrameOf(one))).toEqual([{ t: 'refused', error: 'gone' }])
})
