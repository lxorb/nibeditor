import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'svelte/compiler'
import { describe, expect, test } from 'vitest'

/** The small card a sentence appears in, and the three that hold buttons.
 *
 *  `.nib-bubble` lets every press through it, because the sentence it holds sits over
 *  the row it is about. That is inherited, so a bubble with a button in it that did not
 *  say otherwise drew the button and gave it nothing: a site's question under a web
 *  tab's bar showed Allow and Don't allow, and every press on either fell through to
 *  the page's hole behind them. Emil, 2026-09-28: *"and this thing here is not
 *  clickable."* So every bubble that holds something to press is `is-pressable`, and
 *  this reads every component to hold them to it. See `.nib-bubble` in the themes. */

const SRC = fileURLToPath(new URL('..', import.meta.url))
const BASE = fileURLToPath(new URL('../../../../packages/themes/src/base.css', import.meta.url))

/** What a hand can press, by element. */
const PRESSED = new Set(['button', 'a', 'input', 'select', 'textarea', 'summary'])

interface Node {
  type: string
  name?: string
  attributes?: { type: string; name?: string; value?: unknown }[]
  fragment?: { nodes: Node[] }
  [key: string]: unknown
}

function components(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((one) => {
    const path = join(dir, one.name)
    if (one.isDirectory()) return components(path)
    return one.name.endsWith('.svelte') ? [path] : []
  })
}

/** The static half of an element's `class`, which is where a bubble says what it is. */
function classOf(node: Node): string {
  const found = node.attributes?.find((one) => one.type === 'Attribute' && one.name === 'class')
  if (!found || !Array.isArray(found.value)) return ''

  return (found.value as { type: string; data?: string }[])
    .map((part) => (part.type === 'Text' ? (part.data ?? '') : ''))
    .join(' ')
}

/** Every element under a node, through blocks as well as elements. */
function* elements(node: unknown): Generator<Node> {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const one of node) yield* elements(one)
    return
  }

  const one = node as Node
  if (one.type === 'RegularElement') yield one
  for (const [key, value] of Object.entries(one)) {
    if (key !== 'attributes' && value && typeof value === 'object') yield* elements(value)
  }
}

function holdsAPress(bubble: Node): boolean {
  for (const one of elements(bubble.fragment)) {
    if (one.name && PRESSED.has(one.name)) return true
    if (one.attributes?.some((each) => each.name === 'onclick')) return true
  }
  return false
}

/** Each bubble in the app: which file, whether it holds a press, and what it says it is. */
const bubbles = components(SRC).flatMap((file) => {
  const tree = parse(readFileSync(file, 'utf8'), { modern: true })
  return [...elements(tree.fragment)]
    .filter((one) => classOf(one).split(/\s+/).includes('nib-bubble'))
    .map((one) => ({
      file: file.slice(SRC.length).replaceAll('\\', '/'),
      presses: holdsAPress(one),
      pressable: classOf(one).split(/\s+/).includes('is-pressable'),
    }))
})

describe('a bubble', () => {
  test('is found where the app draws one, sentences and buttons both', () => {
    // Guards the reading itself: a parse that found nothing would pass everything.
    expect(bubbles.filter((one) => one.presses).map((one) => one.file)).toEqual(
      expect.arrayContaining([
        'lib/web-tab/WebAsk.svelte',
        'lib/web-tab/WebDownloads.svelte',
        'lib/web-tab/WebSite.svelte',
      ]),
    )
    expect(bubbles.some((one) => !one.presses)).toBe(true)
  })

  test('with something to press in it answers the pointer', () => {
    const deaf = bubbles.filter((one) => one.presses && !one.pressable).map((one) => one.file)
    expect(deaf).toEqual([])
  })

  test('with only a sentence in it lets the pointer through, as the sentence wants', () => {
    const caught = bubbles.filter((one) => !one.presses && one.pressable).map((one) => one.file)
    expect(caught).toEqual([])
  })

  test('is told apart by the one rule that turns the pointer back on', () => {
    const css = readFileSync(BASE, 'utf8')
    expect(css).toMatch(/\.nib-bubble \{[^}]*pointer-events: none;/)
    expect(css).toMatch(/\.nib-bubble\.is-pressable \{\s*pointer-events: auto;\s*\}/)
  })
})
