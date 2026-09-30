/** Which agents have edits of their own to take back in which notes, this session.
 *
 *  What the palette's "Undo edits by" rows and the activity panel read: a note in
 *  front with an agent's edits in it offers taking them back, one row per agent.
 *  Its own small module, apart from everything that does the editing, so the palette
 *  can ask without bringing that in; see `agentUndoRows` in commands.ts. Kept by
 *  path, and for the session only: the undo it offers is of edits made since the app
 *  opened. */

import { SvelteMap } from 'svelte/reactivity'

/** An agent with edits to take back in a note: who, and how many. */
export interface Touched {
  id: string
  name: string
  edits: number
}

const byNote = new SvelteMap<string, readonly Touched[]>()

/** The agents with edits to take back in the note at `path`, in the order they
 *  first wrote in it. */
export function touchedBy(path: string | null | undefined): readonly Touched[] {
  return path ? (byNote.get(path) ?? []) : []
}

/** How many edits one agent has to take back in one note now. */
export function touch(path: string, agent: { id: string; name: string }, edits: number): void {
  const others = (byNote.get(path) ?? []).filter((one) => one.id !== agent.id)
  const was = byNote.get(path)?.findIndex((one) => one.id === agent.id) ?? -1
  const now: Touched[] = [...others]
  if (edits > 0) now.splice(was === -1 ? now.length : was, 0, { ...agent, edits })

  if (now.length) byNote.set(path, now)
  else byNote.delete(path)
}
