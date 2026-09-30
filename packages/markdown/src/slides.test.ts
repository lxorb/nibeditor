import { describe, expect, test } from 'vitest'
import type { Token, Tokens } from 'marked'
import { lexMarkdown } from './index'
import { isDeck } from './slide-breaks'
import { deckOf, slideAt } from './slides'

/** The shown markdown of every slide, which is most of what a test asserts. */
const shown = (source: string) => deckOf(source).map((slide) => slide.markdown)

describe('breaking a note into slides', () => {
  test('a note with no rule in it is one slide', () => {
    expect(shown('# Title\n\nSome words.')).toEqual(['# Title\n\nSome words.'])
    expect(isDeck('# Title\n\nSome words.')).toBe(false)
  })

  test('a rule with a blank line above it breaks the slide', () => {
    expect(shown('# One\n\n---\n\n# Two')).toEqual(['# One', '# Two'])
    expect(isDeck('# One\n\n---\n\n# Two')).toBe(true)
  })

  test('a rule of more than three hyphens breaks it too', () => {
    expect(shown('One\n\n------\n\nTwo')).toEqual(['One', 'Two'])
  })

  test('a rule under a line of text is the underline of a heading, not a break', () => {
    // CommonMark reads this as `<h2>One</h2>`, and so must this: a break here
    // would present a note differently from the way every renderer shows it.
    expect(shown('One\n---\n\nTwo')).toEqual(['One\n---\n\nTwo'])
    expect(isDeck('One\n---\n\nTwo')).toBe(false)
  })

  test('front matter is not a break', () => {
    const note = '---\ntitle: Deck\n---\n\n# One\n\n---\n\n# Two'
    expect(shown(note)).toEqual(['# One', '# Two'])
  })

  test('front matter alone leaves one slide', () => {
    expect(shown('---\ntitle: Deck\n---\n\n# One')).toEqual(['# One'])
    expect(isDeck('---\ntitle: Deck\n---\n\n# One')).toBe(false)
  })

  test('a rule inside a fence is code', () => {
    const note = '# One\n\n```sh\n\n---\n\n```\n\n---\n\n# Two'
    expect(shown(note)).toEqual(['# One\n\n```sh\n\n---\n\n```', '# Two'])
  })

  test('a rule inside a tilde fence is code as well', () => {
    const note = '# One\n\n~~~\n\n---\n\n~~~\n\n---\n\n# Two'
    expect(deckOf(note)).toHaveLength(2)
  })

  test('a fence closes only on its own marker, at least as long', () => {
    const note = '````\n\n---\n\n```\n\n---\n\n````\n\n---\n\nAfter'
    expect(deckOf(note)).toHaveLength(2)
  })

  test('a rule on the very first line is front matter, as it is everywhere else', () => {
    // Obsidian, Marp and Slidev all read the first two rules of a file as the
    // fence around its metadata, whatever is between them. A deck that opened
    // with a rule would present differently here than there, so it does not.
    expect(shown('---\n\n# One\n\n---\n\n# Two')).toEqual(['# Two'])
  })

  test('a rule right after the front matter opens the first slide', () => {
    expect(shown('---\ntitle: Deck\n---\n\n---\n\n# One\n\n---\n\n# Two')).toEqual([
      '# One',
      '# Two',
    ])
  })

  test('two rules in a row make no empty slide', () => {
    expect(shown('One\n\n---\n\n---\n\nTwo')).toEqual(['One', 'Two'])
  })

  test('a trailing rule leaves no empty slide', () => {
    expect(shown('One\n\n---\n\nTwo\n\n---\n')).toEqual(['One', 'Two'])
  })

  test('carriage returns do not stop a break being read', () => {
    expect(shown('# One\r\n\r\n---\r\n\r\n# Two')).toEqual(['# One', '# Two'])
  })

  test('an indented rule is not a break', () => {
    // Four spaces make it code; three would still be a rule, so the line here
    // is indented past that.
    expect(deckOf('One\n\n    ---\n\nTwo')).toHaveLength(1)
  })
})

