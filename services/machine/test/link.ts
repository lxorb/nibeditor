/** A link to a running `nibd`, as `Machine` holds one: for the drives of a real process. */

import { WebSocket } from 'ws'
import { linkFrame, nibdFrameOf, type MachineFrame, type NibdFrame } from '@nib/online/wire'

export interface Link {
  frames: NibdFrame[]
  send(frame: MachineFrame): void
  /** Everything a session printed so far, as text. */
  text(session: string): string
  close(): void
}

export async function linked(url: string, secret: string): Promise<Link> {
  const socket = new WebSocket(`${url}/link`, { headers: { authorization: `Bearer ${secret}` } })
  const frames: NibdFrame[] = []
  socket.on('message', (data: Buffer) => {
    const frame = nibdFrameOf(new Uint8Array(data))
    if (frame) frames.push(frame)
  })
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  return {
    frames,
    send: (frame) => {
      socket.send(linkFrame(frame))
    },
    text: (session) =>
      Buffer.concat(
        frames.flatMap((frame) =>
          frame.t === 'out' && frame.session === session ? [frame.data] : [],
        ),
      ).toString(),
    close: () => {
      socket.close()
    },
  }
}

export async function until(
  what: () => boolean | Promise<boolean>,
  timeout = 20_000,
): Promise<void> {
  const end = Date.now() + timeout
  while (!(await what())) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

export async function healthy(url: string, timeout = 120_000): Promise<void> {
  await until(async () => {
    try {
      return (await fetch(`${url.replace(/^ws/, 'http')}/health`)).ok
    } catch {
      return false
    }
  }, timeout)
}

export const bytes = (data: string): Uint8Array => new TextEncoder().encode(data)
