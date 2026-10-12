import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const CLI = fileURLToPath(new URL('../../cli/nib.mjs', import.meta.url))

/** What `nib` sends for these words, to an app that is only a socket. */
async function sent(words: string[]): Promise<{ verb: string; args: Record<string, unknown> }> {
  let body = ''
  const server = createServer((request, response) => {
    request.on('data', (chunk: Buffer) => (body += chunk.toString()))
    request.on('end', () => response.end(JSON.stringify({ ok: true, value: {} })))
  })
  await new Promise<void>((settle) => server.listen(0, '127.0.0.1', settle))
  const { port } = server.address() as AddressInfo
  const file = join(mkdtempSync(join(tmpdir(), 'nib-cli-')), 'automation.json')
  writeFileSync(file, JSON.stringify({ port, secret: 's', pid: 1 }))

  const child = spawn(process.execPath, [CLI, ...words], {
    env: { ...process.env, NIB_ENDPOINT: file },
  })
  await new Promise((settle) => child.on('close', settle))
  server.close()
  return JSON.parse(body) as { verb: string; args: Record<string, unknown> }
}

test('a note that opens with front matter is the content, not a flag', async () => {
  const content = '---\nstatus: draft\n---\n# Plan'
  const { verb, args } = await sent(['new', 'Plan', '--content', content, '--silent'])
  expect(verb).toBe('new')
  expect(args).toEqual({ content, silent: '' })
})
