import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  AGENT_COMMANDS,
  AGENT_EVENT,
  AGENT_WINDOW_VERBS,
  type AgentEvent,
  type AgentTab,
  type Answer,
  type Approval,
  type ApprovalAnswer,
  BROWSER_VERBS,
  type BrowserVerb,
  type Category,
  type Code,
  CRATE_ASKS,
  type Dialog,
  type Grant,
  type Minted,
  type Opened,
  type Overview,
  type PausedBy,
  type ReaderTab,
  type SiteRule,
  type Store,
  type StoreAsk,
  type StoreSaid,
} from './verbs'

/** The crate's own file, read as text: the mirror is held to it rather than to a copy. */
function crate(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../src-tauri/src/agents/${name}`, import.meta.url)),
    'utf8',
  )
}

describe('the mirror of the crate agent verbs', () => {
  it('names every verb of the crate table, in its order', () => {
    const table = crate('verbs.rs').split('verbs! {')[1] ?? ''
    const named = [...table.matchAll(/^\s*"([a-z_]+)" =>/gm)].map((one) => one[1])

    expect(named).toEqual([...BROWSER_VERBS])
  })

  it('names the window verbs an agent may call, with the scopes the crate checks', () => {
    const table = crate('verbs.rs').split('AGENT_VERBS')[1]?.split('];')[0] ?? ''
    const rows = [...table.matchAll(/\("([a-z_]+)", (None|Some\(Scope::(\w+)\))\)/g)].map(
      (one) => [one[1], one[3] ?? null] as const,
    )
    const scopes = crate('grants.rs')
    const scopeOf = (variant: string | null) =>
      variant === null
        ? null
        : new RegExp(`rename = "([a-z.]+)"\\)\\]\\s*${variant},`).exec(scopes)?.[1]

    expect(Object.fromEntries(rows.map(([verb, variant]) => [verb, scopeOf(variant)]))).toEqual(
      AGENT_WINDOW_VERBS,
    )
  })

  it('hears on the event the crate emits on', () => {
    expect(crate('verbs.rs')).toContain(`pub const EVENT: &str = "${AGENT_EVENT}";`)
  })

  it('names the commands the crate registers for the window', () => {
    const registered = readFileSync(
      fileURLToPath(new URL('../../../src-tauri/src/lib.rs', import.meta.url)),
      'utf8',
    )
    const named = [...registered.matchAll(/agents::(?:grants::)?(agents_[a-z_]+),/g)].map(
      (one) => one[1],
    )
    expect(named).toEqual([...AGENT_COMMANDS])
  })

  it('names the window verbs the crate asks as the crate does', () => {
    const source = crate('verbs.rs')
    for (const verb of Object.values(CRATE_ASKS)) {
      expect(source).toContain(`&str = "${verb}";`)
    }
  })

  it('reads the shapes the crate writes', () => {
    // The crate's own serialisations, as its tests pin them; typed here so a shape that
    // changes on one side fails to compile on this one.
    const asked: Answer = { status: 'needs_approval', approval: 'a17', summary: 'Place order' }
    const paused: AgentEvent = { kind: 'paused', agent: 'claude-code', tab: 't4', by: 'reader' }
    const grant: Grant = {
      id: 'claude-code',
      name: 'Claude Code',
      client: 'Claude Code',
      scopes: ['browser', 'notes.read'],
      spaces: 'all',
      sites: { 'bank.example': 'agent-store' },
      scripts: [],
      mode: 'unsupervised',
      asks: { sending: false },
      always: {},
      programs: [],
      limits: { tabs: 4, calls: 600, navigations: 60 },
      created: 0,
    }
    const minted: Minted = { grant, token: 'f'.repeat(64) }
    const store: StoreSaid = { space: 'Research', store: null }

    expect([asked.status, paused.kind, minted.grant.id, store.store]).toEqual([
      'needs_approval',
      'paused',
      'claude-code',
      null,
    ])
  })

  it('reads every answer and event shape the crate tests pin', () => {
    const verb: BrowserVerb = 'browser_click'
    const code: Code = 'paused_by_reader'
    const dialog: Dialog = {
      kind: 'confirm',
      message: 'Delete this?',
      url: 'https://shop.example/',
      open_ms: 12,
    }
    const refused: Answer = { status: 'error', code, message: 'the reader is using it', dialog }
    const rule: SiteRule = 'deny'
    const store: Store = 'agent'
    const reader: ReaderTab = {
      id: 't4',
      title: 'Shop',
      url: 'https://shop.example/',
      front: true,
      on_screen: true,
    }
    const own: AgentTab = {
      id: 'a1',
      url: 'about:blank',
      title: '',
      loading: false,
      store,
      parked: false,
    }
    const ask: StoreAsk = { url: 'https://shop.example/' }
    const category: Category = 'paying'
    const answer: ApprovalAnswer = 'pending'
    const approval: Approval = {
      id: 'a17',
      agent: 'claude-code',
      name: 'Claude Code',
      category,
      summary: 'Place order on shop.example',
      site: 'shop.example',
      asked: 0,
      answer,
    }
    const by: PausedBy = 'stop'
    const opened: Opened = { tab: 'a1', store }
    const overview: Overview = {
      agents: [],
      tabs: [['claude-code', own]],
      approvals: [approval],
      stopped: false,
      paused: [['claude-code', opened.tab]],
    }
    expect(overview.tabs[0]?.[1].id).toBe('a1')
    const events: AgentEvent[] = [
      { kind: 'asked', approval },
      { kind: 'paused', agent: 'claude-code', by },
      { kind: 'tab', agent: 'claude-code', id: own.id, url: own.url, title: reader.title },
    ]

    expect(BROWSER_VERBS).toContain(verb)
    expect([refused.status, rule, ask.url, events.length]).toEqual([
      'error',
      'deny',
      'https://shop.example/',
      3,
    ])
  })
})
