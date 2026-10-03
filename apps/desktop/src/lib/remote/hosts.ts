/** The machines a remote terminal reaches, as one list: the hosts of the reader's own
 *  `~/.ssh/config`, read by the crate and never written, and the hosts made in nib,
 *  with what nib knows about each - a colour, a group, a pin, when it was last
 *  connected to. See src-tauri/src/terminal/remote.rs and docs/terminal.md.
 *
 *  Pure: what the crate answered goes in, the list and its orders come out, and the
 *  store (hosts.svelte.ts) holds it. */

/** One of the canvas's six colours, by number, as a card's colour is. */
export type Colour = '1' | '2' | '3' | '4' | '5' | '6'

export const COLOURS: readonly Colour[] = ['1', '2', '3', '4', '5', '6']

/** A host of the config, as the crate read it. */
export interface ConfigHost {
  id: string
  also: string[]
  hostname?: string
  user?: string
  port?: number
  group?: string
}

/** A host made in nib. Its id starts with `n-` and is made once, so renaming it keeps
 *  every tab that connects to it; see `is_own_id` in remote.rs. */
export interface Own {
  id: string
  name: string
  hostname: string
  user?: string
  port?: number
}

export interface About {
  colour?: Colour
  group?: string
  pinned?: boolean
  last?: number
}

/** What nib keeps, as the crate keeps it. */
export interface Kept {
  own: Own[]
  about: Record<string, About>
  /** The order Settings put the hosts in, by id. */
  order: string[]
  /** And the groups. */
  groups: string[]
}

export const NOTHING_KEPT: Kept = { own: [], about: {}, order: [], groups: [] }

/** One host, as every list shows it. */
export interface Host {
  id: string
  name: string
  /** Made in nib, and so editable; a config's host is a mirror. */
  own: boolean
  /** Other names it is found by: the config's other names on its line, its address. */
  also: string[]
  /** `user@address:port` where any of it is known, said quietly after the name. */
  detail: string | null
  user: string | null
  hostname: string | null
  port: number | null
  group: string | null
  colour: Colour | null
  pinned: boolean
  last: number | null
}

/** `user@address:port`, as much of it as is known, and null where nothing is besides
 *  the name. */
function detailOf(user: string | null, hostname: string | null, port: number | null, name: string) {
  const address = hostname ?? (user || port ? name : null)
  if (!address) return null

  const at = user ? `${user}@${address}` : address
  const said = port && port !== 22 ? `${at}:${port}` : at
  return said === name ? null : said
}

/** Every host, in the order Settings lists them: the order kept there first, then the
 *  config's in the config's order, then the ones made here. */
export function hostsOf(config: readonly ConfigHost[], kept: Kept): Host[] {
  const about = (id: string): About => kept.about[id] ?? {}

  const fromConfig = config.map((one): Host => {
    const known = about(one.id)
    return {
      id: one.id,
      name: one.id,
      own: false,
      also: [...one.also, ...(one.hostname ? [one.hostname] : [])],
      detail: detailOf(one.user ?? null, one.hostname ?? null, one.port ?? null, one.id),
      user: one.user ?? null,
      hostname: one.hostname ?? null,
      port: one.port ?? null,
      group: known.group ?? one.group ?? null,
      colour: known.colour ?? null,
      pinned: known.pinned ?? false,
      last: known.last ?? null,
    }
  })

  const made = kept.own.map((one): Host => {
    const known = about(one.id)
    return {
      id: one.id,
      name: one.name,
      own: true,
      also: [one.hostname],
      detail: detailOf(one.user ?? null, one.hostname, one.port ?? null, one.name),
      user: one.user ?? null,
      hostname: one.hostname,
      port: one.port ?? null,
      group: known.group ?? null,
      colour: known.colour ?? null,
      pinned: known.pinned ?? false,
      last: known.last ?? null,
    }
  })

  const all = [...fromConfig, ...made]
  const place = new Map(kept.order.map((id, at) => [id, at]))
  const rank = (host: Host) => place.get(host.id) ?? Number.MAX_SAFE_INTEGER
  // Stable: the ones Settings never ordered keep the order they came in.
  return all
    .map((host, at) => ({ host, at }))
    .sort((a, b) => rank(a.host) - rank(b.host) || a.at - b.at)
    .map(({ host }) => host)
}

/** The groups in their order: the order kept in Settings, then each other group in the
 *  order its first host comes. */
export function groupsOf(hosts: readonly Host[], kept: Kept): string[] {
  const out = [...kept.groups]
  for (const host of hosts) if (host.group && !out.includes(host.group)) out.push(host.group)
  return out.filter((group) => hosts.some((host) => host.group === group))
}

/** How many recent hosts the picker puts after the pinned ones. */
export const RECENT = 5

/** One row of the picker, and what stands over it. */
export interface Placed {
  host: Host
  /** A group's name over this row, where a group starts here. */
  head: string | null
  /** A line over this row, where the pinned or the recent hosts end. */
  parted: boolean
}

/** The hosts as the picker offers them, each once: the pinned ones, then the ones
 *  connected to lately, newest first, then the rest - the ones in no group, and each
 *  group under its name. The numbers a digit picks follow this order. */
export function pickerOrder(hosts: readonly Host[], kept: Kept): Placed[] {
  const pinned = hosts.filter((host) => host.pinned)
  const recent = hosts
    .filter((host) => !host.pinned && host.last !== null)
    .sort((a, b) => (b.last ?? 0) - (a.last ?? 0))
    .slice(0, RECENT)
  const taken = new Set([...pinned, ...recent].map((host) => host.id))
  const rest = hosts.filter((host) => !taken.has(host.id))

  const sections: [readonly Host[], string | null][] = [
    [pinned, null],
    [recent, null],
    [rest.filter((host) => !host.group), null],
    ...groupsOf(rest, kept).map((group): [Host[], string] => [
      rest.filter((host) => host.group === group),
      group,
    ]),
  ]

  const out: Placed[] = []
  for (const [list, group] of sections) {
    // A group's name is the line between it and what is above; the others get a line.
    const parted = out.length > 0 && group === null
    list.forEach((host, at) => {
      out.push({ host, head: at === 0 ? group : null, parted: at === 0 && parted })
    })
  }
  return out
}

