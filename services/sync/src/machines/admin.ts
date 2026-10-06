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
import { sshKeyOf } from './cloudinit'
import { Hetzner } from './hetzner'
import { firewallRules, hetznerMissing } from './hetzner-host'
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
    `select m.id as id, m.user_id as user, m.state as state, m.held as held, m.host as host,
            m.server_id as server, m.region as location, m.price_month as price,
            coalesce(u.awake_s, 0) as awakeS
       from machines m left join machine_usage u on u.user_id = m.user_id and u.month = ?`,
  )
    .bind(monthOf(at))
    .all()
  return context.json({
    online: service.on,
    ceiling: service.ceiling,
    spent: await spentThisMonth(context.env, at),
    // What the Hetzner host still needs set before a machine can be made on it (4.15).
    hetzner: { missing: hetznerMissing(context.env) },
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

/** An always-on machine power-cycled through Hetzner's API: what a server that answers
 *  nothing at all needs (4.15). Its sessions end; its disk stays. */
onlineAdmin.post('/machines/:id/reboot', async (context) => {
  const id = context.req.param('id')
  const row = await context.env.DB.prepare('select user_id, host from machines where id = ?')
    .bind(id)
    .first<{ user_id: string; host: string }>()
  if (!row) return context.json({ error: NOT_FOUND }, 404)
  if (row.host !== 'hetzner') return context.json({ error: 'only a server reboots' }, 409)
  const answer = await askMachine(context.env, id, 'reboot', { 'x-nib-user': row.user_id })
  return context.json({ state: answer ? (await answer.json<{ state: string }>()).state : null })
})

/** A machine moved to another host (4.15): the container saved one last time, its home
 *  backed up to R2 (where it stays, to be fetched by hand), and its next start made on
 *  the other. */
onlineAdmin.post('/machines/:id/host', async (context) => {
  const id = context.req.param('id')
  const body = await readBody(context)
  const host = body.text('host', 20)
  if (body.problem || (host !== 'hetzner' && host !== 'cloudflare')) {
    return context.json({ error: 'host is hetzner or cloudflare' }, 400)
  }
  const row = await context.env.DB.prepare('select user_id from machines where id = ?')
    .bind(id)
    .first<{ user_id: string }>()
  if (!row) return context.json({ error: NOT_FOUND }, 404)
  await audit(context.env, id, 'host', { who: context.get('user').id, detail: host })
  const answer = await askMachine(context.env, id, 'host', {
    'x-nib-user': row.user_id,
    'x-nib-host': host,
  })
  // Without the object (a Worker with no machines bound), the row alone.
  if (!answer) {
    await context.env.DB.prepare('update machines set host = ? where id = ?').bind(host, id).run()
  }
  return context.json({ host })
})

/** The owner's SSH public key for an emergency, or null to take it away (the default):
 *  while it is set the server's firewall lets port 22 in, and a server made after it
 *  lets the key in as the machine's user. A server already made takes a new key from its
 *  owner's own hand, in a terminal (`~/.ssh/authorized_keys`); root never logs in. */
onlineAdmin.post('/machines/:id/ssh', async (context) => {
  const id = context.req.param('id')
  const body = await readBody(context)
  const given = body.text('key', 1000)
  if (body.problem) return context.json({ error: body.problem }, 400)
  const key = given ? sshKeyOf(given) : null
  if (given && !key) return context.json({ error: 'not an SSH public key' }, 400)
  const row = await context.env.DB.prepare('select id from machines where id = ?')
    .bind(id)
    .first<{ id: string }>()
  if (!row) return context.json({ error: NOT_FOUND }, 404)
  await context.env.DB.prepare('update machines set ssh_key = ? where id = ?').bind(key, id).run()

  const token = context.env.HETZNER_TOKEN
  if (token) {
    const hetzner = new Hetzner(token)
    const firewall = await hetzner.firewallLabelled('nib-machine', id)
    if (firewall !== null) await hetzner.setFirewallRules(firewall, firewallRules(key !== null))
  }
  return context.json({ ssh: key !== null })
})

/** The server under a machine deleted, and everything made for it - its firewall, its
 *  tunnel and hostname - with the object emptied: what stops its monthly price without
 *  erasing the account (4.15). Its disk goes with it. The row stays, so the owner's next
 *  terminal makes a new server. */
onlineAdmin.post('/machines/:id/remove', async (context) => {
  const id = context.req.param('id')
  const row = await context.env.DB.prepare('select user_id from machines where id = ?')
    .bind(id)
    .first<{ user_id: string }>()
  if (!row) return context.json({ error: NOT_FOUND }, 404)
  const answer = await askMachine(context.env, id, 'erase', { 'x-nib-user': row.user_id })
  if (answer && !answer.ok) return context.json({ error: 'the server is still there' }, 503)
  await context.env.DB.prepare(
    `update machines set server_id = null, server_status = null, price_month = null,
       state = 'asleep' where id = ?`,
  )
    .bind(id)
    .run()
  await audit(context.env, id, 'stop', { who: context.get('user').id, detail: 'hetzner' })
  return context.json({ removed: true })
})
