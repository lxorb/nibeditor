import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** What fills a pane is fetched the first time a tab of its kind is in front: a
 *  canvas, a PDF, a website, the reading view, the buttons of an empty pane. A fetch
 *  can fail - in the browser build the site is deployed again under a tab that stayed
 *  open, and the chunk it names is gone - and a surface whose fetch failed drew
 *  nothing at all: a blank pane, no word, and nothing that would ever fill it, because
 *  the door keeps its answer. A browser that cannot reach a page says so and offers
 *  Reload; so does a pane.
 *
 *  Read out of the component rather than mounted: a pane is the whole app's graph, and
 *  what is asked here is only that no surface block is left without its other half. */

const SOURCE = readFileSync(fileURLToPath(new URL('./Pane.svelte', import.meta.url)), 'utf8')

const SURFACES = [...SOURCE.matchAll(/\{#await (\w+Surface)\(\) then \w+\}([\s\S]*?)\{\/await\}/g)]

describe('a surface a pane is filled with', () => {
  test('is every kind of tab a pane can show', () => {
    expect(SURFACES.map(([, door]) => door).sort()).toEqual([
      'canvasSurface',
      'emptySurface',
      'graphSurface',
      'pagesSurface',
      'pdfSurface',
      'readingSurface',
      'terminalSurface',
      'webSurface',
    ])
  })

  test('offers a reload where it could not be fetched, rather than a blank pane', () => {
    for (const [, door, body] of SURFACES) {
      expect(body, door).toMatch(/\{:catch\}\s*\{@render unreachable\(\)\}/)
    }
  })
})
