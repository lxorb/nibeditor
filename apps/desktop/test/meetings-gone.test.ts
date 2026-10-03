import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { frontMatterValue, stripFrontMatter } from '@nib/markdown/front-matter'
import { openerFor } from '../src/lib/openers'
import { kindOfName } from '../src/lib/sync2/create'
import { webUrlOf } from '../src/lib/web-tab/note'

/** Meeting notes went on 2026-10-03: Record, Transcribe on the embed and `/summarize`
 *  already did everything a meeting note did, so the kind was a second way in to the
 *  same three things.
 *
 *  Two promises come with that. A meeting note somebody already has is a note like any
 *  other - nothing migrated, nothing deleted, nothing about it read differently - and
 *  no surface offers to make another one, which is the half that drifts back in by
 *  accident: a row copied from an old branch, a string kept in one catalogue, an enum
 *  an agent still sees. */

/** A meeting note exactly as the recorder wrote one until that day. */
const OLD_MEETING = `---
date: 2026-09-12
duration: 4:09
---

# Meeting 2026-09-12 1432

![[recording-2026-09-12-1432.weba]]

*Written by gpt-6-astra*

## Takeaways

- The fonts are decided

## Transcript (German)
*Written by whisper*

Guten Morgen, wir fangen an.
`

const PATH = 'Work/Meeting 2026-09-12 1432.md'

describe('a meeting note already on a disk', () => {
  test('opens as a note, in the app and in the plugin', () => {
    const isUrlNote = () => webUrlOf(OLD_MEETING) !== null
    expect(openerFor(PATH, isUrlNote, { evenBuild: false, isPlugin: false })).toBe('note')
    expect(openerFor(PATH, isUrlNote, { evenBuild: true, isPlugin: true })).toBe('note')
  })

  test('syncs as a note', () => {
    expect(kindOfName('Meeting 2026-09-12 1432.md')).toBe('note')
  })

  /** Nothing in its front matter names a kind, so nothing is there to be read
   *  differently now: the date and the duration are two keys like any other. */
  test('keeps its front matter as two plain keys', () => {
    expect(frontMatterValue(OLD_MEETING, 'date')).toBe('2026-09-12')
    expect(frontMatterValue(OLD_MEETING, 'duration')).toBe('4:09')
    expect(frontMatterValue(OLD_MEETING, 'kind')).toBeNull()
    expect(stripFrontMatter(OLD_MEETING).trimStart().startsWith('# Meeting')).toBe(true)
  })
})

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const APP = join(ROOT, 'apps/desktop/src')

function files(dir: string, keep: (path: string) => boolean): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...files(path, keep))
    else if (keep(path)) out.push(path)
  }
  return out
}

const read = (path: string) => readFileSync(path, 'utf8')

describe('no surface offers to make one', () => {
  /** The palette, the Paragraph menu, the `/` menu, the space's plus, Settings > AI >
   *  Used for: every one of them is built from an id or a label, so neither may be
   *  left anywhere the app is built from. */
  test('no row of the app carries the id or the words', () => {
    const source = files(
      APP,
      (path) =>
        /\.(ts|svelte)$/.test(path) &&
        !path.endsWith('.test.ts') &&
        !/[\\/]locales[\\/]/.test(path),
    )
    const offering = source.filter((path) =>
      /'meeting'|Meeting notes|Stop the meeting|canTakeMeetingNotes/.test(read(path)),
    )
    expect(offering).toEqual([])
  })

  test('no catalogue keeps its strings', () => {
    const kept = files(join(APP, 'locales'), (path) => path.endsWith('.ts')).filter((path) =>
      /^\s*(?:'Meeting notes'|Meeting|'Stop the meeting'):/m.test(read(path)),
    )
    expect(kept).toEqual([])
  })

  /** What an agent may make: `create_note`'s kinds, `workspace_tabs new`'s kinds. */
  test('no agent tool offers the kind', () => {
    const tools = read(join(ROOT, 'apps/desktop/src-tauri/src/mcp/tools.json'))
    expect(tools.toLowerCase()).not.toContain('meeting')
  })

  /** The Worker's summary route was a meeting's and nothing else's. */
  test('the account offers no meeting summary', () => {
    const routes = read(join(ROOT, 'services/sync/src/ask/index.ts'))
    expect(routes).not.toContain("'/summary'")
  })
})
