import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { nibMarkdownExtensions } from './extensions'
import { parsed } from '../../test/parsed'

function stateFor(doc: string): EditorState {
  return parsed(
    EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions })],
    }),
  )
}

function treeOf(state: EditorState): string {
  const doc = state.doc.toString()
  const out: string[] = []
  syntaxTree(state).iterate({
    enter: (node) => {
      let indent = 0
      for (let parent = node.node.parent; parent; parent = parent.parent) indent++
      out.push(
        `${'  '.repeat(indent)}${node.name} ${JSON.stringify(doc.slice(node.from, node.to))}`,
      )
    },
  })
  return out.join('\n')
}

function tree(doc: string): string {
  return treeOf(stateFor(doc))
}

/** Every node the parser produced, flat, for presence checks. */
function namesOf(state: EditorState): string[] {
  return treeOf(state)
    .split('\n')
    .map((line) => line.trim().split(' ')[0] ?? '')
}

function names(doc: string): string[] {
  return namesOf(stateFor(doc))
}

describe('highlight', () => {
  test('parses ==marked==', () => {
    expect(names('a ==marked== b')).toContain('Highlight')
    expect(names('a ==marked== b').filter((n) => n === 'HighlightMark')).toHaveLength(2)
  })

  test('leaves a lone equals alone', () => {
    expect(names('a = b')).not.toContain('Highlight')
  })
})

describe('inline math', () => {
  test('parses $x^2$', () => {
    expect(names('see $x^2$ here')).toContain('InlineMath')
  })

  test('ignores prices with spaces', () => {
    expect(names('costs $5 and $9 total')).not.toContain('InlineMath')
  })

  test('ignores a dollar at end of line', () => {
    expect(names('a $ b')).not.toContain('InlineMath')
  })
})

describe('block math', () => {
  test('parses a $$ fence', () => {
    expect(tree('$$\nE = mc^2\n$$\n')).toMatchInlineSnapshot(`
      "Document "$$\\nE = mc^2\\n$$\\n"
        BlockMath "$$\\nE = mc^2\\n$$"
          MathMark "$$"
          MathMark "$$""
    `)
  })

  /** The way a formula is usually typed, and the way the renderer reads it. The
   *  live preview and the page have to agree, or the note changes shape when it
   *  is exported. */
  test('parses a whole line of $$…$$', () => {
    expect(tree('$$E = mc^2$$\n')).toMatchInlineSnapshot(`
      "Document "$$E = mc^2$$\\n"
        BlockMath "$$E = mc^2$$"
          MathMark "$$"
          MathMark "$$""
    `)
  })

  test('leaves $$ part way along a line alone', () => {
    // "Costs $$5 and $$6 in total" is prose about money, not a formula.
    expect(names('Costs $$5 and $$6 in total.')).not.toContain('BlockMath')
    expect(names('The sum $$E = mc^2$$ sits here.')).not.toContain('BlockMath')
  })

  test('does not read an empty pair as a formula', () => {
    expect(names('$$$$')).not.toContain('BlockMath')
  })

  /** A formula ends the paragraph above it, the way a fence and a heading do.
   *
   *  It used not to, and so a formula written straight under a line of prose was
   *  not a formula at all: the `$$` line joined the paragraph and the maths came
   *  out as two literal dollars around an inline formula. A blank line above it
   *  was the difference, and nothing said so. Emil: *"is it possible that `$$`
   *  only renders properly if we do two line breaks?"*
   *
   *  It is not a convention. CommonMark lets fenced code and an ATX heading
   *  interrupt a paragraph, @lezer/markdown gives both of them an `endLeaf` for
   *  it, and the renderer this package has to agree with already had the same
   *  rule - see `blockMath` in @nib/markdown's blocks.ts, whose `start` hook is
   *  marked's way of saying the same thing. So the note read one way while it was
   *  written and another way once it was published, which is worse than either. */
  test('ends the paragraph above it, in both shapes', () => {
    expect(names('Text above\n$$x + y$$\nText below\n')).toContain('BlockMath')
    expect(names('Text above\n$$\nx + y\n$$\nText below\n')).toContain('BlockMath')
  })

  test('which is what the two constructs either side of it already did', () => {
    // The company it now keeps, asserted here so the rule is read as one rule
    // rather than as a special case for maths.
    expect(names('Text above\n```js\nlet x = 1\n```\nText below\n')).toContain('FencedCode')
    expect(names('Text above\n# A heading\nText below\n')).toContain('ATXHeading1')
  })

  test('and the paragraph above it is still a paragraph', () => {
    expect(tree('Text above\n$$x + y$$\n')).toMatchInlineSnapshot(`
      "Document "Text above\\n$$x + y$$\\n"
        Paragraph "Text above"
        BlockMath "$$x + y$$"
          MathMark "$$"
          MathMark "$$""
    `)
  })

  test('but prose about money is left where it is', () => {
    // The rule that keeps it so is that `$$` has to be the whole line: a line
    // with words before the marks is somebody's sentence, wherever it sits.
    for (const doc of [
      'I paid\nCosts $$5 and $$6 in total.\n',
      'I paid\nThe sum $$E = mc^2$$ sits here.\n',
      'I paid\n$$$$\n',
    ]) {
      expect(names(doc), doc).not.toContain('BlockMath')
    }
  })
})

