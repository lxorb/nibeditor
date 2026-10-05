import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { agentMarks } from '../../src/lib/agent-marks.svelte'
import ActivityPanel from '../../src/lib/agents/ui/ActivityPanel.svelte'
import { FakeCrate } from '../../src/lib/agents/ui/fake'
import { ended, start, started } from '../../src/lib/agents/ui/index'

/** Everything the reader sees of agents, against a crate in memory that tells the
 *  window exactly the news the real one does (docs/agent-native.md 13.1).
 *
 *  In the jsdom project because what is under test is what the UI's effects write into
 *  the shell - the marks the strip and the web tabs read, the badge, the steps asked, the
 *  key handed to the system - and what the panel and the pairing bubble put on screen
 *  and do when they are pressed. Nothing here asks about layout or paint. */

/** The panel's rows arrive and leave with a slide and a fly, which Svelte plays through
 *  the Web Animations API, and jsdom has none. Nothing here asks how they move, only
 *  that a row that leaves has gone once it has: so every animation is over as soon as
 *  somebody asks to hear when it is. */
Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
    set onfinish(then: (() => void) | null) {
      queueMicrotask(() => then?.())
    },
  }) as unknown as Animation

let fake: FakeCrate

/** Every promise the UI's presses are waiting on, and then the effects they set off. */
async function settled(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve()
  flushSync()
}

beforeEach(async () => {
  fake = new FakeCrate()
  const hear = start(fake)
  fake.listen(hear)
  await settled()
})

afterEach(() => {
  ended()
  document.body.replaceChildren()
})

