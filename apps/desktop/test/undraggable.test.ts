import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

/** Every picture the app draws is part of something a press is about, and never a
 *  thing to drag on its own.
 *
 *  A browser drags an `<img>` as a picture of its own unless it is told not to, and
 *  that drag takes the pointer from whatever the picture sits in. Emil, 2026-09-30:
 *  *"When I try to drag a web page and start with my cursor on the icon, it tries to
 *  drag the icon instead of the actual tab."* The favicon is the same picture in the
 *  tab, the file list, a bookmark, the palette and the address bar, so the rule is
 *  the markup's rather than one component's, and held here rather than said beside
 *  each picture, which would be bytes in the first paint for every one of them. A
 *  picture somebody should be able to drag out would say `draggable="true"` and be
 *  named here. */

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))

function components(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return components(path)
    return name.endsWith('.svelte') ? [path] : []
  })
}

/** Each `<img ... />` in a component, whole. A component's pictures are closed with
 *  `/>`, which no attribute's expression here holds. */
function pictures(text: string): string[] {
  return [...text.matchAll(/<img\b[\s\S]*?\/>/g)].map((one) => one[0])
}

const found = components(SOURCE).flatMap((path) =>
  pictures(readFileSync(path, 'utf8')).map((tag) => ({ file: relative(SOURCE, path), tag })),
)

test('the app draws pictures, so this is looking at something', () => {
  expect(found.map((one) => one.file.replaceAll('\\', '/'))).toEqual(
    expect.arrayContaining(['lib/TabMark.svelte', 'lib/FileMark.svelte']),
  )
})

test('and none of them drags on its own', () => {
  const loose = found.filter((one) => !one.tag.includes('draggable="false"'))
  expect(loose.map((one) => `${one.file}: ${one.tag}`)).toEqual([])
})
