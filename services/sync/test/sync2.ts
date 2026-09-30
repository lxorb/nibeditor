/** What the sync v2 tests share: the Worker's rooms running under the routes, their
 *  settles fired on demand, and requests made the way a v2 device makes them, in the
 *  framed envelope of @nib/sync-core. */

import { frame, type Framed, unframe } from '@nib/sync-core'
import app from '../src/index'
import { call, mail, signIn, type TestEnv } from './harness'
import { running } from './room'

/** Somebody given a space, or one file of it, and in it: invited by its owner, then
 *  having signed in and followed the link. Answers their session. */
export async function invited(
  env: TestEnv,
  owner: string,
  space: string,
  email: string,
  role: 'write' | 'read',
  item?: string,
): Promise<string> {
  const sent = await mail(() =>
    call(env, `/v1/spaces/${space}/share/invite${item ? `?item=${item}` : ''}`, {
      token: owner,
      body: { email, role },
    }),
  )
  const found = /\/join\/([a-f0-9]+)/.exec(sent)
  if (!found?.[1]) throw new Error(`no invitation was sent:\n${sent}`)

  const token = await signIn(env, email)
  await call(env, `/v1/join/${found[1]}`, { method: 'POST', token })
  return token
}

export type Live = ReturnType<typeof running> & {
  /** Every settle on the clock, fired, until none is left: what a second and a bit of
   *  nobody typing does. */
  settle(): Promise<void>
}

/** The rooms of the Worker, running under its routes. */
export function live(env: TestEnv): Live {
  const rooms = running(env)
  env.ROOMS = rooms.ROOMS

  const settle = async () => {
    for (let round = 0; round < 20; round++) {
      let fired = false
      for (const { room, state } of rooms.all().values()) {
        await state.idle()
        if (state.takeAlarm() === null) continue
        fired = true
        await room.alarm()
        await state.idle()
      }
      if (!fired) return
    }
    throw new Error('the rooms never stopped settling')
  }

  return { ...rooms, settle }
}

/** What a framed request was answered: the status, and the envelope read back. */
export interface FramedAnswer<T> {
  status: number
  value: T
}

/** A v2 request with a framed body, answered framed and read back. */
export async function framed<T = Record<string, unknown>>(
  env: TestEnv,
  path: string,
  token: string,
  body?: Framed,
  method = body === undefined ? 'GET' : 'POST',
): Promise<FramedAnswer<T>> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    accept: 'application/octet-stream',
  }
  if (body !== undefined) headers['content-type'] = 'application/octet-stream'

  const response = await app.fetch(
    new Request(`https://nibeditor.com${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: frame(body) }),
    }),
    env,
  )

  const bytes = new Uint8Array(await response.arrayBuffer())
  const type = response.headers.get('content-type') ?? ''
  // What the route answered, as the test reads it: an envelope where it framed one,
  // and the JSON of a refusal otherwise.
  const value: unknown = type.startsWith('application/octet-stream')
    ? unframe(bytes)
    : JSON.parse(new TextDecoder().decode(bytes))
  return { status: response.status, value: value as T }
}
