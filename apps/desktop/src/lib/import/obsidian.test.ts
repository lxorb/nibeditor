import JSZip from 'jszip'
import { describe, expect, test } from 'vitest'

import { carriedBy, NOTION } from './carry'
import { fromAppJson, leftInVault, obsidianCarries } from './obsidian'
import { detect, readAs } from './read'
import { insideFolder, sourceOf, sourcesFrom, type Picked, type Source } from './sources'

function file(path: string, body = 'x'): Source {
  return sourceOf(path, new TextEncoder().encode(body))
}

/** What a note says once a vault holding it and these other files is read. */
async function noteFrom(path: string, ...files: Source[]): Promise<string> {
  const plan = await readAs('obsidian', [file('.obsidian/app.json', '{}'), ...files])
  const found = plan.files.find((one) => one.path === path)
  if (found?.kind !== 'note') throw new Error(`no note at ${path}`)
  return found.text
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

describe('the links in a vault', () => {
  test('keep the heading, block or page they point at', async () => {
    const note = file('Note.md', '# Note\n\n## Setup\n\nPara ^abc123\n')
    const paper = file('paper.pdf', '%PDF')

    const said = [
      '[[Note#Setup]]',
      '[[Note#Setup|how to set up]]',
      '[[Note#^abc123]]',
      '![[Note#Setup]]',
      '![[paper.pdf#page=3]]',
    ]
    for (const link of said) {
      await expect(noteFrom('A.md', file('A.md', `See ${link}.\n`), note, paper)).resolves.toBe(
        `See ${link}.\n`,
      )
    }
  })

  test('keep the heading a markdown link to a note points at', async () => {
    const text = await noteFrom(
      'A.md',
      file('A.md', 'See [setup](Note%20name.md#Setup).\n'),
      file('Note name.md', '# Note\n\n## Setup\n'),
    )
    expect(text).toBe('See [[Note name#Setup|setup]].\n')
  })

  test('keep the folder that says which of two files of one name is meant', async () => {
    const both = [
      file('Home/Meeting.md', '# Home meeting\n'),
      file('Work/Meeting.md', '# Work meeting\n'),
      file('Home/photo.png', 'P1'),
      file('Work/photo.png', 'P2'),
    ]
    const linked = async (body: string) => noteFrom('A.md', ...both, file('A.md', body))

    await expect(linked('See [[Work/Meeting]].\n')).resolves.toBe('See [[Work/Meeting]].\n')
    await expect(linked('See [work](Work/Meeting.md).\n')).resolves.toBe(
      'See [[Work/Meeting|work]].\n',
    )
    await expect(linked('![[Work/photo.png|200]]\n')).resolves.toBe('![[Work/photo.png|200]]\n')
    // A name only one file has stays as short as it was written.
    await expect(
      noteFrom('A.md', file('Work/Plan.md', '# Plan\n'), file('A.md', 'See [[Work/Plan]].\n')),
    ).resolves.toBe('See [[Plan]].\n')
  })

  test('are left exactly as written inside code', async () => {
    const kit = file('Kit.md', '# Kit\n')
    const fenced = 'Example:\n\n```markdown\n[the kit](Kit.md) and [[kit#Tent]]\n```\n'
    const inline = 'Write `[the kit](Kit.md)` or ``[[kit#Tent]]`` to link [[Kit]].\n'

    await expect(noteFrom('A.md', file('A.md', fenced), kit)).resolves.toBe(fenced)
    await expect(noteFrom('A.md', file('A.md', inline), kit)).resolves.toBe(inline)
    // A fence nobody closed is code to the end of the note.
    await expect(noteFrom('A.md', file('A.md', '~~~\n[[kit]]\n'), kit)).resolves.toBe(
      '~~~\n[[kit]]\n',
    )
  })

  test('with no extension mean the note, whatever file of that stem sorts first', async () => {
    await expect(
      noteFrom(
        'Home.md',
        file('Home.md', 'Next: [[Plan]]'),
        file('Plan.canvas', '{"nodes":[],"edges":[]}'),
        file('Plan.md', '# Plan'),
      ),
    ).resolves.toBe('Next: [[Plan]]\n')
    await expect(
      noteFrom(
        'Home.md',
        file('Attachments/Report.pdf', '%PDF'),
        file('Home.md', 'Read [[Report]] and [[Report.pdf]]'),
        file('Notes/Report.md', '# Report'),
      ),
    ).resolves.toBe('Read [[Report]] and [[Report.pdf]]\n')
  })
})

/** A file the browser hands over from a picked folder. */
function picked(path: string, bytes: Uint8Array): Picked {
  return {
    name: path.split('/').pop() ?? path,
    webkitRelativePath: path,
    arrayBuffer: async () => bytes.slice().buffer,
  }
}

/** Every path a plan writes, in order. */
async function pathsFrom(sources: readonly Source[]): Promise<string[]> {
  const plan = await readAs('obsidian', sources)
  return plan.files.map((one) => one.path).sort()
}

describe('the files in a vault', () => {
  test('keep a Word document whole when the vault is picked as a folder', async () => {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<Types/>')
    zip.file('word/document.xml', '<w:document/>')
    const docx = await zip.generateAsync({ type: 'uint8array' })
    const words = (body: string) => new TextEncoder().encode(body)

    const sources = await sourcesFrom(
      insideFolder([
        picked('Vault/.obsidian/app.json', words('{}')),
        picked('Vault/Notes.md', words('![[Report.docx]]')),
        picked('Vault/Attachments/Report.docx', docx),
      ]),
    )
    await expect(pathsFrom(sources)).resolves.toEqual([
      '.obsidian/app.json',
      'Attachments/Report.docx',
      'Notes.md',
    ])
  })

  test('keep their names, a hash at the end of one included', async () => {
    const hashed = 'Attachments/photo-0123456789abcdef0123456789abcdef.jpg'
    await expect(
      pathsFrom([file('.obsidian/app.json', '{}'), file(hashed, 'JPG')]),
    ).resolves.toEqual(['.obsidian/app.json', hashed])
  })

  test('keep a saved web page as the page, not a note made of it', async () => {
    const page = '<html><body><p style="color:red">Hi</p></body></html>'
    const plan = await readAs('obsidian', [
      file('.obsidian/app.json', '{}'),
      file('Clips/Article.html', page),
      file('Clips/Article.md', '# Notes on [[Article.html]]'),
    ])

    const kept = plan.files.find((one) => one.path === 'Clips/Article.html')
    expect(kept?.kind).toBe('file')
    expect(kept?.kind === 'file' && new TextDecoder().decode(kept.bytes)).toBe(page)
    expect(plan.files.map((one) => one.path).sort()).toEqual([
      '.obsidian/app.json',
      'Clips/Article.html',
      'Clips/Article.md',
    ])
    expect(plan.lost).toEqual([])
  })
})
