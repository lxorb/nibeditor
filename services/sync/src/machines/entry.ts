/** The Worker with the machines in it: wrangler.jsonc's `main`
 *  (docs/online-terminal.md, 6.3).
 *
 *  Everything src/index.ts is, plus the three classes only a deploy with containers
 *  binds: `Machine`, the Sandbox SDK's `DirectoryBackupGateway` (which carries a home's
 *  backup between the container and R2, reaching only the one object each operation
 *  names), and `Egress`, the outbound gateway a machine uses when `MACHINE_EGRESS` is
 *  `web`. Kept out of src/index.ts because the SDK imports `cloudflare:workers`, which
 *  neither the deploy CI runs nor the tests can load; the host is wired here, once, as
 *  the module loads. */

import {
  DirectoryBackup,
  DirectoryBackupGateway,
  type DirectoryBackupGatewayBinding,
  type DirectoryBackupRecord,
} from '@cloudflare/sandbox'
import { WorkerEntrypoint } from 'cloudflare:workers'
import worker from '../index'
import type { Env } from '../types'
import { wire } from './host'

/** What the machines' entry exports, as `ctx.exports` hands them back. */
interface Exports {
  DirectoryBackupGateway: DirectoryBackupGatewayBinding
  Egress: (options: { props: Record<string, never> }) => Fetcher
}

/** The homes bucket's binding, by name, as the gateway reads it off `env`. */
const HOMES = 'HOMES'

/** What a machine may never reach over HTTP: private ranges, link-local and the
 *  metadata addresses, and the loopback (4.8). Hostnames only; with the internet off an
 *  HTTPS request to a bare address does not leave anyway. */
const DENIED = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^\[?(::1|f[cd][0-9a-f]{2}:|fe80:)/i,
  /^metadata(\.google\.internal)?$/i,
  /\.internal$/i,
  /\.local$/i,
]

/** The outbound gateway for `web` egress: refuses the denied hosts and forwards the
 *  rest as it came. It reads the hostname and nothing else; see `egressOf` in host.ts
 *  for why it is not the default. */
export class Egress extends WorkerEntrypoint<Env> {
  override async fetch(request: Request): Promise<Response> {
    const host = new URL(request.url).hostname.replace(/\.+$/, '')
    if (DENIED.some((one) => one.test(host))) {
      return new Response('Origin is disallowed', { status: 520 })
    }
    return await fetch(request)
  }
}

wire({
  backups: (container, ctx) => {
    const exports = ctx.exports as unknown as Exports
    const homes = new DirectoryBackup(container, exports.DirectoryBackupGateway, {
      binding: HOMES,
    })
    return {
      intercept: () => homes.intercept(),
      backup: async (dir, name) => {
        const record = await homes.backup({
          dir,
          name,
          // What any package manager fetches again, left out of the R2 copy; the
          // snapshot keeps them (4.3).
          exclude: ['.cache/', 'node_modules/', '.npm/_cacache/'],
        })
        return JSON.stringify({ ...record, key: `${record.id}.tar.zst` })
      },
      restore: (record) => homes.restore(JSON.parse(record) as DirectoryBackupRecord),
    }
  },
  outbound: (ctx) => (ctx.exports as unknown as Exports).Egress({ props: {} }),
})

export { DirectoryBackupGateway }
export { AccountHub, NoteRoom } from '../index'
export { Machine } from './machine'
export default worker
