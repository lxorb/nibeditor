import { describe, expect, it } from 'vitest'

import { readGrant } from './crate'
import { FakeCrate, freeId, seeded, standIn } from './fake'
import { ownGrant, thirdPartyGrant, withAsk, withScope, withSite } from './grant'
import { AgentsPane } from './pane.svelte'
import { reach } from './reach.svelte'

async function opened(fake: FakeCrate): Promise<AgentsPane> {
  const pane = new AgentsPane(fake)
  await pane.open()
  return pane
}

describe('the pane over the crate', () => {
  it('reads the agents, the program and when each last called', async () => {
    const now = Date.UTC(2026, 8, 30, 16)
    const pane = await opened(seeded(now))
    expect(pane.ready).toBe(true)
    expect(pane.grants.map((one) => one.id)).toEqual(['claude-code', 'codex', 'nightly-backup'])
    expect(pane.program).toContain('nib.exe')
    expect(pane.last.get('claude-code')).toBe(now - 39 * 60_000)
    expect(pane.last.get('codex')).toBe(now - 26 * 60 * 60 * 1000)
    // Nothing of the script's in thirty days: every day was read looking for it.
    expect(pane.last.has('nightly-backup')).toBe(false)
    expect(pane.earlier).toBe(false)
  })

  it('writes a switch through the crate and reads back what it kept', async () => {
    const fake = new FakeCrate()
    fake.pair('Claude Code', 1)
    const pane = await opened(fake)

    await pane.change('claude-code', (grant) => withScope(grant, 'terminal', true))
    await pane.change('claude-code', (grant) => withAsk(grant, 'paying', false))
    await pane.change('claude-code', (grant) => withSite(grant, 'bank.example', 'agent-store'))

    const kept = fake.grants[0]
    expect(kept?.scopes).toContain('terminal')
    expect(kept?.asks).toEqual({ paying: false })
    expect(kept?.sites).toEqual({ 'bank.example': 'agent-store' })
    expect(pane.grants).toEqual(fake.grants)
    // Who it was made for and when are the crate's facts, whatever the pane sends.
    await pane.change('claude-code', (grant) => ({ ...grant, client: 'Somebody', created: 9 }))
    expect(fake.grants[0]?.client).toBe('Claude Code')
    expect(fake.grants[0]?.created).toBe(1)
  })

  it('never drops an agent that paired while the pane was open', async () => {
    const fake = new FakeCrate()
    fake.pair('Claude Code', 1)
    const pane = await opened(fake)

    // Paired behind the pane's back, with no event heard: the pane's own list is old.
    fake.grants.push(ownGrant('codex', 'Codex', 2))
    await pane.change('claude-code', (grant) => withScope(grant, 'settings', true))

    expect(fake.grants.map((one) => one.id)).toEqual(['claude-code', 'codex'])
    expect(pane.grants.map((one) => one.id)).toEqual(['claude-code', 'codex'])
  })

  it('shows every switch at once and ends on the crate’s answer', async () => {
    const fake = new FakeCrate()
    fake.pair('Claude Code', 1)
    const pane = await opened(fake)

    const first = pane.change('claude-code', (grant) => withScope(grant, 'terminal', true))
    const second = pane.change('claude-code', (grant) => withScope(grant, 'settings', true))
    expect(pane.grants[0]?.scopes).toEqual(expect.arrayContaining(['terminal', 'settings']))
    await first
    // The first write is back, and the second still on screen.
    expect(pane.grants[0]?.scopes).toEqual(expect.arrayContaining(['terminal', 'settings']))
    await second
    expect(fake.grants[0]?.scopes).toEqual(expect.arrayContaining(['terminal', 'settings']))
    expect(fake.writes).toBe(2)
  })

  it('puts a switch back, with the reason, when the crate refuses it', async () => {
    const fake = new FakeCrate()
    fake.pair('Claude Code', 1)
    const pane = await opened(fake)

    fake.failing = new Error('the agents cannot be read just now')
    await pane.change('claude-code', (grant) => withScope(grant, 'terminal', true))
    expect(pane.error).toBe('the agents cannot be read just now')
    expect(pane.grants[0]?.scopes).not.toContain('terminal')
  })

  it('removes an agent, and only that one', async () => {
    const fake = new FakeCrate()
    fake.pair('Claude Code', 1)
    fake.pair('Codex', 2)
    const pane = await opened(fake)
    await pane.remove('claude-code')
    expect(fake.grants.map((one) => one.id)).toEqual(['codex'])
    expect(pane.grants.map((one) => one.id)).toEqual(['codex'])
  })

  it('makes an agent by hand with somebody else’s defaults, and says its token once', async () => {
    const fake = new FakeCrate()
    const pane = await opened(fake)
    await pane.mint('Nightly backup')
    expect(pane.minted?.token).toHaveLength(64)
    expect(pane.grants).toEqual([
      {
        ...thirdPartyGrant('nightly-backup', 'Nightly backup', 0),
        created: pane.grants[0]?.created,
      },
    ])
  })

  it('hears a pairing and an agent at work', async () => {
    const fake = new FakeCrate()
    const pane = await opened(fake)
    fake.pair('Claude Code', 1)
    await Promise.resolve()
    await Promise.resolve()
    expect(pane.grants.map((one) => one.id)).toEqual(['claude-code'])

    fake.emit({ kind: 'acting', agent: 'claude-code' })
    expect(pane.last.get('claude-code')).toBeGreaterThan(0)

    pane.close()
    fake.pair('Codex', 2)
    await Promise.resolve()
    expect(pane.grants).toHaveLength(1)
  })

  it('clears one agent’s log and keeps the others', async () => {
    const now = Date.UTC(2026, 8, 30, 16)
    const fake = seeded(now)
    const pane = await opened(fake)
    await pane.clearLog('claude-code')
    expect(pane.calls.every((one) => one.agent !== 'claude-code')).toBe(true)
    expect(pane.calls.some((one) => one.agent === 'codex')).toBe(true)
    expect(pane.last.has('claude-code')).toBe(false)
    const left = await Promise.all((await fake.days()).map((day) => fake.day(day)))
    expect(left.flat().every((line) => (line as { agent: string }).agent !== 'claude-code')).toBe(
      true,
    )
  })
})

