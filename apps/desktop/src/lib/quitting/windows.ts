/** The other windows' rows, and a row in another window shown.
 *
 *  Quitting stops every window's shells at once, so the one question lists them all, as
 *  Chrome's "Close N tabs?" counts every window's. The windows share an origin, so they
 *  talk over a broadcast channel, the way the presenter's window hears its deck: the
 *  window asking says `ask`, each other one answers with its rows, and the question waits
 *  for every window the crate names (`quit_others`), or `WAITS` at most - a window that
 *  is busy loading is not a quit that never comes. */

import { invoke } from '../tauri'
import { waited } from '../timing'
import { jump } from './jump'
import { type Row, rowsHere } from './rows'

const CHANNEL = 'nib:quitting'

/** How long the question waits for the other windows' rows. */
const WAITS = 800

type Message =
  | { kind: 'ask'; asking: string; idle: boolean }
  | { kind: 'said'; asking: string; window: string; rows: Row[] }
  | { kind: 'show'; row: Row }

/** This window's label, once it answers others; see `answer`. */
let own = ''

/** Every window's rows: this one's, and each other's as they arrive. */
export async function rowsEverywhere(window: string, idle: boolean): Promise<Row[]> {
  const others = await invoke<string[]>('quit_others').catch(() => [])
  if (!others.length) return rowsHere(window, idle)

  const channel = new BroadcastChannel(CHANNEL)
  const asking = crypto.randomUUID()
  const heard = new Map<string, Row[]>()
  const all = new Promise<void>((resolve) => {
    channel.onmessage = ({ data }: MessageEvent<Message>) => {
      if (data.kind !== 'said' || data.asking !== asking) return
      heard.set(data.window, data.rows)
      if (others.every((one) => heard.has(one))) resolve()
    }
  })
  channel.postMessage({ kind: 'ask', asking, idle } satisfies Message)

  const [here] = await Promise.all([rowsHere(window, idle), Promise.race([all, waited(WAITS)])])
  channel.close()
  return [...here, ...others.flatMap((one) => heard.get(one) ?? [])]
}

/** A row of another window's brought forward there. */
export function showElsewhere(row: Row) {
  const channel = new BroadcastChannel(CHANNEL)
  channel.postMessage({ kind: 'show', row } satisfies Message)
  channel.close()
}

/** This window answers the others' questions from now on. */
export function answer(window: string) {
  own = window
  const channel = new BroadcastChannel(CHANNEL)
  channel.onmessage = ({ data }: MessageEvent<Message>) => {
    if (data.kind === 'ask') {
      void rowsHere(own, data.idle).then((rows) =>
        channel.postMessage({
          kind: 'said',
          asking: data.asking,
          window: own,
          rows,
        } satisfies Message),
      )
    } else if (data.kind === 'show' && data.row.window === own) {
      void jump(data.row)
      void invoke('raise_window', { label: own })
    }
  }
}
