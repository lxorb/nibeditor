/** What a key pressed on a row of a view does (docs/tasks.md 5.16): Todoist's keys,
 *  read the same in every layout that has rows.
 *
 *    ↑ ↓                  the row above, the row below
 *    Enter, Space         the note at the line, beside the view (Ctrl: in a tab)
 *    Ctrl+Enter           tick
 *    T, Shift+T, Shift+M  due today, tomorrow, next Monday
 *    1 2 3 4              priority
 *    Alt+↑ Alt+↓          up or down among its siblings in the note
 *    Tab, Shift+Tab       a sub-task of the one above, or lifted out
 *    Q                    add a task here
 *
 *  Pure: a keystroke in, an action out, and the layout does it. */

export type RowKey =
  | { kind: 'step'; by: number }
  | { kind: 'open'; tab: boolean }
  | { kind: 'tick' }
  | { kind: 'due'; when: 'today' | 'tomorrow' | 'monday' }
  | { kind: 'priority'; priority: 1 | 2 | 3 | 4 }
  | { kind: 'move'; up: boolean }
  | { kind: 'indent'; deeper: boolean }
  | { kind: 'add' }

interface Press {
  key: string
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

/** The action a key on a row asks for, or null for a key that is not one of these. */
export function rowKey(press: Press, mac: boolean): RowKey | null {
  const mod = mac ? press.metaKey : press.ctrlKey
  const other = mac ? press.ctrlKey : press.metaKey
  if (other) return null

  if (press.altKey) {
    if (mod || press.shiftKey) return null
    if (press.key === 'ArrowUp') return { kind: 'move', up: true }
    if (press.key === 'ArrowDown') return { kind: 'move', up: false }
    return null
  }

  if (press.key === 'Enter') return mod ? { kind: 'tick' } : { kind: 'open', tab: false }
  if (mod) return null

  switch (press.key) {
    case 'ArrowUp':
      return { kind: 'step', by: -1 }
    case 'ArrowDown':
      return { kind: 'step', by: 1 }
    case ' ':
      return { kind: 'open', tab: false }
    case 'Tab':
      return { kind: 'indent', deeper: !press.shiftKey }
    case 't':
      return { kind: 'due', when: 'today' }
    case 'T':
      return { kind: 'due', when: 'tomorrow' }
    case 'M':
      return { kind: 'due', when: 'monday' }
    case 'q':
    case 'Q':
      return press.shiftKey ? null : { kind: 'add' }
    default: {
      const priority = PRIORITY_KEYS[press.key]
      return priority === undefined || press.shiftKey ? null : { kind: 'priority', priority }
    }
  }
}

const PRIORITY_KEYS: Partial<Record<string, 1 | 2 | 3 | 4>> = { 1: 1, 2: 2, 3: 3, 4: 4 }