describe('whether a note is a deck at all', () => {
  /** The cheap answer has to be the same as the whole one, whatever the note. */
  const notes = [
    '',
    '# One',
    '# One\n\n---\n',
    '---\n\n# One',
    'One\n\n---\n\n---\n',
    '# One\n\n---\n\n# Two',
    '# One\n\n***\n\n# Two',
    '---\ntitle: x\n---\n\n# One',
    '---\ntitle: x\n---\n\n# One\n\n---\n\n# Two',
    'One\n---\n\nTwo',
    '# One\n\n```\n---\n```\n',
    '# One\n\n---\n\n```\ncode\n```\n',
    '```\n---\n```\n\n---\n\n# Two',
    '# One\n\n---\n\nNote: only notes',
  ]

  test('the cheap answer is the whole answer', () => {
    for (const note of notes) {
      expect([note, isDeck(note)]).toEqual([note, deckOf(note).length > 1])
    }
  })

  test('a rule with nothing on one side of it is not a deck', () => {
    expect(isDeck('# One\n\n---\n')).toBe(false)
    expect(isDeck('---\n\n# One')).toBe(false)
  })
})

describe('slides that go downwards', () => {
  test('a run of asterisks breaks downwards', () => {
    const slides = deckOf('# One\n\n***\n\n# Detail\n\n---\n\n# Two')
    expect(slides.map((one) => one.markdown)).toEqual(['# One', '# Detail', '# Two'])
    expect(slides.map((one) => one.vertical)).toEqual([false, true, false])
  })

  test('the first slide is never a continuation', () => {
    expect(deckOf('***\n\n# One\n\n---\n\n# Two')[0]?.vertical).toBe(false)
  })

  test('underscores stay an ordinary rule inside a slide', () => {
    expect(shown('One\n\n___\n\nTwo')).toEqual(['One\n\n___\n\nTwo'])
  })
})

describe('speaker notes', () => {
  test('a Note block hands the rest of the slide to the presenter', () => {
    const [slide] = deckOf('# One\n\nWords.\n\nNote: say the thing.\n\n---\n\n# Two')
    expect(slide?.markdown).toBe('# One\n\nWords.')
    expect(slide?.notes).toBe('say the thing.')
  })

  test('the plural spelling reads too, in any case', () => {
    expect(deckOf('# One\n\nNOTES: both.')[0]?.notes).toBe('both.')
  })

  test('notes run to the end of the slide and no further', () => {
    const slides = deckOf('# One\n\nNote: first\n\nmore\n\n---\n\n# Two')
    expect(slides[0]?.notes).toBe('first\n\nmore')
    expect(slides[1]?.notes).toBe('')
  })

  test('a slide of nothing but notes is still a slide', () => {
    const slides = deckOf('# One\n\n---\n\nNote: only this')
    expect(slides).toHaveLength(2)
    expect(slides[1]?.markdown).toBe('')
    expect(slides[1]?.notes).toBe('only this')
  })

  test('a note line inside a fence is code', () => {
    const [slide] = deckOf('# One\n\n```\nnote: not mine\n```')
    expect(slide?.notes).toBe('')
  })

  test('a note in the middle of a paragraph is words', () => {
    const [slide] = deckOf('# One\n\nWords.\nNote: still the paragraph.')
    expect(slide?.notes).toBe('')
  })
})

describe('list items that wait for a click', () => {
  test('a plus bullet is a step', () => {
    const [slide] = deckOf('# One\n\n+ first\n+ second')
    expect(slide?.fragments).toEqual([0, 1])
  })

  test('hyphens and stars arrive at once', () => {
    expect(deckOf('# One\n\n- a\n- b')[0]?.fragments).toEqual([])
    expect(deckOf('# One\n\n* a\n* b')[0]?.fragments).toEqual([])
  })

  test('a plus among hyphens is the only step', () => {
    // Two lists, since the marker is what tells one list from the next: the
    // items still come out in the order they are written.
    expect(deckOf('# One\n\n- a\n\n+ b')[0]?.fragments).toEqual([1])
  })

  test('a nested list is counted where its own item opens', () => {
    const [slide] = deckOf('# One\n\n- a\n  - b\n- c\n\n+ d')
    expect(slide?.fragments).toEqual([3])
  })

  test('a plus inside a fence is code', () => {
    expect(deckOf('# One\n\n```diff\n+ added\n```')[0]?.fragments).toEqual([])
  })

  test('an embedded note holds none of the slide`s own items', () => {
    // The renderer puts the embedded note's list on the page too, so the places
    // counted here have to be the places among the slide's own items and no
    // others. Whatever shows them skips the embed the same way; see the fragment
    // effect in Slides.svelte and `marks` in deck.ts.
    expect(deckOf('# One\n\n![[Other]]\n\n+ mine')[0]?.fragments).toEqual([0])
  })
})

