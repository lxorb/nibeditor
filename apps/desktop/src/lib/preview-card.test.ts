import { describe, expect, test } from 'vitest'
import { caretFor } from './preview-card'

/** Where the caret stands when a glance card opens.
 *
 *  The bug this is here to keep from coming back. The card is an editor, and an
 *  editor shows the block the caret is in as the markdown it is; a link that names
 *  the whole note put the caret at character nought, which in a note with metadata
 *  is inside the front matter. So a glance at such a note opened on three lines of
 *  raw YAML, with none of the rows it draws for everybody else - while every block
 *  below it drew perfectly. It read as a renderer missing its extensions and was a
 *  caret standing in the wrong place. */
describe('where a glance opens', () => {
  const matter = '---\ntitle: Everything\ntags:\n  - one\n---\n\n# Everything\n\nWords.\n'

  test('below the front matter, for a link that names the whole note', () => {
    const at = caretFor({ path: 'Everything.md', text: matter, at: 0 })

    expect(at).toBe(matter.indexOf('\n\n# Everything') + 1)
    expect(matter.slice(0, at)).toContain('tags:')
    expect(matter.slice(at)).not.toContain('tags:')
  })

  test('at character nought where the note has no front matter', () => {
    expect(caretFor({ path: 'Plain.md', text: '# Plain\n\nWords.\n', at: 0 })).toBe(0)
  })

  test('where the link pointed, when that is past the front matter', () => {
    const heading = matter.indexOf('# Everything')
    expect(caretFor({ path: 'Everything.md', text: matter, at: heading })).toBe(heading)
  })

  /** Three dashes that never close are not front matter, and a note that begins
   *  with a rule is a note like any other. */
  test('and a note that only looks like it has some opens at the top', () => {
    const rule = '---\n\nA line under nothing.\n'
    expect(caretFor({ path: 'Rule.md', text: rule, at: 0 })).toBe(0)
  })

  test('inside the note, whatever the link asked for', () => {
    expect(caretFor({ path: 'Plain.md', text: 'short', at: 900 })).toBe(5)
    expect(caretFor({ path: 'Plain.md', text: 'short', at: -4 })).toBe(0)
  })
})
