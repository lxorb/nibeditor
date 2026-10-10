import { readBase } from '@nib/bases'
import { describe, expect, test } from 'vitest'

import { notionPage, readNotion } from './notion'
import type { ImportPlan } from './plan'
import { sourceOf, type Source } from './sources'

const PLAN = '1a2b3c4d5e6f78901a2b3c4d5e6f7890'
const SUB = 'aaaabbbbccccddddeeeeffff00001111'
const TASKS = '99998888777766665555444433332222'
const ROW = '11112222333344445555666677778888'

function file(path: string, body: string): Source {
  return sourceOf(path, new TextEncoder().encode(body))
}

function pathsOf(plan: ImportPlan): string[] {
  return plan.files.map((one) => one.path)
}

function noteAt(plan: ImportPlan, path: string): string {
  const found = plan.files.find((one) => one.path === path)
  if (found?.kind !== 'note') throw new Error(`no note at ${path}`)
  return found.text
}

/** What a ` ```base ` fence in a note holds. */
function fenced(note: string): string {
  const found = /```base\n([\s\S]*?)\n```/.exec(note)
  if (!found) throw new Error('no base in the note')
  return found[1] ?? ''
}

describe('a Notion export', () => {
  test('loses the ids and lands as the tree it looked like', async () => {
    const plan = await readNotion([
      file(`Plan ${PLAN}.md`, `# Plan\n\nSee [Kit list](Plan%20${PLAN}/Kit%20list%20${SUB}.md).\n`),
      file(`Plan ${PLAN}/Kit list ${SUB}.md`, '# Kit list\n\nA tent.\n'),
      file(`Plan ${PLAN}/tent ${SUB}.png`, 'PNG'),
    ])

    expect(pathsOf(plan)).toEqual(['Plan.md', 'Plan/Kit list.md', 'Plan/tent.png'])
    // A note and a folder of the same name is how nib nests, so the page that
    // had pages under it still stands for them.
    expect(noteAt(plan, 'Plan.md')).toContain('[[Kit list]]')
  })

  test('a page keeps its properties as front matter', async () => {
    const plan = await readNotion([
      file(
        `Task ${PLAN}.md`,
        '# Task\nStatus: Done\nCreated: January 2, 2026\nLast edited time: March 4, 2026\nTags: work, urgent\n\nThe words.\n',
      ),
    ])

    const text = noteAt(plan, 'Task.md')
    expect(text).toContain('date: 2026-01-02')
    expect(text).toContain('updated: 2026-03-04')
    expect(text).toContain('tags: [work, urgent]')
    expect(text).toContain('status: Done')
    expect(text).toContain('# Task')
    expect(text).toContain('The words.')
    expect(text).not.toContain('Status: Done')
  })

  test('a database becomes its folder note, holding a base over its rows', async () => {
    const plan = await readNotion([
      file(`Tasks ${TASKS}.csv`, 'Name,Status\nOne,Done\n'),
      file(`Tasks ${TASKS}_all.csv`, 'Name,Status,Due\nOne,Done,\nTwo,Doing,"October 10, 2026"\n'),
      file(`Tasks ${TASKS}/One ${ROW}.md`, '# One\nStatus: Done\n\nWords.\n'),
    ])

    // Two, which has no page of its own in the export, is a note all the same,
    // so no row is in Notion's table and missing from nib's.
    expect(pathsOf(plan)).toEqual(['Tasks.md', 'Tasks/One.md', 'Tasks/Two.md'])

    const base = readBase(fenced(noteAt(plan, 'Tasks.md')))
    expect(base.filters).toEqual({ and: ['file.folder + ".md" == this.file.path'] })
    expect(base.views[0]?.order).toEqual(['file.name', 'note.status', 'note.due'])
    expect(base.properties['note.status']?.displayName).toBe('Status')
    expect(noteAt(plan, 'Tasks/Two.md')).toContain('due: 2026-10-10')
    expect(plan.lost[0]?.text).toContain('saved views')
  })

  test('a row is written as what its column holds', async () => {
    const plan = await readNotion([
      file(
        `Books ${TASKS}_all.csv`,
        [
          'Name,Pages,Read,Started,Genre,Author,Code,Note',
          `Dune,412,Yes,"January 2, 2026 3:30 PM","Sci-fi, Classic",Herbert (People%20${SUB}/Herbert%20${ROW}.md),007,"Long, and worth it"`,
          'Ubik,224,No,"March 4, 2026","Sci-fi",,12,Short',
        ].join('\n'),
      ),
      file(
        `Books ${TASKS}/Dune ${ROW}.md`,
        [
          '# Dune',
          'Pages: 412',
          'Read: Yes',
          'Started: January 2, 2026 3:30 PM',
          'Genre: Sci-fi, Classic',
          `Author: Herbert (People%20${SUB}/Herbert%20${ROW}.md)`,
          'Code: 007',
          'Note: Long, and worth it',
          '',
          'Words.',
        ].join('\n'),
      ),
      file(`Books ${TASKS}/Ubik ${ROW}.md`, '# Ubik\nPages: 224\nRead: No\nCode: 12\n\nWords.\n'),
    ])

    const dune = noteAt(plan, 'Books/Dune.md')
    expect(dune).toContain('pages: 412\n')
    expect(dune).toContain('read: true\n')
    expect(dune).toContain('started: 2026-01-02T15:30\n')
    expect(dune).toContain('genre: [Sci-fi, Classic]\n')
    expect(dune).toContain("author: ['[[Herbert]]']\n")
    // A leading zero is a code, and a column with one in it is words throughout.
    expect(dune).toContain("code: '007'\n")
    expect(dune).toContain('note: Long, and worth it\n')
    expect(noteAt(plan, 'Books/Ubik.md')).toContain('read: false\n')
    expect(noteAt(plan, 'Books/Ubik.md')).toContain("code: '12'\n")
  })

  test('a database with no pages at all still has every row', async () => {
    const plan = await readNotion([
      file(`Tasks ${TASKS}_all.csv`, 'Name,Note\n"A | B","one\ntwo"\n,Empty\n'),
    ])

    expect(pathsOf(plan)).toEqual(['Tasks.md', 'Tasks/A B.md', 'Tasks/Untitled.md'])
    expect(noteAt(plan, 'Tasks/A B.md')).toContain('note: one two')
  })

  test('an HTML export is read as HTML rather than refused', async () => {
    const plan = await readNotion([
      file(`Plan ${PLAN}.html`, '<h1>Plan</h1><p>Words</p>'),
      file(`Plan ${PLAN}/Kit ${SUB}.html`, '<h1>Kit</h1>'),
    ])

    expect(pathsOf(plan)).toEqual(['Plan.md', 'Plan/Kit.md'])
    expect(plan.format).toBe('notion')
  })
})

describe('what counts as a page of properties', () => {
  test('is the block directly under the title, which is where Notion writes it', () => {
    // Every Notion export leaves a blank line between the title and the page's
    // own words, so words separated from the title are words.
    const text = '# Plan\n\nOne thing: it works.\n\nMore.\n'

    expect(notionPage(text).body).toBe(text)
    expect(notionPage(text).meta).toEqual({})
  })

  test('keeps a page that opens with its words', () => {
    const text = 'Just words, no title.\n'

    expect(notionPage(text).body).toBe(text)
  })

  test('reads a property block that is not followed by any words', () => {
    const said = notionPage('# Plan\nStatus: Done\n')

    expect(said.meta.extra).toEqual([['Status', 'Done']])
    expect(said.body.trim()).toBe('# Plan')
  })
})
