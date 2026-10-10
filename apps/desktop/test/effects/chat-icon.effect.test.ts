/** A chat's icon, drawn where a chat is shown: the Chats panel's row and the chat's head
 *  (ChatMark), and the file list, the tab and the palette (FileMark, handed the
 *  pointer's path). Issue #227: a chat could not wear an icon the way a note does.
 *
 *  In the jsdom project because the icon arrives after the mark is drawn: the pointer is
 *  read on its own the first time a mark asks (marks-elsewhere.svelte.ts), and the mark
 *  redraws because what it derived from has changed. A pointer written again redraws it
 *  the same way. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const CHAT = 'c_3f9a0c1e5b7d4f2a8c6e0b1d3f5a7c9e'

/** The pointers on the disk, by path. */
const files: Record<string, string> = {}

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  invoke: (command: string, args: { path?: string } = {}) => {
    if (command !== 'read_note') return Promise.resolve(undefined)
    const held = files[String(args.path)]
    return held === undefined ? Promise.reject(new Error('no such file')) : Promise.resolve(held)
  },
}))

const ChatMark = (await import('../../src/lib/chats/view/ChatMark.svelte')).default
const FileMark = (await import('../../src/lib/FileMark.svelte')).default
const { GLYPHS } = await import('../../src/lib/chats/view/glyphs')
const { elsewhere } = await import('../../src/lib/marks-elsewhere.svelte')

let target: HTMLElement
const mounted: ReturnType<typeof mount>[] = []

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
  elsewhere.clear()
})

afterEach(() => {
  for (const one of mounted.splice(0)) void unmount(one)
  target.remove()
})

function drawChat(path: string | null) {
  mounted.push(mount(ChatMark, { target, props: { path } }))
  flushSync()
}

function drawRow(path: string) {
  mounted.push(mount(FileMark, { target, props: { mark: 'chat', path } }))
  flushSync()
}

/** The emoji each mark on screen wears, in order. */
const emoji = () => [...target.querySelectorAll('.emoji')].map((one) => one.textContent)

/** Whether a `#` is drawn, which is what a chat that chose nothing wears in the panel. */
const hashes = () => target.querySelectorAll(`path[d="${GLYPHS.hash}"]`).length

test('a chat that chose an icon wears it in the panel, the head and the file list', async () => {
  files['/space/Team.chat'] = `{"v":1,"chat":"${CHAT}","icon":"🚀"}\n`
  drawChat('/space/Team.chat')
  drawRow('/space/Team.chat')

  // Its kind's mark until the pointer has been read, and then the chosen one.
  expect(hashes()).toBe(1)
  await vi.waitFor(() => {
    flushSync()
    expect(emoji()).toEqual(['🚀', '🚀'])
  })
  expect(hashes()).toBe(0)
})

test('one that chose nothing keeps the mark every chat wears', async () => {
  files['/space/Plain.chat'] = `{"v":1,"chat":"${CHAT}"}\n`
  drawChat('/space/Plain.chat')
  drawChat(null)

  await vi.waitFor(() => expect(elsewhere.of('/space/Plain.chat')).not.toBeNull())
  flushSync()
  expect(emoji()).toEqual([])
  expect(hashes()).toBe(2)
})

test('a pointer written again is what the mark wears next', async () => {
  files['/space/Team.chat'] = `{"v":1,"chat":"${CHAT}","icon":"🚀"}\n`
  drawChat('/space/Team.chat')
  await vi.waitFor(() => {
    flushSync()
    expect(emoji()).toEqual(['🚀'])
  })

  elsewhere.saved('/space/Team.chat', `{"v":1,"chat":"${CHAT}","icon":"🌱"}\n`)
  await vi.waitFor(() => {
    flushSync()
    expect(emoji()).toEqual(['🌱'])
  })

  elsewhere.saved('/space/Team.chat', `{"v":1,"chat":"${CHAT}"}\n`)
  await vi.waitFor(() => {
    flushSync()
    expect(hashes()).toBe(1)
  })
})
