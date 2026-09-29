/** Deleting the account, and the proof it takes.
 *
 *  A session is not enough. It is the thing most likely to be in the wrong hands -
 *  a laptop left open, a token copied off a machine - and it is exactly what would
 *  otherwise be all it takes to throw away everything the account holds. So the
 *  person asks the way they sign in: a fresh code mailed to the account's own
 *  address, and the code out of their authenticator app when they have one. What
 *  that proves is held for five minutes as a ticket, so the last question - are you
 *  sure - is asked after the codes rather than before them, and a mistyped code is
 *  said before anybody has confirmed anything.
 *
 *  Three steps, the way a sign-in is two and a second factor a third:
 *  `POST /delete/code`, `POST /delete/verify`, `DELETE /`. Behind the session guard,
 *  and neither a guest nor a program acting for somebody reaches any of them: both
 *  lists of what those may reach are written as what is allowed. See guests.ts and
 *  programs.ts. What deleting takes away is erase.ts. */

import { Hono } from 'hono'
import { checkCode, sendCode, spendCode } from './auth'
import { readBody } from './body'
import { now, randomToken, sha256 } from './crypto'
import { leavingMessage, refusedMail } from './email'
import { eraseAccount } from './erase'
import { machineOf, mayLeave } from './limits'
import { TOOK_TOO_LONG, TRY_IN_AN_HOUR, WRONG_CODE } from './refused'
import { accepted, asksForSecond } from './second'
import type { Env, Variables } from './types'

/** Where a proof is kept between the codes and the confirm, in the table for
 *  things answered once and held a while; see 0022. */
const TICKETS = 'leaving'

/** Long enough to read one line and press one button, short enough that a proof
 *  left on a screen is not a way to delete the account tomorrow. */
const TICKET_FOR = 5 * 60 * 1000

export const account = new Hono<{ Bindings: Env; Variables: Variables }>()

/** Step one: a code, mailed to the account's own address and nowhere else.
 *  Answers whether step two will ask for a second one as well. */
account.post('/delete/code', async (context) => {
  const user = context.get('user')
  if (!(await mayLeave(context.env, user.id))) {
    return context.json({ error: TRY_IN_AN_HOUR }, 429)
  }

  const sent = await sendCode(context.env, user.email, machineOf(context.req), leavingMessage)
  if ('error' in sent) return refusedMail(context, sent)

  return context.json({
    resendIn: sent.resendIn,
    second: await asksForSecond(context.env, user.id),
  })
})

/** Step two: the mailed code, and the authenticator's when the account has one.
 *  Answers a ticket the confirm spends.
 *
 *  The mailed code is checked first and spent last: a second code mistyped is not
 *  a reason to ask for another mail, which is how a sign-in treats the same two. */
account.post('/delete/verify', async (context) => {
  const user = context.get('user')
  const body = await readBody(context)
  const code = body.text('code', 16)
  const second = body.text('second', 64)
  if (body.problem) return context.json({ error: body.problem }, 400)

  if (!(await mayLeave(context.env, user.id))) {
    return context.json({ error: TRY_IN_AN_HOUR }, 429)
  }

  const checked = await checkCode(context.env, user.email, code ?? '')
  if ('error' in checked) return context.json({ error: checked.error }, checked.status)

  if (
    (await asksForSecond(context.env, user.id)) &&
    !(await accepted(context.env, user.id, second ?? '', machineOf(context.req)))
  ) {
    return context.json({ error: WRONG_CODE }, 400)
  }

  // Two requests holding the same code are one proof, not two.
  if (!(await spendCode(context.env, user.email))) {
    return context.json({ error: TOOK_TOO_LONG }, 400)
  }

  const ticket = randomToken()
  await context.env.DB.prepare(
    'insert or replace into cached (scope, key, value, until) values (?, ?, ?, ?)',
  )
    .bind(TICKETS, await sha256(ticket), user.id, now() + TICKET_FOR)
    .run()

  return context.json({ ticket })
})

/** Step three: the account, gone.
 *
 *  The ticket is this account's or it is nothing: one proved by somebody else's
 *  codes is refused with the same words as one that ran out. It is read rather
 *  than spent here, because the deletion takes it away with every other row of the
 *  account - so a deletion that fails half way leaves it good for another try. */
account.delete('/', async (context) => {
  const user = context.get('user')
  const body = await readBody(context)
  const ticket = body.text('ticket', 128)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const held = ticket
    ? await context.env.DB.prepare(
        'select 1 as one from cached where scope = ? and key = ? and value = ? and until > ?',
      )
        .bind(TICKETS, await sha256(ticket), user.id, now())
        .first<{ one: number }>()
    : null

  if (!held) return context.json({ error: TOOK_TOO_LONG }, 400)

  await eraseAccount(context.env, user)

  return context.json({ ok: true })
})
