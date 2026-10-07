/** Quick add's entry, the app's half: what a view's add button already knows. The
 *  entry itself, its line and where it goes in a note are the engine's, shared with
 *  every other way a task comes in (@nib/bases/tasks, agent/entry.ts there). */

export { type Entry, linesOf, placeIn } from '@nib/bases/tasks'

/** What a view's add button already knows: its note, its tag, its day. A task typed
 *  there lands where the view is looking, unless the words say otherwise. A chat's
 *  message made a task brings its words and a link back to it as the description
 *  (docs/chats.md 4.13). */
export interface Prefill {
  note?: string
  tags?: string[]
  due?: string
  text?: string
  description?: string
}
