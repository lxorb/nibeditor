import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { render } from 'svelte/server'
import Hint from './Hint.svelte'

/** The `i` after a label, and the sentence behind it.
 *
 *  Rendered rather than described: the glyph has to be there, the sentence has to
 *  be the glyph's own name so a screen reader reads it, and neither may be a
 *  `title` - the browser's tooltip arrives late, in the system's font, and never
 *  at all under a finger. */

const SENTENCE = 'Only the standard markdown rules, no tables.'
const body = render(Hint, { props: { text: SENTENCE } }).body

describe('a hint', () => {
  test('draws the glyph', () => {
    expect(body).toContain('<svg')
    // Lucide's `info`: a circle, the stem, and the dot over it.
    expect(body).toContain('<circle')
    expect(body).toContain('d="M12 16v-4"')
  })

  test('carries its sentence, as the name of the thing that shows it', () => {
    expect(body).toContain(`aria-label="${SENTENCE}"`)
  })

  test('is a control the keyboard reaches, not a decoration', () => {
    expect(body).toContain('<button')
    expect(body).not.toContain('tabindex="-1"')
  })

  test('is never the browser tooltip, which arrives late and never under a finger', () => {
    expect(body).not.toMatch(/\btitle=/)
  })
})

/** The settings panel draws the glyph for a setting that has a sentence and for
 *  no other, which is what keeps a row without one exactly where it was. */
describe('where the panel draws it', () => {
  const panel = readFileSync(fileURLToPath(new URL('./SettingsPanel.svelte', import.meta.url)), {
    encoding: 'utf8',
  })

  test('only behind a hint, and only in the one slot every row shares', () => {
    expect([...panel.matchAll(/<Hint\b/g)]).toHaveLength(1)
    expect(panel).toContain('{#if field.hint}<Hint text={field.hint} />{/if}')
  })

  test('through the snippet every kind of row renders its name with', () => {
    // Six kinds of row, one name between them: a glyph that landed in five of
    // them and not the sixth is how one slot becomes two.
    const kinds = [...panel.matchAll(/field\.kind === '(\w+)'/g)].map((one) => one[1])
    expect(new Set(kinds)).toEqual(new Set(['switch', 'slider', 'segmented', 'swatches', 'text']))
    expect([...panel.matchAll(/\{@render named\(field, where\)\}/g)]).toHaveLength(6)
    expect(panel).toContain('{#snippet named(field: Field, where?: string)}')
  })
})
