/** Where a view's base comes from and where a change to it goes, for each of the four
 *  places a view stands:
 *
 *  - a built-in view in a tab (Today, a project): the base nib ships, or the one the
 *    tab changed it into, kept in the tab's words (spec.ts);
 *  - a `.base` file in a tab, or embedded with `![[Bugs.base#Board]]`: the file, read
 *    and written back with every key nib does not know kept (`writeBase`), through
 *    the same write a note takes, so a change is one undo;
 *  - a ` ```base ` fence: the fence's own words in the note it stands in.
 *
 *  Each answers a `Source` (live.svelte.ts), so the view on screen never knows which. */

import { type Base, builtinView, readBase, type Row, writeBase } from '@nib/bases'
import { links } from '../link-index.svelte'
import { rows } from '../rows/rows.svelte'
import { insideSpace, samePath, within } from '../space-paths'
import { workspace } from '../workspace.svelte'
import type { Tab } from '../workspace/documents.svelte'
import { noteText, writeNoteText } from '../workspace/note-text'
import type { Source } from './live.svelte'
import { readSpec, type ViewSpec, writeSpec } from './spec'

/** The base a built-in spec asks for: as the tab changed it, else as nib ships it. */
export function builtinBase(spec: ViewSpec): Base {
  if (spec.yaml !== undefined) return readBase(spec.yaml)
  switch (spec.builtin) {
    case 'project':
      return builtinView('project', {
        note: { space: spec.space ?? '', path: spec.path ?? '' },
      })
    case 'label':
      return builtinView('label', { tag: spec.tag ?? '' })
    case 'inbox':
      return builtinView('inbox', { inboxes: rows.inboxes() })
    case 'today':
    case 'upcoming':
    case 'logbook':
      return builtinView(spec.builtin)
    case undefined:
      return builtinView('today')
  }
  return builtinView('today')
}

/** The space a path on this disk is in, by name. */
function spaceOf(path: string): { name: string; root: string } | null {
  return workspace.spaces.find((one) => within(one.root, path, one.root) !== null) ?? null
}

/** The note row at a path on this disk, for `this`. */
export function rowAt(path: string | null): Row | undefined {
  if (path === null) return undefined
  return rows.at(path).find((one) => one.kind === 'note')
}

/** What a file says now: the open document's words where it is open, else the disk. */
async function fileText(path: string): Promise<string> {
  const text = await noteText(workspace, path)
  if (text === null) throw new Error('no such base')
  return text
}

/** A base file heard being written by anyone, the view's own writes included. */
function watchFile(path: string) {
  return (changed: () => void) =>
    links.hearSaves((saved) => {
      if (samePath(saved, path)) changed()
    })
}

/** A base file, read and written back. */
export function fileSource(path: string, view?: string, self?: () => Row | undefined): Source {
  let before = ''
  return {
    scope: spaceOf(path)?.name ?? null,
    view,
    ...(self ? { self } : {}),
    async load() {
      before = await fileText(path)
      return readBase(before)
    },
    async save(next) {
      const now = await fileText(path).catch(() => before)
      const after = writeBase(next, now)
      if (after === now) return
      await writeNoteText(workspace, path, now, after)
      before = after
    },
    watch: watchFile(path),
  }
}

/** A built-in view in a tab: what it changes is kept in the tab's words, and is the
 *  tab's own until "Copy to a base" writes it to a file. */
export function tabSource(tab: Tab): Source {
  const spec = () => readSpec(tab.doc) ?? {}
  return {
    scope: null,
    load: () => Promise.resolve(builtinBase(spec())),
    save(next) {
      tab.note.replace(writeSpec({ ...spec(), yaml: writeBase(next) }), false)
      workspace.scheduleSession()
      return Promise.resolve()
    },
  }
}

/** The fence a base came from, found again in its note: the first ` ```base ` fence
 *  holding exactly these words. */
function fenceAt(text: string, code: string): { from: number; to: number } | null {
  const fences = /^(`{3,}|~{3,})base[ \t]*\r?\n([\s\S]*?)^\1[ \t]*$/gm
  for (let found = fences.exec(text); found; found = fences.exec(text)) {
    const body = found[2] ?? ''
    if (body.replace(/\r?\n$/, '') === code.replace(/\r?\n$/, '')) {
      const from = found.index + found[0].indexOf(body)
      return { from, to: from + body.length }
    }
  }
  return null
}

/** A ` ```base ` fence in a note at `path` (on this disk; null for a note with no
 *  file). Its changes are written into the fence, so the note is the base. */
export function fenceSource(code: string, path: string | null): Source {
  let words = code
  const space = path === null ? workspace.activeSpace : spaceOf(path)
  return {
    scope: space?.name ?? null,
    self: () => rowAt(path),
    load: () => Promise.resolve(readBase(words)),
    async save(next) {
      if (path === null) return
      const text = await noteText(workspace, path)
      if (text === null) return
      const at = fenceAt(text, words)
      if (!at) return
      const written = writeBase(next, words)
      const after =
        text.slice(0, at.from) +
        (written.endsWith('\n') ? written : `${written}\n`) +
        text.slice(at.to)
      await writeNoteText(workspace, path, text, after)
      words = written
    },
  }
}

/** Where a base file an embed names is on this disk, resolved the way a link to a file
 *  is (the link index's `targetOf`); null where the space has no such file. */
export function embeddedPath(target: string, from: string | null): string | null {
  const root = workspace.activeSpace?.root
  if (root === undefined) return null
  const plain = target.split('#')[0] ?? target
  const found = links.targetOf(from, { kind: 'wikilink', target: plain })
  return found === null ? null : insideSpace(root, found)
}
