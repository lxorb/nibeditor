import { expect, test, vi } from 'vitest'

/** The file list is read again once a note has arrived; that read is stood in for,
 *  so what is checked is that it is asked for. */
const loadTree = vi.fn(() => Promise.resolve())
vi.mock('./workspace.svelte', () => ({ workspace: { loadTree } }))

const { icloud } = await import('./icloud.svelte')

test('a note is on its way from the word it sets off until it arrives', async () => {
  icloud.heard({ path: '/s/Plan.md', done: false })
  expect(icloud.coming.has('/s/Plan.md')).toBe(true)

  icloud.heard({ path: '/s/Plan.md', done: true })
  expect(icloud.coming.has('/s/Plan.md')).toBe(false)

  await vi.waitFor(() => expect(loadTree).toHaveBeenCalledOnce())
})
