/** Emil's switches (docs/online-terminal.md, 4.8): the service, the ceiling, the
 *  allow-list, and a hold on one machine. One request each.
 *
 *  Reached only by the account `online_service.admin` names; anybody else is told
 *  there is nothing here. Open while the service is off, because one of them is how it
 *  is switched on. */

import { Hono, type MiddlewareHandler } from 'hono'
import { readBody } from '../body'
import type { Env, Variables } from '../types'
import { askMachine } from './ask'
import { audit } from './audit'
import { spentThisMonth } from './budget'
import { NOT_FOUND } from './door'
import { monthOf } from '@nib/online'
import { serviceOf, setService } from './service'

interface Admin {
  Bindings: Env
  Variables: Variables
}

export const onlineAdmin = new Hono<Admin>()

const admin: MiddlewareHandler<Admin> = async (context, next) => {
  const service = await serviceOf(context.env)
  if (!service.admin || context.get('user').id !== service.admin) {
    return context.json({ error: NOT_FOUND }, 404)
  }
  await next()
}
onlineAdmin.use('*', admin)

/** The service as it stands: switched on or not, the ceiling, this month's spend. */
onlineAdmin.get('/', async (context) => {
  const service = await serviceOf(context.env)
  const at = Date.now()
  const { results: machines } = await context.env.DB.prepare(
    `select m.id as id, m.user_id as user, m.state as state, m.held as held,
            coalesce(u.awake_s, 0) as awakeS
       from machines m left join machine_usage u on u.user_id = m.user_id and u.month = ?`,
  )
    .bind(monthOf(at))
    .all()
  return context.json({
    online: service.on,
    ceiling: service.ceiling,
    spent: await spentThisMonth(context.env, at),
    machines,
  })
})

/** The service switch and the ceiling. Off, every machine stops at its next minute. */
onlineAdmin.post('/service', async (context) => {
  const body = await readBody(context)
  const on = body.flag('online')
  const ceiling = body.count('ceiling')
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (on !== undefined) await setService(context.env, 'online', on ? 'on' : 'off')
  if (ceiling !== undefined && ceiling >= 0)
    await setService(context.env, 'ceiling', String(ceiling))
  const service = await serviceOf(context.env)
  return context.json({ online: service.on, ceiling: service.ceiling })
})

/** An account on or off the allow-list. Off stops its machine now. */
onlineAdmin.post('/allow', async (context) => {
  const body = await readBody(context)
  const email = body.text('email', 320)
  const on = body.flag('online')
  if (body.problem || !email || on === undefined)
    return context.json({ error: 'email and online' }, 400)

  const user = await context.env.DB.prepare('select id from users where email = ?')
    .bind(email.toLowerCase())
    .first<{ id: string }>()
  if (!user) return context.json({ error: NOT_FOUND }, 404)
  await context.env.DB.prepare('update users set online = ? where id = ?')
    .bind(on ? 1 : 0, user.id)
    .run()

  if (!on) {
    const machine = await context.env.DB.prepare('select id from machines where user_id = ?')
      .bind(user.id)
      .first<{ id: string }>()
    if (machine) {
      await audit(context.env, machine.id, 'stop', {
        who: context.get('user').id,
        detail: 'account',
      })
      await askMachine(context.env, machine.id, 'stop', {
        'x-nib-user': user.id,
        'x-nib-reason': 'off',
      })
    }
  }
  return context.json({ online: on })
})

/** A machine stopped and held, by a flag or by hand, until released. */
onlineAdmin.post('/machines/:id/stop', async (context) => {
  const id = context.req.param('id')
  const body = await readBody(context)
  const flag = body.flag('flag') === true
  const row = await context.env.DB.prepare('select user_id from machines where id = ?')
    .bind(id)
    .first<{ user_id: string }>()
  if (!row) return context.json({ error: NOT_FOUND }, 404)

  await context.env.DB.prepare('update machines set held = ? where id = ?')
    .bind(flag ? 'flag' : 'stopped', id)
    .run()
  await audit(context.env, id, flag ? 'flag' : 'stop', {
    who: context.get('user').id,
    detail: flag ? 'flag' : 'stopped',
  })
  await askMachine(context.env, id, 'stop', {
    'x-nib-user': row.user_id,
    'x-nib-reason': flag ? 'flag' : 'stopped',
  })
  return context.json({ held: flag ? 'flag' : 'stopped' })
})

onlineAdmin.post('/machines/:id/release', async (context) => {
  const id = context.req.param('id')
  await context.env.DB.prepare('update machines set held = null where id = ?').bind(id).run()
  await audit(context.env, id, 'release', { who: context.get('user').id })
  return context.json({ held: null })
})
