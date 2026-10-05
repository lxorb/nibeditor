import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { Saves, isSessionId, type Saved } from './saves'

let state: string
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), 'nibd-saves-'))
})
afterEach(() => {
  rmSync(state, { recursive: true, force: true })
})

function saved(session: string, at: number): Saved {
  return {
    v: 1,
    session,
    at,
    seq: 42,
    cols: 80,
    rows: 24,
    screen: '\x1b[31mred\x1b[0m',
    program: 'claude',
    folder: '/home/nib/build',
  }
}

test('a saved screen reads back as it was written, oldest first', () => {
  const saves = new Saves(state)
  saves.write(saved('s_b', 2))
  saves.write(saved('s_a', 1))
  expect(saves.all()).toEqual([saved('s_a', 1), saved('s_b', 2)])
})

test('a session ended for good leaves nothing to draw back', () => {
  const saves = new Saves(state)
  saves.write(saved('s_a', 1))
  saves.forget('s_a')
  expect(saves.all()).toEqual([])
})

test('a file that does not read as a save is passed over, not fatal', () => {
  const saves = new Saves(state)
  saves.write(saved('s_a', 1))
  writeFileSync(join(state, 'sessions', 'broken.json'), '{"v":1,')
  writeFileSync(join(state, 'sessions', 'other.json'), '{"v":2}')
  expect(saves.all().map((one) => one.session)).toEqual(['s_a'])
})

test('nothing saved yet is an empty list', () => {
  expect(new Saves(join(state, 'missing')).all()).toEqual([])
})

test('a session id is never a path', () => {
  expect(isSessionId('s_01J9ZK3-ab')).toBe(true)
  expect(isSessionId('../etc/passwd')).toBe(false)
  expect(isSessionId('a/b')).toBe(false)
  expect(isSessionId('')).toBe(false)
})
