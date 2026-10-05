import { describe, expect, test } from 'vitest'
import { onlineOf } from './calls'
import { isMadeName, isOnlineTab, isTermTarget, termName } from './path'
import { resumeCommand } from './resume'

describe('an online terminal, told apart', () => {
  test('is a terminal tab whose file is a .term', () => {
    expect(isTermTarget('C:\\Notes\\Build.term')).toBe(true)
    expect(isTermTarget('/notes/Build.TERM')).toBe(true)
    expect(isTermTarget('/notes/Build.md')).toBe(false)
    expect(isTermTarget(null)).toBe(false)
    expect(isOnlineTab({ kind: 'terminal', path: '/n/Terminal.term' })).toBe(true)
    expect(isOnlineTab({ kind: 'terminal', path: null })).toBe(false)
    expect(isOnlineTab({ kind: 'note', path: '/n/Terminal.term' })).toBe(false)
  })

  /** The file's name is the tab's, unless it is still the one it was made with. */
  test('is called by its file, unless that is still the name it was made with', () => {
    expect(termName('Build.term')).toBe('Build')
    expect(isMadeName('Terminal.term')).toBe(true)
    expect(isMadeName('Terminal 2')).toBe(true)
    expect(isMadeName('Terminals')).toBe(false)
    expect(isMadeName('Build.term')).toBe(false)
  })
})

describe('Resume', () => {
  /** Exactly the commands docs/online-terminal.md 4.7 names. */
  test('types each agent its own continue command', () => {
    expect(resumeCommand('claude')).toBe('claude --continue')
    expect(resumeCommand('codex')).toBe('codex resume --last')
  })

  test('offers nothing for a program with no conversation to pick up', () => {
    expect(resumeCommand('vim')).toBeNull()
    expect(resumeCommand(null)).toBeNull()
  })
})

describe("the account's answer about the machine", () => {
  const month = {
    allowed: true,
    machine: { id: 'm1', state: 'asleep', held: false },
    used: { awakeS: 3600, cpuS: 60, homeBytes: 1e6, egressBytes: 2e6 },
    limit: { awakeS: 72000, cpuS: 36000, homeBytes: 5e9, egressBytes: 2e10 },
    resetAt: 1_793_000_000_000,
  }

  test('reads as the machine and the month', () => {
    const { resetAt, ...rest } = month
    expect(onlineOf(month)).toEqual({ ...rest, resets: resetAt })
  })

  test('with no machine yet', () => {
    expect(onlineOf({ ...month, machine: null })?.machine).toBeNull()
  })

  test('and is nothing when it does not read', () => {
    expect(onlineOf({ ...month, used: { awakeS: '1' } })).toBeNull()
    expect(onlineOf(null)).toBeNull()
    expect(onlineOf({ ...month, machine: { id: 'm1', state: 'flying' } })?.machine).toBeNull()
  })
})
