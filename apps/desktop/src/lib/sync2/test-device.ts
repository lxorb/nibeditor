/** One device's engine over a disk in memory and an account reached by `fetch`: what the
 *  tests that run the engine against the Worker's own routes start from (the migration
 *  rows of docs/sync-v2.md section 11 in services/sync/test/sync2-migrate.test.ts), and
 *  the transport's own tests here. The app's world is app-world.ts; this is the same
 *  engine with nothing of the window around it. */

import { Engine } from './engine'
import { MemoryDisk } from './memory-disk'
import { MemoryStore } from './memory-store'
import { accountOver, remoteFiles } from './transport'

export interface TestDevice {
  root: string
  disk: MemoryDisk
  store: MemoryStore
  engine: Engine
  /** Every route asked, in order, with the space or document it named. */
  asked: string[]
}

export interface Making {
  /** `fetch`, or the Worker's own `app.fetch` bound to a test environment. */
  fetch: (request: Request) => Promise<Response>
  token: string
  /** The files the device's space folder starts with, by path from its root: words for
   *  a document, bytes for any other file. */
  files?: Record<string, string | Uint8Array>
  name?: string
  base?: string
}

async function sha256(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function testDevice(making: Making): Promise<TestDevice> {
  const root = '/device/space'
  const disk = new MemoryDisk()
  disk.folders.add(root)
  for (const [path, held] of Object.entries(making.files ?? {})) {
    if (typeof held === 'string') await disk.write(`${root}/${path}`, held)
    else await disk.writeBytes(`${root}/${path}`, held)
  }
  const base = making.base ?? 'https://nibeditor.com'
  const asked: string[] = []
  const fetch = (request: Request) => {
    asked.push(`${request.method} ${new URL(request.url).pathname}`)
    return making.fetch(request)
  }
  const store = new MemoryStore(`device-${making.name ?? 'one'}`)
  const reaching = {
    base,
    token: () => making.token,
    device: () => making.name ?? 'one',
    fetch,
  }
  const engine = await Engine.start(
    {
      disk,
      account: accountOver(reaching),
      blobs: {
        read: (path) => disk.readBytes(path),
        write: (path, bytes) => disk.writeBytes(path, bytes),
        hash: (bytes) => sha256(bytes),
        ...remoteFiles(reaching),
      },
      name: making.name ?? 'one',
      now: () => Date.now(),
      random: Math.random,
      digest: sha256,
      join: (folder, path) => `${folder}/${path}`,
      foldsCase: true,
      platform: 'other',
      list: (at) => {
        const listed: { path: string; dir: boolean }[] = []
        for (const folder of disk.folders) {
          if (folder.startsWith(`${at}/`))
            listed.push({ path: folder.slice(at.length + 1), dir: true })
        }
        for (const file of [...disk.files.keys(), ...disk.bytes.keys()]) {
          if (file.startsWith(`${at}/`))
            listed.push({ path: file.slice(at.length + 1), dir: false })
        }
        return Promise.resolve(
          listed.sort((a, b) => a.path.split('/').length - b.path.split('/').length),
        )
      },
      async ancestor(id, hash) {
        const headers = { authorization: `Bearer ${making.token}` }
        const listing = await fetch(new Request(`${base}/v1/notes/${id}/versions`, { headers }))
        const { versions } = (await listing.json()) as { versions: { at: number }[] }
        for (const version of versions) {
          const one = await fetch(
            new Request(`${base}/v1/notes/${id}/versions/${String(version.at)}`, { headers }),
          )
          const { content } = (await one.json()) as { content: string }
          if ((await sha256(content)) === hash) return content
        }
        return null
      },
    },
    store.open(),
    { freshens: false },
  )
  return { root, disk, store, engine, asked }
}
