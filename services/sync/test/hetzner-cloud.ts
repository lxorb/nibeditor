/** Hetzner's Cloud API and Cloudflare's tunnel and DNS API, faked as one `fetch`
 *  (docs/online-terminal.md 4.15): enough of each to make, find, power-cycle and delete
 *  what a machine has, with what was asked kept in order. Nothing leaves the test. */

interface FakeServer {
  id: number
  name: string
  status: string
  location: string
  labels: Record<string, string>
  userData: string
  firewall: number
}

/** One API error, as the next matching call answers it. */
interface Failure {
  method: string
  path: RegExp
  status: number
  code: string
}

export class Cloud {
  /** Every call, as `METHOD path`. */
  readonly asked: string[] = []
  readonly servers: FakeServer[] = []
  readonly firewalls: {
    id: number
    name: string
    labels: Record<string, string>
    rules: unknown[]
  }[] = []
  readonly tunnels: { id: string; name: string; config: unknown; connections: boolean }[] = []
  readonly records: { id: string; name: string; content: string; proxied: boolean }[] = []
  /** Headers each request to a machine's hostname came with. */
  readonly linked: Headers[] = []
  /** Answers to the next calls that match. */
  readonly failures: Failure[] = []
  /** Where the server type may be had now. */
  available = ['nbg1', 'fsn1', 'hel1']
  /** How a link to `nibd` is answered. */
  linkStatus = 101
  private next = 100

