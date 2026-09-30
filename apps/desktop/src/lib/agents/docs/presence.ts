/** Where an agent is in a note: a caret, the way a collaborator's is.
 *
 *  The room's own caret (`packages/editor/src/carets.ts`) given a peer the window
 *  makes up for the agent: its name on the flag, an accent of its own, at the place
 *  it last wrote. It goes by itself three seconds after the agent last wrote - the
 *  fade is the caret's own animation, and the peer is taken away when it has run -
 *  because an agent is somewhere only while it is writing. Nothing of a room is
 *  needed: the list goes to every view of the document, held tabs included, the way
 *  a room's does. See docs/agent-native.md 8.4.
 *
 *  The places are carried through every change while a caret is shown, so a caret
 *  put back into the list when another agent's moves is where its agent left it
 *  rather than where the words were three seconds ago. */

import { type Peer, setAgents } from '@nib/editor'
import { accentColour, accentFor } from '../../accents'
import type { NoteDoc } from '../../workspace/documents.svelte'

/** Who is writing, as far as a caret is concerned: the grant's id, its name, and the
 *  accent it chose when it has one. */
export interface Agent {
  id: string
  name: string
  accent?: string
}

/** How long a caret stays after its agent last wrote. The caret's own fade runs to
 *  the end of this; see AGENT_SHOWN in carets.ts. */
export const SHOWN_FOR = 3500

interface Shown {
  peer: Peer
  timer: ReturnType<typeof setTimeout>
}

interface Note {
  carets: Map<string, Shown>
  stop: () => void
}

const shown = new Map<NoteDoc, Note>()

/** A peer's number, which only has to tell carets apart: below zero, where no
 *  room's client ever is. */
function numberOf(id: string): number {
  let sum = 7
  for (const character of id) sum = (sum * 31 + (character.codePointAt(0) ?? 0)) % 1_000_003
  return -1 - sum
}

/** The agent's caret, at `at`, in a note it has just written in. */
export function showAgent(note: NoteDoc, agent: Agent, at: number, scheme: 'dark' | 'light'): void {
  const here = shown.get(note) ?? follow(note)
  const was = here.carets.get(agent.id)
  if (was) clearTimeout(was.timer)

  here.carets.set(agent.id, {
    peer: {
      id: numberOf(agent.id),
      name: agent.name,
      colour: agent.accent ? accentColour(agent.accent, scheme) : accentFor(agent.name, scheme),
      head: at,
      anchor: at,
    },
    timer: setTimeout(() => {
      gone(note, agent.id)
    }, SHOWN_FOR),
  })

  announce(note, here)
  // And every tab showing the note wears the agent's mark while it writes, which is
  // how a note the reader is not looking at says so (8.4); see lib/agents/ui.
  void import('../ui/index').then(({ wrote }) => wrote(note, agent.id))
}

/** Starts carrying a note's carets through its changes. */
function follow(note: NoteDoc): Note {
  const here: Note = {
    carets: new Map(),
    stop: note.live.listen(({ changes, by }) => {
      if (by === 'switch') {
        note.live.announce([setAgents.of([])])
        forget(note)
        return
      }

      for (const one of here.carets.values()) {
        const head = changes.mapPos(one.peer.head)
        one.peer = { ...one.peer, head, anchor: head }
      }
    }),
  }

  shown.set(note, here)
  return here
}

function gone(note: NoteDoc, agent: string) {
  const here = shown.get(note)
  if (!here) return

  here.carets.delete(agent)
  announce(note, here)
  if (!here.carets.size) forget(note)
}

function forget(note: NoteDoc) {
  const here = shown.get(note)
  if (!here) return

  for (const one of here.carets.values()) clearTimeout(one.timer)
  here.stop()
  shown.delete(note)
}

function announce(note: NoteDoc, here: Note) {
  note.live.announce([setAgents.of([...here.carets.values()].map((one) => one.peer))])
}
