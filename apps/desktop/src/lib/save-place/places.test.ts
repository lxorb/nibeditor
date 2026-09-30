import { describe, expect, test } from 'vitest'
import { NoteDoc, UNTITLED } from '../workspace/documents.svelte'
import { fileFor, placesFor, startingPlace } from './places'

type Entry = import('../workspace.svelte').Entry

const row = (path: string, children: Entry[] = []): Entry => ({
  name: path.slice(path.lastIndexOf('/') + 1),
  path,
  is_dir: children.length > 0,
  modified: 0,
  created: 0,
  children,
})

const tree = row('/space', [row('/space/Plan.md'), row('/space/Trips', [row('/space/Trips/a.md')])])
const spaces = [
  { id: 's', name: 'Notes', root: '/space' },
  { id: 'w', name: 'Work', root: '/work' },
]

const draft = (text: string, kind: 'note' | 'web' = 'note') =>
  new NoteDoc({ kind, path: null, name: UNTITLED, text, dirty: false }, () => undefined)

describe('where Save offers to put a tab', () => {
  test('is everywhere a note could be moved to, the space first', () => {
    const places = placesFor(tree, spaces, '/space')

    expect(places.map((one) => one.id)).toEqual([
      '/space',
      '/space/Plan',
      '/space/Trips',
      '/space/Trips/a',
      '/work',
    ])
  })

  test('starts on the root of the tab’s own space', () => {
    const places = placesFor(tree, spaces, '/space')

    expect(startingPlace(places, '/work')?.id).toBe('/work')
    expect(startingPlace(places, null)?.id).toBe('/space')
  })
})

describe('the file a typed name comes to', () => {
  test('is what a filesystem takes of it, under the kind’s ending', () => {
    expect(fileFor('Q1: costs?', draft('x'))).toBe('Q1 costs.md')
    expect(fileFor('Reading', draft('', 'web'))).toBe('Reading.url')
  })

  test('or the name offered where nothing of it is left', () => {
    expect(fileFor('  ', draft('# Plan'))).toBe('Plan.md')
    expect(fileFor('', draft('', 'web'), 'Svelte docs')).toBe('Svelte docs.url')
  })
})
