import { describe, expect, test } from 'vitest'
import type { Entry } from './workspace.svelte'
import { orderedTree, shownNames, type SortMode } from './tree-order'
import { placedBeside } from './tree-arranging'

/** What putting a whole space into order costs, as the space gets larger.
 *
 *  Counted rather than timed, for the reason the other perf files here give: the
 *  suite runs several files over whatever cores are left, and a sort that was
 *  descheduled halfway through says nothing about the sort. What is counted is how
 *  many times two names are compared, which is the only expensive thing in an
 *  ordering - a collator comparison goes through ICU - and the only thing that could
 *  turn a list into a problem.
 *
 *  Which is the whole question, because the order is now decided over the listing
 *  rather than by whoever read it: the panel draws twenty rows of five thousand, but
 *  the answer to "which row is row forty" is over all five thousand, and it is
 *  recomputed whenever the tree changes. A sort is n log n per folder and the folders
 *  partition the space, so the total is a few comparisons per note - anything worth
 *  one comparison per note per note is the quadratic one, which is what a comparator
 *  that rebuilt a lookup table on every call would be.
 *
 *  The ceilings below are held against the space rather than against a number
 *  measured on one machine. On the machine this was written on: 4,999 comparisons to
 *  read five thousand notes in name order, 13,499 in the order somebody arranged, and
 *  781 for one row dropped into a folder of forty however large the space around it
 *  is. Twenty-five million is what one comparison per note per note would be. */

/** A space of `many` notes, spread over folders of about forty each, which is what a
 *  vault of five thousand actually looks like. */
function space(many: number): Entry {
  const root: Entry = {
    name: 'N',
    path: '/N',
    is_dir: true,
    modified: 0,
    created: 0,
    children: [],
  }

  let folder: Entry = root
  for (let index = 0; index < many; index++) {
    if (index % 40 === 0) {
      folder = {
        name: `Folder ${index}`,
        path: `/N/Folder ${index}`,
        is_dir: true,
        modified: index,
        created: index,
        children: [],
      }
      root.children.push(folder)
    }

    folder.children.push({
      name: `Note ${many - index}.md`,
      path: `${folder.path}/Note ${many - index}.md`,
      is_dir: false,
      modified: (index * 7919) % many,
      created: index,
      children: [],
    })
  }

  return root
}

/** Every comparison of two names while `run` goes, counted.
 *
 *  `compare` on a collator is a getter that hands back a bound function, and it is
 *  read afresh on every call - so wrapping the getter counts every comparison the
 *  order makes without the order knowing anything about it. The descriptor is put
 *  back afterwards, whatever happened. */
function compares(run: () => void): number {
  const proto = Intl.Collator.prototype
  const was = Object.getOwnPropertyDescriptor(proto, 'compare')
  // Taken off the descriptor and called with the collator the app is asking, which is
  // the whole point of standing in front of a getter: `this` is deliberately somebody
  // else's here, and the getter is put back before this function returns.
  // eslint-disable-next-line @typescript-eslint/unbound-method -- see above
  const reader = was?.get
  if (!reader) throw new Error('no compare getter to count through')

  let count = 0
  Object.defineProperty(proto, 'compare', {
    configurable: true,
    get(this: Intl.Collator) {
      const bound = reader.call(this) as (one: string, other: string) => number
      return (one: string, other: string) => {
        count += 1
        return bound(one, other)
      }
    },
  })

  try {
    run()
  } finally {
    Object.defineProperty(proto, 'compare', was)
  }

  return count
}

const MANY = 5000

describe('putting a space of five thousand notes into order', () => {
  test('costs a few comparisons per note, in every order', () => {
    const tree = space(MANY)

    for (const mode of ['name', 'name-desc', 'modified-desc', 'created-asc'] as SortMode[]) {
      const count = compares(() => orderedTree(tree, mode, () => []))
      // Twenty per note is generous for n log n over folders of forty; one per note
      // per note is the quadratic one, and it would be twenty-five million.
      expect(count, `${mode}: ${count}`).toBeLessThan(MANY * 20)
    }
  })

  test('and no more for the order somebody arranged', () => {
    const tree = space(MANY)
    // A folder somebody arranged, which is the case that reads a list as well as a
    // name: the first few names of every folder, which is what a trimmed order holds.
    const listed = (folder: string) => {
      const found = tree.children.find((one) => one.path === folder)
      return found
        ? found.children
            .slice(0, 3)
            .map((one) => one.name)
            .reverse()
        : []
    }

    const count = compares(() => orderedTree(tree, 'manual', listed))
    expect(count, `manual: ${count}`).toBeLessThan(MANY * 20)
  })

  test('and a row dropped into place reads one folder rather than the space', () => {
    const tree = space(MANY)
    const folder = tree.children[0]
    if (!folder) throw new Error('no folder')

    const names = shownNames(folder.children, 'manual', [])
    const first = names[0] ?? ''
    const last = names[names.length - 1] ?? ''

    // Forty children, so a drop is worth a few hundred comparisons however large the
    // space around it is: what the pointer moves over is one folder's rows.
    const count = compares(() => placedBeside(folder.children, [], [last], first, false))
    expect(count, `a drop cost ${count}`).toBeLessThan(2000)
  })
})
