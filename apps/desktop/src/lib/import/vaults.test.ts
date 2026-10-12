import { describe, expect, test, vi } from 'vitest'

vi.mock('../tauri', () => ({
  invoke: (command: string, args: Record<string, unknown>) => {
    if (command === 'obsidian_vault_files') {
      return Promise.resolve([
        { path: 'Attachments/locked.png', size: 4 },
        { path: 'Home.md', size: 6 },
      ])
    }
    if (command === 'read_obsidian_file' && args.path === 'Home.md') {
      return Promise.resolve(btoa('# Home'))
    }
    // A Tauri command's error arrives as the bare string the crate returned.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    return Promise.reject(
      `/home/me/Brain/${String(args.path)} could not be read: Permission denied`,
    )
  },
  isDesktop: true,
}))

const { vaultSources } = await import('./vaults')

describe('a vault read where it is', () => {
  test('names the file it could not read', async () => {
    const sources = await vaultSources({ name: 'Brain', path: '/home/me/Brain' })
    const [locked, home] = sources

    await expect(home?.text()).resolves.toBe('# Home')
    await expect(locked?.bytes()).rejects.toThrow('Attachments/locked.png could not be read.')
  })
})
