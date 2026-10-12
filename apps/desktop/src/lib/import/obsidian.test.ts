import JSZip from 'jszip'
import { describe, expect, test } from 'vitest'

import { setLinkWriting } from '../link-format'
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
    // An old Evernote or Tomboy export kept in a vault is one of its files.
    await expect(
      detect([
        file('.obsidian/app.json', '{}'),
        file('Home.md', '# Home'),
        file('Archive/Evernote backup.enex', '<en-export></en-export>'),
        file('Archive/Old.note', '<note/>'),
      ]),
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
    // Another program's, as the vault list leaves them; see obsidian_vaults.rs.
    expect(leftInVault('.git/HEAD')).toBe(true)
    expect(leftInVault('.git/objects/ab/cdef0123')).toBe(true)
    expect(leftInVault('.stversions/A.md')).toBe(true)
    expect(leftInVault('Projects/node_modules/x/index.js')).toBe(true)
    expect(leftInVault('.gitignore')).toBe(true)

    expect(leftInVault('.obsidian/.DS_Store')).toBe(true)
    expect(leftInVault('.obsidian/snippets/._wide.css')).toBe(true)

    expect(leftInVault('.obsidian/app.json')).toBe(false)
    // The layouts saved by name with the Workspaces plugin are the vault's own.
    expect(leftInVault('.obsidian/workspaces.json')).toBe(false)
    expect(leftInVault('.obsidian/templates.json')).toBe(false)
    expect(leftInVault('Notes/workspace.json')).toBe(false)
    expect(leftInVault('Notes/A.md')).toBe(false)
  })

  test('arrives as its notes, with the settings Obsidian needs to open it again', async () => {
    const plan = await readAs('obsidian', [
      file('.obsidian/app.json', '{}'),
      file('.obsidian/workspace.json', '{}'),
      file('.trash/Gone.md', '# Gone'),
      file('.git/HEAD', 'ref: refs/heads/main'),
      file('.git/objects/ab/cdef', 'blob'),
      file('Projects/Plan.md', '# Plan\n\nSee [[Ideas]]'),
      file('Ideas.md', '# Ideas'),
    ])

    const paths = plan.files.map((one) => one.path).sort()
    expect(paths).toEqual(['.obsidian/app.json', 'Ideas.md', 'Projects/Plan.md'])
    expect(plan.format).toBe('obsidian')
  })
  test('leaves an older vault’s settings behind, as the vault list does', async () => {
    const plan = await readAs('obsidian', [
      file('.obsidian/app.json', '{}'),
      file('Home.md', '# Home'),
      file('Old vault/.obsidian/app.json', '{}'),
      file('Old vault/.obsidian/graph.json', '{}'),
      file('Old vault/Note.md', '# Old'),
    ])

    expect(plan.files.map((one) => one.path).sort()).toEqual([
      '.obsidian/app.json',
      'Home.md',
      'Old vault/Note.md',
    ])
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

  test('reads the vault’s own app.json, not an older vault’s that sorts first', async () => {
    const carried = await carriedBy('obsidian', [
      file('Old vault/.obsidian/app.json', '{"useMarkdownLinks":true,"vimMode":true}'),
      file('Old vault/Note.md', '# Old'),
      file('.obsidian/app.json', '{"vimMode":false}'),
      file('Home.md', '# Home'),
    ])

    expect(carried).toMatchObject({ vim: false, linkFormat: 'wikilink' })
    // A zip whose one entry is the vault still has its settings read.
    await expect(
      obsidianCarries([file('Brain/.obsidian/app.json', '{"vimMode":true}')]),
    ).resolves.toMatchObject({ vim: true })
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

  test('are left exactly as written in an indented block or a fence in a callout', async () => {
    const kit = file('Kit.md', '# Kit\n')
    const indented = 'Example:\n\n    See [the kit](Kit.md)\n\n    and [[kit]]\n\nDone.\n'
    const callout = '> [!example]\n> ~~~\n> [[kit]]\n> ~~~\n'

    await expect(noteFrom('A.md', file('A.md', indented), kit)).resolves.toBe(indented)
    await expect(noteFrom('A.md', file('A.md', callout), kit)).resolves.toBe(callout)
    // Under a paragraph or a list item an indented line is more of it, and its link
    // is a link.
    await expect(
      noteFrom('A.md', file('A.md', 'Some words\n    and [[kit]]\n'), kit),
    ).resolves.toBe('Some words\n    and [[kit]]\n')
    await expect(
      noteFrom('A.md', file('A.md', '- Item\n\n    more about [[kit]]\n'), kit),
    ).resolves.toBe('- Item\n\n    more about [[kit]]\n')
  })

  test('in a table cell keep the cell whole', async () => {
    const plan = file('Plan.md', '# Plan\n')
    const table = (link: string) => `| Who | Link |\n| --- | --- |\n| me | ${link} |\n`

    await expect(noteFrom('A.md', file('A.md', table('[the plan](Plan.md)')), plan)).resolves.toBe(
      table('[[Plan\\|the plan]]'),
    )
    await expect(noteFrom('A.md', file('A.md', table('[[plan\\|the plan]]')), plan)).resolves.toBe(
      table('[[plan\\|the plan]]'),
    )
    // Outside a table the `|` is the link's own.
    await expect(noteFrom('A.md', file('A.md', 'See [the plan](Plan.md).\n'), plan)).resolves.toBe(
      'See [[Plan|the plan]].\n',
    )
  })

  test('keep pointing at a file whose name holds a percent sign or a hash', async () => {
    await expect(
      noteFrom(
        'Notes/A.md',
        file('Notes/A.md', '![chart](../assets/Growth%2010%25.png)\n'),
        file('assets/Growth 10%.png', 'PNG'),
      ),
    ).resolves.toBe('![chart](../assets/Growth%2010%25.png)\n')
    await expect(
      noteFrom(
        'A.md',
        file('A.md', 'See [basics](C%23%20basics.md).\n'),
        file('C.md', '# C\n'),
        file('C# basics.md', '# C# basics\n'),
      ),
    ).resolves.toBe('See [[C# basics|basics]].\n')
    // A wikilink is read as written, never as percent encoding.
    await expect(
      noteFrom(
        'A.md',
        file('A.md', 'See [[50%25 off]].\n'),
        file('50% off.md', 'x'),
        file('50%25 off.md', 'y'),
      ),
    ).resolves.toBe('See [[50%25 off]].\n')
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

  test('with no extension and no note of that name are a note not written yet', async () => {
    await expect(
      noteFrom(
        'Home.md',
        file('Home.md', 'Write up [[Budget]] later.\n'),
        file('Files/Budget.xlsx'),
      ),
    ).resolves.toBe('Write up [[Budget]] later.\n')
    await expect(
      noteFrom('Home.md', file('Home.md', '![[Diagram]]\n'), file('Diagram.png', 'png')),
    ).resolves.toBe('![[Diagram]]\n')
  })

  test('keep the case they were written in', async () => {
    await expect(
      noteFrom(
        'Home.md',
        file('Home.md', 'See the [[plan]] for details.\n'),
        file('Plan.md', '# Plan\n'),
      ),
    ).resolves.toBe('See the [[plan]] for details.\n')
  })

  test('reach each of two notes whose names differ only in case', async () => {
    const plan = await readAs('obsidian', [
      file('.obsidian/app.json', '{}'),
      file('Home.md', 'See [[todo]] and [[TODO]]\n'),
      file('TODO.md', 'big'),
      file('todo.md', 'small'),
    ])
    expect(plan.files.map((one) => one.path)).toEqual([
      '.obsidian/app.json',
      'Home.md',
      'TODO.md',
      'todo 2.md',
    ])
    const home = plan.files.find((one) => one.path === 'Home.md')
    expect(home?.kind === 'note' && home.text).toBe('See [[todo 2]] and [[TODO]]\n')
  })

  test('keep a picture’s size when the Links setting writes markdown', async () => {
    setLinkWriting('shortest')
    try {
      await expect(
        noteFrom('Home.md', file('Home.md', '![[photo.png|300]]\n'), file('photo.png', 'png')),
      ).resolves.toBe('![[photo.png|300]]\n')
    } finally {
      setLinkWriting('wikilink')
    }
  })

  test('to a note with a bracket in its name stay markdown links', async () => {
    await expect(
      noteFrom(
        'Home.md',
        file('Home.md', 'See [the draft](%5BDraft%5D%20Plan.md).\n'),
        file('[Draft] Plan.md', '# Draft\n'),
      ),
    ).resolves.toBe('See [the draft]([Draft]%20Plan.md).\n')
  })

  test('written with escaped brackets are words, not links', async () => {
    const body = 'Write it as \\[label\\](Notes.md) to show the syntax.\n'
    await expect(
      noteFrom('Home.md', file('Home.md', body), file('Notes.md', '# Notes\n')),
    ).resolves.toBe(body)
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

  test('keep a mind map and a Sketch file whole when the vault is picked as a folder', async () => {
    const zipped = async (entries: Record<string, string>) => {
      const zip = new JSZip()
      for (const [path, body] of Object.entries(entries)) zip.file(path, body)
      return zip.generateAsync({ type: 'uint8array' })
    }
    const words = (body: string) => new TextEncoder().encode(body)

    const sources = await sourcesFrom(
      insideFolder([
        picked('Vault/.obsidian/app.json', words('{}')),
        picked('Vault/Home.md', words('![[Map.xmind]]\n')),
        picked('Vault/Mind/Map.xmind', await zipped({ 'content.json': '[]' })),
        picked('Vault/Design/Logo.sketch', await zipped({ 'document.json': '{}' })),
      ]),
    )
    await expect(pathsFrom(sources)).resolves.toEqual([
      '.obsidian/app.json',
      'Design/Logo.sketch',
      'Home.md',
      'Mind/Map.xmind',
    ])
  })

  test('arrive from a picked folder holding a note that opens with PK and a broken zip', async () => {
    const words = (body: string) => new TextEncoder().encode(body)
    const sources = await sourcesFrom([
      picked('.obsidian/app.json', words('{}')),
      picked('PKI.md', words('PKI is public key infrastructure.\n')),
      picked('Attachments/placeholder.zip', new Uint8Array()),
      picked('Attachments/cut.zip', words('PK\u0003\u0004 and then nothing')),
    ])

    await expect(pathsFrom(sources)).resolves.toEqual([
      '.obsidian/app.json',
      'Attachments/cut.zip',
      'Attachments/placeholder.zip',
      'PKI.md',
    ])
    await expect(noteFrom('PKI.md', ...sources)).resolves.toBe(
      'PKI is public key infrastructure.\n',
    )
  })

  test('keep their names, a hash at the end of one included', async () => {
    const hashed = 'Attachments/photo-0123456789abcdef0123456789abcdef.jpg'
    await expect(
      pathsFrom([file('.obsidian/app.json', '{}'), file(hashed, 'JPG')]),
    ).resolves.toEqual(['.obsidian/app.json', hashed])
  })

  test('keep a long name and a double space, so a canvas naming them still finds them', async () => {
    const long =
      'How to Build a Second Brain - A Proven Method to Organize Your Digital Life and Unlock Your Creative Potential'
    const stem = `${'A'.repeat(40)} ${'B'.repeat(60)}`
    const canvas = JSON.stringify({
      nodes: [
        { id: 'a', type: 'file', file: `Clippings/${long}.md` },
        { id: 'b', type: 'file', file: 'Meeting  notes.md' },
      ],
      edges: [],
    })

    await expect(
      pathsFrom([
        file('.obsidian/app.json', '{}'),
        file(`Clippings/${long}.md`, '# Book'),
        file('Meeting  notes.md', '# Meeting'),
        file(`${stem} part one.md`, '1'),
        file(`${stem} part two.md`, '2'),
        file('Board.canvas', canvas),
      ]),
    ).resolves.toEqual([
      '.obsidian/app.json',
      `${stem} part one.md`,
      `${stem} part two.md`,
      'Board.canvas',
      `Clippings/${long}.md`,
      'Meeting  notes.md',
    ])
  })

  test('arrive when a name starts like a device’s, with the links following it', async () => {
    const plan = await readAs('obsidian', [
      file('.obsidian/app.json', '{}'),
      file('Home.md', 'See [[Con. Law]].\n'),
      file('Con. Law.md', 'Marbury v. Madison.'),
    ])
    expect(plan.files.map((one) => one.path)).toEqual([
      '.obsidian/app.json',
      'Home.md',
      'Con-. Law.md',
    ])
    const home = plan.files.find((one) => one.path === 'Home.md')
    expect(home?.kind === 'note' && home.text).toBe('See [[Con-. Law]].\n')
  })

  test('arrive both when one is named with a space in front to sort first', async () => {
    const plan = await readAs('obsidian', [
      file('.obsidian/app.json', '{}'),
      file('Home.md', 'See [[Inbox]].\n'),
      file(' Inbox.md', 'pinned inbox'),
      file('Inbox.md', 'the other inbox'),
    ])
    const notes = plan.files.flatMap((one) => (one.kind === 'note' ? [[one.path, one.text]] : []))
    expect(notes).toEqual([
      ['Home.md', 'See [[Inbox 2]].\n'],
      ['Inbox.md', 'pinned inbox\n'],
      ['Inbox 2.md', 'the other inbox\n'],
    ])
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

  test('land at the top of the space from a zip whose one entry is the vault', async () => {
    const zip = new JSZip()
    zip.file('Brain/.obsidian/app.json', '{}')
    zip.file('Brain/Home.md', '# Home\n\nSee [[Projects/Plan]]')
    zip.file('Brain/Projects/Plan.md', '# Plan')
    zip.file('Brain/Map.canvas', '{"nodes":[{"type":"file","file":"Projects/Plan.md"}]}')
    const bytes = await zip.generateAsync({ type: 'uint8array' })

    const sources = await sourcesFrom([
      { name: 'Brain.zip', arrayBuffer: async () => bytes.slice().buffer },
    ])
    await expect(detect(sources)).resolves.toBe('obsidian')
    await expect(pathsFrom(sources)).resolves.toEqual([
      '.obsidian/app.json',
      'Home.md',
      'Map.canvas',
      'Projects/Plan.md',
    ])
  })

  test('keep a note’s line endings and the blank lines above a rule', async () => {
    const windows = '# T\r\n\r\nline\r\n'
    const rule = '\n---\nnot: properties\n---\n'

    await expect(noteFrom('A.md', file('A.md', windows))).resolves.toBe(windows)
    await expect(noteFrom('A.md', file('A.md', '# T\r\n\r\nline'))).resolves.toBe(windows)
    await expect(noteFrom('A.md', file('A.md', rule))).resolves.toBe(rule)
  })

  test('keep a note that opens with an indented code block as code', async () => {
    const code = '    let x = 1\n    let y = 2\n\nAfter.\n'
    await expect(noteFrom('Code.md', file('Code.md', code))).resolves.toBe(code)
  })
})
