import { flushSync } from 'svelte'
import { expect, test } from 'vitest'
import { NoteDoc, Tab } from '../../src/lib/workspace/documents.svelte'
import { root, watch } from './runes.svelte'

/** A tab pointed at another document, with something watching it.
 *
 *  Walking back along a trail to a note another pane already has open points the
 *  tab at that pane's document rather than making a second one, and the pane, the
 *  strip and the outline all read `tab.note` from inside an effect. Its rune is
 *  first given a value in the constructor rather than where the field is
 *  declared, so this is what says that is still a rune: in the node project a
 *  `$state` is a plain field and the swap would look the same either way. */

function documentAt(path: string): NoteDoc {
  return new NoteDoc(
    { kind: 'note', path, name: path.split('/').at(-1) ?? '', text: '', dirty: false },
    () => undefined,
  )
}

test('a tab pointed at another document is seen by whatever is watching it', () => {
  const tab = new Tab(documentAt('/space/One.md'), 'pane')
  const seen: (string | null)[] = []

  const stop = root(() => {
    watch(() => {
      seen.push(tab.note.path)
    })
  })
  flushSync()

  tab.note = documentAt('/space/Two.md')
  flushSync()
  stop()

  expect(seen).toEqual(['/space/One.md', '/space/Two.md'])
})
