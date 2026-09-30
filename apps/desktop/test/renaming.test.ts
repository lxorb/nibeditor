import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { render } from 'svelte/server'
import NameField from '../src/lib/NameField.svelte'

/** Renaming happens where the name is written.
 *
 *  A row being renamed used to become a plain field across the whole row: the
 *  mark went, the indentation went, and a note being renamed looked nothing like
 *  the note it was a moment before. So the rule this holds the source to is that
 *  the row is not redrawn while its name is being typed - it is the same row, with
 *  the name editable in place - and that there is one field doing it, wherever the
 *  app renames something.
 *
 *  What a name may be is naming.test.ts; what the store does about it is
 *  naming.store.test.ts. This is what the reader sees. */

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))
const THEMES = fileURLToPath(new URL('../../../packages/themes/src/', import.meta.url))

const read = (name: string) => readFileSync(`${SOURCE}${name}`, 'utf8')

/** Every component in the app, by the name this file refers to it as. */
function componentFiles(dir: string): string[] {
  const out: string[] = []

  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...componentFiles(path))
    else if (name.endsWith('.svelte')) out.push(path.slice(SOURCE.length).split('\\').join('/'))
  }

  return out
}

const components = componentFiles(SOURCE)

const tree = read('lib/Tree.svelte')
const switcher = read('lib/SpaceSwitcher.svelte')
const shared = readFileSync(`${THEMES}base.css`, 'utf8')

/** The branch a row is drawn by while its name is being typed: from the test that
 *  says this row is the one, to the branch for a row that is not. */
const naming = tree.slice(
  tree.indexOf('{#if named?.path === entry.path}'),
  tree.indexOf('{:else if own}'),
)

