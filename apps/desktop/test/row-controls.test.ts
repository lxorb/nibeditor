import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'svelte/compiler'
import { expect, test } from 'vitest'

/** What may stand at the end of a row of settings.
 *
 *  `.nib-setting` is a name on the left and a control on the right, and the name is
 *  what gives way. `.nib-action` is the other kind of action: a line of words across a
 *  card, as wide as the card. Put one at the end of a row and it takes the whole row,
 *  the name is left no width at all, and its words are drawn a letter to a line down
 *  the window - which is what Settings > Online terminal did with Restart (issue 245).
 *  The action at the end of a row is `.nib-chip`; see base.css.
 *
 *  And since Settings > Account drew Clear after the same way with a dropdown, the row
 *  itself holds the line whatever stands at its end: its `.name` has a floor, and a
 *  control that does not fit beside it goes under it. The tests below hold the rule and
 *  the markup it needs; the layout sweep (test/e2e/layout-sweep.py) holds what is drawn. */

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

interface Node {
  type: string
  name?: string
  attributes?: { type: string; name?: string; value?: unknown }[]
  [key: string]: unknown
}

function components(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((one) => {
    const path = join(dir, one.name)
    if (one.isDirectory()) return components(path)
    return one.name.endsWith('.svelte') ? [path] : []
  })
}

/** The static half of an element's `class`, plus every `class:name` it may wear. */
function classesOf(node: Node): string[] {
  const words: string[] = []
  for (const one of node.attributes ?? []) {
    if (one.type === 'ClassDirective' && one.name) words.push(one.name)
    if (one.type !== 'Attribute' || one.name !== 'class' || !Array.isArray(one.value)) continue
    for (const part of one.value as { type: string; data?: string }[])
      if (part.type === 'Text') words.push(...(part.data ?? '').split(/\s+/))
  }
  return words.filter(Boolean)
}

/** Every element under a node, through blocks as well as elements, each with whether a
 *  row of settings holds it. */
function* elements(node: unknown, inRow = false): Generator<{ node: Node; inRow: boolean }> {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const one of node) yield* elements(one, inRow)
    return
  }

  const one = node as Node
  let under = inRow
  if (one.type === 'RegularElement') {
    yield { node: one, inRow }
    under = inRow || classesOf(one).includes('nib-setting')
  }
  for (const [key, value] of Object.entries(one)) {
    if (key !== 'attributes' && value && typeof value === 'object') yield* elements(value, under)
  }
}

test('no row of settings ends in an action that is as wide as a card', () => {
  const files = components(SRC)
  expect(files.length).toBeGreaterThan(100)

  const wide = files.flatMap((file) => {
    const tree = parse(readFileSync(file, 'utf8'), { modern: true })
    return [...elements(tree.fragment)]
      .filter((one) => one.inRow && classesOf(one.node).includes('nib-action'))
      .map(() => file.slice(SRC.length).replaceAll('\\', '/'))
  })

  expect(wide).toEqual([])
})

/** The children of an element that are elements, through blocks but not into other
 *  elements or components. */
function* children(node: unknown): Generator<Node> {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const one of node) yield* children(one)
    return
  }
  const one = node as Node
  if (one.type === 'RegularElement') {
    yield one
    return
  }
  if (one.type === 'Component') return
  for (const [key, value] of Object.entries(one)) {
    if (key !== 'attributes' && value && typeof value === 'object') yield* children(value)
  }
}

/** Whether an element says words of its own, written in the markup or put there. */
function says(node: Node): boolean {
  const nodes = (node.fragment as { nodes?: Node[] } | undefined)?.nodes ?? []
  return nodes.some(
    (one) =>
      (one.type === 'Text' && typeof one.data === 'string' && one.data.trim() !== '') ||
      one.type === 'ExpressionTag',
  )
}

/** The words a row is named by are its `.name`, because that is what the floor in
 *  base.css holds - `.nib-setting > .name`, never below a readable width whatever sits
 *  beside it. A row whose name is a bare span is a row whose name can still be squeezed
 *  to nothing, which is the bug the floor exists for. */
test('the words a row of settings is named by are its .name', () => {
  const WORDS = new Set(['span', 'div', 'p', 'strong', 'small'])
  // What a row says that is not its name: a value, a key, a hint, a mark.
  const VALUES = new Set(['name', 'text', 'hint', 'value', 'key', 'mark'])
  const bare = components(SRC).flatMap((file) => {
    const tree = parse(readFileSync(file, 'utf8'), { modern: true })
    return [...elements(tree.fragment)]
      .filter(({ node }) => classesOf(node).includes('nib-setting'))
      .flatMap(({ node }) => [...children(node.fragment)])
      .filter((child) => WORDS.has(child.name ?? '') && says(child))
      .filter((child) => !classesOf(child).some((one) => VALUES.has(one)))
      .map(
        (child) =>
          `${file.slice(SRC.length).replaceAll('\\', '/')} ${child.name}.${classesOf(child).join('.')}`,
      )
  })

  expect(bare).toEqual([])
})

/** The rule of the row itself, in the themes package: one rule's body by its selector. */
function ruleOf(sheet: string, selector: string): string {
  const at = sheet.indexOf(`\n${selector} {`)
  expect(at, `${selector} in base.css`).toBeGreaterThan(-1)
  return sheet.slice(at, sheet.indexOf('}', at))
}

test("a row's name keeps a readable width and what does not fit beside it wraps under it", () => {
  const sheet = readFileSync(
    fileURLToPath(new URL('../../../packages/themes/src/base.css', import.meta.url)),
    'utf8',
  )

  // The row breaks rather than the name: a control too wide goes to the next line.
  expect(ruleOf(sheet, '.nib-setting')).toMatch(/flex-wrap:\s*wrap/)
  // A floor no pane's own `min-width: 0` can take away, and never wider than the row.
  expect(ruleOf(sheet, '.nib-setting > .name')).toMatch(
    /min-inline-size:\s*min\(\d+(\.\d+)?rem,\s*100%\)\s*!important/,
  )
  // What wraps lands at the end, where a row's control always is.
  expect(ruleOf(sheet, '.nib-setting > .name + *')).toMatch(/margin-inline-start:\s*auto/)
  expect(ruleOf(sheet, '.nib-setting > .name ~ *')).toMatch(/max-inline-size:\s*100%/)
})