describe('footnotes', () => {
  test('parses a reference', () => {
    expect(names('text[^1] more')).toContain('FootnoteRef')
  })

  test('parses a definition', () => {
    expect(names('[^1]: the note')).toContain('FootnoteDef')
  })

  test('does not swallow ordinary links', () => {
    expect(names('[label](url)')).not.toContain('FootnoteRef')
  })
})

describe('front matter', () => {
  test('parses YAML at the top of the document', () => {
    expect(tree('---\ntitle: Hi\n---\n\nbody')).toMatchInlineSnapshot(`
      "Document "---\\ntitle: Hi\\n---\\n\\nbody"
        FrontMatter "---\\ntitle: Hi\\n---"
          FrontMatterMark "---"
          FrontMatterMark "---"
        Paragraph "body""
    `)
  })

  test('leaves a leading horizontal rule alone', () => {
    expect(names('---\n\njust a rule')).not.toContain('FrontMatter')
  })

  test('ignores YAML that is not at the top', () => {
    expect(names('intro\n\n---\ntitle: Hi\n---\n')).not.toContain('FrontMatter')
  })
})

describe('fenced code', () => {
  test('parses a closed fence with its marks, info and text', () => {
    expect(tree('```js\nlet x\n```\n')).toBe(
      [
        'Document "```js\\nlet x\\n```\\n"',
        '  FencedCode "```js\\nlet x\\n```"',
        '    CodeMark "```"',
        '    CodeInfo "js"',
        '    CodeText "let x"',
        '    CodeMark "```"',
      ].join('\n'),
    )
  })

  test('leaves an unclosed fence as a paragraph and the rest of the file alone', () => {
    const found = names('```\n# Title\n\nsome *emphasis* here')
    expect(found).not.toContain('FencedCode')
    expect(found).toContain('ATXHeading1')
    expect(found).toContain('Emphasis')
    expect(tree('```\n# Title')).toBe(
      [
        'Document "```\\n# Title"',
        '  Paragraph "```"',
        '  ATXHeading1 "# Title"',
        '    HeaderMark "#"',
      ].join('\n'),
    )
  })

  test('leaves a fence on the last line as a paragraph', () => {
    expect(tree('# Title\n\n```')).toBe(
      [
        'Document "# Title\\n\\n```"',
        '  ATXHeading1 "# Title"',
        '    HeaderMark "#"',
        '  Paragraph "```"',
      ].join('\n'),
    )
  })

  test('still cuts a paragraph short, so the fence line stands on its own', () => {
    expect(tree('text\n```')).toBe(
      ['Document "text\\n```"', '  Paragraph "text"', '  Paragraph "```"'].join('\n'),
    )
  })

  test('becomes a fence the moment the third backtick of the closer lands', () => {
    expect(names('```js\ncode\n`')).not.toContain('FencedCode')
    expect(names('```js\ncode\n``')).not.toContain('FencedCode')
    expect(names('```js\ncode\n```')).toContain('FencedCode')
  })

  test('closes tildes with tildes, and backticks with backticks', () => {
    expect(names('~~~\ncode\n~~~')).toContain('FencedCode')
    expect(names('~~~\ncode\n```')).not.toContain('FencedCode')
    expect(names('```\ncode\n~~~')).not.toContain('FencedCode')
  })

  test('needs a closer at least as long as the opener', () => {
    expect(names('````\ncode\n```')).not.toContain('FencedCode')
    expect(tree('````\ncode\n```\n````')).toBe(
      [
        'Document "````\\ncode\\n```\\n````"',
        '  FencedCode "````\\ncode\\n```\\n````"',
        '    CodeMark "````"',
        '    CodeText "code\\n```"',
        '    CodeMark "````"',
      ].join('\n'),
    )
  })

  test('keeps the info string, but not one with a backtick in it', () => {
    expect(tree('```js extra \ncode\n```')).toContain('CodeInfo "js extra"')
    expect(names('```js`\ncode\n```')).not.toContain('FencedCode')
    expect(tree('~~~a`b\ncode\n~~~')).toContain('CodeInfo "a`b"')
  })

  test('allows up to three spaces of indent on either fence', () => {
    expect(names('   ```\ncode\n   ```')).toContain('FencedCode')
    expect(names('```\ncode\n    ```')).not.toContain('FencedCode')
  })

  test('leaves indented code alone', () => {
    expect(names('    code')).toContain('CodeBlock')
    expect(names('    ```')).toEqual(['Document', 'CodeBlock', 'CodeText'])
  })

  test('closes inside a list item', () => {
    expect(tree('- ```\n  code\n  ```')).toBe(
      [
        'Document "- ```\\n  code\\n  ```"',
        '  BulletList "- ```\\n  code\\n  ```"',
        '    ListItem "- ```\\n  code\\n  ```"',
        '      ListMark "-"',
        '      FencedCode "```\\n  code\\n  ```"',
        '        CodeMark "```"',
        '        CodeText "code"',
        '        CodeMark "```"',
      ].join('\n'),
    )
  })

  // CommonMark would end the item's fence where the item ends and make
  // `code` part of it; here a fence nothing closes is not a fence at all.
  test('does not let a list item close a fence for it', () => {
    const found = names('- ```\n  code\n\nafter')
    expect(found).not.toContain('FencedCode')
    expect(found).toContain('ListItem')
    expect(found.filter((name) => name === 'Paragraph')).toHaveLength(2)
  })

  test('ignores a closer outside the list item', () => {
    expect(names('- ```\n  code\n\n```')).not.toContain('FencedCode')
  })

  test('closes inside a blockquote', () => {
    expect(tree('> ```\n> code\n> ```')).toBe(
      [
        'Document "> ```\\n> code\\n> ```"',
        '  Blockquote "> ```\\n> code\\n> ```"',
        '    QuoteMark ">"',
        '    FencedCode "```\\n> code\\n> ```"',
        '      CodeMark "```"',
        '      QuoteMark ">"',
        '      CodeText "code"',
        '      QuoteMark ">"',
        '      CodeMark "```"',
      ].join('\n'),
    )
  })

  test('does not let a blockquote close a fence for it', () => {
    const found = names('> ```\n> code\n\nafter')
    expect(found).not.toContain('FencedCode')
    expect(found).toContain('Blockquote')
    expect(found.filter((name) => name === 'Paragraph')).toHaveLength(2)
  })

  test('is what Enter after an opening fence produces', () => {
    // commands.ts closes the fence on Enter; the result must parse as one.
    expect(names('```\n\n```')).toContain('FencedCode')
  })
})