/** What a typed host is found by: its name, its other names and its address. */
export function searchName(host: Host): string {
  return [host.name, ...host.also].join(' ')
}

/** A destination typed: `pi`, `emil@10.0.0.5`, `box.example.com:2222`,
 *  `[fe80::1]:22`. */
export interface Destination {
  user: string | null
  hostname: string
  port: number | null
}

/** What remote.rs takes as an address and a user; the crate holds the same rule. */
const ADDRESS = /^(?!-)[A-Za-z0-9._:%-]{1,253}$/
const USER = /^(?!-)[A-Za-z0-9._@\\$-]{1,64}$/

/** The destination something typed is, or null for words that are not one: no space,
 *  nothing an option could start with, a port that is a port. A leading `ssh ` is the
 *  command's own and is read past. */
export function destinationOf(typed: string): Destination | null {
  const text = typed.trim().replace(/^ssh\s+/i, '')
  if (!text || /\s/.test(text)) return null

  const at = text.lastIndexOf('@')
  const user = at > 0 ? text.slice(0, at) : null
  const rest = at > 0 ? text.slice(at + 1) : text

  let hostname = rest
  let port: number | null = null
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(rest)
  const portEnd = /^([^:]+):(\d+)$/.exec(rest)
  if (bracketed?.[1]) {
    hostname = bracketed[1]
    port = bracketed[2] ? Number(bracketed[2]) : null
  } else if (portEnd?.[1] && portEnd[2]) {
    hostname = portEnd[1]
    port = Number(portEnd[2])
  }

  if (!ADDRESS.test(hostname) || (user !== null && !USER.test(user))) return null
  if (port !== null && (port < 1 || port > 65535)) return null
  return { user, hostname, port }
}

/** Whether typing could still become a destination: only what one is written with. */
export function mayBeDestination(typed: string): boolean {
  return /^[A-Za-z0-9._:%@\\$[\]-]+$/.test(typed)
}

/** Whether a destination says it is one - a user, a port, a dot - rather than being a
 *  few letters that may be the start of a host's name. */
export function plainlyDestination(typed: string): boolean {
  return /[@:.]/.test(typed)
}

/** The host a destination is already, if one is: by its name, one of its other names,
 *  or the same user, address and port. */
export function hostFor(hosts: readonly Host[], wanted: Destination): Host | null {
  const plain = !wanted.user && wanted.port === null
  return (
    hosts.find(
      (host) =>
        (plain && (host.name === wanted.hostname || host.also.includes(wanted.hostname))) ||
        (host.hostname === wanted.hostname &&
          host.user === wanted.user &&
          (host.port ?? null) === wanted.port),
    ) ?? null
  )
}

/** A destination, said the way it was typed. */
export function said(wanted: Destination): string {
  const at = (address: string) => (wanted.user ? `${wanted.user}@${address}` : address)
  if (wanted.port === null) return at(wanted.hostname)

  const address = wanted.hostname.includes(':') ? `[${wanted.hostname}]` : wanted.hostname
  return `${at(address)}:${wanted.port}`
}

/** Fields to change, where one set to undefined is taken out. */
export type Change<T> = { [K in keyof T]?: T[K] | undefined }

/** What nib knows about one host, changed. */
export function withAbout(kept: Kept, id: string, change: Change<About>): Kept {
  const merged = { ...kept.about[id], ...change }
  const about = Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== undefined && value !== false),
  ) as About
  const rest = Object.fromEntries(Object.entries(kept.about).filter(([one]) => one !== id))
  return {
    ...kept,
    about: Object.keys(about).length ? { ...rest, [id]: about } : rest,
  }
}

/** A host made here, changed. */
export function withOwn(kept: Kept, id: string, change: Change<Omit<Own, 'id'>>): Kept {
  return {
    ...kept,
    own: kept.own.map((one) => {
      if (one.id !== id) return one
      const { user, port, ...rest } = { ...one, ...change }
      return {
        ...rest,
        id: one.id,
        name: rest.name ?? one.name,
        hostname: rest.hostname ?? one.hostname,
        ...(user ? { user } : {}),
        ...(port !== undefined ? { port } : {}),
      }
    }),
  }
}

/** A host made here, gone, with everything nib knew about it. */
export function withoutOwn(kept: Kept, id: string): Kept {
  const about = Object.fromEntries(Object.entries(kept.about).filter(([one]) => one !== id))
  return {
    ...kept,
    own: kept.own.filter((one) => one.id !== id),
    about,
    order: kept.order.filter((one) => one !== id),
  }
}

/** The list with the host at `from` moved to `to`, kept as the order Settings shows
 *  and the groups in the order their first hosts now come. */
export function moved(kept: Kept, hosts: readonly Host[], from: number, to: number): Kept {
  const ids = hosts.map((host) => host.id)
  const [one] = ids.splice(from, 1)
  if (one === undefined) return kept
  ids.splice(Math.max(0, Math.min(to, ids.length)), 0, one)

  const byId = new Map(hosts.map((host) => [host.id, host]))
  const groups: string[] = []
  for (const id of ids) {
    const group = byId.get(id)?.group
    if (group && !groups.includes(group)) groups.push(group)
  }
  return { ...kept, order: ids, groups }
}
