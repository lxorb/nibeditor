import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import type { NibdFrame } from '@nib/online/wire'
import { Nibd } from './nibd'

const made: { nibd: Nibd; state: string }[] = []
afterEach(() => {
  for (const { nibd, state } of made.splice(0)) {
    nibd.stop()
    rmSync(state, { recursive: true, force: true })
  }
})

/** A `nibd` with no session yet, whose callbacks are answered by `call`. */
function machine(call: (url: string) => Promise<number> = () => Promise.resolve(200)) {
  const state = mkdtempSync(join(tmpdir(), 'nibd-state-'))
  const nibd = new Nibd({
    state,
    home: state,
    shell: '/bin/sh',
    user: null,
    env: {},
    pidsMax: 64,
    cgroups: null,
    activityEvery: 60_000,
    homeEvery: 60_000,
    call,
  })
  made.push({ nibd, state })
  const said: NibdFrame[] = []
  return { nibd, said, attach: () => nibd.attach((frame) => said.push(frame)) }
}

test('a callback is made on the machine and answered with its status', async () => {
  const asked: string[] = []
  const { nibd, said, attach } = machine((url) => {
    asked.push(url)
    return Promise.resolve(302)
  })
  attach()
  const url = 'http://localhost:54545/callback?code=c'
  await nibd.receive({ t: 'callback', session: 's_1', url })
  expect(asked).toEqual([url])
  expect(said).toEqual([{ t: 'called', session: 's_1', url, status: 302 }])
})

test('a callback anywhere but this machine is never made', async () => {
  const asked: string[] = []
  const { nibd, said, attach } = machine((url) => {
    asked.push(url)
    return Promise.resolve(200)
  })
  attach()
  await nibd.receive({ t: 'callback', session: 's_1', url: 'http://169.254.169.254:80/' })
  expect(asked).toEqual([])
  expect(said).toEqual([])
})

test('opens nothing with no link to say it on, or no session to say it for', () => {
  const { nibd, said, attach } = machine()
  expect(nibd.open('https://a.b/', 's_1')).toBe(false)
  attach()
  expect(nibd.open('https://a.b/', 's_1')).toBe(false)
  expect(said).toEqual([])
})