// The parser reuses blocks of an earlier parse that lie clear of an edit,
// and it only does so for stretches of some length - hence the padding.
describe('fenced code while editing', () => {
  const padding =
    '# Heading\n\nA paragraph of prose, long enough for the parse to keep it around.\n\n'.repeat(2)

  /** The nodes after editing a document that was parsed before. */
  function edited(doc: string, from: number, to: number, insert: string): string[] {
    const state = stateFor(doc)
    syntaxTree(state)
    return namesOf(parsed(state.update({ changes: { from, to, insert } }).state))
  }

  /** The nodes after a run of edits, each parsed before the next arrives -
   *  which is what typing is, and the only way the parse of an earlier tree
   *  gets to be reused several times over. */
  function typed(doc: string, inserts: string[]): string[] {
    let state = stateFor(doc)
    for (const insert of inserts) {
      syntaxTree(state)
      state = parsed(state.update({ changes: { from: state.doc.length, insert } }).state)
    }
    syntaxTree(state)
    return namesOf(state)
  }

  test('becomes a fence once a closer is typed well below it', () => {
    const doc = '```js\n\n' + padding
    const found = edited(doc, doc.length, doc.length, '```')
    expect(found).toContain('FencedCode')
    expect(found).not.toContain('ATXHeading1')
  })

  test('goes back to a paragraph once the closer is removed', () => {
    const doc = '```js\n\n' + padding + '```'
    const found = edited(doc, doc.length - 3, doc.length, '')
    expect(found).not.toContain('FencedCode')
    expect(found).toContain('ATXHeading1')
  })

  // Nothing about the fence lines changes here: the item used to end at `x`,
  // and without it the item reaches the closer. (Lezer never reuses a list
  // that sits right before an edit, so this holds without help; it is here
  // so that a fence in a container is known to follow the container.)
  test('becomes a fence once the line ending its list item is removed', () => {
    const item = '- ```\n  ' + 'a'.repeat(200) + '\n'
    const doc = item + '\nx\n  ```'
    expect(names(doc)).not.toContain('FencedCode')
    expect(edited(doc, item.length + 1, item.length + 3, '')).toContain('FencedCode')
  })

  // The blocks a keystroke leaves alone come back from the tree before it, and
  // the fence line above is the one that must not: these type the closer a
  // character at a time, so the same paragraph is carried forward and looked
  // at again on every one of them.
  test('becomes a fence on the third backtick of a closer typed key by key', () => {
    const doc = '```js\n\n' + padding
    expect(typed(doc, ['`', '`'])).not.toContain('FencedCode')
    const found = typed(doc, ['`', '`', '`'])
    expect(found).toContain('FencedCode')
    expect(found).not.toContain('ATXHeading1')
  })

  test('stays a paragraph through prose typed below it', () => {
    const doc = '```js\n\n' + padding
    const found = typed(doc, ['more', ' prose', ' still', ' no', ' closer'])
    expect(found).not.toContain('FencedCode')
    expect(found).toContain('ATXHeading1')
  })

  test('a closer typed long after the last edit still closes it', () => {
    const doc = '```js\n\n' + padding
    const found = typed(doc, ['one\n\n', 'two\n\n', 'three\n\n', '```'])
    expect(found).toContain('FencedCode')
  })

  test('a fence inside a list item closes after edits elsewhere', () => {
    const doc = '- ~~~\n  ' + 'a'.repeat(200) + '\n'
    expect(typed(doc, ['\ntext\n\n'])).not.toContain('FencedCode')
    expect(typed(doc, ['  ~~~\n'])).toContain('FencedCode')
  })

  test('two unclosed fences, and the first one closes on its own', () => {
    const doc = '```js\n\n' + padding + '~~~\n\ntail\n'
    const found = typed(doc, ['```\n'])
    expect(found).toContain('FencedCode')
    // The tildes are inside the fence the backticks just closed.
    expect(found.filter((name) => name === 'FencedCode')).toHaveLength(1)
  })
})
