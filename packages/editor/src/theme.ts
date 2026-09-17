import { HighlightStyle } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { markTags } from './markdown/tags'

/** Chrome for the editor itself. Everything visual reads from the theme tokens,
 *  so swapping a theme restyles the editor without touching this file. */
export const nibTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'transparent',
    color: 'var(--text)',
    fontFamily: 'var(--font-content)',
    fontSize: 'var(--text-content)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: 'var(--leading-content)',
    overflowY: 'auto',
    overflowX: 'hidden',
  },
  '.cm-content': { caretColor: 'var(--accent)' },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--accent)',
    borderLeftWidth: '2px',
  },
  // The editor paints the selection itself, as one block per range; see
  // selection/layer.ts, which carries its colour with it. The browser's own
  // highlight has to be turned off inside the editor, or the two stack and the
  // words under them wash out.
  '.cm-content ::selection, .cm-content::selection': {
    backgroundColor: 'transparent',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-selectionMatch': {
    backgroundColor: 'var(--accent-soft)',
    borderRadius: '3px',
  },
  '.cm-searchMatch': {
    backgroundColor: 'var(--accent-soft)',
    outline: '1px solid var(--accent-line)',
    borderRadius: '3px',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--accent)',
    color: '#fff',
  },
})

export const nibHighlightStyle = HighlightStyle.define([
  // Size and leading belong to the line (see editor.css), not to the heading's
  // token: inline code in a heading is a token of its own, and a size set here
  // would leave it at paragraph size inside a title.
  { tag: tags.heading1, fontWeight: '620' },
  { tag: tags.heading2, fontWeight: '620' },
  { tag: tags.heading3, fontWeight: '620' },
  { tag: tags.heading4, fontWeight: '620' },
  { tag: tags.heading5, fontWeight: '620' },
  { tag: tags.heading6, fontWeight: '620', color: 'var(--muted-strong)' },
  { tag: tags.strong, fontWeight: '650', color: 'var(--text-strong)' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through', color: 'var(--muted)' },
  { tag: tags.link, color: 'var(--accent)' },
  { tag: tags.url, color: 'var(--muted)' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono)', fontSize: '0.88em' },
  { tag: tags.quote, color: 'var(--muted-strong)' },
  { tag: tags.list, color: 'var(--text)' },
  { tag: tags.contentSeparator, color: 'var(--muted)' },
  { tag: tags.meta, color: 'var(--md-char-color)' },
  { tag: tags.processingInstruction, color: 'var(--md-char-color)' },
  { tag: markTags.highlight, background: 'var(--accent-soft)', color: 'var(--text-strong)' },
  { tag: markTags.math, fontFamily: 'var(--font-mono)', color: 'var(--muted-strong)' },
  { tag: markTags.footnote, color: 'var(--accent)', fontSize: '0.8em', verticalAlign: 'super' },
  { tag: markTags.frontMatter, fontFamily: 'var(--font-mono)', color: 'var(--muted)' },
])

// Code fences are coloured separately, in `code-theme.ts`, so the syntax theme
// can be chosen independently of the one the document is written in.
