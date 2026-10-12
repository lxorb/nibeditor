import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { root, watch } from './runes.svelte'

/** The space chooser goes the moment a space exists, and nothing watching it loops.
 *
 *  Whether it is up is derived from the spaces, the tabs, the session and the launch
 *  rather than written anywhere (Obsidian's rule: no vault, the chooser), so the one
 *  way it can go wrong is a reader that writes what it reads. This watches it the
 *  way the card does, in the jsdom project where an effect actually runs, and makes
 *  a space underneath it. See space-choice.ts for the table itself. */

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    const name = typeof args?.name === 'string' ? args.name : ''
    switch (command) {
      case 'create_space':
        return { name, path: `/spaces/${name}` }
      case 'read_tree':
        return { name, path: '/spaces/One', is_dir: true, modified: 0, created: 0, children: [] }
      default:
        return undefined
    }
  },
}))

/** Svelte plays a transition through the Web Animations API, which jsdom lacks. This
 *  one finishes as soon as it is asked for, so an element on its way out is gone. */
Element.prototype.animate = () => {
  const animation = {
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
    onfinish: null as (() => void) | null,
  }
  setTimeout(() => animation.onfinish?.(), 0)
  return animation as unknown as Animation
}

const { workspace } = await import('../../src/lib/workspace.svelte')
const { modes } = await import('../../src/lib/modes.svelte')
const { setup } = await import('../../src/lib/setup.svelte')
const { spaceChooser } = await import('../../src/lib/space-chooser.svelte')
const { default: Choosing } = await import('./Choosing.svelte')

let stop: (() => void) | undefined

beforeEach(() => {
  workspace.spaces = []
  workspace.activeSpaceId = null
  workspace.tabs = []
  workspace.restored = true
  modes.developer = null
  setup.finish()
})

afterEach(() => {
  stop?.()
  stop = undefined
  document.body.replaceChildren()
})

test('is up on a fresh install, and goes once a space is made', async () => {
  const seen: boolean[] = []
  stop = root(() => watch(() => void seen.push(spaceChooser.showing)))
  flushSync()
  expect(seen).toEqual([true])

  await workspace.addSpace('One')
  flushSync()

  expect(spaceChooser.showing).toBe(false)
  // Once each way: a watcher that ran on and on would have left a longer trail.
  expect(seen).toEqual([true, false])
})

test('the card is drawn while it is up, and a space takes it away', async () => {
  const target = document.createElement('div')
  document.body.append(target)
  const card = mount(Choosing, { target })
  stop = () => void unmount(card, { outro: false })
  flushSync()

  expect(target.querySelector('[role="dialog"]')).not.toBeNull()
  expect(target.querySelectorAll('button').length).toBeGreaterThanOrEqual(3)

  await workspace.addSpace('One')
  flushSync()

  // Somebody new is offered the optional questions first; Done goes past them.
  press(target, 'Done')
  await vi.waitFor(() => expect(target.querySelector('[role="dialog"]')).toBeNull())
})

/** What the card's buttons say, in order. */
const words = (target: HTMLElement) =>
  [...target.querySelectorAll('button')].map((one) => one.textContent.trim())

function press(target: HTMLElement, word: string) {
  const button = [...target.querySelectorAll('button')].find(
    (one) => one.textContent.trim() === word,
  )
  if (!button) throw new Error(`no ${word} in ${words(target).join(', ')}`)
  button.click()
  flushSync()
}

/** The required step done, the optional questions after it: the card stays, says it is
 *  all set, and lets the reader personalize as far as they like. See setup.svelte.ts. */
test('stays after the space is made, to offer the optional questions', async () => {
  const target = document.createElement('div')
  document.body.append(target)
  const card = mount(Choosing, { target })
  stop = () => void unmount(card, { outro: false })
  flushSync()
  expect(setup.armed).toBe(true)

  await workspace.addSpace('One')
  flushSync()
  expect(target.querySelector('[role="dialog"]')).not.toBeNull()
  expect(words(target)).toEqual(expect.arrayContaining(['Personalize', 'Done']))

  press(target, 'Personalize')
  expect(setup.question).toBe('theme')

  press(target, 'Next')
  press(target, 'Yes')
  expect(modes.developer).toBe(true)
  press(target, 'Next')
  expect(setup.question).toBe('markdown')
  // A yes starts markdown the way Obsidian's live preview writes it.
  expect(target.querySelector('[aria-checked="true"]')?.textContent.trim()).toBe('Live preview')

  press(target, 'Clean')
  expect(modes.quietMarks).toBe(true)
  press(target, 'Next')

  expect(setup.armed).toBe(false)
  await vi.waitFor(() => expect(target.querySelector('[role="dialog"]')).toBeNull())
})

test('Done at any question leaves the rest at their defaults', async () => {
  const target = document.createElement('div')
  document.body.append(target)
  const card = mount(Choosing, { target })
  stop = () => void unmount(card, { outro: false })
  flushSync()

  await workspace.addSpace('One')
  flushSync()
  press(target, 'Personalize')
  press(target, 'Done')

  expect(modes.developer).toBeNull()
  expect(modes.coder).toBe(true)
  await vi.waitFor(() => expect(target.querySelector('[role="dialog"]')).toBeNull())
})
