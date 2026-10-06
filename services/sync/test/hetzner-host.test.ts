/** A machine on a Hetzner server of its own (docs/online-terminal.md 4.15): `HetznerHost`
 *  against a fake Hetzner Cloud API and a fake Cloudflare tunnel API - made once, found
 *  again, power-cycled, deleted, refused, and every error said for what it is. */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { carry } from '../src/machines/bundle'
import { HetznerError } from '../src/machines/hetzner'
import { Hetzner } from '../src/machines/hetzner'
import {
  HetznerHost,
  HostRefused,
  isMachineHost,
  namesOf,
  type Setup,
} from '../src/machines/hetzner-host'
import { Tunnels } from '../src/machines/tunnel'
import { Cloud } from './hetzner-cloud'
import { signIn, type TestEnv, testEnv } from './harness'

const ID = 'm_0123456789abcdef0123456789abcdef'
const HOSTNAME = 'm-0123456789abcdef0123456789abcdef.nibeditor.com'
const SECRET = 'a'.repeat(64)
const BOOT = { NIBD_SECRET: SECRET, TZ: 'Europe/Zurich' }

let env: TestEnv
let cloud: Cloud
let costs: { monthly: number; currency: string }[]
let affordable: boolean

function setup(overrides: Partial<Setup> = {}): Setup {
  return {
    hetzner: new Hetzner('hetzner-token', cloud.fetch),
    tunnels: new Tunnels('tunnel-token', 'account', 'zone', cloud.fetch),
    service: { id: 'access-id', secret: 'access-secret' },
    access: { team: 'nib', aud: 'aud-tag' },
    domain: 'nibeditor.com',
    origin: 'https://nibeditor.com',
    mayCost: (monthly, currency) => {
      costs.push({ monthly, currency })
      return Promise.resolve(affordable)
    },
    fetcher: cloud.fetch,
    ...overrides,
  }
}

function host(given: Setup | null = setup()): HetznerHost {
  const storage = { get: <T>() => Promise.resolve(SECRET as T) }
  return new HetznerHost(env, storage, given)
}

const row = () =>
  env.db.prepare('select * from machines where id = ?').get(ID) as Record<string, unknown>

beforeEach(async () => {
  env = testEnv()
  cloud = new Cloud()
  costs = []
  affordable = true
  carry(new TextEncoder().encode('the bundle').buffer as ArrayBuffer)
  await signIn(env, 'owner@example.com')
  const user = env.db.prepare('select id from users').get() as { id: string }
  env.db
    .prepare("insert into machines (id, user_id, created_at, host) values (?, ?, 1, 'hetzner')")
    .run(ID, user.id)
})

afterEach(() => {
  env.close()
})

