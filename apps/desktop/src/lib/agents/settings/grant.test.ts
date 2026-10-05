import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { Grant, Scope } from '../verbs'
import {
  askApplies,
  asks,
  ownGrant,
  reaches,
  sidebars,
  sitesOf,
  thirdPartyGrant,
  trifecta,
  withAsk,
  withEverySpace,
  withLimit,
  withListed,
  withName,
  withoutAlways,
  withScope,
  withSite,
  withSpace,
} from './grant'

const own = () => ownGrant('claude-code', 'Claude Code', 1)

const only = (...scopes: Scope[]): Grant => ({ ...own(), scopes })

describe('the defaults', () => {
  it('are Emil’s for his own client: everything but scripts, storage, settings and the terminal', () => {
    const grant = own()
    expect(grant.scopes).toEqual([
      'context',
      'notes.read',
      'notes.write',
      'tree',
      'workspace',
      'workspace.focus',
      'browser',
      'browser.reader',
      'browser.network',
    ])
    expect(grant.spaces).toBe('all')
    expect(grant.mode).toBe('unsupervised')
    expect(grant.limits).toEqual({ tabs: 4, calls: 600, navigations: 60 })
    expect(asks(grant, 'paying')).toBe(true)
  })

  it('keep somebody else’s tool off the screen and the reader’s tabs, and asking for every write', () => {
    const grant = thirdPartyGrant('script', 'A script', 1)
    expect(grant.scopes).not.toContain('context')
    expect(grant.scopes).not.toContain('browser.reader')
    expect(grant.scopes).toContain('notes.read')
    expect(grant.mode).toBe('confirm')
  })

  it('are the crate’s own, as grants.rs writes them', () => {
    const crate = readFileSync(
      fileURLToPath(new URL('../../../../src-tauri/src/agents/grants.rs', import.meta.url)),
      'utf8',
    )
    // The four scopes `Grant::own` leaves out, and the two `third_party` takes away.
    expect(crate).toMatch(
      /Scope::BrowserScript\s*\|\s*Scope::BrowserStorage\s*\|\s*Scope::Settings\s*\|\s*Scope::Terminal/,
    )
    expect(crate).toMatch(/Scope::Context \| Scope::BrowserReader/)
    expect(crate).toMatch(/tabs: 4,\s*calls: 600,\s*navigations: 60/)
  })
})

describe('a switch means what it says', () => {
  it('brings what a scope needs when it is turned on', () => {
    expect(withScope(only(), 'notes.write', true).scopes).toEqual(['notes.read', 'notes.write'])
    expect(withScope(only(), 'workspace.focus', true).scopes).toEqual([
      'workspace',
      'workspace.focus',
    ])
    expect(withScope(only(), 'browser.storage', true).scopes).toEqual([
      'browser.reader',
      'browser.storage',
    ])
    // Scripts reach through either browser: the plain one, which is the narrower.
    expect(withScope(only(), 'browser.script', true).scopes).toEqual(['browser', 'browser.script'])
    expect(withScope(only('browser.reader'), 'browser.script', true).scopes).toEqual([
      'browser.reader',
      'browser.script',
    ])
  })

  it('takes what needed a scope when it is turned off', () => {
    expect(withScope(only('notes.read', 'notes.write'), 'notes.read', false).scopes).toEqual([])
    expect(
      withScope(only('browser', 'browser.reader', 'browser.script'), 'browser', false).scopes,
    ).toEqual(['browser.reader', 'browser.script'])
    expect(
      withScope(
        only('browser', 'browser.reader', 'browser.script', 'browser.storage'),
        'browser.reader',
        false,
      ).scopes,
    ).toEqual(['browser', 'browser.script'])
    expect(withScope(only('browser', 'browser.network'), 'browser', false).scopes).toEqual([])
  })

  it('keeps the crate’s order, and never a scope twice', () => {
    const grant = withScope(withScope(only('terminal'), 'context', true), 'context', true)
    expect(grant.scopes).toEqual(['context', 'terminal'])
  })
})