describe('the frame and the mark', () => {
  test('are worn by a reader tab while an agent acts in it, in the agent colour', async () => {
    fake.connect('claude', 'Claude Code')
    fake.act('claude', 't1', 'browser_click')
    await settled()

    const worn = agentMarks.on.t1
    expect(worn?.agent).toBe('claude')
    expect(worn?.stopped).toBe(false)
    expect(worn?.colour).toMatch(/^#/)
    expect(agentMarks.heard).toBe(true)
  })

  test('stay on whatever the reader does in the tab: nothing hands it over', async () => {
    fake.connect('claude', 'Claude Code')
    fake.act('claude', 't1', 'browser_click')
    await settled()

    // The reader presses and types in the page: the crate says nothing, and the agent's
    // next call finds the tab as theirs as ever.
    fake.act('claude', 't1', 'browser_type')
    await settled()
    expect(agentMarks.on.t1?.stopped).toBe(false)
    expect(fake.asked.some((one) => one.command === 'pause')).toBe(false)
  })

  test('Stop in the tab menu stops that agent, and a press on its mark resumes it', async () => {
    fake.connect('claude', 'Claude Code')
    fake.connect('codex', 'Codex')
    fake.act('claude', 't1', 'browser_click')
    fake.act('codex', 't2', 'browser_type')
    await settled()

    agentMarks.act?.('t1', 'stop')
    await settled()
    expect(fake.asked.at(-1)).toEqual({ command: 'stop', args: ['claude'] })
    expect(agentMarks.on.t1?.stopped).toBe(true)
    expect(agentMarks.on.t2?.stopped).toBe(false)

    agentMarks.act?.('t1', 'resume')
    await settled()
    expect(fake.asked.at(-1)).toEqual({ command: 'resume', args: ['claude'] })
    expect(agentMarks.on.t1?.stopped).toBe(false)
  })

  test('the stop mutes them all, and lifting it lets them act again', async () => {
    fake.connect('claude', 'Claude Code')
    fake.act('claude', 't1', 'browser_click')
    await settled()

    await started().stop()
    await settled()
    expect(agentMarks.on.t1?.stopped).toBe(true)

    agentMarks.act?.('t1', 'resume')
    await settled()
    expect(fake.asked.at(-1)).toEqual({ command: 'resume', args: [undefined] })
    expect(agentMarks.on.t1?.stopped).toBe(false)
  })
})

describe('the shell while an agent is connected', () => {
  test('hands the stop key to the system and holds the window', async () => {
    expect(agentMarks.holding).toBe(false)

    fake.connect('claude', 'Claude Code')
    await settled()

    expect(fake.told?.key).toBe('Control+Alt+Shift+K')
    expect(fake.told?.words.stop).toBe('Stop agents')
    expect(agentMarks.holding).toBe(true)

    await agentMarks.hide?.()
    await settled()
    expect(fake.hidden).toBe(true)
  })
})

describe('the activity panel', () => {
  let panel: ReturnType<typeof mount> | null = null

  afterEach(() => {
    if (panel) void unmount(panel, { outro: false })
    panel = null
  })

  function open(): HTMLElement {
    const target = document.createElement('div')
    document.body.append(target)
    panel = mount(ActivityPanel, { target })
    return target
  }

  test('shows each agent, what it is doing, and its tabs as pictures while open', async () => {
    fake.connect('claude', 'Claude Code')
    const tab = fake.open('claude', 'https://shop.example/', 'Shop')
    fake.act('claude', tab.id, 'browser_click')
    const target = open()
    await settled()

    expect(target.querySelector('.name')?.textContent).toBe('Claude Code')
    expect(target.querySelector('.doing')?.textContent.trim()).toBe('Pressing · Shop')
    expect(fake.watching).toEqual([tab.id])

    fake.frame(tab.id, 'AAAA')
    await settled()
    const picture = target.querySelector<HTMLElement>('.thumb .picture')
    expect(picture?.style.backgroundImage).toContain('data:image/jpeg;base64,AAAA')
  })

  test('stops watching as it closes', async () => {
    fake.connect('claude', 'Claude Code')
    fake.open('claude', 'https://shop.example/', 'Shop')
    open()
    await settled()
    if (panel) void unmount(panel, { outro: false })
    panel = null
    await settled()

    expect(fake.watching).toEqual([])
  })

  test('asks a question and sends the answer, and the question goes', async () => {
    fake.connect('claude', 'Claude Code')
    const asked = fake.ask('claude', 'paying', 'Place order on shop.example', 'shop.example', 't1')
    const target = open()
    await settled()

    expect(agentMarks.waiting).toBe(1)
    const question = target.querySelector('.question')
    expect(question?.textContent).toContain('Place order on shop.example')
    const answers = [...(question?.querySelectorAll('button') ?? [])].map((one) =>
      one.textContent.trim(),
    )
    expect(answers).toEqual(['Don’t allow', 'Allow', 'Always on this site'])

    question?.querySelector<HTMLButtonElement>('.always')?.click()
    await settled()

    expect(fake.asked.find((one) => one.command === 'answer')).toEqual({
      command: 'answer',
      args: [asked.id, true, true],
    })
    expect(target.querySelector('.question')).toBeNull()
    expect(agentMarks.waiting).toBe(0)
  })

  test('shows the session from the audit log, and Stop stops that agent', async () => {
    fake.connect('claude', 'Claude Code')
    fake.act('claude', 't1', 'browser_open', { url: 'https://shop.example/' })
    fake.act('claude', 't1', 'browser_click')
    const target = open()
    await settled()
    await started().readLog()
    await settled()

    const rows = [...target.querySelectorAll('.call .word')].map((one) => one.textContent)
    expect(rows).toEqual(['Pressing', 'Opening'])

    target.querySelector<HTMLButtonElement>('.head .nib-glyph')?.click()
    await settled()
    expect(fake.asked.at(-1)).toEqual({ command: 'stop', args: ['claude'] })
    expect(target.querySelector('.head .nib-glyph')?.getAttribute('aria-label')).toBe('Continue')
  })
})

describe('questions outside the panel', () => {
  test('a pairing is asked in a bubble of its own, and allowing it answers', async () => {
    const asked = fake.pair('Codex')
    await settled()

    const bubble = document.body.querySelector('.pairing')
    expect(bubble?.textContent).toContain('Codex wants to connect')
    // Not in the badge: the bubble is where it is answered.
    expect(agentMarks.waiting).toBe(0)

    ;[...(bubble?.querySelectorAll('button') ?? [])].at(-1)?.click()
    await settled()

    expect(fake.asked.find((one) => one.command === 'answer')?.args).toEqual([
      asked.id,
      true,
      false,
    ])
    await settled()
    expect(document.body.querySelector('.pairing')).toBeNull()
  })

  test('a step asked of the reader is put under the bar of its tab, and takes nothing', async () => {
    fake.connect('claude', 'Claude Code')
    fake.act('claude', 't1', 'browser_click')
    const asked = fake.ask(
      'claude',
      'takeover',
      'Sign in to the bank',
      'https://bank.example/',
      't1',
    )
    await settled()

    expect(agentMarks.takeovers.t1).toEqual({ id: asked.id, reason: 'Sign in to the bank' })
    expect(agentMarks.on.t1?.stopped).toBe(false)

    await started().answer(asked, true)
    await settled()
    expect(agentMarks.takeovers.t1).toBeUndefined()
    expect(agentMarks.on.t1?.stopped).toBe(false)
  })
})
