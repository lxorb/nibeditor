import { HighlightStyle } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { markTags } from './markdown/tags'

/** Chrome for the editor itself. Everything visual reads from the theme tokens,
 *  so swapping a theme restyles the editor without touching this file. */
export const nibTheme = EditorView.theme({
  '&': {
    // A height from the flex line first, and the percentage only as the fallback
    // for a parent that is not a flex column - the card over a `[[link]]`, and a
    // test that mounts the editor in a bare div.
    //
    // `height: 100%` alone was the whole of it, and on a stretched flex item that
    // is the one case engines have never agreed on. Chromium resolved it and gave
    // the scroller a height; the WebView2 the Windows app embeds did not, so the
    // scroller grew to the whole note, `.surface` clipped it with `overflow:
    // hidden`, and the editor believed its content fitted. What that looks like is
    // a note that cannot be scrolled: no bar, because the app draws one only when
    // there is something to scroll, and a wheel that does nothing, because the
    // element under the pointer has nowhere to go - while the caret still moves the
    // note, because that is the app setting `scrollTop` on the clipping parent,
    // which works whether or not it hides its overflow.
    //
    // The reading view never had this: it sizes its own scroller `flex: 1;
    // min-height: 0` and asks no percentage of anybody. See Reading.svelte, which
    // is now the one way a scrolling surface is sized in this app.
    flex: '1',
    minHeight: 0,
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