describe('the AI sidebar’s own agents', () => {
  it('are told apart by the name the crate gives them, and ask as their thread’s mode says', () => {
    expect(sidebars(ownGrant('nib-anthropic', 'nib · Claude', 1))).toBe(true)
    expect(sidebars(own())).toBe(false)
    expect(sidebars(ownGrant('nib-notes', 'Nib Notes', 1))).toBe(false)
  })
})

describe('the rest of a grant', () => {
  it('asks unless the reader turned a question off, and keeps on as nothing', () => {
    const off = withAsk(own(), 'sending', false)
    expect(off.asks).toEqual({ sending: false })
    expect(asks(off, 'sending')).toBe(false)
    expect(withAsk(off, 'sending', true).asks).toEqual({})
  })

  it('offers a question only where it can come up', () => {
    expect(askApplies(only('notes.read'), 'paying')).toBe(false)
    expect(askApplies(only('browser.reader'), 'paying')).toBe(true)
    expect(askApplies(own(), 'terminal')).toBe(false)
    expect(askApplies(only('terminal'), 'terminal')).toBe(true)
  })

  it('names itself, but never with nothing', () => {
    expect(withName(own(), '  Research  ').name).toBe('Research')
    expect(withName(own(), '   ').name).toBe('Claude Code')
  })

  it('holds a limit to what a slider could say', () => {
    expect(withLimit(own(), 'tabs', 12).limits.tabs).toBe(8)
    expect(withLimit(own(), 'calls', 95).limits.calls).toBe(120)
    expect(withLimit(own(), 'navigations', 0).limits.navigations).toBe(10)
  })

  it('leaves every space for the spaces there are, then one at a time', () => {
    const some = withEverySpace(own(), false, ['Work', 'Home'])
    expect(some.spaces).toEqual(['Work', 'Home'])
    expect(reaches(some, 'Home')).toBe(true)
    const less = withSpace(some, 'Home', false)
    expect(reaches(less, 'Home')).toBe(false)
    expect(withSpace(less, 'Home', true).spaces).toEqual(['Work', 'Home'])
    expect(withSpace(own(), 'Home', false).spaces).toBe('all')
    expect(withEverySpace(less, true, []).spaces).toBe('all')
  })

  it('keeps one rule a site, and lists every site once with its answers', () => {
    const grant = withSite(withSite(own(), 'bank.example', 'deny'), 'bank.example', 'agent-store')
    expect(grant.sites).toEqual({ 'bank.example': 'agent-store' })
    const always = {
      ...grant,
      always: { 'shop.example': ['paying' as const], 'bank.example': ['sending' as const] },
    }
    expect(sitesOf(always)).toEqual([
      { site: 'bank.example', rule: 'agent-store', always: ['sending'] },
      { site: 'shop.example', rule: null, always: ['paying'] },
    ])
    expect(withSite(grant, 'bank.example', null).sites).toEqual({})
  })

  it('takes an "always" back, and the site with its last one', () => {
    const grant = { ...own(), always: { 'shop.example': ['paying' as const, 'sending' as const] } }
    const one = withoutAlways(grant, 'shop.example', 'paying')
    expect(one.always).toEqual({ 'shop.example': ['sending'] })
    expect(withoutAlways(one, 'shop.example', 'sending').always).toEqual({})
  })

  it('adds a word to a list once, and takes it away', () => {
    const grant = withListed(withListed(own(), 'programs', ' git ', true), 'programs', 'git', true)
    expect(grant.programs).toEqual(['git'])
    expect(withListed(grant, 'programs', 'git', false).programs).toEqual([])
    expect(withListed(own(), 'scripts', '   ', true).scripts).toEqual([])
  })
})

describe('the trifecta', () => {
  it('is notes and a browser in the reader’s store, together', () => {
    expect(trifecta(own())).toBe(true)
    expect(trifecta(only('notes.read', 'browser'))).toBe(true)
    expect(trifecta(only('context', 'browser.reader'))).toBe(true)
  })

  it('is not either leg alone', () => {
    expect(trifecta(only('notes.read', 'notes.write', 'tree'))).toBe(false)
    expect(trifecta(only('browser', 'browser.reader'))).toBe(false)
    expect(trifecta(withScope(own(), 'notes.read', false))).toBe(true)
    expect(trifecta(withScope(withScope(own(), 'notes.read', false), 'context', false))).toBe(false)
  })
})
