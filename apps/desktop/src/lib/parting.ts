/** What has to be written down before the window goes.
 *
 *  Several things in the app write their file once the hand has stopped rather than
 *  on the stroke or the letter itself, because writing it costs the size of the
 *  thing: a plane is serialised whole, and every space's graph settings are. A window
 *  closing runs no effect's teardown, so nothing would ever reach those timers, and
 *  a note's own write waits for a pause the same way - so the words would never
 *  reach the disk.
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
 *  its document, and the document is what its write takes down. One list would leave
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

/** What has to reach the account rather than the disk before the window goes: a web
 *  login this computer holds, handed back so the next computer starts from where this
 *  one left it (web-tab/lease.svelte.ts). Whether it owes anything is asked at once,
 *  because the close handler decides whether to wait before it can wait; the sending is
 *  waited for, as long as `HANDS_BACK_WITHIN`. */
interface HandsBack {
  owes(): boolean
  send(): Promise<void>
}

const handing = new Set<HandsBack>()

/** Said once by whatever holds something to hand back. */
export function handsBack(one: HandsBack): void {
  handing.add(one)
}

/** Whether anything is owed to the account. */
export function handingBack(): boolean {
  return [...handing].some((one) => one.owes())
}

/** Everything owed to the account, sent. */
export async function handBack(): Promise<void> {
  await Promise.all([...handing].map((one) => one.send().catch(() => undefined)))
}
