import { expect, test } from 'vitest'
import { placeAt } from './scroll'

/** A note read from its first line was put back with that line against the top of the
 *  view, which is a note scrolled past the room over its title: every pane built again
 *  on a note left at its top - a split, a launch, a pane following another - showed its
 *  title pressed against the strip, 57 pixels down from where it opens. */
test('the first line is the top of the note, room over the title and all', () => {
  expect(placeAt(0)).toBeNull()
})

test('any other line is put against the top', () => {
  expect(placeAt(42)).not.toBeNull()
})
