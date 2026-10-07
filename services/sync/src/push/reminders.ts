/** Reminders pushed from here, so a phone that has not opened nib since a task was
 *  written elsewhere still rings (docs/tasks.md 5.10 and decision 5).
 *
 *  **Kept from the notes as they arrive.** Every note is written through one place
 *  (`saveNote` and the two that make a note, notes.ts), and each hands its words here:
 *  the task lines are read the way the app reads them, their reminders worked out by the
 *  same code (`@nib/markdown/task-reminders`) in the time zone the account's newest
 *  device said it is in, and the note's rows of `push_reminders` rewritten. Only for an
 *  account with a device to push to, so a save costs nothing for everybody else.
 *
 *  **Sent at the minute** by the cron each minute (`sendDue`): each reminder due is
 *  claimed once, pushed to every target of its account, and let go a day later. A
 *  reminder in a note deleted since, or of a space deleted since, is not sent.
 *
 *  The id is the one every device makes for the same reminder, so a phone that set the
 *  alarm itself knows this push and stays quiet; see Reminders.kt. */

import { taskHash } from '@nib/bases'
import { readTask } from '@nib/markdown/task-line'
import { momentOf, plainWords, reminderId, remindTimes } from '@nib/markdown/task-reminders'
import type { Env } from '../types'
import { type Message, push, type Target } from './send'

/** The automatic reminder's choices, in minutes before a task's time, -1 for none: the
 *  app's own list (modes.svelte.ts), which the settings route holds an account to. */
export const REMIND_BEFORE: readonly number[] = [0, 5, 15, 30, 60, -1]

/** How many of one note's reminders are kept. */
const MOST_PER_NOTE = 64

/** How many due reminders one run of the cron sends. */
const AT_ONCE = 200

/** How long a reminder is kept after its minute, sent or not. */
const KEPT_FOR = 86_400_000

/** A note as this reads it. */
interface Saved {
  id: string
  space_id: string
  path: string
}

/** One reminder of one note. */
interface Kept {
  id: string
  at: number
  title: string
  body: string
  hash: string
  line: number
}

/** The task lines of a note's words, with the line each is on: outside the front matter
 *  and outside a fenced block, as the app's own scan reads them (scan-rows.ts). */
function taskLines(content: string): { line: number; text: string }[] {
  const lines = content.split(/\r?\n/)
  const found: { line: number; text: string }[] = []
  let at = 0
  if (lines[0] === '---') {
    const close = lines.findIndex((one, index) => index > 0 && (one === '---' || one === '...'))
    if (close > 0) at = close + 1
  }
  let fence: string | null = null
  for (; at < lines.length; at++) {
    const line = lines[at] ?? ''
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
    if (marker) {
      const sign = marker.charAt(0)
      if (fence === null) fence = sign
      else if (sign === fence) fence = null
      continue
    }
    if (fence === null && /^\s*[-*+] \[.\]/.test(line)) found.push({ line: at, text: line })
  }
  return found
}

