import { beforeEach, describe, expect, test, vi } from 'vitest'

/** A web tab saved into another space: its page goes into that space's web data, built
 *  again where it was only where the store is another. See rehome.ts. */

const page = {
  space: 'w' as string | null,
  url: 'https://mail.example.com/inbox' as string | null,
  live: true,
  shown: true,
  pane: { x: 0, y: 0, width: 800, height: 600 },
  rehomed: null as string | null,
}
const steps: string[] = []

vi.mock('./pages.svelte', () => ({
  pages: {
    of: () => page,
    park: (tab: string) => {
      steps.push(`park ${tab}`)
      return Promise.resolve()
    },
    show: (tab: string, url: string) => {
      steps.push(`show ${tab} ${url}`)
      return Promise.resolve()
    },
  },
}))

/** Work keeps its web data apart; Home and every other space share the global store. */
vi.mock('./web-data.svelte', () => ({
  webData: {
    store: (space: string | null) => Promise.resolve(space === 'w' ? 'space_w' : null),
  },
}))

const { rehome } = await import('./rehome')

beforeEach(() => {
  steps.length = 0
  page.space = 'w'
  page.live = true
  page.rehomed = null
})

describe('a web tab saved into another space', () => {
  test('is built again in that space’s store, where it was, and says so', async () => {
    await rehome('tab', 'h', 'Home')

    expect(page.space).toBe('h')
    expect(steps).toEqual(['park tab', 'show tab https://mail.example.com/inbox'])
    expect(page.rehomed).toBe('Home')
  })

  test('is left as it is where the two spaces share a store', async () => {
    page.space = 'x'

    await rehome('tab', 'h', 'Home')

    expect(page.space).toBe('h')
    expect(steps).toEqual([])
    expect(page.rehomed).toBeNull()
  })

  test('is only told its space when no page is running, which is built there next', async () => {
    page.live = false

    await rehome('tab', 'h', 'Home')

    expect(page.space).toBe('h')
    expect(steps).toEqual([])
  })
})
