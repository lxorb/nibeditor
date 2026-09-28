import { afterEach, describe, expect, test, vi } from 'vitest'

/** On a Mac the frame's print is a dead end - `WKWebView` ignores `print()` inside a
 *  frame - so the page goes to the crate's own print sheet instead. The crate is stood
 *  in for; what is under test is which road a Mac takes and what it is handed. No
 *  frame is ever made on the way, which is what lets this run without a document. */
const world = vi.hoisted(() => ({
  asked: [] as { command: string; args: Record<string, unknown> | undefined }[],
  refuse: false,
}))

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: true,
  platform: () => 'macos',
  invoke: (command: string, args?: Record<string, unknown>) => {
    world.asked.push({ command, args })
    return world.refuse ? Promise.reject(new Error('no')) : Promise.resolve(undefined)
  },
}))

const { printInFrame } = await import('../export')

const PAGE = { width: 8.27, height: 11.69, margin: 0.5, landscape: false }

afterEach(() => {
  world.asked = []
  world.refuse = false
})

describe('printing on a Mac', () => {
  test('hands the page and its paper to the system print sheet', async () => {
    await printInFrame('<p>hello</p>', PAGE)

    expect(world.asked).toEqual([
      { command: 'print_page', args: { html: '<p>hello</p>', page: PAGE } },
    ])
  })

  test('says no paper when the caller knows none', async () => {
    await printInFrame('<p>hello</p>')

    expect(world.asked[0]?.args?.page).toBeNull()
  })

  /** A sheet that could not be shown is not worth an error on top of it: the caller
   *  is let go of rather than held for ever. */
  test('lets the caller go when the sheet cannot be shown', async () => {
    world.refuse = true

    await expect(printInFrame('<p>hello</p>', PAGE)).resolves.toBeUndefined()
  })
})
