import { describe, expect, test } from 'vitest'
import { listOf, type Listed } from './calls'
import { opens, rowOf, rowsOf } from './listing'

function listed(over: Partial<Listed> = {}): Listed {
  return {
    term: 'note-1',
    session: 's_1',
    createdAt: 100,
    space: 'space-1',
    path: 'Build/Terminal 2.term',
    trashed: false,
    program: null,
    title: null,
    alive: true,
    at: null,
    ...over,
  }
}

describe('a session as a row', () => {
  test('is called by the title its program set, then the program, then its file', () => {
    expect(rowOf(listed({ program: 'claude', title: '✳ Fix the build' })).name).toBe(
      'Fix the build',
    )
    expect(rowOf(listed({ program: 'vim' })).name).toBe('vim')
    // A title with nobody in front is the shell's own, never a name.
    expect(rowOf(listed({ title: 'nib@machine: ~' })).name).toBe('Terminal 2')
    expect(rowOf(listed({ term: null, path: null })).name).toBeNull()
  })

  test('says its file under a name that is not the file, and when it last printed', () => {
    expect(rowOf(listed({ program: 'vim', at: 500 }))).toMatchObject({
      file: 'Terminal 2',
      at: 500,
    })
    expect(rowOf(listed())).toMatchObject({ file: null, at: 100 })
  })

  test('the one that printed last comes first, then the newest made', () => {
    const rows = rowsOf([
      listed({ session: 's_old', createdAt: 1 }),
      listed({ session: 's_busy', at: 900 }),
      listed({ session: 's_new', createdAt: 5 }),
      listed({ session: 's_quiet', at: 50 }),
    ])
    expect(rows.map((one) => one.key)).toEqual(['s_busy', 's_quiet', 's_new', 's_old'])
  })

  test('opens only where a file names it and the file is not in the trash', () => {
    expect(opens(listed())).toBe(true)
    expect(opens(listed({ trashed: true }))).toBe(false)
    expect(opens(listed({ term: null, path: null }))).toBe(false)
  })
})

test('the account’s list is read, and a row that does not read is left out', () => {
  expect(
    listOf({
      terms: [
        { ...listed(), typing: 'owner' },
        { term: null, session: 's_2', alive: null },
        { term: 'note-3' },
      ],
    }),
  ).toEqual([
    listed(),
    {
      term: null,
      session: 's_2',
      createdAt: null,
      space: null,
      path: null,
      trashed: false,
      program: null,
      title: null,
      alive: null,
      at: null,
    },
  ])
  expect(listOf(null)).toEqual([])
})
