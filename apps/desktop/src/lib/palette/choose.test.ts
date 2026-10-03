import { describe, expect, test } from 'vitest'
import type { Field } from '../preferences'
import { choose, type Hands } from './choose'
import type { Row } from './rows'
import { command, file, ROOT, setting, tab } from './world.fixture'

/** A stand-in for the app that writes down what it was asked to do. */
function hands(): { asked: string[]; hands: Hands } {
  const asked: string[] = []
  const say =
    (what: string) =>
    (...args: unknown[]) =>
      void asked.push(`${what} ${JSON.stringify(args)}`)

  return {
    asked,
    hands: {
      openEntry: say('open'),
      openAside: say('aside'),
      openPage: say('page'),
      activate: say('activate'),
      openAtHeading: say('heading'),
      openAtBlock: say('block'),
      revealFolder: say('folder'),
      searchFor: say('search'),
      openGraph: say('graph'),
      showSetting: say('setting'),
      make: say('make'),
      goto: say('goto'),
      openHost: say('host'),
      connect: say('connect'),
    },
  }
}

/** A keystroke, as the palette hands one on. */
const key = (held: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) => ({
  ctrlKey: held.ctrl ?? false,
  metaKey: false,
  shiftKey: held.shift ?? false,
  altKey: held.alt ?? false,
})

const NOTE: Row = { kind: 'note', entry: file('Plan.md'), folder: null, shared: false }

describe('choosing a note', () => {
  test('opens it in front with Enter', () => {
    const { asked, hands: with_ } = hands()
    expect(choose(NOTE, key(), with_)).toBe('close')
    expect(asked).toEqual([`open ["${ROOT}/Plan.md",{}]`])
  })

  test('in a tab of its own behind with Ctrl+Enter, in front with Ctrl+Shift+Enter', () => {
    const behind = hands()
    choose(NOTE, key({ ctrl: true }), behind.hands)
    expect(behind.asked).toEqual([`open ["${ROOT}/Plan.md",{"activate":false,"beside":true}]`])

    const front = hands()
    choose(NOTE, key({ ctrl: true, shift: true }), front.hands)
    expect(front.asked).toEqual([`open ["${ROOT}/Plan.md",{"beside":true}]`])
  })

  test('in a pane to the right with Ctrl+Alt+Enter', () => {
    const { asked, hands: with_ } = hands()
    choose(NOTE, key({ ctrl: true, alt: true }), with_)
    expect(asked).toEqual([`aside ["${ROOT}/Plan.md"]`])
  })

  test('with the middle button, in a tab of its own', () => {
    const { asked, hands: with_ } = hands()
    choose(NOTE, { ...key(), button: 1 }, with_)
    expect(asked).toEqual([`open ["${ROOT}/Plan.md",{"activate":false,"beside":true}]`])
  })
})

describe('choosing an open tab', () => {
  const open: Row = {
    kind: 'tab',
    tab: tab('t1', 'Plan', { path: `${ROOT}/Plan.md` }),
    folder: null,
    shared: false,
  }
  const page: Row = {
    kind: 'tab',
    tab: tab('w1', 'Svelte', { kind: 'web', url: 'https://svelte.dev/' }),
    folder: null,
    shared: false,
  }

  test('switches to it', () => {
    const { asked, hands: with_ } = hands()
    choose(open, key(), with_)
    expect(asked).toEqual(['activate ["t1"]'])
  })

  test('with a modifier, opens what it holds again the way the modifier asks', () => {
    const note = hands()
    choose(open, key({ ctrl: true }), note.hands)
    expect(note.asked).toEqual([`open ["${ROOT}/Plan.md",{"activate":false,"beside":true}]`])

    const site = hands()
    choose(page, key({ ctrl: true, shift: true }), site.hands)
    expect(site.asked).toEqual(['page ["https://svelte.dev/","front"]'])
  })
})

describe('choosing the rest', () => {
  test('a page opens in a tab, behind with Ctrl', () => {
    const row: Row = {
      kind: 'page',
      url: 'https://svelte.dev/',
      title: 'Svelte',
      address: 'svelte.dev',
    }
    const { asked, hands: with_ } = hands()
    choose(row, key(), with_)
    choose(row, key({ ctrl: true }), with_)
    expect(asked).toEqual([
      'page ["https://svelte.dev/","plain"]',
      'page ["https://svelte.dev/","behind"]',
    ])
  })

  test('a command runs, and one that cannot run does nothing and keeps the list up', () => {
    let ran = 0
    const { hands: with_ } = hands()
    expect(
      choose({ kind: 'command', command: command('a', 'A', { run: () => ran++ }) }, key(), with_),
    ).toBe('close')
    expect(
      choose(
        { kind: 'command', command: command('b', 'B', { run: () => ran++, disabled: true }) },
        key(),
        with_,
      ),
    ).toBe('nothing')
    expect(ran).toBe(1)
  })

  test('a switch is flipped where it stands, and the list stays up', () => {
    let on = false
    const field: Field = {
      kind: 'switch',
      label: 'Focus mode',
      get: () => on,
      set: (to) => (on = to),
    }
    const { asked, hands: with_ } = hands()

    expect(
      choose(
        { kind: 'setting', setting: setting('Focus mode', 'Editor', { field }) },
        key(),
        with_,
      ),
    ).toBe('stay')
    expect(on).toBe(true)
    expect(asked).toEqual([])
  })

  test('any other setting opens its pane on it, and a pane opens on its top', () => {
    const { asked, hands: with_ } = hands()
    choose({ kind: 'setting', setting: setting('Text size', 'Editor') }, key(), with_)
    choose(
      { kind: 'setting', setting: setting('Editor', 'Settings', { row: false }) },
      key(),
      with_,
    )
    expect(asked).toEqual(['setting ["editor","Text size"]', 'setting ["editor",null]'])
  })

  test('a bookmarked heading opens at it, in a tab of its own with Ctrl', () => {
    const row: Row = {
      kind: 'bookmark',
      mark: { kind: 'heading', path: 'Plan.md', text: 'Goals' },
      label: 'Goals',
      note: 'Plan',
      path: `${ROOT}/Plan.md`,
      file: 'note',
    }
    const { asked, hands: with_ } = hands()
    choose(row, key({ ctrl: true }), with_)
    expect(asked).toEqual(['heading ["Plan.md","Goals",{"activate":false,"beside":true}]'])
  })

  test('a name nothing has is made, and a place is gone to', () => {
    const { asked, hands: with_ } = hands()
    choose({ kind: 'make', make: { folder: 'Uni', name: 'Lecture 4.md' } }, key(), with_)
    choose({ kind: 'place', line: 41, text: 'x', depth: 0, hint: '42' }, key(), with_)
    expect(asked).toEqual(['make [{"folder":"Uni","name":"Lecture 4.md"}]', 'goto [41]'])
  })
})

describe('another machine', () => {
  test('a host opens a terminal on it, and a destination typed is connected to', () => {
    const { asked, hands: hand } = hands()
    const host = {
      id: 'pi',
      name: 'pi',
      own: false,
      also: [],
      detail: null,
      user: null,
      hostname: null,
      port: null,
      group: null,
      colour: null,
      pinned: false,
      last: null,
    }
    const wanted = { user: 'emil', hostname: 'box', port: 2222 }

    expect(choose({ kind: 'host', host }, undefined, hand)).toBe('close')
    expect(choose({ kind: 'connect', wanted, said: 'emil@box:2222' }, undefined, hand)).toBe(
      'close',
    )
    expect(asked).toEqual(['host ["pi"]', `connect [${JSON.stringify(wanted)}]`])
  })
})