describe('what a slide is made of', () => {
  test('headings alone are a title', () => {
    expect(deckOf('# Nib\n\n## slides')[0]?.shape).toBe('title')
  })

  test('a heading with words under it is prose', () => {
    expect(deckOf('# Nib\n\nWords.')[0]?.shape).toBe('prose')
  })

  test('one picture and nothing else fills the stage', () => {
    expect(deckOf('![](photo.png)')[0]?.shape).toBe('picture')
    expect(deckOf('![[photo.png]]')[0]?.shape).toBe('picture')
  })

  test('a picture with a caption under it is prose', () => {
    expect(deckOf('![](photo.png)\n\nA caption.')[0]?.shape).toBe('prose')
  })

  test('an empty slide is prose rather than a title', () => {
    expect(deckOf('# One\n\n---\n\nNote: only notes')[1]?.shape).toBe('prose')
  })
})

describe('where a slide sits in the note', () => {
  const note = '# One\n\n---\n\n# Two\n\n---\n\n# Three'

  test('the offsets point at the slide in the source', () => {
    const slides = deckOf(note)
    for (const slide of slides) {
      expect(note.slice(slide.from, slide.to)).toContain(slide.markdown)
    }
  })

  test('a caret finds the slide it is in', () => {
    const slides = deckOf(note)
    expect(slideAt(slides, 0)).toBe(0)
    expect(slideAt(slides, note.indexOf('# Two'))).toBe(1)
    expect(slideAt(slides, note.length)).toBe(2)
  })

  test('a caret above the first slide is on the first slide', () => {
    expect(slideAt(deckOf('---\n\n# One'), 0)).toBe(0)
  })
})

/** The list items the renderer's own grammar finds, in the order it emits them.
 *  What `fragments` is counted against, reached the expensive way. */
function itemsThroughTheRenderer(markdown: string): string[] {
  const found: string[] = []

  const walk = (tokens: readonly Token[]) => {
    for (const token of tokens) {
      if (token.type === 'list') {
        for (const item of (token as Tokens.List).items) {
          found.push(item.raw)
          walk(item.tokens)
        }
        continue
      }

      const inside = (token as { tokens?: Token[] }).tokens
      if (inside) walk(inside)
    }
  }

  walk(lexMarkdown(markdown))
  return found
}

describe('the grammar the fragments are counted with', () => {
  /** Every shape where a lighter grammar could disagree with the renderer's about
   *  which lines are list items: a construct that swallows lines, and one that
   *  does not. */
  const notes = [
    '# One\n\n+ a\n+ b',
    '# One\n\n- a\n  - b\n- c\n\n+ d',
    '# One\n\n$$\n+ not an item\n$$\n\n+ mine',
    '# One\n\n$$+ x$$\n\n+ mine',
    '# One\n\nTerm\n: a meaning\n\n+ mine',
    '# One\n\n- a\n: not a meaning',
    '# One\n\n[^1]: a note\n\n+ mine',
    '# One\n\n*[HTML]: HyperText\n\n+ mine',
    '# One\n\n> - quoted\n> + stepped',
    '# One\n\n```diff\n+ added\n```\n\n+ mine',
    '# One\n\n:smile: and $x$\n\n+ mine',
    '# One\n\n![[Other]]\n\n+ mine',
  ]

  test('finds the same items the renderer would, without loading the renderer', () => {
    for (const note of notes) {
      const [slide] = deckOf(note)
      const items = itemsThroughTheRenderer(slide?.markdown ?? '')
      const stepped = items.flatMap((raw, at) => (/^[ \t]*\+/.test(raw) ? [at] : []))

      expect([note, slide?.fragments], note).toEqual([note, stepped])
    }
  })
})
