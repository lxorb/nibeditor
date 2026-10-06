import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from 'vitest'
import { STALL, stalled } from './watchdog'

test('a loop is stalled once it has not turned for longer than the limit', () => {
  expect(stalled(0, STALL)).toBe(false)
  expect(stalled(0, STALL + 1)).toBe(true)
  expect(stalled(1000, 1500, 400)).toBe(true)
})

/** A node process that watches its own loop (limit 400 ms), then holds the loop for
 *  `holdFor` ms and says whether it came out the other side. */
function held(holdFor: number): Promise<{ out: string; ms: number }> {
  const module = pathToFileURL(join(import.meta.dirname, 'watchdog.ts')).href
  const script = `
    const { watch } = await import(${JSON.stringify(module)})
    watch(400, 50)
    setTimeout(() => {
      const end = Date.now() + ${String(holdFor)}
      while (Date.now() < end) {}
      process.stdout.write('survived')
      process.exit(0)
    }, 100)
  `
  const started = Date.now()
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  let out = ''
  child.stdout.on('data', (data: Buffer) => (out += data.toString()))
  return new Promise((resolve) => {
    child.on('exit', () => resolve({ out, ms: Date.now() - started }))
  })
}

test('a process whose loop is stuck is ended by its own watchdog', async () => {
  const { out, ms } = await held(10_000)
  expect(out).toBe('')
  expect(ms).toBeLessThan(8000)
})

test('a loop busy for less than the limit is left alone', async () => {
  const { out } = await held(150)
  expect(out).toBe('survived')
})
