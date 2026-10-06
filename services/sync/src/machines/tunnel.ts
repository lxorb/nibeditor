/** A machine's one way in (docs/online-terminal.md 4.15): a Cloudflare Tunnel of its own,
 *  run by `cloudflared` on the server, and the hostname in front of it,
 *  `m-<machine>.nibeditor.com`, whose only origin is that tunnel.
 *
 *  Made and taken away through Cloudflare's API with the Worker's secret
 *  `MACHINE_TUNNEL_TOKEN`, which may edit Cloudflare Tunnels on the account and DNS on the
 *  one zone and nothing else. Every call is idempotent: a tunnel is found by its name and
 *  a record by its hostname before either is made, so a start that died halfway finishes
 *  what it began instead of making a second of each.
 *  https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel-api/ */

const API = 'https://api.cloudflare.com/client/v4'

/** The port `nibd` listens on, on the server's loopback (nibd.service). */
const NIBD = 'http://127.0.0.1:7680'

class TunnelError extends Error {
  constructor(
    readonly status: number,
    readonly code: number,
    message: string,
  ) {
    super(message)
    this.name = 'TunnelError'
  }
}

/** Cloudflare Access in front of the machines' hostnames, where it is set up: the team's
 *  name and the application's audience tag, which `cloudflared` checks every request's
 *  token against as well as the edge does. */
export interface Access {
  team: string
  aud: string
}

type Fetch = typeof fetch

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class Tunnels {
  constructor(
    private readonly token: string,
    private readonly account: string,
    private readonly zone: string,
    private readonly fetcher: Fetch = (input, init) => fetch(input, init),
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
    let said: unknown = null
    try {
      said = await answer.json()
    } catch {
      // Not JSON: the status says enough.
    }
    const ok = isRecord(said) && said.success === true
    if (!answer.ok || !ok) {
      const errors = isRecord(said) && Array.isArray(said.errors) ? said.errors : []
      const first: unknown = errors[0]
      const error = isRecord(first) ? first : {}
      throw new TunnelError(
        answer.status,
        typeof error.code === 'number' ? error.code : 0,
        typeof error.message === 'string'
          ? error.message
          : `Cloudflare answered ${String(answer.status)}`,
      )
    }
    return (said as { result?: unknown }).result
  }

  /** The tunnel named `name`, made where there is none: its id. Managed by Cloudflare
   *  (`config_src`), so its routes are set here and the server needs only its token. */
  async tunnel(name: string): Promise<string> {
    const found = await this.ask(
      'GET',
      `/accounts/${this.account}/cfd_tunnel?name=${encodeURIComponent(name)}&is_deleted=false`,
    )
    const first: unknown = Array.isArray(found) ? found[0] : null
    if (isRecord(first) && typeof first.id === 'string') return first.id
    const made = await this.ask('POST', `/accounts/${this.account}/cfd_tunnel`, {
      name,
      config_src: 'cloudflare',
    })
    if (!isRecord(made) || typeof made.id !== 'string') {
      throw new TunnelError(502, 0, 'the made tunnel did not read')
    }
    return made.id
  }

  /** The token `cloudflared` runs the tunnel with. Asked when a server is made, handed to
   *  it once, and never kept by the Worker. */
  async tokenOf(id: string): Promise<string> {
    const token = await this.ask('GET', `/accounts/${this.account}/cfd_tunnel/${id}/token`)
    if (typeof token !== 'string' || !token) throw new TunnelError(502, 0, 'no tunnel token')
    return token
  }

  /** The tunnel's one route: the machine's hostname to `nibd`, and nothing for anything
   *  else. With Access set up, `cloudflared` also refuses a request whose Access token
   *  is not this application's. */
  async route(id: string, hostname: string, access: Access | null): Promise<void> {
    await this.ask('PUT', `/accounts/${this.account}/cfd_tunnel/${id}/configurations`, {
      config: {
        ingress: [
          {
            hostname,
            service: NIBD,
            originRequest: access
              ? { access: { required: true, teamName: access.team, audTag: [access.aud] } }
              : {},
          },
          { service: 'http_status:404' },
        ],
      },
    })
  }

  /** The hostname, a proxied CNAME to the tunnel: its record's id. */
  async hostname(hostname: string, tunnel: string): Promise<string> {
    const content = `${tunnel}.cfargotunnel.com`
    const found = await this.ask(
      'GET',
      `/zones/${this.zone}/dns_records?type=CNAME&name=${encodeURIComponent(hostname)}`,
    )
    const first: unknown = Array.isArray(found) ? found[0] : null
    if (isRecord(first) && typeof first.id === 'string') {
      if (first.content !== content) {
        await this.ask('PATCH', `/zones/${this.zone}/dns_records/${first.id}`, { content })
      }
      return first.id
    }
    const made = await this.ask('POST', `/zones/${this.zone}/dns_records`, {
      type: 'CNAME',
      name: hostname,
      content,
      proxied: true,
      comment: 'nib online terminal machine',
    })
    if (!isRecord(made) || typeof made.id !== 'string') {
      throw new TunnelError(502, 0, 'the made record did not read')
    }
    return made.id
  }

  /** The tunnel and its hostname, gone; either already gone is fine. A tunnel with a
   *  connector still attached cannot be deleted, so its connections are cleaned first
   *  (the server is gone by now, and they are stale). */
  async remove(name: string, hostname: string): Promise<void> {
    const records = await this.ask(
      'GET',
      `/zones/${this.zone}/dns_records?type=CNAME&name=${encodeURIComponent(hostname)}`,
    )
    for (const record of Array.isArray(records) ? records : []) {
      if (isRecord(record) && typeof record.id === 'string') {
        await this.ask('DELETE', `/zones/${this.zone}/dns_records/${record.id}`)
      }
    }
    const tunnels = await this.ask(
      'GET',
      `/accounts/${this.account}/cfd_tunnel?name=${encodeURIComponent(name)}&is_deleted=false`,
    )
    for (const tunnel of Array.isArray(tunnels) ? tunnels : []) {
      if (!isRecord(tunnel) || typeof tunnel.id !== 'string') continue
      await this.ask('DELETE', `/accounts/${this.account}/cfd_tunnel/${tunnel.id}/connections`)
      await this.ask('DELETE', `/accounts/${this.account}/cfd_tunnel/${tunnel.id}`)
    }
  }
}