  fail(method: string, path: RegExp, status: number, code: string): void {
    this.failures.push({ method, path, status, code })
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    )
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = url.pathname + url.search
    this.asked.push(
      `${method} ${url.hostname === 'api.hetzner.cloud' ? path.replace('/v1', '') : url.hostname === 'api.cloudflare.com' ? path.replace('/client/v4', '') : url.href}`,
    )
    const failure = this.failures.findIndex((one) => one.method === method && one.path.test(path))
    if (failure >= 0) {
      const [one] = this.failures.splice(failure, 1)
      return Response.json(
        url.hostname === 'api.hetzner.cloud'
          ? { error: { code: one?.code, message: `fake ${one?.code ?? ''}` } }
          : { success: false, errors: [{ code: 1000, message: `fake ${one?.code ?? ''}` }] },
        { status: one?.status ?? 500 },
      )
    }
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null
    if (url.hostname === 'api.hetzner.cloud') return this.hetzner(method, url, body)
    if (url.hostname === 'api.cloudflare.com') return this.cloudflare(method, url, body)
    this.linked.push(new Headers(init?.headers))
    if (this.linkStatus !== 101) return new Response('no', { status: this.linkStatus })
    const socket = { accept: () => undefined, close: () => undefined }
    return { status: 101, webSocket: socket } as unknown as Response
  }

  private labelled<T extends { labels: Record<string, string> }>(list: T[], url: URL): T[] {
    const selector = url.searchParams.get('label_selector')
    if (!selector) return list
    const [key, value] = selector.split('==')
    return list.filter((one) => key !== undefined && one.labels[key] === value)
  }

  private hetzner(method: string, url: URL, body: unknown): Response {
    const path = url.pathname.replace('/v1', '')
    const given = (body ?? {}) as Record<string, unknown>
    let match: RegExpExecArray | null
    if (method === 'GET' && path === '/servers') {
      return Response.json({
        servers: this.labelled(this.servers, url).map((one) => ({
          id: one.id,
          status: one.status,
          datacenter: { location: { name: one.location } },
        })),
      })
    }
    if (method === 'POST' && path === '/servers') {
      const firewalls = given.firewalls as { firewall: number }[]
      const made: FakeServer = {
        id: this.next++,
        name: String(given.name),
        status: 'initializing',
        location: String(given.location),
        labels: given.labels as Record<string, string>,
        userData: String(given.user_data),
        firewall: firewalls[0]?.firewall ?? 0,
      }
      this.servers.push(made)
      return Response.json(
        {
          server: {
            id: made.id,
            status: made.status,
            datacenter: { location: { name: made.location } },
          },
          root_password: 'never-read',
        },
        { status: 201 },
      )
    }
    if ((match = /^\/servers\/(\d+)$/.exec(path)) && method === 'DELETE') {
      const at = this.servers.findIndex((one) => one.id === Number(match?.[1]))
      if (at < 0)
        return Response.json({ error: { code: 'not_found', message: 'gone' } }, { status: 404 })
      this.servers.splice(at, 1)
      return Response.json({ action: { id: 1 } })
    }
    if ((match = /^\/servers\/(\d+)\/actions\/(reset|poweron)$/.exec(path))) {
      const server = this.servers.find((one) => one.id === Number(match?.[1]))
      if (server) server.status = 'running'
      return Response.json({ action: { id: 2 } }, { status: 201 })
    }
    if (method === 'GET' && path === '/firewalls') {
      return Response.json({
        firewalls: this.labelled(this.firewalls, url).map((one) => ({ id: one.id })),
      })
    }
    if (method === 'POST' && path === '/firewalls') {
      const made = {
        id: this.next++,
        name: String(given.name),
        labels: given.labels as Record<string, string>,
        rules: given.rules as unknown[],
      }
      this.firewalls.push(made)
      return Response.json({ firewall: { id: made.id }, actions: [] }, { status: 201 })
    }
    if ((match = /^\/firewalls\/(\d+)\/actions\/set_rules$/.exec(path))) {
      const wall = this.firewalls.find((one) => one.id === Number(match?.[1]))
      if (wall) wall.rules = given.rules as unknown[]
      return Response.json({ actions: [] }, { status: 201 })
    }
    if ((match = /^\/firewalls\/(\d+)$/.exec(path)) && method === 'DELETE') {
      const id = Number(match[1])
      if (this.servers.some((one) => one.firewall === id)) {
        return Response.json(
          { error: { code: 'resource_in_use', message: 'in use' } },
          { status: 409 },
        )
      }
      const at = this.firewalls.findIndex((one) => one.id === id)
      if (at >= 0) this.firewalls.splice(at, 1)
      return new Response(null, { status: 204 })
    }
    if (method === 'GET' && path === '/server_types') {
      return Response.json({
        server_types: [
          {
            name: url.searchParams.get('name'),
            cores: 8,
            memory: 16,
            disk: 160,
            prices: ['nbg1', 'fsn1', 'hel1'].map((location) => ({
              location,
              price_hourly: { net: '0.0200', gross: '0.0238' },
              price_monthly: { net: '11.4900', gross: '13.6731' },
            })),
            locations: ['nbg1', 'fsn1', 'hel1'].map((name, id) => ({
              id,
              name,
              available: this.available.includes(name),
            })),
          },
        ],
      })
    }
    if (method === 'GET' && path === '/pricing') {
      return Response.json({
        pricing: {
          currency: 'EUR',
          primary_ips: [
            {
              type: 'ipv4',
              prices: ['nbg1', 'fsn1'].map((location) => ({
                location,
                price_hourly: { net: '0.0008', gross: '0.0010' },
                price_monthly: { net: '0.5000', gross: '0.5950' },
              })),
            },
          ],
        },
      })
    }
    return Response.json({ error: { code: 'not_found', message: path } }, { status: 404 })
  }

  private cloudflare(method: string, url: URL, body: unknown): Response {
    const path = url.pathname.replace('/client/v4', '')
    const given = (body ?? {}) as Record<string, unknown>
    const ok = (result: unknown, status = 200) =>
      Response.json({ success: true, errors: [], result }, { status })
    let match: RegExpExecArray | null
    if ((match = /^\/accounts\/[^/]+\/cfd_tunnel$/.exec(path))) {
      if (method === 'GET') {
        const name = url.searchParams.get('name')
        return ok(
          this.tunnels
            .filter((one) => one.name === name)
            .map(({ id, name: n }) => ({ id, name: n })),
        )
      }
      const made = {
        id: `tunnel-${String(this.next++)}`,
        name: String(given.name),
        config: null,
        connections: true,
      }
      this.tunnels.push(made)
      return ok({ id: made.id, name: made.name })
    }
    if ((match = /^\/accounts\/[^/]+\/cfd_tunnel\/([^/]+)\/token$/.exec(path))) {
      return ok(`eyJ-token-of-${match[1] ?? ''}`)
    }
    if ((match = /^\/accounts\/[^/]+\/cfd_tunnel\/([^/]+)\/configurations$/.exec(path))) {
      const tunnel = this.tunnels.find((one) => one.id === match?.[1])
      if (tunnel) tunnel.config = given.config
      return ok({})
    }
    if ((match = /^\/accounts\/[^/]+\/cfd_tunnel\/([^/]+)\/connections$/.exec(path))) {
      const tunnel = this.tunnels.find((one) => one.id === match?.[1])
      if (tunnel) tunnel.connections = false
      return ok(null)
    }
    if ((match = /^\/accounts\/[^/]+\/cfd_tunnel\/([^/]+)$/.exec(path)) && method === 'DELETE') {
      const at = this.tunnels.findIndex((one) => one.id === match?.[1])
      if (this.tunnels[at]?.connections) {
        return Response.json(
          { success: false, errors: [{ code: 1022, message: 'connections' }] },
          { status: 400 },
        )
      }
      if (at >= 0) this.tunnels.splice(at, 1)
      return ok({})
    }
    if (/^\/zones\/[^/]+\/dns_records$/.test(path)) {
      if (method === 'GET') {
        const name = url.searchParams.get('name')
        return ok(this.records.filter((one) => one.name === name))
      }
      const made = {
        id: `record-${String(this.next++)}`,
        name: String(given.name),
        content: String(given.content),
        proxied: given.proxied === true,
      }
      this.records.push(made)
      return ok(made)
    }
    if ((match = /^\/zones\/[^/]+\/dns_records\/([^/]+)$/.exec(path))) {
      const at = this.records.findIndex((one) => one.id === match?.[1])
      if (method === 'DELETE' && at >= 0) this.records.splice(at, 1)
      return ok({ id: match[1] })
    }
    return Response.json(
      { success: false, errors: [{ code: 7003, message: path }] },
      { status: 404 },
    )
  }
}
