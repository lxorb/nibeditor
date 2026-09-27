import { describe, expect, test, vi } from 'vitest'
import { scanNote } from '../scan-note'

/** The note behind a hover preview, and the note inside an `![[embed]]`, read
 *  through the editor exactly as the app wires it - against the reading view of
 *  the same note, rendered here beside it.
 *
 *  What went wrong: the editor rendered a shown note itself, with a renderer that
 *  has no fence highlighter, no diagram drawers, no embed resolver, no link
 *  resolver, no metadata rows and no picture resolver for the note it was showing.
 *  So a fenced code block in a hover preview came out grey and frameless, a
 *  callout as a plain quote, a picture as a broken image - while the reading view
 *  of that very note showed all of it. There is one render now, and the whole of
 *  what this file says is that the two paths end in the same string.
 *
 *  The space is the app's own index over real notes rather than something shaped
 *  like one: both paths have to resolve a link and read an embedded note, and a
 *  stand-in is a second answer to go wrong. One did - the reading view's resolver
 *  changed shape under this very file - and a stand-in would have hidden it. Only
 *  the two things that are not the app are stood in for: the disk, and where a
 *  picture ends up on a platform this test is not running on. */

const ROOT = '/space'

/** Every kind of block a note is made of, in one note. */
const FIXTURE = `---
title: Everything
tags:
  - one
  - two
---

# Everything

[toc]

\`\`\`ts pipeline.ts
const ink = 'on glass'
\`\`\`

> [!tip]- Folds away
> Mind this.

| One | Two |
| --- | --- |
| 1 | 2 |

$$
e = mc^2
$$

- [ ] one
- [x] two

![[shot.png]]

![[Plan]]

See [[Plan#Why it works]] and [[ideas/Later|later]].

Text[^1].

[^1]: The note.
`

/** The space around it, as notes rather than as an index: the app's own scanner
 *  reads the headings, the blocks and the aliases out of these. */
const BODIES: Record<string, string> = {
  'Notes/Today.md': FIXTURE,
  'Plan.md': '# Plan\n\nThe plan itself.\n\n## Why it works\n\nBecause.\n',
  'ideas/Later.md': '# Later\n\nSoon.\n',
}

/** Everything in the space that is not a note: the picture an embed names. */
const FILES = ['shot.png']

/** The disk, stood in for. The index scans a space and reads a note through the
 *  platform shim, and under node there is none. */
vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: async (command: string, args?: Record<string, unknown>) => {
    const path = typeof args?.path === 'string' ? args.path : ''

    switch (command) {
      case 'scan_links':
        return {
          notes: Object.entries(BODIES).map(([one, content]) => scanNote(one, content)),
          files: FILES,
        }
      case 'read_note': {
        const doc = BODIES[path.slice(ROOT.length + 1)]
        if (doc === undefined) throw new Error(`no such note: ${path}`)
        return doc
      }
      default:
        return undefined
    }
  },
}))

/** Where a picture ends up is note-images.ts's business, and depends on a
 *  platform; here it only matters that a shown note's pictures go through it at
 *  all - they used to go through the open note's resolver, which is a different
 *  note's folder. */
vi.mock('../note-images', () => ({
  notePicture: (src: string) => `asset://${src}`,
}))

const { links } = await import('../link-index.svelte')
const { startup } = await import('../startup.svelte')
const { readingHtml } = await import('./render')
const { modes } = await import('../modes.svelte')
const { EditorState, noteIndexExtension, renderNote } = await import('@nib/editor')

/** The exporter, loaded once rather than by whichever test rendered first; see
 *  render.test.ts, and docs/conventions.md. */
await import('../export')

// A space is scanned once its file list is on screen, which is what the launch
// says for itself; said once here so the scan is not waiting on a frame that
// never comes. See startup.svelte.ts, and link-index.test.ts.
void startup.shown()
await links.build(ROOT)

/** The note's path as the app holds it, and as a link speaks of it. */
const PATH = `${ROOT}/Notes/Today.md`
const RELATIVE = 'Notes/Today.md'

