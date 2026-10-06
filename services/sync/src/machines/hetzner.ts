/** The Hetzner Cloud API, as much of it as a machine needs (docs/online-terminal.md 4.15):
 *  servers found by their label, made, power-cycled and deleted; their firewall; and
 *  what a server type is and costs. https://docs.hetzner.cloud, read 2026-10-06.
 *
 *  Every answer is read into its type or refused, and every failure is a `HetznerError`
 *  with the API's own code (`resource_unavailable`, `rate_limit_exceeded`, ...), so the
 *  host can tell "try the next location" from "stop". The token is the Worker's secret
 *  `HETZNER_TOKEN`, scoped by Hetzner to one project. */

const API = 'https://api.hetzner.cloud/v1'

export class HetznerError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'HetznerError'
  }
}

/** A server as the host reads it. */
export interface Server {
  id: number
  status: string
  location: string
}

/** A server type: its size, and what it costs a month in each location where it can be
 *  had now, with VAT, in the project's currency. */
export interface ServerType {
  name: string
  cores: number
  /** GB, as Hetzner says them. */
  memory: number
  disk: number
  prices: { location: string; monthly: number }[]
  /** Locations where it can be ordered now. */
  available: string[]
}

/** What the server will be: the request body of `POST /servers`. */
export interface NewServer {
  name: string
  serverType: string
  location: string
  userData: string
  labels: Record<string, string>
  firewall: number
}

type Fetch = typeof fetch

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function serverOf(value: unknown): Server | null {
  if (!isRecord(value) || typeof value.id !== 'number' || typeof value.status !== 'string') {
    return null
  }
  const datacenter = isRecord(value.datacenter) ? value.datacenter : null
  const location = datacenter && isRecord(datacenter.location) ? datacenter.location.name : null
  return {
    id: value.id,
    status: value.status,
    location: typeof location === 'string' ? location : '',
  }
}

/** A price string ("14.8631") as a number of the currency's units. */
function amount(value: unknown): number | null {
  const gross = isRecord(value) ? Number(value.gross) : Number.NaN
  return Number.isFinite(gross) && gross >= 0 ? gross : null
}

export class Hetzner {
  constructor(
    private readonly token: string,
    private readonly fetcher: Fetch = fetch,
  ) {}

