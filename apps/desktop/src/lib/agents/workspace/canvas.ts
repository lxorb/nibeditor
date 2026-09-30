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
 *  - a canvas open but not drawn, or closed: the file's words, stamped, and merged with
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
import { asked } from './asks'
import { applied, readable } from './canvas-ops'
import { type Call, done, maybe, need } from './call'
import { Refused } from './problem'
import { judged, judgedForWriting, onDisk, type Place, placeFor, sharedSource } from './spaces'

/** The canvas a call names: a `.canvas` or a `.pages` file of a space it may reach. */
function canvasOf(call: Call, writing: boolean): { place: Place; relative: string; path: string } {
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

  return { place, relative, path }
}

/** The plane on screen for a path, when there is one. Fetched with the first canvas
 *  question: the store is a surface's worth of code. */
async function drawnAt(path: string) {
  const open = workspace.documentAt(path)
  if (!open) return null

  const { CanvasStore } = await import('../../canvas/store.svelte')
  return CanvasStore.drawing(open, workspace.tabs)
}

/** The canvas as it stands: the plane on screen, the open document's words, or the
 *  file's. */
async function canvasAt(path: string): Promise<Canvas> {
  const drawn = await drawnAt(path)
  if (drawn) return drawn.canvas

  const open = workspace.documentAt(path)
  if (open) {
    open.flush()
    return parse(open.text)
  }

  const words = await invoke<string>('read_note', { path }).catch(() => null)
  if (words === null) throw new Refused('no_such_file', 'there is no canvas there')

  return parse(words)
}

export async function readCanvas(call: Call): Promise<AgentAnswer> {
  const { place, relative, path } = canvasOf(call, false)
  return done({ path: relative, ...readable(await canvasAt(path)) }, sharedSource(place))
}

export async function editCanvas(call: Call): Promise<AgentAnswer> {
  const { relative, path, place } = canvasOf(call, true)
  // Worked out once against the canvas as it stands, to refuse what cannot be done
  // before the reader is asked anything.
  applied(await canvasAt(path), call.args.ops)

  const question = await asked(call, null, `Edit the canvas ${relative} in ${place.space.name}`)
  if (question) return question

  const made = await edited(path, call.args.ops, call.caller.agent?.name)
  return done({ path: relative, made })
}

/** The operations into the canvas where it is, worked out against what it holds at
 *  that moment; see the top of this file. Answers the ids of what they made. */
async function edited(path: string, ops: unknown, source: string | undefined): Promise<string[]> {
  const drawn = await drawnAt(path)
  if (drawn) {
    const done = applied(drawn.canvas, ops)
    drawn.edit(done.canvas)
    return done.made
  }

  const open = workspace.documentAt(path)
  if (open) {
    open.flush()
    const before = parse(open.text)
    const done = applied(before, ops)
    open.replace(writeCanvas(stamped(before, done.canvas, Date.now())))
    return done.made
  }

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