/** The state the editor renders a shown note in, with the render the app hands
 *  over: one call to the reading view, on the shown note's own path. This is
 *  `shownHtml` in link-index.svelte.ts, which turns the relative path a link
 *  speaks in into the path the app holds. */
function shown(render = true) {
  return EditorState.create({
    extensions: [
      noteIndexExtension({
        notes: [],
        files: FILES,
        path: RELATIVE,
        read: () => Promise.resolve(null),
        ...(render
          ? {
              render: (source: string, from: string | null) =>
                readingHtml(
                  { text: source, path: from === null ? null : `${ROOT}/${from}` },
                  'light',
                  true,
                ),
            }
          : {}),
      }),
    ],
  })
}

const reading = () => readingHtml({ text: FIXTURE, path: PATH }, 'light', true)

describe('the note behind a hover preview', () => {
  test('is the reading view of that note, to the character', async () => {
    const [preview, read] = await Promise.all([renderNote(FIXTURE, RELATIVE, shown()), reading()])

    // Nothing between them but the card the preview puts it in.
    expect(preview).toBe(read)
  })

  test('has every kind of block the reading view has', async () => {
    // The rows, which a reader asks for: hidden is where the front matter starts.
    modes.setProperties('properties')
    const html = await renderNote(FIXTURE, RELATIVE, shown()).finally(() => {
      modes.setProperties('hidden')
    })

    // A fence with a language and a caption: framed, captioned and coloured.
    expect(html).toContain('<figure class="code"')
    expect(html).toContain('pipeline.ts')
    expect(html).toContain('hl-keyword')
    // A callout that folds, with its icon.
    expect(html).toContain('data-callout="tip"')
    expect(html).toContain('callout-icon')
    expect(html).toContain('<summary')
    expect(html).toContain('<table>')
    expect(html).toContain('katex')
    // Task boxes, and inert - a glance is not a place a note is changed.
    expect(html).toContain('class="task-list-item"')
    expect(html).toContain('class="task-list-item is-done"')
    expect(html).toContain('disabled')
    // A picture named by an embed, pointed where the host says it lives.
    expect(html).toContain('src="asset://shot.png"')
    // A note named by an embed, read out of the space.
    expect(html).toContain('<figure class="embed">')
    expect(html).toContain('The plan itself.')
    // The note's own metadata, as the rows the editor draws.
    expect(html).toContain('class="properties"')
    expect(html).toContain('Everything')
    // Links into the space, through the index's own resolver: the heading a link
    // names, and a note named by the end of its path.
    expect(html).toContain('href="Plan.md#why-it-works"')
    expect(html).toContain('<a class="wikilink" href="ideas/Later.md">later</a>')
    expect(html).toContain('<nav class="toc">')
    // Anchors on the headings, and the footnotes gathered at the end.
    expect(html).toContain('<h1 id="everything">')
    expect(html).toContain('<section class="footnotes">')
    // And nothing of the front matter left in the words.
    expect(html).not.toContain('tags:')
  })

  test('is not the thin render the editor can do with no app around it', async () => {
    const thin = await renderNote(FIXTURE, RELATIVE, shown(false))

    // Each of these is one of the things missing from the preview, and each of
    // them is what a renderer with no app around it cannot produce: no parser to
    // colour a fence, no space to read an embedded note out of or to point a link
    // into, no host to ask where a picture lives, and no rows because metadata is
    // a thing the app knows a note by. The frame and the caption round the fence
    // are the renderer's own and are there either way.
    expect(thin).not.toContain('hl-keyword')
    expect(thin).not.toContain('class="properties"')
    expect(thin).not.toContain('<figure class="embed">')
    expect(thin).not.toContain('<nav class="toc">')
    expect(thin).toContain('<p>[toc]</p>')
    expect(thin).not.toContain('class="wikilink"')
    expect(thin).toContain('src="shot.png"')
  })
})