  private async ask(method: string, path: string, body?: unknown): Promise<unknown> {
    const answer = await this.fetcher(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await answer.text()
    let said: unknown = null
    try {
      said = text ? JSON.parse(text) : null
    } catch {
      // Not JSON: the status says enough.
    }
    if (!answer.ok) {
      const error = isRecord(said) && isRecord(said.error) ? said.error : {}
      throw new HetznerError(
        answer.status,
        typeof error.code === 'string' ? error.code : 'http',
        typeof error.message === 'string'
          ? error.message
          : `Hetzner answered ${String(answer.status)}`,
      )
    }
    return said
  }

  /** The server with this label, if there is one. A label is how a server is known to be
   *  a machine's, so a start that died halfway finds what it made rather than making a
   *  second one. */
  async serverLabelled(key: string, value: string): Promise<Server | null> {
    const selector = encodeURIComponent(`${key}==${value}`)
    const said = await this.ask('GET', `/servers?label_selector=${selector}`)
    const servers = isRecord(said) && Array.isArray(said.servers) ? said.servers : []
    return serverOf(servers[0])
  }

  /** The server made, and what the API said it is. Its root password, which Hetzner
   *  answers with when no SSH key is given, is never read: root has no password the
   *  machine accepts (install.sh). */
  async createServer(server: NewServer): Promise<Server> {
    const said = await this.ask('POST', '/servers', {
      name: server.name,
      server_type: server.serverType,
      location: server.location,
      image: 'ubuntu-24.04',
      user_data: server.userData,
      labels: server.labels,
      firewalls: [{ firewall: server.firewall }],
      // IPv4 too: much of what a person fetches (GitHub among it) has no IPv6.
      public_net: { enable_ipv4: true, enable_ipv6: true },
      start_after_create: true,
    })
    const made = isRecord(said) ? serverOf(said.server) : null
    if (!made) throw new HetznerError(502, 'shape', 'the made server did not read')
    return made
  }

  async deleteServer(id: number): Promise<void> {
    await this.ask('DELETE', `/servers/${String(id)}`)
  }

  /** A hard power cycle: what a server that answers nothing needs. */
  async reset(id: number): Promise<void> {
    await this.ask('POST', `/servers/${String(id)}/actions/reset`)
  }

  async powerOn(id: number): Promise<void> {
    await this.ask('POST', `/servers/${String(id)}/actions/poweron`)
  }

  /** The firewall with this label, if there is one. */
  async firewallLabelled(key: string, value: string): Promise<number | null> {
    const selector = encodeURIComponent(`${key}==${value}`)
    const said = await this.ask('GET', `/firewalls?label_selector=${selector}`)
    const walls = isRecord(said) && Array.isArray(said.firewalls) ? said.firewalls : []
    const first: unknown = walls[0]
    return isRecord(first) && typeof first.id === 'number' ? first.id : null
  }

  /** A firewall that lets in only what `rules` says: none is nothing at all. Outbound is
   *  left open, as no outbound rule means. */
  async createFirewall(name: string, labels: Record<string, string>, rules: unknown[]) {
    const said = await this.ask('POST', '/firewalls', { name, labels, rules })
    const wall = isRecord(said) && isRecord(said.firewall) ? said.firewall : null
    if (!wall || typeof wall.id !== 'number') {
      throw new HetznerError(502, 'shape', 'the made firewall did not read')
    }
    return wall.id
  }

  async setFirewallRules(id: number, rules: unknown[]): Promise<void> {
    await this.ask('POST', `/firewalls/${String(id)}/actions/set_rules`, { rules })
  }

  async deleteFirewall(id: number): Promise<void> {
    await this.ask('DELETE', `/firewalls/${String(id)}`)
  }

  /** A server type by name, with its prices and where it can be had. */
  async serverType(name: string): Promise<ServerType> {
    const said = await this.ask('GET', `/server_types?name=${encodeURIComponent(name)}`)
    const types = isRecord(said) && Array.isArray(said.server_types) ? said.server_types : []
    const type: unknown = types[0]
    if (!isRecord(type) || typeof type.cores !== 'number' || typeof type.memory !== 'number') {
      throw new HetznerError(404, 'not_found', `no server type ${name}`)
    }
    const prices = (Array.isArray(type.prices) ? type.prices : []).flatMap((one: unknown) => {
      if (!isRecord(one) || typeof one.location !== 'string') return []
      const monthly = amount(one.price_monthly)
      return monthly === null ? [] : [{ location: one.location, monthly }]
    })
    const available = (Array.isArray(type.locations) ? type.locations : []).flatMap(
      (one: unknown) =>
        isRecord(one) && typeof one.name === 'string' && one.available !== false ? [one.name] : [],
    )
    return {
      name,
      cores: type.cores,
      memory: type.memory,
      disk: typeof type.disk === 'number' ? type.disk : 0,
      prices,
      available,
    }
  }

  /** What a public IPv4 address costs a month in a location, with VAT (0 where the API
   *  says nothing), and the currency every price of the project is in. */
  async ipv4(location: string): Promise<{ monthly: number; currency: string }> {
    const said = await this.ask('GET', '/pricing')
    const pricing = isRecord(said) && isRecord(said.pricing) ? said.pricing : {}
    const currency = typeof pricing.currency === 'string' ? pricing.currency : 'EUR'
    const ips: unknown[] = Array.isArray(pricing.primary_ips) ? pricing.primary_ips : []
    for (const ip of ips) {
      if (!isRecord(ip) || ip.type !== 'ipv4' || !Array.isArray(ip.prices)) continue
      for (const one of ip.prices as unknown[]) {
        if (isRecord(one) && one.location === location) {
          return { monthly: amount(one.price_monthly) ?? 0, currency }
        }
      }
    }
    return { monthly: 0, currency }
  }
}
