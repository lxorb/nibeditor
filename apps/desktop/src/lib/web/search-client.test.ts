import { afterEach, describe, expect, test, vi } from 'vitest'
import { parseQuery } from '../search/query'

/** A worker that cannot be started is a worker that fell over: the field has no
 *  answer to this word, and the next question tries again. Neither the warming nor
 *  a search may throw for it - the warming is not awaited by anybody, so a throw
 *  there is an unhandled rejection in whatever is running. */
describe('a worker that cannot be started', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  test('warms nothing and says nothing where there is no Worker at all', async () => {
    vi.stubGlobal('Worker', undefined)
    const { warmSpace } = await import('./search-client')

    expect(() => warmSpace('/space')).not.toThrow()
  })

  test('answers a search with nothing, and finishes it', async () => {
    vi.stubGlobal('Worker', undefined)
    const { searchInWorker } = await import('./search-client')
    const found = vi.fn()

    await searchInWorker('/space', parseQuery('alpha'), ['alpha'], 10, found)

    expect(found).not.toHaveBeenCalled()
  })

  test('is tried again on the next question', async () => {
    const posted: unknown[] = []
    let refuse = true
    vi.stubGlobal(
      'Worker',
      class {
        onmessage: ((event: MessageEvent<unknown>) => void) | null = null
        onerror: (() => void) | null = null
        constructor() {
          if (refuse) throw new Error('refused by the page')
        }
        postMessage(message: unknown) {
          posted.push(message)
        }
        terminate = vi.fn()
      },
    )
    const { warmSpace } = await import('./search-client')

    warmSpace('/space')
    refuse = false
    warmSpace('/space')

    expect(posted).toEqual([{ kind: 'warm', root: '/space' }])
  })
})
