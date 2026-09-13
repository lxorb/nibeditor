/** The pane that draws a website asks the store for its page from a `$derived`, and
 *  that is the whole of this file.
 *
 *  `const page = $derived(pages.of(tab.id))` is what the component says, because the
 *  tab a pane shows can be swapped under it and the page has to follow. A derived is
 *  a reaction, and Svelte forbids a reaction from writing to state made outside it -
 *  so a method that makes something the first time it is asked for, out of a
 *  reactive collection, throws `state_unsafe_mutation` the first time a component
 *  reads it. Nothing about the method on its own shows it: every unit test of
 *  `pages.of` passes, and the app freezes.
 *
 *  Frozen is exactly what it looks like. The error is thrown while Svelte is
 *  flushing, the batch is abandoned, and the window is left drawn and no longer
 *  reactive: no menu opens, no button answers, and the only thing to do is quit.
 *  That is the report this file is here to keep from coming back - a window restored
 *  with a website in front of it, and an app that does nothing at all. */

import { expect, test, vi } from 'vitest'
import { computed, root } from './runes.svelte'

// The store talks to the crate on a desktop and nothing here is about that: under
// node there is no crate, and a page that is asked for is a page that is not built.
vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: false,
  invoke: () => Promise.resolve(undefined),
}))

const { pages } = await import('../../src/lib/web-tab/pages.svelte')

test('a pane can read its page out of a derived the first time it asks', () => {
  let read: (() => unknown) | undefined
  const stop = root(() => {
    read = computed(() => pages.of('a-tab-nothing-has-asked-about'))
  })

  try {
    expect(() => read?.()).not.toThrow()
    // And the same page every time, because the pane places what it read.
    expect(read?.()).toBe(read?.())
  } finally {
    stop()
    pages.forget('a-tab-nothing-has-asked-about')
  }
})

test('a page read through a derived is still the one the store hands out', () => {
  let read: (() => unknown) | undefined
  const stop = root(() => {
    read = computed(() => pages.of('another-tab'))
  })

  try {
    expect(read?.()).toBe(pages.of('another-tab'))
  } finally {
    stop()
    pages.forget('another-tab')
  }
})
