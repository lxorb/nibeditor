import { describe, expect, test } from 'vitest'
import { type Inline, parseInline } from './inline'

/** The shape as compact markup, so a failure reads like the cell it came from.
 *  Lives here rather than in the renderer: the app builds elements, not text. */
function html(source: string): string {
  const show = (nodes: Inline[]): string =>
    nodes
      .map((node) => {
        if ('text' in node) return node.text
        const attribute = node.href ? ` href="${node.href}"` : ''
        return `<${node.tag}${attribute}>${show(node.children)}</${node.tag}>`
      })
      .join('')

  return show(parseInline(source))
}

describe('a table cell', () => {
  test('renders bold, which is what a plain-text cell got wrong', () => {
    expect(html('**Nib**')).toBe('<strong>Nib</strong>')
  })

  test('renders italic', () => {
    expect(html('*maybe*')).toBe('<em>maybe</em>')
  })

  test('renders code without its backticks', () => {
    expect(html('`pnpm dev`')).toBe('<code>pnpm dev</code>')
  })

  test('renders strikethrough', () => {
    expect(html('~~gone~~')).toBe('<del>gone</del>')
  })

  test('keeps the text around a construct', () => {
    expect(html('use **Nib** daily')).toBe('use <strong>Nib</strong> daily')
  })

  test('handles several in one cell', () => {
    expect(html('**a** and *b*')).toBe('<strong>a</strong> and <em>b</em>')
  })

  test('nests them', () => {
    expect(html('**bold *and* both**')).toBe('<strong>bold <em>and</em> both</strong>')
  })

  test('leaves ordinary text alone', () => {
    expect(html('just words')).toBe('just words')
  })

  test('leaves an emoji alone', () => {
    expect(html('✅')).toBe('✅')
  })

  test('is empty for an empty cell', () => {
    expect(html('')).toBe('')
  })

  test('keeps text that only looks like markup as text', () => {
    expect(parseInline('a < b & c')).toEqual([{ text: 'a < b & c' }])
  })

  test('shows an escaped pipe as the pipe, which is how a cell has to spell one', () => {
    expect(html('a \\| b')).toBe('a | b')
  })

  test('shows it inside code as well, where the grammar has no escapes', () => {
    // A pipe has to be written `\|` wherever it is in a cell, code span or not,
    // and showing the backslash would be showing syntax.
    expect(html('`a \\| b`')).toBe('<code>a | b</code>')
    expect(html('`x` and \\| and `y \\| z`')).toBe('<code>x</code> and | and <code>y | z</code>')
  })

  test('keeps a backslash that is not spelling a pipe', () => {
    expect(html('`C:\\temp`')).toBe('<code>C:\\temp</code>')
  })
})

describe('links in a cell', () => {
  test('show their label and carry their address', () => {
    expect(html('[Orden](https://orden.so)')).toBe('<a href="https://orden.so">Orden</a>')
  })

  test('refuse a scheme that could run something', () => {
    // The label still shows; only the address is dropped.
    expect(html('[tap](javascript:alert(1))')).toBe('<a>tap</a>')
  })
})
