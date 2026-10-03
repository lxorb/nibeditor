/** One placement of a page in the air at a time, and only the newest one behind it.
 *
 *  A pane being dragged, a window being resized or a sidebar sliding open says where
 *  the page goes on every frame, and each of those is a call across to the crate. Sent
 *  as they came, several were in the air at once, and nothing says calls land in the
 *  order they were sent: an older rectangle landing after a newer one left the page
 *  where the pane had been a frame ago - and since the pane had already said its last
 *  rectangle, nothing ever said it again. That was the page that "freezes where it is"
 *  while the window is resized. So a page has one call in the air, and whatever is
 *  said while it is flying waits behind it, each new word replacing the last: the
 *  page goes where the pane is now, never where it was, and never to the same place
 *  twice. Pure, so the order is tested without a webview; see latest.test.ts. */
export class Latest<T> {
  private flying: Promise<void> | null = null
  private waiting: { one: T; landed: Promise<void> } | null = null

  constructor(private readonly send: (one: T) => Promise<void>) {}

  /** Sends `one`, or puts it behind the call in the air in place of whatever was
   *  waiting there. Answers when the call that carried it has landed, with that call's
   *  own outcome - a placement replaced by a newer one is carried by the newer one. */
  put(one: T): Promise<void> {
    // Asked before the call in the air, so that a word said in the breath between one
    // call landing and the next one leaving joins the one leaving rather than
    // overtaking it.
    if (this.waiting) {
      this.waiting.one = one
      return this.waiting.landed
    }
    if (!this.flying) return this.fly(one)

    const waiting = { one, landed: Promise.resolve() }
    waiting.landed = this.flying
      .catch(() => undefined)
      .then(() => {
        this.waiting = null
        return this.fly(waiting.one)
      })
    this.waiting = waiting
    return waiting.landed
  }

  /** Whether nothing is in the air or waiting. */
  get idle(): boolean {
    return this.flying === null && this.waiting === null
  }

  private fly(one: T): Promise<void> {
    const going = this.send(one)
    this.flying = going
    void going
      .catch(() => undefined)
      .finally(() => {
        if (this.flying === going) this.flying = null
      })
    return going
  }
}
