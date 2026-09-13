import { describe, expect, test } from 'vitest'

import { toBase64 } from '../bytes'
import { planFor, type AppleNotes } from './apple'
import { detect, readAs } from './read'
import { sourceOf, type Source } from './sources'

function file(path: string, body: string): Source {
  return sourceOf(path, new TextEncoder().encode(body))
}

/** What the crate answers, in the shape it answers it: notes with the path they
 *  had in Notes, the attachments as bytes, and a count of what could not come. */
function read(): AppleNotes {
  return {
    notes: [
      {
        path: 'Groceries.md',
        title: 'Groceries',
        text: '# Groceries\n\n- [x] Milk\n- [ ] Eggs\n',
        // 2026-09-04 and 2026-09-05, as seconds since 1970.
        created: 1_788_480_000,
        modified: 1_788_566_400,
      },
      {
        path: 'Work/Ideas.md',
        title: 'Ideas',
        text: '# Ideas\n\nSee ![](assets/photo.png) and [Groceries](Groceries.md)\n',
        created: 1_788_480_000,
        modified: 1_788_480_000,
      },
      {
        path: 'Work/No title at all.md',
        title: 'No title at all',
        text: 'Just the words.\n',
        created: 0,
        modified: 0,
      },
    ],
    media: [{ path: 'assets/photo.png', bytes: toBase64(new Uint8Array([1, 2, 3])) }],
    locked: 2,
    binned: 1,
    drawn: 3,
    tables: 1,
    missing: 4,
  }
}

function noteAt(plan: Awaited<ReturnType<typeof planFor>>, path: string): string {
  const found = plan.files.find((one) => one.path === path)
  expect(found, `${path} among ${plan.files.map((one) => one.path).join(', ')}`).toBeTruthy()
  return found?.kind === 'note' ? found.text : ''
}

describe("Apple Notes off the Mac's own database", () => {
  test('arrives under the folders it sat in, with the attachments beside it', async () => {
    const plan = await planFor(read())
    const paths = plan.files.map((one) => one.path)

    expect(plan.format).toBe('apple-notes')
    expect(paths).toContain('Groceries.md')
    expect(paths).toContain('Work/Ideas.md')
    expect(paths).toContain('assets/photo.png')
  })

  test('carries the two days Notes knew', async () => {
    const note = noteAt(await planFor(read()), 'Groceries.md')

    expect(note.startsWith('---\ndate: 2026-09-04\nupdated: 2026-09-05\n---\n')).toBe(true)
  })

  test('a note Notes had no date for says nothing about when it was written', async () => {
    const note = noteAt(await planFor(read()), 'Work/No title at all.md')

    expect(note).not.toContain('date:')
    // The title is on the row rather than in the words, so the heading is added.
    expect(note).toContain('# No title at all')
  })

  test('a link to another note becomes a wikilink, and a picture stays a path', async () => {
    const note = noteAt(await planFor(read()), 'Work/Ideas.md')

    expect(note).toContain('[[Groceries]]')
    // Written from `Work/`, which is where that note went.
    expect(note).toContain('![](../assets/photo.png)')
  })

  test('says what Notes keeps to itself, with the counts', async () => {
    const said = (await planFor(read())).lost.map((one) => one.text)

    expect(said.some((one) => one.includes('behind a password'))).toBe(true)
    expect(said.some((one) => one.includes('Recently Deleted'))).toBe(true)
    expect(said.some((one) => one.includes('drawings'))).toBe(true)
    expect(said.some((one) => one.includes('tables'))).toBe(true)
    expect(said.some((one) => one.includes('iCloud'))).toBe(true)
  })

  test('nothing is said about what did come over whole', async () => {
    const plan = await planFor({
      ...read(),
      locked: 0,
      binned: 0,
      drawn: 0,
      tables: 0,
      missing: 0,
    })

    expect(plan.lost).toEqual([])
  })
})

/** What an exporter hands over: a folder per notebook, a file per note, and the
 *  note's rich text as macOS writes rich text. The attachment is pointed at by
 *  the address it had on the machine it was exported from, which is what Notes
 *  puts in the HTML it hands out. */
const EXPORTED = `<html>
<head><meta name="Generator" content="Cocoa HTML Writer"></head>
<body>
<p class="p1"><span class="s1" style="font: 24px '-apple-system-font'">Groceries</span></p>
<p class="p1"><span class="s1">Milk and eggs</span></p>
<p class="p1"><img src="file:///Users/emil/Exported/Notes/photo.png"></p>
</body>
</html>
`

function exported(): Source[] {
  return [
    file('Exported/Notes/Groceries.html', EXPORTED),
    sourceOf('Exported/Notes/photo.png', new Uint8Array([1, 2, 3])),
    file('Exported/Work/Ideas.html', EXPORTED),
  ]
}

describe('a folder an Apple Notes exporter wrote', () => {
  test('is read as Apple Notes rather than as a folder of HTML', async () => {
    expect(await detect(exported())).toBe('apple-notes')
  })

  test('becomes a note per note, in the folders the notebooks were', async () => {
    const plan = await readAs('apple-notes', exported())
    const paths = plan.files.map((one) => one.path)

    expect(paths).toContain('Exported/Notes/Groceries.md')
    expect(paths).toContain('Exported/Work/Ideas.md')
    expect(paths).toContain('Exported/Notes/photo.png')
  })

  test("an attachment's address on the old machine points at the file that came with it", async () => {
    const plan = await readAs('apple-notes', exported())
    const note = plan.files.find((one) => one.path === 'Exported/Notes/Groceries.md')

    expect(note?.kind === 'note' && note.text).toContain('![](photo.png)')
  })

  test('an address to something that was not in the export is left as it was', async () => {
    const plan = await readAs('apple-notes', [
      file(
        'Notes/Only.html',
        `<html><head><meta name="Generator" content="Cocoa HTML Writer"></head>
         <body><p><img src="file:///Users/emil/elsewhere.png"></p></body></html>`,
      ),
    ])
    const note = plan.files[0]

    expect(note?.kind === 'note' && note.text).toContain('file:///Users/emil/elsewhere.png')
  })

  /** Notes writes its own scheme for a link between two notes, and an exporter hands
   *  that scheme over as it stands. It is a fact about where the note used to live, so
   *  it stays a link rather than arriving as the words with the address thrown away;
   *  see `appTargets` in @nib/markdown. */
  test("a link in Apple's own scheme stays a link", async () => {
    const plan = await readAs('apple-notes', [
      file(
        'Notes/Only.html',
        `<html><head><meta name="Generator" content="Cocoa HTML Writer"></head>
         <body><p><a href="applenotes:note/ideas">Ideas</a></p></body></html>`,
      ),
    ])
    const note = plan.files[0]

    expect(note?.kind === 'note' && note.text).toContain('[Ideas](applenotes:note/ideas)')
  })

  test('and a scheme that runs code is still only the words', async () => {
    const plan = await readAs('apple-notes', [
      file(
        'Notes/Only.html',
        `<html><head><meta name="Generator" content="Cocoa HTML Writer"></head>
         <body><p><a href="javascript:alert(1)">Ideas</a></p></body></html>`,
      ),
    ])
    const note = plan.files[0]

    expect(note?.kind === 'note' && note.text).toContain('Ideas')
    expect(note?.kind === 'note' && note.text).not.toContain('javascript:')
  })
})
