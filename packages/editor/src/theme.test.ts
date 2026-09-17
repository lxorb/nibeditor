import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { highlightTree } from '@lezer/highlight'
import { describe, expect, test } from 'vitest'
import { nibHighlightStyle, nibTheme } from './theme'

/** The two things about the writing surface that nothing else in the app states,
 *  and that a reader loses within a second of either line going: a note longer than
 *  the window scrolls, and the words between the stars are heavier than the ones
 *  around them.
 *
 *  Both come out of this one file as CSS the library generates and mounts, not as
 *  anything in packages/themes - so nothing that reads a stylesheet covers them, and
 *  a line deleted here would go out looking like a tidy-up. What is asserted is the
 *  CSS the theme and the highlight style actually generate, and - for bold - the
 *  whole road from the stars in the document to the class the words are drawn in.
 *
 *  The measured versions of both, in a real window with a real scroll height, belong
 *  to the drives; see apps/desktop/test/e2e/smoke.py. */

/** What a browser treats as bold, and the weight from which it synthesises one for
 *  a family with no bold cut installed. Below this the words are not bold on a
 *  machine that has only the regular face. */
const BOLD = 600

/** The rules an extension's style modules generate, as one string. */
function rulesOf(extension: Extension): string {
  return EditorState.create({ extensions: [extension] })
    .facet(EditorView.styleModule)
    .map((one) => one.getRules())
    .join('\n')
}

/** The declarations of one generated class. The classes are named by a counter
 *  inside the library, so a name is always asked for rather than written down. */
function blockFor(rules: string, className: string): string {
  return new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`).exec(rules)?.[1] ?? ''
}

/** The classes the highlighter gives the words `word` in `doc`.
 *
 *  The whole road: the markdown parser, which says those characters are strong
 *  emphasis; the tag it says it with; and the style, which turns the tag into a
 *  class. A break anywhere along it comes back as no class at all. */
function classesOver(doc: string, word: string): string {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage })],
  })
  const tree = ensureSyntaxTree(state, doc.length, 5000)
  expect(tree).not.toBeNull()

  const at = doc.indexOf(word)
  let found = ''
  highlightTree(tree!, [nibHighlightStyle], (from, to, classes) => {
    if (from <= at && to >= at + word.length) found = classes
  })

  return found
}

describe('the writing surface', () => {
  test('is as tall as the pane holding it, and scrolls the note inside that', () => {
    const rules = rulesOf(nibTheme)

    // The editor fills its pane rather than growing with the note. The pane clips
    // what overflows it - `.surface` in Editor.svelte - so an editor that grew would
    // put the foot of a long note under the bottom of the window with nothing to
    // scroll it back into view.
    //
    // Off the flex line FIRST and the percentage only as the fallback. The
    // percentage alone shipped, and a percentage against a stretched flex item is
    // the one case engines disagree on: Chromium resolved it and WebView2, which is
    // what the Windows app embeds, did not - so on Windows the editor grew to the
    // note and no wheel could move it, while every test and every drive here passed.
    const surface = /\.\S+ \{([^}]*)\}/.exec(rules)?.[1] ?? ''
    expect(surface).toMatch(/height: 100%/)
    expect(surface).toMatch(/flex: 1/)
    expect(surface).toMatch(/min-height: 0/)

    // And the scroller is what scrolls. The library's own theme states `overflow-x`
    // and leaves the block axis alone, so this one declaration is what makes a note
    // longer than the window reachable at all.
    const scroller = /\.\S+ \.cm-scroller \{([^}]*)\}/.exec(rules)?.[1] ?? ''
    expect(scroller).toMatch(/overflow-y: auto/)
  })
})

describe('the words between the stars', () => {
  test('are drawn in a class of their own', () => {
    expect(classesOver('a **bold** word', 'bold')).not.toBe('')
  })

  test('are heavy enough that a browser draws them bold', () => {
    const rules = nibHighlightStyle.module?.getRules() ?? ''
    const [className = ''] = classesOver('a **bold** word', 'bold').split(' ')
    const weight = Number(/font-weight:\s*(\d+)/.exec(blockFor(rules, className))?.[1] ?? 0)

    expect(weight).toBeGreaterThanOrEqual(BOLD)
  })

  test('are heavier than the words around them', () => {
    const rules = nibHighlightStyle.module?.getRules() ?? ''
    const [bold = ''] = classesOver('a **bold** word', 'bold').split(' ')
    const [plain = ''] = classesOver('a *leaning* word', 'leaning').split(' ')

    expect(blockFor(rules, bold).includes('font-weight')).toBe(true)
    expect(blockFor(rules, plain).includes('font-weight')).toBe(false)
  })
})
