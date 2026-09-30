import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { coalesce } from './outbox'
import { applyOp, nameKey, type TreeState, treeState } from './tree'
import type { Op } from './wire'

const create = (op: string, id: string, name: string, parent: string | null = null): Op => ({
  op,
  t: 'create',
  id,
  kind: 'note',
  parent,
  name,
  seen: 0,
})
const mkdir = (op: string, id: string, name: string, parent: string | null = null): Op => ({
  op,
  t: 'mkdir',
  id,
  parent,
  name,
  seen: 0,
})
const rename = (op: string, id: string, name: string): Op => ({
  op,
  t: 'rename',
  id,
  name,
  seen: 0,
})
const move = (op: string, id: string, parent: string | null): Op => ({
  op,
  t: 'move',
  id,
  parent,
  seen: 0,
})
const remove = (op: string, id: string): Op => ({ op, t: 'delete', id, seen: 0 })

describe('coalesce', () => {
  test('a title typed letter by letter is one rename, the last', () => {
    const ops = [rename('1', 'n', 'P'), rename('2', 'n', 'Pl'), rename('3', 'n', 'Plan')]
    expect(coalesce(ops)).toEqual([rename('3', 'n', 'Plan')])
  })

  test('renames of one id with something else done to it between stay apart', () => {
    const ops = [rename('1', 'n', 'A'), move('2', 'n', 'f'), rename('3', 'n', 'B')]
    expect(coalesce(ops)).toEqual(ops)
  })

  test('renames of other ids in between do not stop the fold', () => {
    const ops = [rename('1', 'n', 'A'), rename('2', 'm', 'X'), rename('3', 'n', 'B')]
    expect(coalesce(ops)).toEqual([rename('2', 'm', 'X'), rename('3', 'n', 'B')])
  })

  test('a rename or move of a note whose create has not gone folds into the create', () => {
    const ops = [
      mkdir('0', 'f', 'Work'),
      create('1', 'n', 'Untitled.md'),
      rename('2', 'n', 'Plan.md'),
      move('3', 'n', 'f'),
    ]
    expect(coalesce(ops)).toEqual([mkdir('0', 'f', 'Work'), create('1', 'n', 'Plan.md', 'f')])
  })

  test('a move into a folder made later waits for it', () => {
    const ops = [create('1', 'n', 'Plan.md'), mkdir('2', 'f', 'Work'), move('3', 'n', 'f')]
    expect(coalesce(ops)).toEqual(ops)
  })

  test('a create and a delete of one id cancel, with everything between', () => {
    const ops = [create('1', 'n', 'Untitled.md'), rename('2', 'n', 'Plan.md'), remove('3', 'n')]
    expect(coalesce(ops)).toEqual([])
  })

  test('a folder made and deleted takes what was made in it; what was moved in is deleted', () => {
    const ops = [
      mkdir('1', 'f', 'Tmp'),
      create('2', 'n', 'Inside.md', 'f'),
      move('3', 'old', 'f'),
      create('4', 'kept', 'Kept.md'),
      remove('5', 'f'),
    ]
    expect(coalesce(ops)).toEqual([create('4', 'kept', 'Kept.md'), remove('5.0', 'old')])
  })

  test('a delete of something the account already has stays', () => {
    const ops = [rename('1', 'n', 'A'), remove('2', 'n')]
    expect(coalesce(ops)).toEqual(ops)
  })

  test('does not change what it was handed', () => {
    const ops = [create('1', 'n', 'A.md'), rename('2', 'n', 'B.md')]
    const copy = structuredClone(ops)
    coalesce(ops)
    expect(ops).toEqual(copy)
  })
})

// ---------------------------------------------------------------------------
// The property: what one device does, coalesced or not, leaves the same tree.

type Choice =
  | { t: 'mkdir' | 'create'; parent: number; name: number }
  | { t: 'rename'; id: number; name: number }
  | { t: 'move'; id: number; parent: number }
  | { t: 'delete'; id: number }

const NAMES = ['A.md', 'a.md', 'B.md', 'Work', 'Plan.md']

