/** The browser build's search, off the writing thread.
 *
 *  Reading a space of notes and scoring every line of them is work measured in
 *  hundreds of milliseconds, and on the page's own thread every one of those is
 *  a keystroke that does not appear. So it happens here: the worker opens the
 *  same storage the page does, reads the space once, and answers every question
 *  after that from what it is holding.
 *
 *  Three things arrive here. A search, which is answered in handfuls as it is
 *  found. A space to warm, which is the launch saying the file list is up and the
 *  index has had its turn. And a row that has been written, straight from the
 *  store on the page's side, which is what keeps what is held the same as what is
 *  on disk without anything having to remember to say so; see `watchRows` in
 *  store.ts.
 *
 *  Nothing but the walk lives here. See search.ts for it, space-cache.ts for what
 *  is held, and search-client.ts for the side of the conversation the app holds. */

import { searchRows } from './search'
import { type Answer, isAsk, isWarm } from './search-protocol'
import { space } from './space-cache'
import { watchRows } from './store'

function post(answer: Answer) {
  self.postMessage(answer)
}

function warmth() {
  post({ kind: 'warmth', warmth: space.warmth() })
}

// What the page writes, the worker hears: one note read again rather than a space.
// A change at a time, in the order they were made, since a note is read back
// between hearing of one and the next.
let hearing = Promise.resolve()
watchRows((change) => {
  hearing = hearing.then(async () => {
    // What has gone first: a rename is both, and the new row is the one to keep.
    for (const path of change.gone) space.gone(path)
    for (const path of change.written) await space.rewritten(path).catch(() => undefined)
    warmth()
  })
})

self.onmessage = (event: MessageEvent<unknown>) => {
  const told = event.data
  // A message that is not one of ours is not this worker's business; see the note
  // on boundaries in docs/conventions.md.
  if (isWarm(told)) {
    // A space that cannot be read is not a failure to report: the next search
    // reads what it can, the way it did before anything was held.
    void space
      .fill(told.root)
      .catch(() => undefined)
      .then(warmth)
    return
  }

  if (!isAsk(told)) return

  searchRows(
    told.root,
    told.query,
    told.terms,
    told.limit,
    (found) => {
      post({ kind: 'found', id: told.id, ...found })
    },
    told.excluded,
  )
    .then(() => {
      post({ kind: 'done', id: told.id })
      warmth()
    })
    .catch(() => post({ kind: 'done', id: told.id }))
}
