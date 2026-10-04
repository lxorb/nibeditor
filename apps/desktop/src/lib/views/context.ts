/** What a view's expressions are answered against beyond the row: today, now, `this`,
 *  the words typed into its search, and the three questions about other files an
 *  expression may ask (a link resolved, the note at a path, the notes linking here).
 *
 *  All of it out of the rows a view already has in hand, so answering a view reads no
 *  file. The lookups are built the first time an expression asks one of them and not
 *  at all for a view that never does, which is nearly every task view. */

import type { Context, Row } from '@nib/bases'

interface Lookups {
  byPath: Map<string, Row>
  byName: Map<string, Row>
  linking: Map<string, string[]>
}

/** A link target as the name it is resolved by: no folder, no `.md`, any case. */
function nameOf(target: string): string {
  return (target.split('/').pop() ?? target).replace(/\.md$/i, '').toLowerCase()
}

const keyOf = (space: string, path: string) => `${space}\n${path}`

function lookups(rows: readonly Row[]): Lookups {
  const byPath = new Map<string, Row>()
  const byName = new Map<string, Row>()
  const linking = new Map<string, string[]>()

  for (const row of rows) {
    if (row.kind !== 'note') continue
    byPath.set(keyOf(row.space, row.path), row)
    const name = keyOf(row.space, nameOf(row.path))
    if (!byName.has(name)) byName.set(name, row)
  }
  for (const row of rows) {
    if (row.kind !== 'note') continue
    for (const target of row.file.links) {
      const found = byName.get(keyOf(row.space, nameOf(target.split('#')[0] ?? target)))
      if (!found) continue
      const key = keyOf(found.space, found.path)
      linking.set(key, [...(linking.get(key) ?? []), row.path])
    }
  }
  return { byPath, byName, linking }
}

export interface ContextStart {
  rows: readonly Row[]
  today: string
  now: string
  this?: Row | undefined
  search?: string
  me?: string | undefined
}

/** The context a view is answered in. */
export function contextFor(start: ContextStart): Context {
  let made: Lookups | null = null
  const look = () => (made ??= lookups(start.rows))

  const context: Context = {
    today: start.today,
    now: start.now,
    resolve: (target, from) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null
      const found = look().byName.get(keyOf(from.space, nameOf(target.split('#')[0] ?? target)))
      return found?.path ?? null
    },
    row: (path, space) => look().byPath.get(keyOf(space, path)),
    backlinks: (row) => look().linking.get(keyOf(row.space, row.path)) ?? [],
  }
  if (start.this) context.this = start.this
  if (start.search) context.search = start.search
  if (start.me) context.me = start.me
  return context
}
