/** Which device a v2 request comes from.
 *
 *  The tree's rules need it for one thing: a device's own writing never stands
 *  against its own delete (section 5.9), so every change is written down with the
 *  device that made it. The session is what proves it, never something the request
 *  says about itself: a device that said hello to its hub is bound to its session
 *  (see hub/devices.ts), and one that has not yet is named by its session, which is
 *  the same device for as long as the session lasts. A guest is one device, and so is
 *  a program's token. */

import type { Context } from 'hono'
import { tokenIn } from '../auth'
import { sha256 } from '../crypto'
import { deviceOfSession } from '../hub/devices'
import type { Env, Variables } from '../types'

export async function deviceOf(
  context: Context<{ Bindings: Env; Variables: Variables }>,
): Promise<string> {
  const who = context.get('who')
  if (who.kind === 'guest') return `guest:${who.guest.id}`
  if (who.program) return `program:${who.user.id}`

  const header = context.req.header('authorization')
  const device = await deviceOfSession(context.env, who.user.id, header)
  if (device) return device

  // Short: it is written beside every change, and sixteen hex digits of a hash tell
  // a person's sessions apart without saying anything about the token.
  return `session:${(await sha256(tokenIn(header) ?? '')).slice(0, 16)}`
}
