/** A site's login on its way to the account and back, against an account and a crate
 *  that are stood in for: chunks before the manifest and never twice, the fence and the
 *  key's generation on the manifest, `fenced` when the lease moved on, and a download
 *  that fetches the manifest and then exactly the chunks it is missing. */

import { beforeEach, describe, expect, test, vi } from 'vitest'

interface Sent {
  method: string
  path: string
  headers: Record<string, string>
  size: number
}

const world = vi.hoisted(() => ({
  sent: [] as Sent[],
  answers: new Map<string, { status: number; body?: unknown; headers?: Record<string, string> }>(),
  put: [] as { folder: string; name: string; size: number }[],
  wants: [] as string[],
}))

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (command === 'web_state_file') return Promise.resolve(new Uint8Array([1, 2, 3]).buffer)
    if (command === 'web_state_inbox')
      return Promise.resolve('C:\\nib\\web-state\\in-0123456789abcdef')
    if (command === 'web_state_wants') return Promise.resolve(world.wants)
    return Promise.reject(new Error(`${command} ${JSON.stringify(args)}`))
  },
}))

vi.mock('../native', () => ({
  invoke: (_command: string, bytes: Uint8Array, options: { headers: Record<string, string> }) => {
    world.put.push({
      folder: options.headers['x-nib-folder'] ?? '',
      name: options.headers['x-nib-name'] ?? '',
      size: bytes.length,
    })
    return Promise.resolve(null)
  },
}))

vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
  const path = new URL(url).pathname
  const headers = (init.headers ?? {}) as Record<string, string>
  const body = init.body as Uint8Array | undefined
  world.sent.push({ method: init.method ?? 'GET', path, headers, size: body?.length ?? 0 })
  const answer = world.answers.get(`${init.method ?? 'GET'} ${path}`) ?? { status: 200, body: {} }
  const bytes = new Uint8Array([9, 9])
  return Promise.resolve({
    ok: answer.status >= 200 && answer.status < 300,
    status: answer.status,
    headers: new Headers(answer.headers ?? {}),
    json: () => Promise.resolve(answer.body),
    arrayBuffer: () => Promise.resolve(bytes.buffer),
  })
})

const { download, upload } = await import('./lease-transfer')

const KEY = 'f'.repeat(64)
const A = 'a'.repeat(64)
const B = 'b'.repeat(64)

function lease() {
  return { key: KEY, store: null, site: 'ethz.ch', sent: new Set<string>() }
}

function captured(chunks: string[]) {
  return {
    folder: 'C:/nib/web-state/out-0123456789abcdef',
    manifest: { name: 'manifest', size: 3 },
    chunks: chunks.map((name) => ({ name, size: 3 })),
    named: chunks,
    digest: 'd',
    skipped: [],
    cookies: 2,
  }
}

beforeEach(() => {
  world.sent = []
  world.answers.clear()
  world.put = []
  world.wants = []
})

describe('an upload', () => {
  test('sends the chunks, then the manifest under the fence and the generation', async () => {
    world.answers.set(`PUT /v2/web/${KEY}`, { status: 200, body: { version: 4 } })
    const one = lease()

    await expect(upload('tok', one, captured([A, B]), 3, 2)).resolves.toBe(4)
    expect(world.sent.map((sent) => sent.path)).toEqual([
      `/v2/web/chunks/${A}`,
      `/v2/web/chunks/${B}`,
      `/v2/web/${KEY}`,
    ])
    expect(world.sent.at(-1)?.headers).toMatchObject({
      authorization: 'Bearer tok',
      'x-nib-fence': '3',
      'x-nib-generation': '2',
      'x-nib-chunks': `${A},${B}`,
    })
    expect(one.sent).toEqual(new Set([A, B]))
  })

  test('a chunk already on the account is not sent again', async () => {
    world.answers.set(`PUT /v2/web/${KEY}`, { status: 200, body: { version: 5 } })
    const one = lease()
    one.sent.add(A)

    await upload('tok', one, captured([A, B]), 3, 2)
    expect(world.sent.map((sent) => sent.path)).toEqual([`/v2/web/chunks/${B}`, `/v2/web/${KEY}`])
  })

  test('an older fence is `fenced`, and a failure is nothing', async () => {
    world.answers.set(`PUT /v2/web/${KEY}`, { status: 409, body: { error: 'fenced' } })
    await expect(upload('tok', lease(), captured([]), 1, 1)).resolves.toBe('fenced')

    world.answers.set(`PUT /v2/web/${KEY}`, { status: 503, body: {} })
    await expect(upload('tok', lease(), captured([]), 1, 1)).resolves.toBeNull()
  })
})

describe('a download', () => {
  test('is the manifest, then the chunks it names that are not here yet', async () => {
    world.answers.set(`GET /v2/web/${KEY}`, { status: 200, headers: { 'x-nib-version': '7' } })
    world.wants = [B]

    await expect(download('tok', lease())).resolves.toEqual({
      path: 'C:\\nib\\web-state\\in-0123456789abcdef\\manifest',
      version: 7,
    })
    expect(world.sent.map((sent) => sent.path)).toEqual([`/v2/web/${KEY}`, `/v2/web/chunks/${B}`])
    expect(world.put.map((one) => one.name)).toEqual(['manifest', B])
    expect(world.put[0]?.folder).toBe('in-0123456789abcdef')
  })

  test('is nothing where the account has no state yet', async () => {
    world.answers.set(`GET /v2/web/${KEY}`, { status: 404 })
    await expect(download('tok', lease())).resolves.toBeNull()
  })
})
