/** What the launch reads first, handed out to whatever would have asked for it.
 *
 *  The crate reads the spaces, the tree of the space the window was left in and the
 *  notes that were open while the webview starts, and src/early.ts asks for all of it
 *  the moment the page arrives; see src-tauri/src/ahead.rs. Here each answer goes to
 *  the one caller that would have asked the same question - the listing of the
 *  spaces, the tree read with the same options, a note read at the same path - once,
 *  and to nobody after that: a second read is a read of the disk as it is then. What
 *  no question took by the time the index starts is let go.
 *
 *  And the other half: what the next launch will ask for first, written down for the
 *  crate as it changes (`plan`), which is how the crate knows what to read. */

import { sameSpelling } from '../space-paths'
import { isRecord, isString } from '../stored'
import { invoke, isDesktop } from '../tauri'
import type { Entry, TreeOptions } from '../workspace.svelte'

/** What the next launch will ask for first. */
export interface Plan {
  root: string | null
  options: TreeOptions
  /** The notes it will read, the one in front first. */
  notes: string[]
}

/** What the crate read, as the page received it. */
interface Answer {
  plan: Plan
  spaces: { name: string; path: string }[] | null
  tree: Entry | null
  notes: Map<string, string>
}

/** The answer as it crossed the bridge, checked into its shape. The crate is the
 *  other half of this repository and its tree and listing are the same shapes the
 *  commands answer with, which are trusted as they are everywhere else; the rest is
 *  looked at, because a plan is something the page wrote and read back. */
function answerOf(value: unknown): Answer | null {
  if (!isRecord(value) || !isRecord(value.plan)) return null

  const { root, options, notes } = value.plan
  const words = isRecord(value.notes) ? value.notes : {}

  return {
    plan: {
      root: isString(root) ? root : null,
      options: { showHidden: isRecord(options) && options.showHidden === true },
      notes: Array.isArray(notes) ? notes.filter(isString) : [],
    },
    spaces: Array.isArray(value.spaces) ? (value.spaces as Answer['spaces']) : null,
    tree: isRecord(value.tree) ? (value.tree as unknown as Entry) : null,
    notes: new Map(
      Object.entries(words).flatMap(([path, text]) => (isString(text) ? [[path, text]] : [])),
    ),
  }
}

let answer: Promise<Answer | null> | null = null

/** The answer, once src/early.ts has it; null where nothing was asked. */
function received(): Promise<Answer | null> {
  answer ??= Promise.resolve(
    (window as unknown as { nibEarly?: Promise<unknown> }).nibEarly ?? null,
  ).then(answerOf, () => null)
  return answer
}

/** Nothing outside a window: the tests and the browser build ask for themselves. */
const asked = () => typeof window !== 'undefined' && isDesktop

/** The spaces, as `list_spaces` answers, the first time they are listed. */
export async function spacesAhead(): Promise<{ name: string; path: string }[] | null> {
  if (!asked()) return null

  const got = await received()
  const spaces = got?.spaces ?? null
  if (got) got.spaces = null
  return spaces
}

/** A space's tree, as `read_tree` answers, if it is the one read ahead with these
 *  options. */
export async function treeAhead(root: string, options: TreeOptions): Promise<Entry | null> {
  if (!asked()) return null

  const got = await received()
  // Spelled alike, and not merely the same folder: every path in the tree is spelled
  // the way the root it was read from is.
  const read = got?.plan.root
  if (!got?.tree || !read || !sameSpelling(read, root)) return null
  if (got.plan.options.showHidden !== options.showHidden) return null

  const tree = got.tree
  got.tree = null
  return tree
}

/** A note's words, as `read_note` answers, if they were read ahead; taken, so the
 *  next read of the same note is the disk's. */
export async function noteAhead(path: string): Promise<string | null> {
  if (!asked()) return null

  const got = await received()
  const words = got?.notes.get(path) ?? null
  got?.notes.delete(path)
  return words
}

/** The same words, left for the read that takes them: for a question about the note
 *  that is not its reading, such as whether a first screen kept of it is still it. */
export async function noteAheadPeek(path: string): Promise<string | null> {
  if (!asked()) return null
  return (await received())?.notes.get(path) ?? null
}

/** Everything no question took. Called once the launch is past its reads. */
export function forgetAhead(): void {
  answer = Promise.resolve(null)
}

/** What was last written down for the crate, so an unchanged plan is not written again. */
let written = ''

/** Writes down what the next launch will ask for first, when that has changed. */
export function plan(next: Plan): void {
  if (!asked()) return

  const said = JSON.stringify(next)
  if (said === written) return
  written = said
  invoke('remember_launch', { plan: next }).catch(() => {
    // A launch that cannot read ahead reads as it always did; the next change tries
    // again.
    written = ''
  })
}
