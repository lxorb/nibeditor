import { expect, test, vi } from 'vitest'

const written: { path: string; content: string }[] = []
vi.mock('../workspace/write-file', () => ({
  writeFile: (path: string, content: string) => {
    written.push({ path, content })
    return Promise.resolve()
  },
}))

const { linkWords, siteDropped } = await import('./dropped-site')

const sites = {
  activeSpace: null,
  device: { expand: () => undefined },
  freeName: (_dir: string, wanted: string) => wanted,
  showEntry: () => undefined,
  freshEntry: (path: string) => ({ path, name: path, is_dir: false }) as never,
}

test("a link's own words name it", () => {
  expect(linkWords('<a href="https://svelte.dev/docs">Svelte  docs</a>')).toBe('Svelte docs')
  expect(linkWords('')).toBe('')
  expect(linkWords('<meta charset="utf-8"><a href="x"><b>Tom</b> &amp; Jerry&#39;s</a>')).toBe(
    "Tom & Jerry's",
  )
})

test('a link dropped on the list is a web note there, named by its words or its site', async () => {
  const path = await siteDropped(
    sites,
    '/Space/Read',
    'https://svelte.dev/docs/runes\r\n',
    '<a href="https://svelte.dev/docs/runes">Runes</a>',
  )
  expect(path?.replaceAll('\\', '/')).toBe('/Space/Read/Runes.url')
  expect(written.at(-1)?.content).toContain('URL=https://svelte.dev/docs/runes')

  const bare = await siteDropped(sites, '/Space', 'https://www.bbc.co.uk/news', '')
  expect(bare?.replaceAll('\\', '/')).toBe('/Space/bbc.co.uk.url')
})

test('nothing for a link no web tab may open', async () => {
  expect(await siteDropped(sites, '/Space', 'javascript:alert(1)', '')).toBeNull()
  expect(await siteDropped(sites, '/Space', 'file:///C:/a.md', '')).toBeNull()
})
