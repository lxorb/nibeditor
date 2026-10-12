import { describe, expect, test } from 'vitest'

import { counts, type ImportPlan } from './plan'
import { readPlain } from './plain'
import { sourceOf, type Source } from './sources'

function file(path: string, body: string): Source {
  return sourceOf(path, new TextEncoder().encode(body))
}

function noteAt(plan: ImportPlan, path: string): string {
  const found = plan.files.find((one) => one.path === path)
  if (found?.kind !== 'note') throw new Error(`no note at ${path}`)
  return found.text
}

describe('a folder of markdown', () => {
  test('keeps its folders, its notes and its pictures', async () => {
    const plan = await readPlain([
      file('Plans/Trip.md', '# Trip\n\nSee [the list](../Lists/Kit.md).\n'),
      file('Lists/Kit.md', '# Kit\n\n![](../Pictures/tent.png)\n'),
      file('Pictures/tent.png', 'PNG'),
    ])

    expect(counts(plan)).toEqual({ notes: 2, files: 1, folders: 3, bytes: expect.any(Number) })
    expect(plan.files.map((one) => one.path)).toEqual([
      'Plans/Trip.md',
      'Lists/Kit.md',
      'Pictures/tent.png',
    ])
  })

  test('a link to another note becomes a wikilink, however it was written', async () => {
    const plan = await readPlain([
      file('A.md', 'One [the kit](Lists/Kit.md), two [[Kit]], three [k](Lists%2FKit.md).'),
      file('Lists/Kit.md', '# Kit'),
    ])

    const text = noteAt(plan, 'A.md')
    expect(text).toContain('[[Kit|the kit]]')
    expect(text).toContain('two [[Kit]]')
    expect(text).toContain('three [[Kit|k]]')
  })

  test('a link to a picture stays a link, with a path that resolves', async () => {
    const plan = await readPlain([
      file('Plans/Trip.md', '![tent](../Pictures/a tent.png)'),
      file('Pictures/a tent.png', 'PNG'),
    ])

    expect(noteAt(plan, 'Plans/Trip.md')).toContain('![tent](../Pictures/a%20tent.png)')
  })

  test('a link to somewhere else entirely is left alone', async () => {
    const plan = await readPlain([
      file('A.md', '[web](https://example.com/a.md) [down](#heading) [mail](mailto:a@b.c)'),
    ])

    const text = noteAt(plan, 'A.md')
    expect(text).toContain('[web](https://example.com/a.md)')
    expect(text).toContain('[down](#heading)')
    expect(text).toContain('[mail](mailto:a@b.c)')
  })

  test('a link to a note that was not exported is left as it was', async () => {
    const plan = await readPlain([file('A.md', '[gone](Somewhere/Else.md)')])

    expect(noteAt(plan, 'A.md')).toContain('[gone](Somewhere/Else.md)')
  })

  test('leaves out what the two desktops leave in every folder', async () => {
    const plan = await readPlain([
      file('A.md', '# A'),
      file('.DS_Store', 'junk'),
      file('__MACOSX/._A.md', 'junk'),
      file('Notes/Thumbs.db', 'junk'),
      file('Icon\r', ''),
      file('Notes/Icon\r', ''),
    ])

    expect(plan.files).toHaveLength(1)
  })

  test('a name no file may have is argued with, one folder at a time', async () => {
    const plan = await readPlain([file('Plans: 2026/What? Why.md', '# x')])

    expect(plan.files[0]?.path).toBe('Plans 2026/What Why.md')
  })

  test('two notes that would land on one name are stepped apart', async () => {
    const plan = await readPlain([file('A: b.md', '# one'), file('A? b.md', '# two')])

    expect(plan.files.map((one) => one.path)).toEqual(['A b.md', 'A b 2.md'])
  })

  test('a text file is a note', async () => {
    const plan = await readPlain([file('Note.txt', 'Just words')])

    expect(plan.files[0]?.path).toBe('Note.md')
  })
})

describe('a TextBundle', () => {
  test('becomes the note it holds, named after the bundle, with its assets', async () => {
    const plan = await readPlain([
      file('Trips/Iceland.textbundle/info.json', '{"version":2}'),
      file('Trips/Iceland.textbundle/text.md', '# Iceland\n\n![](assets/shot.png)\n'),
      file('Trips/Iceland.textbundle/assets/shot.png', 'PNG'),
    ])

    expect(plan.files.map((one) => one.path)).toEqual(['Trips/Iceland.md', 'assets/shot.png'])
    expect(noteAt(plan, 'Trips/Iceland.md')).toContain('![](../assets/shot.png)')
  })
})

describe('a folder of HTML', () => {
  test('becomes markdown, and says that it was HTML', async () => {
    const plan = await readPlain(
      [file('Page.html', '<h1>Page</h1><p>One <b>bold</b> word and a <ul><li>list</li></ul></p>')],
      { format: 'onenote' },
    )

    const text = noteAt(plan, 'Page.md')
    expect(text).toContain('# Page')
    expect(text).toContain('**bold**')
    expect(text).toContain('- list')
    expect(plan.lost[0]?.values).toEqual({ count: 1 })
  })

  test('a link between two pages of an HTML export still finds its note', async () => {
    const plan = await readPlain([
      file('A.html', '<a href="B.html">to B</a>'),
      file('B.html', '<h1>B</h1>'),
    ])

    expect(noteAt(plan, 'A.md')).toContain('[[B|to B]]')
  })
})
