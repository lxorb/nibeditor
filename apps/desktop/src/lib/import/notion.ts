/** A Notion export, which is the one most people arrive with.
 *
 *  Notion writes a folder per page that has pages under it, a file per page, and
 *  an id on the end of every single name: `Plan 1a2b...7890.md` beside
 *  `Plan 1a2b...7890/`. Take the ids off and that is exactly nib's own shape - a
 *  note and a folder of the same name, the note standing for the folder - so a
 *  Notion workspace arrives as the tree it looked like in Notion, with nothing
 *  rearranged.
 *
 *  A database is a CSV beside a folder of the rows' own pages. The CSV becomes
 *  the folder's note, holding the table, and the rows come in as the notes they
 *  already were: the database is one thing in the file list that opens into its
 *  rows. Notion writes the table twice, once as the view that was on screen and
 *  once as every row; this reads the second, because a filtered view is a
 *  question somebody asked on a Tuesday and the rows are the data.
 *
 *  Each page carries its properties as lines under the title, which become front
 *  matter: that is where nib keeps a note's properties, and it is what makes them
 *  searchable with `[key:value]`. */

import { key } from '../i18n.svelte'
import { recordsOf } from './csv'
import { folderPlan, isJunk } from './folder'
import { dayOf, type Meta } from './meta'
import { Names, safeParts, withoutNotionId } from './names'
import type { ImportPlan } from './plan'
import type { Source } from './sources'
import { readPlain } from './plain'
import { tableOf } from './table'

const HTML = /\.html?$/i
const MARKDOWN = /\.(md|markdown)$/i
const CSV = /\.csv$/i

/** A line under the title that says what the page's property held. Notion writes
 *  the name exactly as the property was called, so a colon and a space is all
 *  there is to go on; the shape of the name is what keeps a sentence out. */
const PROPERTY = /^([A-Z][^:\n.]{0,39}): *(.*)$/

/** The property names that are the page's own dates rather than something
 *  somebody added. */
const MADE = /^(created|created time|created at|date)$/i
const CHANGED = /^(last edited time|last edited|last modified|updated)$/i
const LABELS = /^(tags?|multi-select|select|labels?)$/i

export async function readNotion(sources: readonly Source[]): Promise<ImportPlan> {
  const html = sources.filter((one) => HTML.test(one.path)).length
  const markdown = sources.filter((one) => MARKDOWN.test(one.path)).length

  // Notion offers both, and its HTML export is the one that keeps a page's look.
  // Which arrived is a fact about the file rather than a choice to be made.
  if (html > markdown) return readPlain(sources, { format: 'notion' })

  const names = new Names()
  const kept = usefulCsvs(sources)
  let views = 0

  const plan = await folderPlan(sources, {
    format: 'notion',
    place: (source) => {
      if (isJunk(source.path)) return { to: null }

      if (CSV.test(source.path)) {
        if (!kept.has(source.path)) {
          views += 1
          return { to: null }
        }

        // Named after the folder its rows are in, so it is that folder's note.
        // The `_all` comes off before the id does, since the id is on the end of
        // the name Notion wrote and `_all` is after it.
        const wanted = source.path.replace(/_all\.csv$/i, '.csv')
        const path = names.free(safeParts(wanted, withoutNotionId).replace(CSV, '.md'))
        return {
          to: path,
          read: (text) => {
            const table = recordsOf(text)
            const name = (path.split('/').pop() ?? path).replace(MARKDOWN, '')
            return { text: tableOf(table.columns, table.rows), title: name }
          },
        }
      }

      if (!MARKDOWN.test(source.path))
        return { to: names.free(safeParts(source.path, withoutNotionId)) }

      return {
        to: names.free(safeParts(source.path, withoutNotionId)),
        read: (text) => {
          const said = notionPage(text)
          return { text: said.body, title: null, meta: said.meta }
        },
      }
    },
  })

  if (views) {
    plan.lost.push({
      text: key('{count} saved views are left out, and every row is in the table'),
      // Not a row of its own: a count is filed under its `other` form, and the
      // forms a language wants sit in the catalogue under it. See i18n.svelte.ts.
      one: '{count} saved view is left out, and every row is in the table',
      values: { count: views },
    })
  }

  return plan
}

/** Which of the CSVs to read. Notion writes `Table id.csv` for the view that was
 *  on screen and `Table id_all.csv` for every row; where both are there the
 *  second is the one that holds the database. */
function usefulCsvs(sources: readonly Source[]): Set<string> {
  const csvs = sources.filter((one) => CSV.test(one.path)).map((one) => one.path)
  const alls = new Set(
    csvs.filter((one) => /_all\.csv$/i.test(one)).map((one) => one.replace(/_all\.csv$/i, '')),
  )

  return new Set(csvs.filter((one) => /_all\.csv$/i.test(one) || !alls.has(one.replace(CSV, ''))))
}

/** A page's properties out of the lines under its title, and the words that are
 *  left.
 *
 *  What counts as the property block is the lines directly under the title, up to
 *  the first blank one, each of them `Name: value`. That is exactly where Notion
 *  writes them, and its export always leaves a blank line between the title and
 *  the page's own words - so a page that has no properties has a blank line there
 *  and nothing is taken from it. One line that is not a property makes the whole
 *  block words again, since half a block of properties is a page that has lost a
 *  sentence. */
export function notionPage(text: string): { body: string; meta: Meta } {
  const lines = text.split('\n')
  let at = 0

  // The title is already the file's name, and nib keeps it as the heading.
  const title = lines[at]?.startsWith('# ') ? lines[at] : null
  if (title !== null) at += 1

  const said: [string, string][] = []
  let scan = at

  while (scan < lines.length) {
    const line = lines[scan] ?? ''
    if (!line.trim()) break

    const found = PROPERTY.exec(line)
    if (!found) return { body: text, meta: {} }

    said.push([found[1] ?? '', found[2] ?? ''])
    scan += 1
  }

  if (!said.length) return { body: text, meta: {} }

  const meta: Meta = {}
  const extra: [string, string][] = []
  const tags: string[] = []

  for (const [name, value] of said) {
    const plain = value.trim()
    if (!plain) continue

    if (MADE.test(name)) {
      const day = dayOf(plain)
      if (day) meta.date ??= day
      continue
    }

    if (CHANGED.test(name)) {
      const day = dayOf(plain)
      if (day) meta.updated ??= day
      continue
    }

    if (LABELS.test(name)) {
      tags.push(...plain.split(',').map((one) => one.trim()))
      continue
    }

    extra.push([name, plain])
  }

  if (tags.length) meta.tags = tags
  if (extra.length) meta.extra = extra

  const body = [title, ...lines.slice(scan)].filter((one) => one !== null).join('\n')
  return { body, meta }
}