describe('the row a name is being typed on', () => {
  test('is found by this test at all', () => {
    expect(naming).toContain('<NameField')
  })

  /** Every part of the row that is not the name: the shared row itself, the mark in
   *  front of it, the step in per level of the tree, and the two fills that say
   *  which note is open and what is picked. */
  test('is the same row it was a moment ago', () => {
    for (const part of [
      'class="nib-row row"',
      '<FileMark mark={markOf(entry, own)} path={markPath(entry, own)} />',
      'style:--level={depth}',
      'class:is-on=',
      'class:is-picked=',
    ]) {
      expect(naming, part).toContain(part)
    }
  })

  /** Which is the whole point: the row draws no field of its own, it hands the name
   *  to the one component that does. */
  test('and draws no field of its own', () => {
    expect(naming).not.toContain('<input')
    expect(tree).not.toContain('<input')
    // And the full-width box the row used to become has gone from the stylesheet
    // with it: what is left there is where a row sits and what a twist fills.
    const style = tree.slice(tree.indexOf('<style>'))
    expect(style).not.toContain('.rename')
    expect(style).not.toContain('border: 1px solid var(--accent)')
  })

  /** A folder being renamed is still open: what a folder discloses has nothing to
   *  do with what its own row is drawn as. Nothing at all, now that the list is one
   *  flat column - what a note holds are rows of the list, after this one, so there
   *  is no branch inside a row for a name being typed to reach. See tree-flat.ts. */
  test('and a folder keeps the rows it discloses', () => {
    expect([...tree.matchAll(/\{#if entry\.is_dir && workspace\.isExpanded/g)]).toHaveLength(0)
    expect(tree).toContain('flatRows(tree, isOpen)')
  })

  /** Which is what lets a rename survive the listing sync brings: the row is the
   *  same row, so the field inside it is never remade and never loses what has been
   *  typed into it. See `keepNaming` in workspace.svelte.ts.
   *
   *  And what keeps a scroll cheap: the rows a window slides in and out are keyed,
   *  so a scroll of one row makes one row rather than remaking twenty.
   *
   *  Keyed by the element a path was given, which is the path's for as long as it
   *  is drawn and is handed to a new row only when nothing drawn before is drawn
   *  now - another space's rows; see `slotsFor` in row-window.ts. */
  test('and the list is keyed by path, so a fresh listing does not remake it', () => {
    expect(tree).toContain(
      '{#each drawn as one (slots.get(one.row.entry.path) ?? one.row.entry.path)}',
    )
    expect(tree).toContain('drawn.map((one) => one.row.entry.path)')
  })

  /** And a name being typed on a row far off screen is a row the window has to keep:
   *  the field would otherwise be taken out of the page mid-word. */
  test('and the row being named is held in the page wherever the scroll is', () => {
    expect(tree).toContain('[workspace.naming?.path, standing, reaching]')
  })

  /** Held and drawn by the one list, so a row that is being held at its own offset
   *  and then becomes a row of the window is the same element throughout. Two lists
   *  made that one element ending and another beginning, and the field lost the
   *  keyboard the moment a folder finished opening under it. */
  test('and is the same element whether it is held or in the window', () => {
    expect([...tree.matchAll(/\{#each drawn as/g)]).toHaveLength(1)
    expect(tree).toContain('class:away={one.away}')
  })
})

describe('the field that renames', () => {
  test('is asked for by the list and by the header over it, and by nothing else', () => {
    expect(components.length).toBeGreaterThan(30)

    // Everything that renames something asks the one field for it, and everything
    // that knows a name is being typed is one of those two.
    const asking = components.filter((name) => read(name).includes('<NameField')).sort()
    const knowing = components.filter((name) => read(name).includes('workspace.naming')).sort()

    expect(asking).toEqual(['lib/SpaceSwitcher.svelte', 'lib/Tree.svelte'])
    // One more looks and draws nothing: the caret is kept out of the note while a
    // name is being typed, or the first letter would land in the document. See
    // caret.ts.
    expect(knowing).toEqual(['App.svelte', ...asking])
  })

  test('and the space renames in place too, rather than in a sheet', () => {
    expect(switcher).toContain('workspace.naming?.path === here.root')
    // The chevron that says the name can be pressed stays beside it.
    const header = switcher.slice(switcher.indexOf('workspace.naming?.path === here.root'))
    expect(header.slice(0, header.indexOf('{:else}'))).toContain('class="chevron"')
  })

  /** Both wear the same hairline, and it is stated once. */
  test('and a name that cannot be written is a red hairline, drawn in the themes', () => {
    expect(shared).toContain('.is-wrong')
    expect(shared.slice(shared.indexOf('.is-wrong'))).toContain('var(--danger)')

    for (const [name, text] of [
      ['lib/Tree.svelte', tree],
      ['lib/SpaceSwitcher.svelte', switcher],
    ] as const) {
      expect(text, name).toContain('class:is-wrong={wrong}')
      expect(text, name).toContain('bind:wrong')
    }
  })
})

/** Rendered rather than described, the way Hint.test.ts renders the bubble it
 *  shows: what a person can see of the field is a name and nothing else. */
describe('what the field draws', () => {
  const draw = (props: Record<string, unknown>) =>
    render(NameField, {
      props: { value: 'Plan', oncommit: () => undefined, oncancel: () => undefined, ...props },
    }).body

  test('the name it was given, in a field with a name of its own for a reader', () => {
    const body = draw({})
    expect(body).toContain('value="Plan"')
    expect(body).toContain('aria-label="Name"')
    expect(body).toContain('spellcheck="false"')
  })

  test('and never the browser tooltip, which a finger never sees', () => {
    expect(draw({})).not.toMatch(/\btitle=/)
  })

  test('nothing at all about a name that can be written', () => {
    expect(draw({})).not.toContain('nib-bubble')
  })

  /** Calmly: the sentence says what to change, in the bubble a setting's `i` shows
   *  its own sentence in, and never a dialog. */
  test('and the reason a name cannot be, in the shared bubble', () => {
    const body = draw({ value: 'Work/Plan' })
    expect(body).toContain('nib-bubble')
    expect(body).toContain('A name cannot hold a slash')
  })

  test('while an empty field is a name nobody has finished, not a mistake', () => {
    expect(draw({ value: '' })).not.toContain('nib-bubble')
  })

  test('and a name already taken says so', () => {
    expect(draw({ value: 'Beta', extension: '.md', taken: ['Beta.md'] })).toContain(
      'That name is taken',
    )
  })
})

/** The keys a file manager renames with, read off the one field that has them. */
describe('the keys the field takes', () => {
  const field = read('lib/NameField.svelte')

  test('Enter writes the name, Escape puts it back, and so does clicking away', () => {
    expect(field).toContain("if (event.key === 'Enter')")
    expect(field).toContain("} else if (event.key === 'Escape') {")
    expect(field).toContain('onblur={leave}')
  })

  /** A rename that lost the focus halfway through is a rename nobody asked for. */
  test('and Tab is swallowed', () => {
    const tab = field.slice(field.indexOf("event.key === 'Tab'"))
    expect(tab.slice(0, tab.indexOf('}'))).toContain('event.preventDefault()')
  })

  /** The name arrives selected without the extension, which is what Finder and
   *  Explorer both do; a name that is settled takes the caret at the end instead. */
  test('and the name arrives selected without its extension', () => {
    expect(field).toContain('if (appending) return caretAtEnd(node)')
    expect(field).toContain('return carries ? selectStem(node) : selectAll(node)')
  })
})
