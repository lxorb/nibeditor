import { beforeEach, describe, expect, test, vi } from 'vitest'

/** A tab's own menu, read as labels. The store reads storage the moment it is
 *  made, so that is stood in for before it is imported. */

function memoryStorage(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}
vi.stubGlobal('localStorage', memoryStorage())

const { tabMenu } = await import('./menu')
const { workspace } = await import('../workspace.svelte')
type Tab = import('../workspace.svelte').Tab

/** Only what the menu reads of a tab. */
function tab(path: string | null, kind: Tab['kind'] = 'note'): Tab {
  // A stand-in, because a real tab is built round a document read off a disk.
  return { id: 'one', path, kind, pinned: false, reading: false } as Tab
}

function labels(one: Tab): string[] {
  return tabMenu(one, workspace.panes.focusedId).flatMap((row) => (row ? [row.label] : []))
}

beforeEach(() => {
  workspace.spaces = [{ id: 's', name: 'Notes', root: '/s' }]
  workspace.activeSpaceId = 's'
})

describe('Show in the file list', () => {
  test('is offered for a file that has a row', () => {
    expect(labels(tab('/s/work/plan.md'))).toContain('Show in the file list')
  })

  test('and not for one that has none', () => {
    expect(labels(tab('/elsewhere/plan.md'))).not.toContain('Show in the file list')
    expect(labels(tab(null, 'graph'))).not.toContain('Show in the file list')
  })
})
