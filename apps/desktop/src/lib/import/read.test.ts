import { describe, expect, test } from 'vitest'

import { detect, readAs } from './read'
import { sourceOf, type Source } from './sources'

function file(path: string, body = 'x'): Source {
  return sourceOf(path, new TextEncoder().encode(body))
}

describe('which app an export came out of', () => {
  test('an Evernote file says so by its extension', async () => {
    await expect(detect([file('Travel.enex', '<en-export></en-export>')])).resolves.toBe('evernote')
  })

  test('a Tomboy note says so by its extension', async () => {
    await expect(detect([file('abc.note', '<note><note-content/></note>')])).resolves.toBe('tomboy')
  })

  test('a Notion export says so with an id on every name', async () => {
    await expect(
      detect([file('Plan 1a2b3c4d5e6f78901a2b3c4d5e6f7890.md', '# Plan')]),
    ).resolves.toBe('notion')
  })

  test('a folder of notes with one Notion page kept in it is a folder of notes', async () => {
    const standup = '# Standup\nDate: 2024-03-02\nAttendees: Ann, Bob\n\nShipped the beta.\n'
    const sources = [
      file('Standup.md', standup),
      file('Home.md', '# Home\n\nSee [[Standup]].\n'),
      file('Inbox/Old page 0123456789abcdef0123456789abcdef.md', '# Old page\n'),
    ]
    await expect(detect(sources)).resolves.toBe('markdown')

    const plan = await readAs('markdown', sources)
    const read = plan.files.find((one) => one.path === 'Standup.md')
    expect(read?.kind === 'note' && read.text).toBe(standup)
    // An HTML export's own index carries no id, and the pages still say Notion.
    await expect(
      detect([
        file('index.html', '<html></html>'),
        file('Plan 1a2b3c4d5e6f78901a2b3c4d5e6f7890.html'),
      ]),
    ).resolves.toBe('notion')
  })

  test('a folder of notes with a folder called Keep is a folder of notes', async () => {
    const sources = [
      file('Home.md', '# Home\n\nSee [[Shopping]].\n'),
      file('Keep/Shopping.md', '- milk\n'),
    ]
    await expect(detect(sources)).resolves.toBe('markdown')

    const plan = await readAs('markdown', sources)
    expect(plan.files.map((one) => one.path).sort()).toEqual(['Home.md', 'Keep/Shopping.md'])
  })

  test('a Keep export says so by its folder, or by what a note holds', async () => {
    await expect(detect([file('Takeout/Keep/A.json', '{}')])).resolves.toBe('keep')
    await expect(detect([file('A.json', '{"textContent":"words"}')])).resolves.toBe('keep')
  })

  test('a Roam graph says so by its shape', async () => {
    const graph = JSON.stringify([{ title: 'A', children: [{ string: 'x' }] }])

    await expect(detect([file('graph.json', graph)])).resolves.toBe('roam')
  })

  test('a Logseq graph says so by its folders', async () => {
    await expect(
      detect([file('journals/2026_01_02.md', '- x'), file('pages/A.md', '- y')]),
    ).resolves.toBe('logseq')
    await expect(detect([file('pages/A.md', '- y')])).resolves.toBe('logseq')
    // A zip whose one entry is the graph.
    await expect(detect([file('Graph/pages/A.md', '- y')])).resolves.toBe('logseq')
  })

  test('a folder of notes with a Journals folder of its own is a folder of notes', async () => {
    const sources = [
      file('Home.md', '# Home\n\nSee [[Plan]].\n'),
      file('Projects/Plan.md', '# Plan\n\n- TODO call the bank\n'),
      file('Journals/2024/01/2024-01-15.md', '# Monday\n'),
      file('Journals/2024/02/2024-02-01.md', '# Thursday\n'),
    ]
    const format = await detect(sources)
    expect(format).toBe('markdown')

    const plan = await readAs(format ?? 'markdown', sources)
    expect(plan.files.map((one) => one.path).sort()).toEqual([
      'Home.md',
      'Journals/2024/01/2024-01-15.md',
      'Journals/2024/02/2024-02-01.md',
      'Projects/Plan.md',
    ])
    // Logseq's own folder still says it is a graph, journals and all.
    await expect(
      detect([file('journals/2026_01_02.md', '- x'), file('logseq/config.edn', '{}')]),
    ).resolves.toBe('logseq')
  })

  test('a folder of notes with a pages folder deep inside is a folder of notes', async () => {
    const sources = [
      file('Home.md', 'Today:\n\n- TODO call the bank\n- DONE send invoice\n'),
      file('Clients/Acme/Website/pages/About.md', '# About'),
    ]
    await expect(detect(sources)).resolves.toBe('markdown')
  })

  test('a TextBundle says what wrote it', async () => {
    await expect(
      detect([
        file('A.textbundle/info.json', '{"creatorIdentifier":"net.shinyfrog.bear"}'),
        file('A.textbundle/text.md', '# A'),
      ]),
    ).resolves.toBe('bear')

    await expect(
      detect([
        file('A.textbundle/info.json', '{"creatorIdentifier":"com.lukilabs.lukiapp"}'),
        file('A.textbundle/text.md', '# A'),
      ]),
    ).resolves.toBe('craft')
  })

  test("a folder of markdown with Bear's own tags in it is Bear's", async () => {
    await expect(detect([file('A.md', '# A\n\n#two words# here')])).resolves.toBe('bear')
    await expect(detect([file('A.md', '# A\n\nplain words')])).resolves.toBe('markdown')
  })

  test('a folder of notes with two ordinary tags on a line is a folder of notes', async () => {
    const sources = [
      file('Home.md', '# Home\n\nTags: #project #work\n'),
      file('Plan.md', '# Plan\n'),
      file('.git/config', '[core]\n'),
      file('.trash/Old draft.md', '# Thrown away\n'),
    ]
    const format = await detect(sources)
    expect(format).toBe('markdown')

    const plan = await readAs(format ?? 'markdown', sources)
    expect(plan.files.map((one) => one.path).sort()).toEqual(['Home.md', 'Plan.md'])
  })

  test('a OneNote page says so in its own markup', async () => {
    const page = '<html><head><meta name="Generator" content="Microsoft OneNote 15"></head></html>'

    await expect(detect([file('Page.html', page)])).resolves.toBe('onenote')
    await expect(detect([file('Page.html', '<html></html>')])).resolves.toBe('markdown')
  })

  test('a CSV on its own is a table', async () => {
    await expect(detect([file('Books.csv', 'Name\nDune')])).resolves.toBe('table')
    // With notes beside it, it is part of whatever those notes are.
    await expect(detect([file('Books.csv', 'Name\nDune'), file('A.md', '# A')])).resolves.toBe(
      'markdown',
    )
  })

  test("a document only pandoc reads is named as pandoc's", async () => {
    await expect(detect([file('Thesis.docx', 'PK')])).resolves.toBe('pandoc')
  })

  test('nothing at all, and nothing readable, answer nothing', async () => {
    await expect(detect([])).resolves.toBeNull()
    await expect(detect([file('holiday.mp4', 'binary')])).resolves.toBeNull()
  })
})

describe('reading as a format', () => {
  test('answers a plan for each of them', async () => {
    const plan = await readAs('markdown', [file('A.md', '# A')])

    expect(plan.format).toBe('markdown')
    expect(plan.files).toHaveLength(1)
  })

  test('a folder of notes leaves its hidden files behind, git and a trash among them', async () => {
    // A vault kept in git whose `.obsidian/` was never committed: a folder of notes.
    const sources = [
      file('Home.md', '# Home\n\nSee [[Plan]]'),
      file('Plan.md', '# Plan'),
      file('.trash/Deleted idea.md', '# thrown away'),
      file('.git/HEAD', 'ref: refs/heads/main'),
      file('.git/config', '[core]'),
      file('.gitignore', '.obsidian/'),
    ]
    const format = await detect(sources)
    expect(format).toBe('markdown')

    const plan = await readAs(format ?? 'markdown', sources)
    expect(plan.files.map((one) => one.path).sort()).toEqual(['Home.md', 'Plan.md'])
  })

  test("pandoc's own formats answer an empty plan, since pandoc reads those", async () => {
    const plan = await readAs('pandoc', [file('A.docx', 'PK')])

    expect(plan.files).toHaveLength(0)
  })
})
