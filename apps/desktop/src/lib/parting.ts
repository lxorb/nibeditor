/** What has to be written down before the window goes.
 *
 *  Several things in the app write their file once the hand has stopped rather than
 *  on the stroke or the letter itself, because writing it costs the size of the
 *  thing: a plane is serialised whole, and every space's graph settings are. A window
 *  closing runs no effect's teardown, so nothing would ever reach those timers, and
 *  until the write has happened the document is not one the workspace knows is
 *  unsaved either - so the window would not even ask.
 *
 *  A register rather than a list of calls in start.ts, because the launch must not
 *  have to load a thing in order to call one function on it on the way out. Reaching
 *  for the canvas store from there put the whole ink engine in front of the first
 *  paint. Whatever is on screen has loaded itself; this is where it says it owes a
 *  write.
 *
 *  Nothing here is a place to put work. A window is going: what runs is the writes
 *  that were already due. */

const owing = new Set<() => void>()

/** The writes that have to happen after all of the others.
 *
 *  Turning what is on screen into words and putting those words on the disk are two
 *  writes, and the second cannot run before the first: a plane serialises itself into
 *  its document, and the document is what the save writes out. One list would leave
 *  that to the order the modules happened to load in, which is the order the reader
 *  happened to open things in. */
const lastly = new Set<() => void>()

/** Said once by whoever owes a write, when its module is first loaded. */
export function owes(write: () => void): void {
  owing.add(write)
}

/** The same, for a write that has to come after those: see `lastly`. */
export function owesLast(write: () => void): void {
  lastly.add(write)
}

/** Everything owing, written now. Called where the window is going; see `onClose`
 *  in start.ts. */
export function settleUp(): void {
  for (const write of owing) write()
  for (const write of lastly) write()
}
