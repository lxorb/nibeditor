/** The icon sets, held once for everything that draws out of them.
 *
 *  Each set is far larger than the app around it - Lucide alone is, the emoji index
 *  and the coloured drawings are larger again - so each is a chunk of its own,
 *  fetched the first time something actually wants an icon from it and kept for the
 *  rest of the session. What they have to be as well as loaded once is reactive: the
 *  rows that want them are already on screen when one lands, so the space that chose
 *  a book and the note that chose a rocket draw themselves again the moment it
 *  arrives rather than at the next redraw for some other reason.
 *
 *  One holder rather than one per surface, because a file list has one mark
 *  component per row: a load kept inside the component that draws a mark would be a
 *  load per row of the tree. And because a set is asked for from three places at
 *  once - the tree, the space's own badge and the picker - `load` has to be safe to
 *  call on every redraw, which is what `asked` is for.
 *
 *  A written value never says which set to fetch for anything but itself, so nothing
 *  here guesses: a row asks for the set its own value names, and a set nobody's
 *  value names is never fetched at all. */

import { type IconNode, keyNamed, loadIcons, LUCIDE, shapeFor, type WrittenIcon } from './icons'
import type { IconShape, LoadedSet } from './icon-sets'
import { startup } from './startup.svelte'

class IconLibrary {
  /** The sets that have arrived, by id. Empty until the first one does, which is
   *  why every reader falls back to something it can draw without them: a letter for
   *  a space, a kind's own mark for a file. */
  loaded = $state<Record<string, LoadedSet>>({})

  /** The sets that were asked for and could not be had: a chunk that would not
   *  fetch, or one this build does not carry at all - the plugin leaves the emoji
   *  index and the coloured set out, since half a megabyte of JSON is a lot to pack
   *  for a picker on a phone. Held so the picker can say so once rather than showing
   *  a set that is loading forever. */
  absent = $state<Record<string, true>>({})

  private asked = new Set<string>()

  /** The stroked set on its own, under the library's own keys, which is what a
   *  space keeps and what three readers here already expect. Empty until it
   *  arrives. */
  set = $state<Record<string, IconNode>>({})

  /** Asks for a set, once however often it is called - which is what lets the
   *  caller be a row of a list rather than the list.
   *
   *  A set this build has never heard of is not fetched and not remembered as
   *  asked: a file may name one a newer nib ships, and it should start working the
   *  moment that nib is installed rather than after a restart.
   *
   *  Asked for, on the launch, after the file list is on screen. A set is a
   *  fetch - a chunk this build carries, or a file off the network - and the first
   *  screenful of rows asks for one the moment it is drawn, which put it in front
   *  of the note somebody was waiting to read. The row shows its kind's own mark
   *  until the set lands, which is what it does anyway for the second or two a set
   *  takes; see FileMark.svelte and startup.svelte.ts. Which sets there are is read
   *  at the same turn, since nothing before it asks: the list of them is fifteen
   *  kilobytes the first paint has no use for (see test/weight.test.ts). */
  load(id: string = LUCIDE) {
    if (this.asked.has(id)) return
    this.asked.add(id)

    void startup.turn('icons').then(async () => {
      const set = (await import('./icon-sets')).setNamed(id)
      if (!set) {
        this.asked.delete(id)
        return
      }

      void set
        .load()
        .then((held) => {
          this.loaded = { ...this.loaded, [id]: held }
        })
        .catch(() => {
          this.absent = { ...this.absent, [id]: true }
        })

      // The stroked set is also held flat, under the library's own keys. Asked for
      // again rather than derived from what arrived, because `loadIcons` answers
      // with the one copy it already has: two asks, one fetch.
      if (id === LUCIDE) void loadIcons().then((all) => (this.set = all))
    })
  }

  /** Whether a set has been asked for, has not arrived, and still might. */
  loading(id: string): boolean {
    return this.asked.has(id) && !this.loaded[id] && !this.absent[id]
  }

  /** The drawing a space's chosen name means: the library's own key, since that is
   *  what a space keeps. Null until the set is here. */
  spaceShape(chosen: string | null): IconNode | null {
    return shapeFor(this.set, chosen)
  }

  /** The drawing a name written in a note means, in any of the spellings a file can
   *  hold; see keyNamed in icons.ts. */
  shape(written: string): IconNode | null {
    return shapeFor(this.set, keyNamed(this.set, written))
  }

  /** How to draw a written icon, whichever set it names, or null while the set it
   *  needs is still on its way - and for a name no set holds, which is a value
   *  written by a newer build or by hand.
   *
   *  An emoji needs no set at all: the platform's font is already here. */
  drawing(icon: WrittenIcon | null): IconShape | null {
    if (!icon) return null
    if (icon.kind === 'emoji') return { kind: 'emoji', text: icon.text }

    if (icon.kind === 'lucide') {
      const found = this.shape(icon.name)
      return found ? { kind: 'stroked', icon: found } : null
    }

    return this.loaded[icon.set]?.shape(icon.name) ?? null
  }

  /** The set a written icon has to be fetched for, or null where it needs none. */
  setFor(icon: WrittenIcon | null): string | null {
    if (!icon || icon.kind === 'emoji') return null
    return icon.kind === 'lucide' ? LUCIDE : icon.set
  }
}

export const iconLibrary = new IconLibrary()