const choice: fc.Arbitrary<Choice> = fc.oneof(
  fc.record({
    t: fc.constantFrom('mkdir' as const, 'create' as const),
    parent: fc.nat(),
    name: fc.nat(),
  }),
  fc.record({ t: fc.constant('rename' as const), id: fc.nat(), name: fc.nat() }),
  fc.record({ t: fc.constant('move' as const), id: fc.nat(), parent: fc.nat() }),
  fc.record({ t: fc.constant('delete' as const), id: fc.nat() }),
)

/** A device's own ops, made against its own tree as it goes, so each one names
 *  something that is there. */
function made(start: TreeState, choices: readonly Choice[]): Op[] {
  const state = structuredClone(start)
  const ops: Op[] = []
  let fresh = 0
  const context = { role: 'owner' as const, device: 'me' }

  for (const [index, one] of choices.entries()) {
    const live = [...state.entries.values()].filter((entry) => !entry.deleted)
    const folders = [
      null,
      ...live.filter((entry) => entry.kind === 'folder').map((entry) => entry.id),
    ]
    const pick = <T>(list: readonly T[], at: number): T | undefined =>
      list[at % Math.max(1, list.length)]
    const op = `o${String(index)}`
    const name = NAMES[('name' in one ? one.name : 0) % NAMES.length] ?? 'A.md'

    let next: Op | null = null
    if (!('id' in one)) {
      fresh += 1
      const id = `x${String(fresh)}`
      const parent = pick(folders, one.parent) ?? null
      next =
        one.t === 'mkdir'
          ? { op, t: 'mkdir', id, parent, name: name.replace('.md', ''), seen: state.cursor }
          : { op, t: 'create', id, kind: 'note', parent, name, seen: state.cursor }
    } else {
      const target = pick(live, one.id)
      if (!target) continue
      if (one.t === 'rename') next = { op, t: 'rename', id: target.id, name, seen: state.cursor }
      if (one.t === 'delete') next = { op, t: 'delete', id: target.id, seen: state.cursor }
      if (one.t === 'move') {
        next = {
          op,
          t: 'move',
          id: target.id,
          parent: pick(folders, one.parent) ?? null,
          seen: state.cursor,
        }
      }
    }

    if (!next) continue
    const result = applyOp(state, next, context)
    if ('ok' in result) ops.push(next)
  }
  return ops
}

/** A tree as its shape: which ids are alive, where, and how many of each name key are
 *  in each folder. Names themselves may step aside differently once the order of the
 *  ops changes; what may not change is what exists and where. */
function shape(state: TreeState) {
  const alive = [...state.entries.values()]
    .filter((entry) => !entry.deleted)
    .map((entry) => `${entry.id}@${entry.parent ?? ''}`)
    .sort()
  const keys = [...state.entries.values()]
    .filter((entry) => !entry.deleted)
    .map((entry) => `${entry.parent ?? ''}/${nameKey(entry.name).replace(/ \d+(?=\.|$)/, '')}`)
    .sort()
  return { alive, keys }
}

function replay(start: TreeState, ops: readonly Op[]): TreeState {
  const state = structuredClone(start)
  for (const op of ops) applyOp(state, op, { role: 'owner', device: 'me' })
  return state
}

describe('coalesce property', () => {
  test("property: coalesced or not, one device's ops leave the same tree, in fewer ops", () => {
    const start = treeState()
    applyOp(
      start,
      { op: 's1', t: 'mkdir', id: 'f', parent: null, name: 'Folder', seen: 0 },
      { role: 'owner' },
    )
    applyOp(
      start,
      { op: 's2', t: 'create', id: 'n', kind: 'note', parent: null, name: 'Note.md', seen: 0 },
      { role: 'owner' },
    )
    start.done.clear()

    fc.assert(
      fc.property(fc.array(choice, { maxLength: 30 }), (choices) => {
        const ops = made(start, choices)
        const folded = coalesce(ops)

        expect(folded.length).toBeLessThanOrEqual(ops.length)
        expect(shape(replay(start, folded))).toEqual(shape(replay(start, ops)))
      }),
      { numRuns: 2000 },
    )
  })
})
