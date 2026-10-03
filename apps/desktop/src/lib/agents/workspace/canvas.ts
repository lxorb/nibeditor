/** Canvases and page notes: `read_canvas` and `edit_canvas` (docs/agent-native.md 8.7).
 *
 *  A canvas is JSON Canvas, and that is what an agent reads: its cards with their ids,
 *  words and places, and the connections between them. A stroke of ink is thousands of
 *  points nobody can read, so the ink is said as how many strokes there are.
 *
 *  An edit is operations on objects by id - add a card, change its words, move it,
 *  connect two, remove one - made with the surface's own edits (canvas/edits.ts), so
 *  it touches exactly the objects it names and nothing else. Where it goes decides how
 *  it meets the reader's drawing:
 *
 *  - a plane on screen: one edit of the surface itself, made in the same breath as it
 *    is worked out, so whatever the reader drew a moment before is in what it is worked
 *    out from; one step for Ctrl+Z like any gesture, and into the room's Yjs document
 *    through the room's binding when the plane is in one (rooms/plane-bind.ts), where
 *    it merges with every other device object by object;
 *  - a canvas open but not drawn, or closed, or drawn in a tab and never saved: the file's words, stamped, and merged with
 *    whatever the file says by the time it is written, by the same object-by-object
 *    merge two devices' copies get (canvas-merge.ts), so a change that landed while the
 *    agent was working is kept rather than written over. */

import type { AgentAnswer } from '../../automation/caller'
import { type Canvas, merged, readCanvas as parse, stamped, writeCanvas } from '../../canvas/format'
import { canWriteAt } from '../../sharing.svelte'
import { invoke } from '../../tauri'
import { writeFile } from '../../workspace/write-file'
import { workspace } from '../../workspace.svelte'
import { isCanvasTarget, isPagesTarget } from '@nib/markdown/links'
import type { NoteDoc } from '../../workspace/documents.svelte'
import { asked } from './asks'
import { applied, readable } from './canvas-ops'
import { type Call, done, maybe, need } from './call'
import { readablePages } from './pages-ops'
import { Refused } from './problem'
import { namedTab } from './tab-target'
import { judged, judgedForWriting, onDisk, type Place, placeFor, sharedSource } from './spaces'

/** A canvas a call names: a `.canvas` or `.pages` file of a space it may reach, by its
 *  path, or by `tab` - which also reaches one drawn in a tab and not saved yet. */
interface Target {
  place: Place
  /** Its path in the space, or the empty string for one with no file. */
  relative: string
  /** Where it is on this disk; null for one with no file. */
  path: string | null
  /** The document of one with no file, which only its tab holds. */
  draft: NoteDoc | null
}

function canvasOf(call: Call, writing: boolean): Target {
  if (maybe(call, 'tab') !== null) return canvasInTab(call, writing)

  const place = placeFor(call, maybe(call, 'space'))
  const asked = need(call, 'path')
  const relative = writing ? judgedForWriting(asked) : judged(asked)
  if (!isCanvasTarget(relative) && !isPagesTarget(relative)) {
    throw new Refused('bad_arguments', `${relative} is not a canvas or a page note`)
  }

  const path = onDisk(place, relative)
  if (writing && !canWriteAt(path)) {
    throw new Refused('read_only', `${place.space.name} is shared with you to read`)
  }

  return { place, relative, path, draft: null }
}

/** The canvas or page note in a tab: by its file when it has one, as though the path
 *  had been said, and otherwise the document the tab holds. */
function canvasInTab(call: Call, writing: boolean): Target {
  const { tab, place, relative } = namedTab(call, ['canvas', 'pages'], 'a canvas or page note')
  if (relative !== null) {
    return canvasOf({ ...call, args: { ...call.args, tab: null, path: relative } }, writing)
  }
  if (tab.path !== null) throw new Refused('by_hand', `tab ${tab.id} is outside every space`)
  if (tab.note.shared !== null) {
    throw new Refused('by_hand', `tab ${tab.id} is a canvas somebody shared, kept by its room`)
  }

  return { place, relative: '', path: null, draft: tab.note }
}

/** The document a canvas is open as: its tab's for one with no file. */
function openAs(target: Target): NoteDoc | null {
  return target.draft ?? (target.path === null ? null : workspace.documentAt(target.path))
}

/** The plane on screen for a canvas, when there is one. Fetched with the first canvas
 *  question: the store is a surface's worth of code. */
async function drawnAt(target: Target) {
  const open = openAs(target)
  if (!open) return null

  const { CanvasStore } = await import('../../canvas/store.svelte')
  return CanvasStore.drawing(open, workspace.tabs)
}

/** The canvas as it stands: the plane on screen, the open document's words, or the
 *  file's. */
async function canvasAt(target: Target): Promise<Canvas> {
  const drawn = await drawnAt(target)
  if (drawn) return drawn.canvas

  const open = openAs(target)
  if (open) {
    open.flush()
    return parse(open.text)
  }

  const words =
    target.path === null
      ? null
      : await invoke<string>('read_note', { path: target.path }).catch(() => null)
  if (words === null) throw new Refused('no_such_file', 'there is no canvas there')

  return parse(words)
}

/** Whose page note it is: a `.pages` file, or a page note in a tab. */
function isPages(target: Target): boolean {
  return target.draft ? target.draft.kind === 'pages' : isPagesTarget(target.relative)
}

/** What a target is called in an answer and a question. */
function nameOf(target: Target, call: Call): string {
  return target.relative || `tab ${maybe(call, 'tab') ?? ''}`
}

export async function readCanvas(call: Call): Promise<AgentAnswer> {
  const target = canvasOf(call, false)
  const canvas = await canvasAt(target)
  const read = isPages(target) ? readablePages(canvas) : readable(canvas)
  return done({ path: target.relative, ...read }, sharedSource(target.place))
}

export async function editCanvas(call: Call): Promise<AgentAnswer> {
  const target = canvasOf(call, true)
  // Worked out once against the canvas as it stands, to refuse what cannot be done
  // before the reader is asked anything.
  applied(await canvasAt(target), call.args.ops)

  const named = nameOf(target, call)
  const question = await asked(call, null, `Edit the canvas ${named} in ${target.place.space.name}`)
  if (question) return question

  const made = await edited(target, call.args.ops, call.caller.agent?.name)
  return done({ path: target.relative, made })
}

/** The operations into the canvas where it is, worked out against what it holds at
 *  that moment; see the top of this file. Answers the ids of what they made. */
async function edited(target: Target, ops: unknown, source: string | undefined): Promise<string[]> {
  const drawn = await drawnAt(target)
  if (drawn) {
    const done = applied(drawn.canvas, ops)
    drawn.edit(done.canvas)
    return done.made
  }

  const open = openAs(target)
  if (open) {
    open.flush()
    const before = parse(open.text)
    const done = applied(before, ops)
    open.replace(writeCanvas(stamped(before, done.canvas, Date.now())))
    return done.made
  }

  const path = target.path
  if (path === null) throw new Refused('no_such_file', 'there is no canvas there')
  const was = await invoke<string>('read_note', { path })
  const before = parse(was)
  const done = applied(before, ops)
  const mine = stamped(before, done.canvas, Date.now())

  // Whatever landed in the file while this was being worked out is kept beside it.
  const now = await invoke<string>('read_note', { path }).catch(() => was)
  const kept = now === was ? mine : merged(mine, parse(now))

  await invoke('snapshot_note', { path, content: now, source }).catch(() => undefined)
  await writeFile(path, writeCanvas(kept))
  return done.made
}
