/** What readers typed into the forms on a site, for whoever published it.
 *
 *  A form is a fence in a note and an answer belongs to the note that asked, so
 *  this is read per space and grouped by note: which page was asking, what came
 *  back, and when. The owner's, like everything else about a site: a collaborator
 *  writes in the space, they did not put the form on the internet.
 *
 *  Two shapes of the same thing, because the app wants both: the rows, for the
 *  quiet list in the publish sheet, and a CSV, for the spreadsheet somebody
 *  actually works in. The CSV is written here rather than in the app so that what
 *  a column is called is decided once; see blog/form.ts.
 *
 *  And how much of it is kept. A form is open to anybody, and the rate limits in
 *  limits.ts bound how fast answers arrive but not how many pile up: at the pace
 *  they allow one site could put about eleven gigabytes a month into a database
 *  every account shares. So a space holds at most `MOST_ANSWERS` answers and
 *  `MOST_ANSWER_BYTES` of them, and an answer older than `KEPT_DAYS` goes with the
 *  nightly job. A form that is full stops taking answers, the way Typeform and
 *  Google Forms close theirs, rather than letting go of older ones nobody has read
 *  yet: a flood of spam pushing out the real messages is the worse of the two. */

import { Hono } from 'hono'
import { objectIn } from '../body'
import { asCsv } from '../blog/form'
import { newId } from '../crypto'
import type { Env, Variables } from '../types'
import { atLeast, spaceOf } from './space'

/** How many answers one read hands back. A form on a blog that has taken more
 *  than this wants the CSV, which is bounded by the same number. */
const MOST_SHOWN = 500

/** How many answers one space keeps, and how many bytes of them. A sign-up sheet
 *  for a conference is a few thousand; at a few hundred bytes an answer the count
 *  is the ceiling anybody meets, and the bytes are there for the answer written
 *  out to the length every field allows. */
const MOST_ANSWERS = 5000
const MOST_ANSWER_BYTES = 10 * 1024 * 1024

/** How long an answer is kept. Long enough that a form somebody looks at twice a
 *  year has not lost anything, short enough that what a stranger typed is not held
 *  for ever: it is a message, and the CSV is where somebody keeps one. */
export const KEPT_DAYS = 180

const A_DAY = 24 * 60 * 60 * 1000

/** One answer, kept, unless the space is full. One statement, so two answers
 *  arriving together cannot both find the last place free. */
export async function keepAnswer(
  env: Env,
  spaceId: string,
  noteId: string,
  answers: Record<string, string>,
): Promise<boolean> {
  const text = JSON.stringify(answers)
  const bytes = new TextEncoder().encode(text).byteLength

  const kept = await env.DB.prepare(
    `insert into form_answers (id, space_id, note_id, at, answers, bytes)
     select ?1, ?2, ?3, ?4, ?5, ?6
      where (select count(*) from form_answers where space_id = ?2) < ?7
        and (select coalesce(sum(bytes), 0) from form_answers where space_id = ?2) + ?6 <= ?8`,
  )
    .bind(newId(), spaceId, noteId, Date.now(), text, bytes, MOST_ANSWERS, MOST_ANSWER_BYTES)
    .run()

  return kept.meta.changes > 0
}

/** Whether a space has stopped taking answers. */
async function isFull(env: Env, spaceId: string): Promise<boolean> {
  const held = await env.DB.prepare(
    `select count(*) as many, coalesce(sum(bytes), 0) as bytes
       from form_answers where space_id = ?`,
  )
    .bind(spaceId)
    .first<{ many: number; bytes: number }>()

  return (held?.many ?? 0) >= MOST_ANSWERS || (held?.bytes ?? 0) >= MOST_ANSWER_BYTES
}

/** Every answer older than a space keeps them, whoever's, for the nightly job. */
export function sweepAnswers(env: Env, at: number): Promise<unknown> {
  return env.DB.prepare('delete from form_answers where at < ?')
    .bind(at - KEPT_DAYS * A_DAY)
    .run()
}

interface Row {
  id: string
  note_id: string
  path: string
  at: number
  answers: string
}

/** One row, as the app reads it. The answers are a JSON object keyed by the
 *  question the note asked; anything that is not that is dropped rather than
 *  handed on, because the column is written by this service and read by the app.
 */
function present(row: Row) {
  const held = objectIn(row.answers)
  const answers: Record<string, string> = Object.fromEntries(
    Object.entries(held ?? {}).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value]] : [],
    ),
  )
  // A row nobody can read says nothing, which is what an empty object is.
  return { id: row.id, note: row.note_id, path: row.path, at: row.at, answers }
}

async function rowsFor(env: Env, spaceId: string): Promise<Row[]> {
  const { results } = await env.DB.prepare(
    `select a.id as id, a.note_id as note_id, n.path as path, a.at as at, a.answers as answers
       from form_answers a
       join notes n on n.id = a.note_id
      where a.space_id = ?
      order by a.at desc
      limit ?`,
  )
    .bind(spaceId, MOST_SHOWN)
    .all<Row>()

  return results
}

export const answers = new Hono<{ Bindings: Env; Variables: Variables }>()

/** Everything the forms on this site have collected, newest first. */
answers.get('/:id/answers', atLeast('owner'), async (context) => {
  const space = spaceOf(context)
  const rows = await rowsFor(context.env, space.id)

  return context.json({
    answers: rows.map(present),
    more: rows.length === MOST_SHOWN,
    // Said by the service rather than copied into the app, so the sheet can never
    // promise a length the nightly job does not keep.
    keptDays: KEPT_DAYS,
    full: await isFull(context.env, space.id),
  })
})

/** The same, as a file for a spreadsheet. */
answers.get('/:id/answers.csv', atLeast('owner'), async (context) => {
  const space = spaceOf(context)
  const rows = await rowsFor(context.env, space.id)

  const csv = asCsv(
    rows.map((row) => {
      const one = present(row)
      return { at: one.at, answers: { page: one.path, ...one.answers } }
    }),
  )

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="answers.csv"',
      'cache-control': 'private, no-store',
    },
  })
})

/** One answer, gone. Somebody's to delete: spam arrives, and a message that has
 *  been read and acted on is not something an account should hold for ever. */
answers.delete('/:id/answers/:answer', atLeast('owner'), async (context) => {
  const space = spaceOf(context)

  await context.env.DB.prepare('delete from form_answers where id = ? and space_id = ?')
    .bind(context.req.param('answer'), space.id)
    .run()

  return context.json({ ok: true })
})
