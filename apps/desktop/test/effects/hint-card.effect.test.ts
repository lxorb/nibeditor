/** A hint card on the page, with the store behind it watched the way the app watches it.
 *
 *  What hints.test.ts cannot ask: the card tells the store it wants a hint from inside
 *  an effect, and the store answers by putting that hint up. A store that read what it
 *  wrote made the effect depend on the hint on screen, so putting it up ran the effect
 *  again, whose teardown took the card straight back down, and the session's one hint
 *  was spent on a card nobody saw.
 *
 *  In the jsdom project because it mounts a component. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import HintCard from '../../src/lib/HintCard.svelte'
import { hints } from '../../src/lib/hints.svelte'

/** jsdom has no animations, and the card flies in. */
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
  }) as unknown as Animation

let host: HTMLElement
let shown: ReturnType<typeof mount> | undefined

beforeEach(() => {
  localStorage.clear()
  hints.restore()
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  if (shown) void unmount(shown)
  shown = undefined
  host.remove()
})

function card(): HTMLElement | null {
  return host.querySelector('.hint')
}

test('a card drawn once the session has settled stays up', () => {
  hints.settle()
  shown = mount(HintCard, { target: host, props: { hint: 'graph', text: 'See them' } })
  flushSync()

  expect(hints.current).toBe('graph')
  expect(card()?.textContent).toContain('See them')
})

test('a card already drawn goes up when the session settles, and stays', () => {
  shown = mount(HintCard, { target: host, props: { hint: 'palette', text: 'Press it' } })
  flushSync()
  expect(card()).toBeNull()

  hints.settle()
  flushSync()

  expect(hints.current).toBe('palette')
  expect(card()?.textContent).toContain('Press it')
})

test('its cross puts it away', () => {
  hints.settle()
  shown = mount(HintCard, { target: host, props: { hint: 'sign-in', text: 'Sign in' } })
  flushSync()

  host.querySelector<HTMLButtonElement>('.shut')?.click()
  flushSync()

  // Gone, on its way out: jsdom never finishes the fly, so the store is what is asked.
  expect(hints.current).toBeNull()
  expect(hints.seen).toEqual(['sign-in'])
})
