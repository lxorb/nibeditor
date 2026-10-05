import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Hidden tabs: the first switch away from a set with a page running asks once, a
 *  dismissed question asks again next time, an answer is the setting from then on, and
 *  a page is paused and let run again only where that answer says so. */

const sent = vi.hoisted(() => [] as { command: string; args: Record<string, unknown> }[])
const answers = vi.hoisted(() => [] as (string | null)[])
const asked = vi.hoisted(() => ({ count: 0 }))

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    sent.push({ command, args: args ?? {} })
    return Promise.resolve(undefined)
  },
}))

vi.mock('../prompt.svelte', () => ({
  prompt: {
    choose: () => {
      asked.count += 1
      return Promise.resolve(answers.shift() ?? null)
    },
  },
}))

const { memoryStorage } = await import('../../../test/disk')
vi.stubGlobal('localStorage', memoryStorage())

const { hiddenTabs } = await import('./hidden-tabs.svelte')
const { pages } = await import('../web-tab/pages.svelte')
const { agentMarks } = await import('../agent-marks.svelte')
// What a freeze is carried out by, fetched with the first one; loaded here so a turn is enough.
await import('../web-tab/sleeping')
type Tab = import('../workspace.svelte').Tab

/** A web tab in a pane nobody is showing, its page running or not: as much of a tab as
 *  the store reads. */
function webTab(id: string, live = true): Tab {
  pages.of(id).live = live
  return { id, kind: 'web', paneId: 'aside' } as Tab
}

/** A turn for the pages to send what they were asked: each freeze and thaw goes after
 *  the one before it has landed; see `lull` in pages.svelte.ts. */
const sending = () => new Promise<void>((go) => setTimeout(go, 0))

/** What reached the crate, as [tab, paused]. */
async function paused() {
  await sending()
  return sent
    .filter((one) => one.command === 'web_pause')
    .map((one) => [one.args.tab, one.args.paused])
}

beforeEach(async () => {
  // Whatever the last test paused runs again, so each starts with nothing paused.
  hiddenTabs.set('run')
  await sending()
  sent.length = 0
  answers.length = 0
  asked.count = 0
  localStorage.clear()
  hiddenTabs.choice = 'ask'
  agentMarks.on = {}
})

describe('until somebody has answered', () => {
  test('the first switch away from a running page asks, and Pause pauses it', async () => {
    answers.push('pause')
    await hiddenTabs.left([webTab('a')])

    expect(asked.count).toBe(1)
    expect(hiddenTabs.choice).toBe('pause')
    expect(await paused()).toEqual([['a', true]])
    expect(localStorage.getItem('nib:hidden-tabs')).toBe('"pause"')
  })

  test('a question dismissed lets the pages run, and the next switch asks again', async () => {
    answers.push(null)
    await hiddenTabs.left([webTab('a')])
    expect(hiddenTabs.choice).toBe('ask')
    expect(await paused()).toEqual([])

    answers.push(null)
    await hiddenTabs.left([webTab('a')])
    expect(asked.count).toBe(2)
  })

  test('Keep running is kept, and nothing is asked again', async () => {
    answers.push('run')
    await hiddenTabs.left([webTab('a')])
    await hiddenTabs.left([webTab('b')])

    expect(asked.count).toBe(1)
    expect(hiddenTabs.choice).toBe('run')
    expect(await paused()).toEqual([])
  })

  test('a set with no page running asks nothing', async () => {
    await hiddenTabs.left([webTab('a', false), { id: 'n', kind: 'note', paneId: 'aside' } as Tab])
    expect(asked.count).toBe(0)
  })
})

describe('pausing', () => {
  test('the set coming back lets run what was paused in it, and nothing else', async () => {
    hiddenTabs.set('pause')
    await hiddenTabs.left([webTab('a'), webTab('b')])
    await sending()
    sent.length = 0

    hiddenTabs.came([webTab('a'), webTab('c')])
    expect(await paused()).toEqual([['a', false]])
  })

  test('a tab an agent is acting in is left running', async () => {
    hiddenTabs.set('pause')
    agentMarks.on = { a: { agent: 'claude', colour: '#000', stopped: false } }
    await hiddenTabs.left([webTab('a'), webTab('b')])
    expect(await paused()).toEqual([['b', true]])
  })

  test('choosing Keep running lets every paused page run again', async () => {
    hiddenTabs.set('pause')
    await hiddenTabs.left([webTab('a')])
    await sending()
    sent.length = 0

    hiddenTabs.set('run')
    expect(await paused()).toEqual([['a', false]])
  })
})