describe('the fake is the crate', () => {
  it('puts the pane in reach where there is no crate, which is how a drive sees it', () => {
    // A test runs where there is no window of Tauri's, so nothing offers the pane.
    expect(reach.offered).toBe(false)
    const fake = standIn()
    expect(reach.standIn).toBe(fake)
    expect(reach.offered).toBe(true)
    reach.standIn = null
  })

  it('names agents the way free_id does', () => {
    expect(freeId('Claude Code', [])).toBe('claude-code')
    expect(freeId('Claude Code', ['claude-code'])).toBe('claude-code-2')
    expect(freeId('Claude Code', ['claude-code', 'claude-code-2'])).toBe('claude-code-3')
    expect(freeId('  ', [])).toBe('agent')
    expect(freeId('Codex (CLI)', [])).toBe('codex-cli')
    expect(freeId('日本', [])).toBe('agent')
  })

  it('reads a grant in the crate’s own shape, and nothing else', () => {
    const grant = ownGrant('claude-code', 'Claude Code', 1)
    expect(readGrant(JSON.parse(JSON.stringify(grant)))).toEqual(grant)
    expect(readGrant({ id: 1 })).toBeNull()
    expect(
      readGrant({
        ...grant,
        scopes: ['notes.read', 'everything'],
        sites: { 'a.example': 'allow', 'b.example': 'maybe' },
        asks: { paying: false, lying: true },
        spaces: 'all',
        limits: null,
      }),
    ).toEqual({
      ...grant,
      scopes: ['notes.read'],
      sites: { 'a.example': 'allow' },
      asks: { paying: false },
    })
  })
})
