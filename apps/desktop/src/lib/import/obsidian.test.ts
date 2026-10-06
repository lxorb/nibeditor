import { describe, expect, test } from 'vitest'

import { carriedBy, NOTION } from './carry'
import { fromAppJson, leftInVault, obsidianCarries } from './obsidian'
import { detect, readAs } from './read'
import { sourceOf, type Source } from './sources'

function file(path: string, body = 'x'): Source {
  return sourceOf(path, new TextEncoder().encode(body))
}

describe('an Obsidian vault', () => {
  test('says so by its settings folder, before any folder shape', async () => {
    await expect(detect([file('.obsidian/app.json', '{}'), file('A.md', '# A')])).resolves.toBe(
      'obsidian',
    )
    // A vault with a `pages/` folder is still a vault, not a Logseq graph.
    await expect(
      detect([file('.obsidian/app.json', '{}'), file('pages/A.md', '# A')]),
    ).resolves.toBe('obsidian')
    // A zip whose one entry is the vault.
    await expect(
      detect([file('Vault/.obsidian/app.json', '{}'), file('Vault/A.md', '# A')]),
    ).resolves.toBe('obsidian')
  })

  test('leaves behind what is about one machine, and keeps the rest of its settings', () => {
    expect(leftInVault('.obsidian/workspace.json')).toBe(true)
    expect(leftInVault('.obsidian/workspace-mobile.json')).toBe(true)
    expect(leftInVault('.obsidian/plugins/dataview/main.js')).toBe(true)
    expect(leftInVault('.obsidian/themes/Minimal/theme.css')).toBe(true)
    expect(leftInVault('.trash/Old.md')).toBe(true)
    expect(leftInVault('Vault/.trash/Old.md')).toBe(true)

    expect(leftInVault('.obsidian/app.json')).toBe(false)
    expect(leftInVault('.obsidian/templates.json')).toBe(false)
    expect(leftInVault('Notes/workspace.json')).toBe(false)
    expect(leftInVault('Notes/A.md')).toBe(false)
  })

  test('arrives as its notes, with the settings Obsidian needs to open it again', async () => {
    const plan = await readAs('obsidian', [
      file('.obsidian/app.json', '{}'),
      file('.obsidian/workspace.json', '{}'),
      file('.trash/Gone.md', '# Gone'),
      file('Projects/Plan.md', '# Plan\n\nSee [[Ideas]]'),
      file('Ideas.md', '# Ideas'),
    ])

    const paths = plan.files.map((one) => one.path).sort()
    expect(paths).toEqual(['.obsidian/app.json', 'Ideas.md', 'Projects/Plan.md'])
    expect(plan.format).toBe('obsidian')
  })
})

describe('what a vault carries into the settings', () => {
  test('is Obsidian’s defaults where app.json says nothing', () => {
    expect(fromAppJson({})).toEqual({
      linkFormat: 'wikilink',
      hardBreaks: true,
      attachments: 'space',
      properties: 'properties',
      vim: false,
      quietMarks: false,
      keys: 'obsidian',
    })
  })

  test('reads each answer the way Obsidian meant it', () => {
    const carried = fromAppJson({
      useMarkdownLinks: true,
      newLinkFormat: 'relative',
      strictLineBreaks: true,
      attachmentFolderPath: './assets',
      propertiesInDocument: 'source',
      vimMode: true,
    })

    expect(carried).toMatchObject({
      linkFormat: 'relative',
      hardBreaks: false,
      attachments: 'note',
      properties: 'source',
      vim: true,
    })
  })

  test('takes a markdown link with no format as the shortest one, Obsidian’s default', () => {
    expect(fromAppJson({ useMarkdownLinks: true }).linkFormat).toBe('shortest')
    expect(fromAppJson({ useMarkdownLinks: true, newLinkFormat: 'absolute' }).linkFormat).toBe(
      'absolute',
    )
  })

  test('puts pictures in the space’s own folder for a folder at the top of the vault', () => {
    expect(fromAppJson({ attachmentFolderPath: '/' }).attachments).toBe('space')
    expect(fromAppJson({ attachmentFolderPath: 'Attachments' }).attachments).toBe('space')
    expect(fromAppJson({ attachmentFolderPath: './' }).attachments).toBe('note')
  })

  test('reads app.json out of what was picked, and a broken one as the defaults', async () => {
    const strict = await obsidianCarries([file('.obsidian/app.json', '{"strictLineBreaks":true}')])
    expect(strict.hardBreaks).toBe(false)

    const broken = await obsidianCarries([file('.obsidian/app.json', '{not json')])
    expect(broken).toEqual(fromAppJson({}))
  })

  test('is Notion’s habits for a Notion export, and nothing for a plain folder', async () => {
    await expect(carriedBy('notion', [])).resolves.toBe(NOTION)
    expect(NOTION).toMatchObject({ quietMarks: true, keys: 'notion' })
    await expect(carriedBy('markdown', [])).resolves.toBeNull()
  })
})
