/** Moving accounts to sync v2, and back: the switches docs/sync-v2.md section 11 names,
 *  as requests instead of lines of SQL typed against production.
 *
 *  One account at a time (`/sync-version`): forward is refused while something could
 *  still reach the account with an app that cannot speak v2 well enough, and names it
 *  (gate.ts says what holds a move back). Back is never refused: it is the kill switch,
 *  and a kill switch that can say no is not one. It still names the devices below
 *  `min`, because an app without the rollback fix makes copies on the way back and the
 *  person flipping should know.
 *
 *  Everybody (`/sync-rollout`): the service's switch, `off`, `new` or `all`, and the way
 *  back for every account at once (rollout.ts says what each does).
 *
 *  Reached only by the account `online_service.admin` names, and a 404 for anybody else,
 *  the same door as the online terminal's switches (machines/admin.ts). */

import { Hono, type MiddlewareHandler } from 'hono'
import { tokenIn } from '../auth'
import { readBody } from '../body'
import { sha256 } from '../crypto'
import { NOT_FOUND } from '../machines/door'
import { serviceOf } from '../machines/service'
import type { Env, Variables } from '../types'
import { type Account, accountBy, minimum, move, NEEDS_MIN, type Standing, standing } from './gate'
import { everyoneBack, isMode, rolloutView, setRollout } from './rollout'

interface Admin {
  Bindings: Env
  Variables: Variables
}

/** A reading as the answer says it: everything but the account's id. */
function view(account: Account, min: string, judged: Standing) {
  return { email: account.email, version: account.version, min, ...judged }
}

export const syncAdmin = new Hono<Admin>()

const admin: MiddlewareHandler<Admin> = async (context, next) => {
  const service = await serviceOf(context.env)
  if (!service.admin || context.get('user').id !== service.admin) {
    return context.json({ error: NOT_FOUND }, 404)
  }
  await next()
}
syncAdmin.use('*', admin)

async function askerOf(header: string | undefined): Promise<string | null> {
  const token = tokenIn(header)
  return token ? await sha256(token) : null
}

/** Where one account stands: its version, its devices and what would hold a flip back. */
syncAdmin.get('/sync-version', async (context) => {
  const email = context.req.query('email') ?? ''
  const allow = new Set(context.req.queries('allow') ?? [])
  const judged = minimum(context.req.query('min'))
  if ('error' in judged) return context.json({ error: judged.error }, 400)

  const account = await accountBy(context.env, 'email', email)
  if (!account) return context.json({ error: 'no such account' }, 404)
  const asker = await askerOf(context.req.header('authorization'))
  const found = await standing(context.env, account, {
    min: judged.min,
    allow,
    asker,
    deviceless: 'hold',
  })
  return context.json(view(account, judged.min, found))
})

/** The flip itself: `{ email, to, min, allow?, dry? }`. */
syncAdmin.post('/sync-version', async (context) => {
  const body = await readBody(context)
  const email = body.text('email', 320)
  const to = body.count('to')
  const given = body.text('min', 40)
  const allowed = body.texts('allow', 50, 100)
  const dry = body.flag('dry') === true
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (!email || (to !== 1 && to !== 2)) return context.json({ error: 'email and to (1 or 2)' }, 400)
  // Forward needs the caller to say which build is safe; nothing here can know.
  if (to === 2 && !given) return context.json({ error: NEEDS_MIN }, 400)

  const judged = minimum(given)
  if ('error' in judged) return context.json({ error: judged.error }, 400)

  const account = await accountBy(context.env, 'email', email)
  if (!account) return context.json({ error: 'no such account' }, 404)
  const asker = await askerOf(context.req.header('authorization'))
  const found = await standing(context.env, account, {
    min: judged.min,
    allow: new Set(allowed ?? []),
    asker,
    deviceless: 'hold',
  })

  const shown = view(account, judged.min, found)
  if (to === 2 && found.blockers.length > 0) {
    return context.json({ error: 'a device of this account runs an older app', ...shown }, 409)
  }
  if (dry || account.version === to) return context.json({ ...shown, to, changed: false })

  const changed = await move(context.env, account, to, 'admin', judged.min)
  if (!changed) return context.json({ error: 'the account changed meanwhile; ask again' }, 409)
  return context.json({ ...shown, version: to, to, changed })
})

/** The service's switch, the accounts on each version, and the latest moves. */
syncAdmin.get('/sync-rollout', async (context) => context.json(await rolloutView(context.env)))

/** The switch: `{ mode: 'off' | 'new' | 'all', min? }`. Setting it moves nobody now. */
syncAdmin.post('/sync-rollout', async (context) => {
  const body = await readBody(context)
  const mode = body.text('mode', 10)
  const min = body.text('min', 40)
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (!isMode(mode)) return context.json({ error: 'mode: off, new or all' }, 400)

  const set = await setRollout(context.env, mode, min)
  if ('error' in set) return context.json({ error: set.error }, 400)
  return context.json(await rolloutView(context.env))
})

/** Every v2 account back to 1, and the switch off: `{ everyone: true, dry? }`. The flag
 *  is there so that no body sent here by mistake moves the whole service. */
syncAdmin.post('/sync-rollout/back', async (context) => {
  const body = await readBody(context)
  const everyone = body.flag('everyone')
  const dry = body.flag('dry') === true
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (everyone !== true) return context.json({ error: 'everyone: true' }, 400)

  const moved = await everyoneBack(context.env, dry)
  return context.json({ ...(await rolloutView(context.env)), moved, dry })
})