describe('a Hetzner machine', () => {
  test('is made once: its tunnel, hostname, firewall and labelled CX43 in Nuremberg', async () => {
    await host().start(ID, 'machine', BOOT)

    expect(cloud.tunnels).toEqual([
      expect.objectContaining({ name: 'nib-machine-0123456789abcdef0123456789abcdef' }),
    ])
    expect(cloud.tunnels[0]?.config).toEqual({
      ingress: [
        {
          hostname: HOSTNAME,
          service: 'http://127.0.0.1:7680',
          originRequest: { access: { required: true, teamName: 'nib', audTag: ['aud-tag'] } },
        },
        { service: 'http_status:404' },
      ],
    })
    expect(cloud.records).toEqual([
      expect.objectContaining({
        name: HOSTNAME,
        content: `${cloud.tunnels[0]?.id ?? ''}.cfargotunnel.com`,
        proxied: true,
      }),
    ])
    // Nothing let in at all.
    expect(cloud.firewalls).toEqual([
      expect.objectContaining({ labels: { 'nib-machine': ID }, rules: [] }),
    ])

    expect(cloud.servers).toHaveLength(1)
    const server = cloud.servers[0]
    expect(server).toMatchObject({
      name: 'nib-0123456789abcdef0123456789abcdef',
      location: 'nbg1',
      labels: { 'nib-machine': ID },
      firewall: cloud.firewalls[0]?.id,
    })
    // Its secrets reach it in its user data, and nowhere it runs a command.
    expect(server?.userData).toContain(`NIBD_SECRET=${SECRET}`)
    expect(server?.userData).toContain(`TUNNEL_TOKEN=eyJ-token-of-${cloud.tunnels[0]?.id ?? ''}`)
    expect(server?.userData).toContain('TZ=Europe/Zurich')

    // The price as Hetzner said it, with the address, and the budget asked before.
    expect(costs).toEqual([{ monthly: 13.6731 + 0.595, currency: 'EUR' }])
    expect(row()).toMatchObject({
      server_id: server?.id,
      server_status: 'initializing',
      region: 'nbg1',
      size: 'cx43',
      spec: JSON.stringify({ cores: 8, memory: 16, disk: 160 }),
      price_month: 14.27,
      price_currency: 'EUR',
    })
  })

  test('a start asked again finds what is there and makes nothing twice', async () => {
    const machine = host()
    await machine.start(ID, 'machine', BOOT)
    cloud.asked.length = 0
    await machine.start(ID, 'machine', BOOT)

    expect(cloud.servers).toHaveLength(1)
    expect(cloud.tunnels).toHaveLength(1)
    expect(cloud.records).toHaveLength(1)
    expect(cloud.firewalls).toHaveLength(1)
    expect(cloud.asked.filter((one) => one.startsWith('POST'))).toEqual([])
    expect(costs).toHaveLength(1)
  })

  test('a start that died after the tunnel finishes the job without a second tunnel', async () => {
    cloud.fail('POST', /^\/v1\/servers$/, 500, 'server_error')
    const machine = host()
    await expect(machine.start(ID, 'machine', BOOT)).rejects.toThrow(HetznerError)
    await machine.start(ID, 'machine', BOOT)
    expect(cloud.tunnels).toHaveLength(1)
    expect(cloud.firewalls).toHaveLength(1)
    expect(cloud.servers).toHaveLength(1)
  })

  test('a server that was switched off is switched on', async () => {
    const machine = host()
    await machine.start(ID, 'machine', BOOT)
    const server = cloud.servers[0]
    if (server) server.status = 'off'
    await machine.start(ID, 'machine', BOOT)
    expect(cloud.asked).toContain(`POST /servers/${String(server?.id)}/actions/poweron`)
    expect(server?.status).toBe('running')
  })

  test('where Nuremberg has none to give, Falkenstein', async () => {
    cloud.fail('POST', /^\/v1\/servers$/, 412, 'resource_unavailable')
    await host().start(ID, 'machine', BOOT)
    expect(cloud.servers.map((one) => one.location)).toEqual(['fsn1'])
    expect(row().region).toBe('fsn1')

    // And a type Hetzner says is not to be had in Nuremberg is not asked for there.
    cloud.servers.length = 0
    cloud.available = ['fsn1']
    await host().start(ID, 'machine', BOOT)
    expect(cloud.asked.filter((one) => one === 'POST /servers')).toHaveLength(3)
    expect(cloud.servers.map((one) => one.location)).toEqual(['fsn1'])
  })

  test('nowhere to be had is an error that says so', async () => {
    cloud.available = ['hel1']
    await expect(host().start(ID, 'machine', BOOT)).rejects.toThrow(
      /no cx43 to be had in nbg1 or fsn1/,
    )
    expect(cloud.servers).toEqual([])
  })

  test('past the budget it is refused before anything costs money', async () => {
    affordable = false
    await expect(host().start(ID, 'machine', BOOT)).rejects.toThrow(HostRefused)
    expect(cloud.servers).toEqual([])
    expect(cloud.firewalls).toEqual([])
  })

  test('without its secrets it refuses with what is missing, and touches nothing', async () => {
    const bare = host(null)
    await expect(bare.start(ID, 'machine', BOOT)).rejects.toThrow(
      'Hetzner machines are not set up: HETZNER_TOKEN, MACHINE_TUNNEL_TOKEN, CF_ACCOUNT_ID, CF_ZONE_ID missing',
    )
    expect(await bare.running(ID)).toBe(false)
    await bare.remove(ID)
    expect(cloud.asked).toEqual([])
  })

  test('an API error is an error with the API’s own code', async () => {
    cloud.fail('GET', /^\/v1\/servers/, 401, 'unauthorized')
    const failed = await host()
      .start(ID, 'machine', BOOT)
      .catch((error: unknown) => error)
    expect(failed).toBeInstanceOf(HetznerError)
    expect(failed).toMatchObject({ status: 401, code: 'unauthorized' })
  })

  test('is running when its server says so', async () => {
    const machine = host()
    expect(await machine.running(ID)).toBe(false)
    await machine.start(ID, 'machine', BOOT)
    const server = cloud.servers[0]
    if (server) server.status = 'running'
    expect(await machine.running(ID)).toBe(true)
  })

  test('links through its hostname with nibd’s secret and the Access service token', async () => {
    const socket = await host().link(ID)
    expect(socket).toBeTruthy()
    expect(cloud.asked).toEqual([`GET https://${HOSTNAME}/link`])
    const sent = cloud.linked[0]
    expect(sent?.get('authorization')).toBe(`Bearer ${SECRET}`)
    expect(sent?.get('upgrade')).toBe('websocket')
    expect(sent?.get('cf-access-client-id')).toBe('access-id')
    expect(sent?.get('cf-access-client-secret')).toBe('access-secret')

    // Refused for good is not asked again.
    cloud.asked.length = 0
    cloud.linkStatus = 401
    await expect(host().link(ID)).rejects.toThrow('nibd answered 401')
    expect(cloud.asked).toHaveLength(1)
  })

  test('a reboot power-cycles its server', async () => {
    const machine = host()
    await machine.start(ID, 'machine', BOOT)
    await machine.reboot(ID)
    expect(cloud.asked.at(-1)).toBe(`POST /servers/${String(cloud.servers[0]?.id)}/actions/reset`)
    await expect(host().reboot('m_nothing')).rejects.toThrow('the machine has no server')
  })

  test('removed: its server, firewall, tunnel and hostname, and again is nothing', async () => {
    const machine = host()
    await machine.start(ID, 'machine', BOOT)
    await machine.remove(ID)
    expect(cloud.servers).toEqual([])
    expect(cloud.firewalls).toEqual([])
    expect(cloud.tunnels).toEqual([])
    expect(cloud.records).toEqual([])

    cloud.asked.length = 0
    await machine.remove(ID)
    expect(cloud.asked.filter((one) => one.startsWith('DELETE'))).toEqual([])
  })

  test('keeps no snapshot or backup, and nothing stops it', async () => {
    const machine = host()
    expect(machine.alwaysOn).toBe(true)
    await expect(machine.snapshot()).rejects.toThrow()
    await expect(machine.backup()).rejects.toThrow()
    await machine.stop()
    expect(cloud.asked).toEqual([])
  })

  test('an emergency SSH key opens port 22 and is written into the server', async () => {
    const key =
      'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIK0wmN/Cr3JXqmLW7u+g9pTh+wyqDHpSQEIQczXkVx9q emil@laptop'
    env.db.prepare('update machines set ssh_key = ? where id = ?').run(key, ID)
    await host().start(ID, 'machine', BOOT)
    expect(cloud.firewalls[0]?.rules).toEqual([
      expect.objectContaining({ direction: 'in', protocol: 'tcp', port: '22' }),
    ])
    expect(cloud.servers[0]?.userData).toContain(key)
  })
})

describe('its names', () => {
  test('are its id’s, and only those are machine hostnames', () => {
    expect(namesOf(ID, 'nibeditor.com').hostname).toBe(HOSTNAME)
    expect(isMachineHost(HOSTNAME, 'https://nibeditor.com')).toBe(true)
    expect(
      isMachineHost('M-0123456789ABCDEF0123456789ABCDEF.nibeditor.com', 'https://nibeditor.com'),
    ).toBe(true)
    expect(isMachineHost('m-blog.nibeditor.com', 'https://nibeditor.com')).toBe(false)
    expect(isMachineHost(`${HOSTNAME}.evil.com`, 'https://nibeditor.com')).toBe(false)
    expect(isMachineHost('nibeditor.com', 'https://nibeditor.com')).toBe(false)
  })
})
