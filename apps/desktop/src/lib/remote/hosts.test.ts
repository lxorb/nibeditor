import { describe, expect, test } from 'vitest'
import {
  type ConfigHost,
  destinationOf,
  groupsOf,
  hostFor,
  hostsOf,
  type Kept,
  mayBeDestination,
  moved,
  NOTHING_KEPT,
  pickerOrder,
  RECENT,
  said,
  withAbout,
  withOwn,
  withoutOwn,
} from './hosts'

const CONFIG: ConfigHost[] = [
  { id: 'pi', also: ['raspberry'], hostname: '10.0.0.5', user: 'emil', group: 'Home' },
  { id: 'nas', also: [], group: 'Home' },
  { id: 'office', also: [], hostname: 'office.example.com', port: 2222, group: 'Work' },
  { id: 'build', also: [] },
]

const kept = (more: Partial<Kept> = {}): Kept => ({ ...NOTHING_KEPT, ...more })

describe('the list', () => {
  test("the config's hosts in its order, then nib's own, each saying where it is", () => {
    const hosts = hostsOf(
      CONFIG,
      kept({ own: [{ id: 'n-1', name: 'Box', hostname: 'box', user: 'me' }] }),
    )

    expect(hosts.map((one) => one.id)).toEqual(['pi', 'nas', 'office', 'build', 'n-1'])
    expect(hosts.map((one) => one.detail)).toEqual([
      'emil@10.0.0.5',
      null,
      'office.example.com:2222',
      null,
      'me@box',
    ])
    expect(hosts[0]?.also).toEqual(['raspberry', '10.0.0.5'])
    expect(hosts.map((one) => one.own)).toEqual([false, false, false, false, true])
  })

  test("Settings' order goes first, and a group set in nib before the config's", () => {
    const hosts = hostsOf(
      CONFIG,
      kept({ order: ['build', 'pi'], about: { nas: { group: 'Storage', colour: '3' } } }),
    )

    expect(hosts.map((one) => one.id)).toEqual(['build', 'pi', 'nas', 'office'])
    expect(hosts.find((one) => one.id === 'nas')).toMatchObject({ group: 'Storage', colour: '3' })
  })

  test("the groups in Settings' order, then as their first hosts come, and only with hosts", () => {
    const hosts = hostsOf(CONFIG, NOTHING_KEPT)
    expect(groupsOf(hosts, NOTHING_KEPT)).toEqual(['Home', 'Work'])
    expect(groupsOf(hosts, kept({ groups: ['Work', 'Gone'] }))).toEqual(['Work', 'Home'])
  })
})

describe('the picker', () => {
  test('pinned, then recent newest first, then the hosts in no group, then each group', () => {
    const now = 1_000_000
    const hosts = hostsOf(
      CONFIG,
      kept({
        about: {
          office: { pinned: true, last: now },
          nas: { last: now - 10 },
          build: { last: now - 5 },
        },
      }),
    )
    const order = pickerOrder(hosts, NOTHING_KEPT)

    expect(order.map((one) => one.host.id)).toEqual(['office', 'build', 'nas', 'pi'])
    expect(order.map((one) => one.head)).toEqual([null, null, null, 'Home'])
    expect(order.map((one) => one.parted)).toEqual([false, true, false, false])
  })

  test(`at most ${String(RECENT)} recent hosts, the rest in their groups`, () => {
    const many: ConfigHost[] = Array.from({ length: RECENT + 2 }, (_, at) => ({
      id: `h${String(at)}`,
      also: [],
    }))
    const about = Object.fromEntries(many.map((one, at) => [one.id, { last: at }]))
    const order = pickerOrder(hostsOf(many, kept({ about })), NOTHING_KEPT)

    expect(order.slice(0, RECENT).map((one) => one.host.id)).toEqual(['h6', 'h5', 'h4', 'h3', 'h2'])
    expect(order[RECENT]?.parted).toBe(true)
  })
})

describe('a destination typed', () => {
  test('read as ssh takes it', () => {
    expect(destinationOf('pi')).toEqual({ user: null, hostname: 'pi', port: null })
    expect(destinationOf('ssh emil@10.0.0.5')).toEqual({
      user: 'emil',
      hostname: '10.0.0.5',
      port: null,
    })
    expect(destinationOf('box.example.com:2222')).toEqual({
      user: null,
      hostname: 'box.example.com',
      port: 2222,
    })
    expect(destinationOf('[fe80::1]:22')).toEqual({ user: null, hostname: 'fe80::1', port: 22 })
    expect(destinationOf('fe80::1')).toEqual({ user: null, hostname: 'fe80::1', port: null })
  })

  test('and never anything that could be read as an option, or words', () => {
    for (const bad of [
      '-oProxyCommand=calc',
      'me@-oProxyCommand=calc',
      '-l@box',
      'two words',
      '',
      'box:0',
      'box:70000',
      'a;b',
      'me@',
    ]) {
      expect(destinationOf(bad), bad).toBeNull()
    }
  })

  test('said back the way it is written', () => {
    expect(said({ user: 'me', hostname: 'box', port: 2222 })).toBe('me@box:2222')
    expect(said({ user: null, hostname: 'fe80::1', port: 22 })).toBe('[fe80::1]:22')
    expect(said({ user: null, hostname: 'pi', port: null })).toBe('pi')
  })

  test('is the host it already names, by a name or by the same place', () => {
    const hosts = hostsOf(CONFIG, NOTHING_KEPT)
    expect(hostFor(hosts, { user: null, hostname: 'raspberry', port: null })?.id).toBe('pi')
    expect(hostFor(hosts, { user: 'emil', hostname: '10.0.0.5', port: null })?.id).toBe('pi')
    expect(hostFor(hosts, { user: 'root', hostname: '10.0.0.5', port: null })).toBeNull()
  })

  test('typing that could still become one', () => {
    expect(mayBeDestination('me@')).toBe(true)
    expect(mayBeDestination('DOMAIN\\me@box')).toBe(true)
    expect(mayBeDestination('two words')).toBe(false)
  })
})

describe('Settings', () => {
  test('what nib knows is changed, and a field taken out when it is cleared', () => {
    const one = withAbout(NOTHING_KEPT, 'pi', { colour: '2', pinned: true })
    expect(one.about.pi).toEqual({ colour: '2', pinned: true })

    const cleared = withAbout(one, 'pi', { colour: undefined, pinned: false })
    expect(cleared.about.pi).toBeUndefined()
  })

  test('a host made here changes, and goes with everything nib knew about it', () => {
    const start = kept({
      own: [{ id: 'n-1', name: 'Box', hostname: 'box', user: 'me', port: 22 }],
      about: { 'n-1': { pinned: true } },
      order: ['n-1'],
    })
    const changed = withOwn(start, 'n-1', { hostname: 'box2', user: undefined, port: undefined })
    expect(changed.own[0]).toEqual({ id: 'n-1', name: 'Box', hostname: 'box2' })

    const gone = withoutOwn(start, 'n-1')
    expect(gone).toEqual(NOTHING_KEPT)
  })

  test('moving a host keeps the whole order, and the groups as their first hosts now come', () => {
    const hosts = hostsOf(CONFIG, NOTHING_KEPT)
    const next = moved(NOTHING_KEPT, hosts, 2, 0)

    expect(next.order).toEqual(['office', 'pi', 'nas', 'build'])
    expect(next.groups).toEqual(['Work', 'Home'])
  })
})
