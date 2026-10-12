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

  test('says how many of its files are in iCloud rather than on this Mac', async () => {
    const plan = await readAs('obsidian', [
      file('.obsidian/app.json', '{}'),
      file('Home.md', '# Home'),
      file('.Plan.md.icloud', 'bplist00'),
      file('Pictures/.photo.png.icloud', 'bplist00'),
      file('.trash/.Old.md.icloud', 'bplist00'),
    ])

    expect(plan.files.map((one) => one.path).sort()).toEqual(['.obsidian/app.json', 'Home.md'])
    expect(plan.lost).toEqual([
      { text: '{count} files are in iCloud rather than on this Mac', values: { count: 2 } },
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
      '[[Note#Setup|Note]]',
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

  test('keep going to a note at the top that shares its name with one beside them', async () => {
    const text = await noteFrom(
      'Projects/Alpha.md',
      file('Index.md', '# Home\n'),
      file('Projects/Index.md', '# Projects\n'),
      file('Projects/Alpha.md', 'Back to [Home](../Index.md), or [[Index|here]].\n'),
    )
    // nib reads `[[Index]]` from Projects as the Index beside it, so the markdown link
    // stays, while the wikilink meant the one beside it all along.
    expect(text).toBe('Back to [Home](../Index.md), or [[Projects/Index|here]].\n')
  })

  test('that start with a slash start at the top of the vault', async () => {
    const text = await noteFrom(
      'Notes/Home.md',
      file('Notes/Home.md', 'See [x](/Plan.md) and ![[/img.png]].\n'),
      file('Plan.md', '# P\n'),
      file('Notes/Plan.md', '# P2\n'),
      file('img.png', 'p'),
    )
    expect(text).toBe('See [x](../Plan.md) and ![[img.png]].\n')
  })

  test('whose words hold escaped brackets stay markdown links', async () => {
    const body = 'See [\\[1\\] Intro](Intro.md).\n'
    await expect(
      noteFrom('Home.md', file('Home.md', body), file('Intro.md', '# Intro\n')),
    ).resolves.toBe(body)
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

  test('are left exactly as written in a fence inside a list item', async () => {
    const plan = file('Plan.md', '# Plan\n')
    const indented = '# A\n\n1. Write:\n    ~~~md\n    See [the plan](Plan.md)\n    ~~~\n'
    const tabbed = '# A\n\n- Write:\n\t~~~\n\tSee [the plan](Plan.md)\n\t~~~\n'
    const opened = '1. ```markdown\n   See [the plan](Plan.md)\n   ```\n'

    await expect(noteFrom('A.md', file('A.md', indented), plan)).resolves.toBe(indented)
    await expect(noteFrom('A.md', file('A.md', tabbed), plan)).resolves.toBe(tabbed)
    await expect(noteFrom('A.md', file('A.md', opened), plan)).resolves.toBe(opened)
    // Once the fence closes, the item's words are words again.
    await expect(
      noteFrom('A.md', file('A.md', `${opened}   and [the plan](Plan.md)\n`), plan),
    ).resolves.toBe(`${opened}   and [[Plan|the plan]]\n`)
  })

  test('are left exactly as written in inline code after a lone backtick a paragraph above', async () => {
    const plan = file('Plan.md', '# Plan')
    const body =
      'Press the backtick (`) key to open the console.\n\nIn code: `[the plan](Plan.md)` is a markdown link.\n'

    await expect(noteFrom('Notes/A.md', file('Notes/A.md', body), plan)).resolves.toBe(body)
  })

  test('after a lone backtick are still pointed at their files', async () => {
    const body = 'Press the backtick (`) key.\n\n![](Screenshot%202.png)\n\nUse `x` here.\n'

    await expect(
      noteFrom('Notes/A.md', file('Notes/A.md', body), file('Attachments/Screenshot 2.png', 'png')),
    ).resolves.toBe(
      'Press the backtick (`) key.\n\n![](../Attachments/Screenshot%202.png)\n\nUse `x` here.\n',
    )
  })

  test('after a fence left open inside a callout are pointed at their files', async () => {
    const body = '> [!note]\n> ```\n> code\n\n![](pic.png)\n'

    await expect(
      noteFrom('Notes/A.md', file('Notes/A.md', body), file('Attachments/pic.png', 'png')),
    ).resolves.toBe('> [!note]\n> ```\n> code\n\n![](../Attachments/pic.png)\n')
  })

  test('are left exactly as written in a tilde fence of a note with Windows line endings', async () => {
    const body = '~~~\r\n![](pic.png)\r\n~~~\r\n'

    await expect(
      noteFrom('Notes/Guide.md', file('Notes/Guide.md', body), file('Attachments/pic.png', 'p')),
    ).resolves.toBe(body)
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

  test('in a table under a list item keep the cell whole', async () => {
    const plan = file('Plan.md', '# Plan\n')
    // Obsidian writes a list item's contents a tab in; four spaces do the same.
    const tabbed = '- Steps\n\t| step | note |\n\t| --- | --- |\n\t| one | [[Plan\\|the plan]] |\n'
    const spaced = (link: string) =>
      `1. Steps\n    | step | note |\n    | --- | --- |\n    | one | ${link} |\n`

    await expect(noteFrom('A.md', file('A.md', tabbed), plan)).resolves.toBe(tabbed)
    await expect(noteFrom('A.md', file('A.md', spaced('[the plan](Plan.md)')), plan)).resolves.toBe(
      spaced('[[Plan\\|the plan]]'),
    )
  })

  test('are left exactly as written in math', async () => {
    const block = '$$\nA[i](j) = 1\n$$\n'
    const span = 'Let $f[x](y)$ be, for $5 or [y](y.md).\n'

    await expect(noteFrom('A.md', file('A.md', block), file('j.md', '# j'))).resolves.toBe(block)
    await expect(noteFrom('A.md', file('A.md', span), file('y.md', '# y'))).resolves.toBe(
      'Let $f[x](y)$ be, for $5 or [[y]].\n',
    )
  })

  test('around a picture point the picture at its file', async () => {
    const pic = file('attachments/pic.png', 'png')

    await expect(
      noteFrom('A.md', file('A.md', '[![badge](pic.png)](https://example.com)\n'), pic),
    ).resolves.toBe('[![badge](attachments/pic.png)](https://example.com)\n')
    // The note keeps a markdown link, since a wikilink cannot show a picture.
    await expect(
      noteFrom(
        'A.md',
        file('A.md', '[![cover](pic.png)](Plan.md)\n'),
        file('Plan.md', '# Plan'),
        pic,
      ),
    ).resolves.toBe('[![cover](attachments/pic.png)](Plan.md)\n')
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

  test('to a file whose name holds brackets in a pair are pointed at it', async () => {
    await expect(
      noteFrom(
        'Notes/A.md',
        file('Notes/A.md', '![](Screenshot%20(1).png)\n'),
        file('Attachments/Screenshot (1).png', 'png'),
      ),
    ).resolves.toBe('![](../Attachments/Screenshot%20%281%29.png)\n')
  })

  test('whose words hold brackets in a pair are pointed at their files', async () => {
    await expect(
      noteFrom(
        'Notes/A.md',
        file('Notes/A.md', '![see [1]](pic.png)\n'),
        file('Attachments/pic.png', 'png'),
      ),
    ).resolves.toBe('![see [1]](../Attachments/pic.png)\n')
    // A wikilink with words after it in brackets is still a wikilink.
    await expect(
      noteFrom('A.md', file('A.md', 'See [[Plan]](draft).\n'), file('Plan.md', '# Plan')),
    ).resolves.toBe('See [[Plan]](draft).\n')
  })

  test('keep pointing at a file whose name holds a bracket alone', async () => {
    await expect(
      noteFrom(
        'Home.md',
        file('Home.md', 'Read [the intro](1%29%20Intro.pdf) first.\n'),
        file('1) Intro.pdf', '%PDF'),
      ),
    ).resolves.toBe('Read [the intro](1%29%20Intro.pdf) first.\n')
    await expect(
      noteFrom(
        'Home.md',
        file('Home.md', '![scan](%28draft%20scan.png)\n'),
        file('(draft scan.png', 'png'),
      ),
    ).resolves.toBe('![scan](%28draft%20scan.png)\n')
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

  test('that name a folder holding no such note are a note not written yet', async () => {
    const beta = file('Clients/Beta/Contacts.md', '# Beta\n')
    const wiki = 'Call [[Clients/Acme/Contacts]].\n'
    const markdown = 'Call [them](Clients/Acme/Contacts.md).\n'

    await expect(noteFrom('A.md', file('A.md', wiki), beta)).resolves.toBe(wiki)
    await expect(noteFrom('A.md', file('A.md', markdown), beta)).resolves.toBe(markdown)
    // The end of a path is enough, the way Obsidian reads it.
    await expect(noteFrom('A.md', file('A.md', 'Call [[Beta/Contacts]].\n'), beta)).resolves.toBe(
      'Call [[Contacts]].\n',
    )
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

  test('to a file whose name holds a bracket alone work when the Links setting writes markdown', async () => {
    setLinkWriting('shortest')
    try {
      await expect(
        noteFrom('Home.md', file('Home.md', 'Read ![[1) Intro.pdf]]\n'), file('1) Intro.pdf', 'x')),
      ).resolves.toBe('Read ![1) Intro.pdf](1%29%20Intro.pdf)\n')
    } finally {
      setLinkWriting('wikilink')
    }
  })

  test('in the properties stay wikilinks when the Links setting writes markdown', async () => {
    setLinkWriting('shortest')
    try {
      await expect(
        noteFrom(
          'Meeting.md',
          file('Meeting.md', '---\nproject: "[[Alpha]]"\n---\nAbout [[Alpha]].\n'),
          file('Alpha.md', '# Alpha\n'),
        ),
      ).resolves.toBe('---\nproject: "[[Alpha]]"\n---\nAbout [Alpha](Alpha.md).\n')
    } finally {
      setLinkWriting('wikilink')
    }
  })

  test('keep the folder that says which note is meant when the Links setting writes markdown', async () => {
    setLinkWriting('shortest')
    try {
      await expect(
        noteFrom(
          'Home.md',
          file('Home.md', 'See [[Projects/Plan]].\n'),
          file('Plan.md', '# Root\n'),
          file('Projects/Plan.md', '# Project\n'),
        ),
      ).resolves.toBe('See [Projects/Plan](Projects/Plan.md).\n')
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

/** A zip as Windows' "Compressed (zipped) folder" writes one: stored, its names in
 *  the machine's code page as they are given and not marked UTF-8. */
function windowsZip(entries: [Uint8Array, string][]): Uint8Array {
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff]
  const u32 = (n: number) => [...u16(n & 0xffff), ...u16(n >>> 16)]
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (bytes: Uint8Array) => {
    let c = 0xffffffff
    for (const b of bytes) c = (table[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }

  const local: number[] = []
  const central: number[] = []
  for (const [name, body] of entries) {
    const data = new TextEncoder().encode(body)
    const sizes = [...u32(crc(data)), ...u32(data.length), ...u32(data.length)]
    const offset = local.length
    local.push(...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u32(0), ...sizes)
    local.push(...u16(name.length), ...u16(0), ...name, ...data)
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u32(0))
    central.push(...sizes, ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0))
    central.push(...u32(0), ...u32(offset), ...name)
  }
  const count = u16(entries.length)
  const end = [...u32(0x06054b50), ...u32(0), ...count, ...count]
  return new Uint8Array([
    ...local,
    ...central,
    ...end,
    ...u32(central.length),
    ...u32(local.length),
    ...u16(0),
  ])
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

  test('keep a dot or a space before the extension, beside a namesake without one', async () => {
    await expect(
      pathsFrom([
        file('.obsidian/app.json', '{}'),
        file('Wait for it....md', '# Suspense\n'),
        file('Draft.md', 'one\n'),
        file('Draft .md', 'two\n'),
      ]),
    ).resolves.toEqual(['.obsidian/app.json', 'Draft .md', 'Draft.md', 'Wait for it....md'])
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

  test('renamed for Windows are still what a canvas card shows', async () => {
    const board =
      '{\n  "nodes": [{ "id": "a", "type": "file", "file": "Questions/Why?.md" }],\n  "edges": []\n}'
    const plan = await readAs('obsidian', [
      file('.obsidian/app.json', '{}'),
      file('Questions/Why?.md', '# Why'),
      file('Questions/Board.canvas', board),
    ])
    const canvas = plan.files.find((one) => one.path === 'Questions/Board.canvas')
    expect(plan.files.map((one) => one.path)).toContain('Questions/Why.md')
    expect(canvas?.kind === 'file' && new TextDecoder().decode(canvas.bytes)).toBe(
      board.replace('Why?.md', 'Why.md'),
    )
  })

  test('keep their links when a rename for Windows gives one a namesake', async () => {
    const plan = await readAs('obsidian', [
      file('.obsidian/app.json', '{}'),
      file('Home.md', 'Read [[Why?]] first, then [[Why]].\n'),
      file('Notes/Why?.md', 'the new one'),
      file('Archive/Why.md', 'the old one'),
    ])
    const home = plan.files.find((one) => one.path === 'Home.md')
    expect(home?.kind === 'note' && home.text).toBe(
      'Read [[Notes/Why]] first, then [[Archive/Why]].\n',
    )
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

  test('arrive both when their names differ only in how an accent is composed', async () => {
    const plan = await readAs('obsidian', [
      file('.obsidian/app.json', '{}'),
      file('Caf\u00e9.md', 'typed on Linux'),
      file('Cafe\u0301.md', 'synced from a Mac'),
    ])
    const notes = plan.files.flatMap((one) => (one.kind === 'note' ? [one.path] : []))
    expect(notes).toEqual(['Caf\u00e9.md', 'Cafe\u0301 2.md'])
  })

  test('whose names a Mac wrote with their accents apart are found by a link typed whole', async () => {
    // As Finder or Preview saves a name, with each accent apart from its letter; a
    // link typed or completed holds them together, and Obsidian reads both as one.
    const embedded = await noteFrom(
      'Notes/Job.md',
      file(`Attachments/${'R\u00e9sum\u00e9'.normalize('NFD')}.pdf`, '%PDF-1.7'),
      file('Notes/Job.md', '![](R%C3%A9sum%C3%A9.pdf)\n'),
    )
    expect(embedded.normalize('NFC')).toBe('![](../Attachments/R\u00e9sum\u00e9.pdf)\n')

    // The same file renamed for Windows on the way in, its link following it.
    const renamed = await noteFrom(
      'Notes/Quiz.md',
      file(`Pics/${'R\u00e9ponse'.normalize('NFD')}?.png`, 'png'),
      file('Notes/Quiz.md', '![[R\u00e9ponse?.png]]\n'),
    )
    expect(renamed.normalize('NFC')).toBe('![[R\u00e9ponse.png]]\n')
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

  test('keep their accented names from a zip Windows made', async () => {
    const ascii = (said: string) => [...new TextEncoder().encode(said)]
    // `é` is 0x82 in code page 437, and the bytes are not UTF-8.
    const cafe = (before: string, after: string) =>
      new Uint8Array([...ascii(`${before}Caf`), 0x82, ...ascii(after)])
    const zip = windowsZip([
      [new Uint8Array(ascii('Brain/.obsidian/app.json')), '{}'],
      [new Uint8Array(ascii('Brain/Home.md')), 'See [[Café]] and ![[Café.png]]\n'],
      [cafe('Brain/', '.md'), '# Café\n'],
      [cafe('Brain/Attachments/', '.png'), 'png'],
      // A name macOS wrote, UTF-8 that does not say so, reads as UTF-8.
      [new Uint8Array(ascii('Brain/Crème.md')), '# Crème\n'],
    ])

    const sources = await sourcesFrom([
      { name: 'Brain.zip', arrayBuffer: async () => zip.slice().buffer },
    ])
    await expect(detect(sources)).resolves.toBe('obsidian')
    await expect(pathsFrom(sources)).resolves.toEqual([
      '.obsidian/app.json',
      'Attachments/Café.png',
      'Café.md',
      'Crème.md',
      'Home.md',
    ])
  })

  test('land at the top of the space with their settings when a hidden file sits beside the vault', async () => {
    const sources = [
      file('Brain/.obsidian/app.json', '{"vimMode":true}'),
      file('Brain/Home.md', 'hi'),
      file('.nomedia', ''),
    ]

    await expect(detect(sources)).resolves.toBe('obsidian')
    await expect(pathsFrom(sources)).resolves.toEqual(['.obsidian/app.json', 'Home.md'])
    expect((await obsidianCarries(sources)).vim).toBe(true)
  })

  test('stay in their folders when the folder picked holds more than one vault', async () => {
    const notes = async (sources: Source[]) =>
      (await pathsFrom(sources)).filter((one) => !one.includes('.obsidian'))

    await expect(
      notes([
        file('Work/.obsidian/app.json', '{"useMarkdownLinks": true}'),
        file('Work/Home.md', '# Work home'),
        file('Personal/.obsidian/app.json', '{}'),
        file('Personal/Home.md', '# Personal home'),
      ]),
    ).resolves.toEqual(['Personal/Home.md', 'Work/Home.md'])
    // A vault one folder down beside notes of the folder's own is not poured over them.
    await expect(
      notes([
        file('Home.md', '# Loose home'),
        file('Vault/.obsidian/app.json', '{}'),
        file('Vault/Home.md', '# Vault home'),
      ]),
    ).resolves.toEqual(['Home.md', 'Vault/Home.md'])
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
