/** A part fetched when first asked for: one fetch however many ask, tried twice, and
 *  forgotten when both failed, so a dropped request is not every later ask's answer. */

/** Long enough for a dropped request's network to be back, short enough to wait on. */
const AGAIN_AFTER = 800

export function door<T>(load: () => Promise<T>): () => Promise<T> {
  let asked: Promise<T> | null = null

  return () => {
    if (asked) return asked

    const fetching = attempt(load).catch(async () => {
      await new Promise((resolve) => setTimeout(resolve, AGAIN_AFTER))
      return attempt(load)
    })
    asked = fetching
    fetching.catch(() => {
      asked = null
    })

    return fetching
  }
}

function attempt<T>(load: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve) => resolve(load()))
}