/** The next reminders a note's words ask for, after `now`. */
export function remindersIn(
  content: string,
  space: string,
  path: string,
  zone: string,
  auto: number | null,
  now: number,
): Kept[] {
  const body = path.replace(/^.*\//, '').replace(/\.md$/i, '')
  const kept: Kept[] = []
  for (const { line, text } of taskLines(content)) {
    const task = readTask(text)
    if (!task) continue
    const hash = taskHash(task.text)
    for (const wall of remindTimes(task, auto)) {
      const at = momentOf(wall, zone)
      if (!(at > now)) continue
      kept.push({
        id: reminderId(space, path, hash, wall),
        at,
        title: plainWords(task.text),
        body,
        hash,
        line,
      })
    }
  }
  return kept.sort((a, b) => a.at - b.at).slice(0, MOST_PER_NOTE)
}

/** The automatic reminder the account chose, or the app's own default. */
function autoOf(settings: string | null): number | null {
  try {
    const chosen = (JSON.parse(settings ?? '{}') as { remindBefore?: unknown }).remindBefore
    if (typeof chosen === 'number' && REMIND_BEFORE.includes(chosen)) {
      return chosen < 0 ? null : chosen
    }
  } catch {
    // Settings nobody can read are the defaults.
  }
  return 0
}

/** A note's reminders, rewritten from its words. Best effort, as the note's words and
 *  versions are: the note is already stored. */
export async function keepReminders(env: Env, note: Saved, content: string, now = Date.now()) {
  const owner = await env.DB.prepare(
    `select s.user_id, s.name, u.settings,
            (select zone from push_targets t where t.user_id = s.user_id
              order by t.created_at desc limit 1) as zone
       from spaces s join users u on u.id = s.user_id where s.id = ?`,
  )
    .bind(note.space_id)
    .first<{ user_id: string; name: string; settings: string | null; zone: string | null }>()

  const forget = env.DB.prepare('delete from push_reminders where note_id = ?').bind(note.id)
  // No device to push to: nothing is kept, and nothing an earlier save kept stays.
  if (!owner?.zone) {
    await forget.run()
    return
  }

  const kept = remindersIn(content, owner.name, note.path, owner.zone, autoOf(owner.settings), now)
  // What was sent stays sent: a save after a reminder rang does not ring it again.
  const sent = await env.DB.prepare(
    'select id, sent_at from push_reminders where note_id = ? and sent_at is not null',
  )
    .bind(note.id)
    .all<{ id: string; sent_at: number }>()
  const sentAt = new Map(sent.results.map((one) => [one.id, one.sent_at]))

  await env.DB.batch([
    forget,
    ...kept.map((one) =>
      env.DB.prepare(
        `insert into push_reminders
           (note_id, id, user_id, space_id, at, title, body, path, hash, line, sent_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        note.id,
        one.id,
        owner.user_id,
        note.space_id,
        one.at,
        one.title,
        one.body,
        note.path,
        one.hash,
        one.line,
        sentAt.get(one.id) ?? null,
      ),
    ),
  ])
}

/** What a due reminder carries. */
interface Due {
  note_id: string
  id: string
  user_id: string
  at: number
  title: string
  body: string
  space: string
  path: string
  hash: string
  line: number
}

/** Every reminder due by now, pushed once to every device of its account. Answers how
 *  many were sent. */
export async function sendDue(
  env: Env,
  now: number,
  send: typeof fetch = (input, init) => fetch(input, init),
): Promise<number> {
  await env.DB.prepare('delete from push_reminders where at < ?')
    .bind(now - KEPT_FOR)
    .run()

  const { results: due } = await env.DB.prepare(
    `select r.note_id, r.id, r.user_id, r.at, r.title, r.body, r.path, r.hash, r.line,
            s.name as space
       from push_reminders r
       join notes n on n.id = r.note_id and n.deleted = 0
       join spaces s on s.id = r.space_id and s.deleted = 0
      where r.sent_at is null and r.at <= ?
      order by r.at limit ?`,
  )
    .bind(now, AT_ONCE)
    .all<Due>()

  let sent = 0
  const targets = new Map<string, Target[]>()
  for (const one of due) {
    // Claimed first, so two runs of the cron that overlap send it once.
    const claimed = await env.DB.prepare(
      'update push_reminders set sent_at = ? where note_id = ? and id = ? and sent_at is null',
    )
      .bind(now, one.note_id, one.id)
      .run()
    if (!claimed.meta.changes) continue

    let theirs = targets.get(one.user_id)
    if (!theirs) {
      theirs = (
        await env.DB.prepare(
          'select id, user_id, kind, token, keys, zone from push_targets where user_id = ?',
        )
          .bind(one.user_id)
          .all<Target>()
      ).results
      targets.set(one.user_id, theirs)
    }

    const message: Message = {
      kind: 'reminder',
      id: one.id,
      title: one.title,
      body: one.body,
      fields: {
        at: String(one.at),
        space: one.space,
        path: one.path,
        hash: one.hash,
        line: String(one.line),
      },
    }
    const delivered = await Promise.all(
      theirs.map((target) => push(env, target, message, now, send)),
    )
    if (delivered.includes('sent')) sent++
  }
  return sent
}
