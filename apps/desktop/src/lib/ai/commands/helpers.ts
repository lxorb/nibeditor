/** The commands that run a thread beside this one (docs/ai-sidebar.md 3.1, 3.3):
 *  `/fork`, `/subtask`, `/bg`, `/batch` and `/deep-research`.
 *
 *  Claude Code's three nearby words, kept apart by what comes back: `/branch` moves you
 *  into a copy (the panel's own), `/fork` leaves a copy running while you stay and sends
 *  nothing back, `/subtask` leaves a copy running and its answer comes back here as a
 *  line. `/batch` is many subtasks, one a note, three at a time, and `/deep-research` is
 *  one that reads the web and writes a note. Every one is on the thread's task list
 *  until it ends, and `/stop` ends it; each helper is a thread of its own in the list,
 *  and the thread that started it keeps their ids for the review (lane 3), so one review
 *  covers every change they made. */

import { t } from '../../i18n.svelte'
import type { Query } from '../../search/query'
import { workspace } from '../../workspace.svelte'
import { branchThread, newThread } from '../chat/threads'
import type { Mode, Thread } from '../chat/types'
import type { Host } from './host'
import type { Held } from './instructions'
import { answerOf } from './loop'
import { tasks, type TaskKind } from './tasks.svelte'
import type { Ended } from './types'

/** Subtasks of one batch that run at once. */
const AT_ONCE = 3

/** The fields the helpers keep on the thread that started them. */
interface Helped {
  /** Every helper thread this one started: what lane 3's review of it covers too. */
  helpers?: string[]
}

/** A copy of the thread to here, or a new thread on the same provider and model where
 *  there is nothing to copy or the helper should start clean. */
function helperOf(parent: Thread, title: string, copy: boolean, mode?: Mode): Thread {
  const last = parent.turns.at(-1)
  const made =
    copy && last
      ? branchThread(parent, last.id, title)
      : {
          ...newThread(
            parent.space,
            parent.provider,
            parent.model,
            parent.effort,
            mode ?? parent.mode,
          ),
          title,
        }
  if (mode) made.mode = mode
  const held = parent as Held & Helped
  held.helpers = [...(held.helpers ?? []), made.id]
  return made
}

/** Runs one helper, on the task list while it runs, and says how it ended. */
async function run(
  host: Host,
  parent: Thread,
  helper: Thread,
  kind: TaskKind,
  text: string,
  label = text,
): Promise<Ended | null> {
  const stopper = new AbortController()
  const task = tasks.add({
    thread: parent.id,
    kind,
    label,
    helper: helper.id,
    stop: () => stopper.abort(),
  })
  host.adopt(helper)
  try {
    return await host.turn(helper, text, { signal: stopper.signal })
  } catch {
    return null
  } finally {
    tasks.done(task.id)
  }
}

/** The line a helper's answer comes back as: what it was asked, then what it said. */
function answered(task: string, ended: Ended | null): string {
  const words = ended ? answerOf(ended).trim() : ''
  const failed = !ended || ended.stop === 'error'
  return `↳ ${task}\n\n${failed ? (ended?.error ?? t('The model did not answer.')) : words}`
}

/** `/fork [prompt]`: a copy left running while you stay. */
export function fork(host: Host, parent: Thread, prompt: string): void {
  const copy = helperOf(parent, parent.title, true)
  host.touched(parent)
  if (prompt) void run(host, parent, copy, 'fork', prompt)
  else host.adopt(copy)
}

/** `/subtask <task>`: a copy that works on the task, whose answer comes back here. */
export async function subtask(host: Host, parent: Thread, task: string): Promise<void> {
  const copy = helperOf(parent, task.slice(0, 80), true)
  host.touched(parent)
  const ended = await run(host, parent, copy, 'subtask', task)
  if (ended?.stop === 'stopped') return
  host.line(parent, answered(task, ended))
}

/** The folders (`Inbox/`) and tags (`#todo`) an instruction names. */
export function batchTargets(instruction: string): { folders: string[]; tags: string[] } {
  const words = instruction.split(/\s+/).map((one) => one.replace(/^@/, '').replace(/[.,;:]+$/, ''))
  return {
    folders: words.filter((one) => one.length > 1 && one.endsWith('/')),
    tags: words.filter((one) => /^#[\p{L}\p{N}_/-]+$/u.test(one)).map((one) => one.slice(1)),
  }
}

/** The notes of those folders and tags, by the space's own search. */
async function batchNotes(
  root: string,
  targets: { folders: string[]; tags: string[] },
): Promise<string[]> {
  const asked: Query = {
    kind: 'any',
    of: [
      ...targets.folders.map((text): Query => ({ kind: 'path', text, fold: true })),
      ...targets.tags.map((tag): Query => ({ kind: 'tag', tag })),
    ],
  }
  const { searchSpace } = await import('../../search/space')
  const paths = new Set<string>()
  await searchSpace(
    root,
    asked,
    [],
    1_000,
    (batch) => {
      for (const hit of batch.hits) if (hit.page === undefined && !hit.tab) paths.add(hit.path)
    },
    workspace.leftOutOf(root),
  )
  return [...paths].sort()
}

/** The path a note's link names it by. */
function linkOf(path: string, root: string): string {
  const relative = path.startsWith(root) ? path.slice(root.length).replace(/^[\\/]+/, '') : path
  return relative.replace(/\\/g, '/').replace(/\.md$/i, '')
}

/** `/batch <instruction>`: the instruction over every note it names, each a subtask in
 *  Agent mode, three at a time; one line when all are done. */
export async function batch(host: Host, parent: Thread, instruction: string): Promise<void> {
  const root =
    workspace.spaces.find((one) => one.id === parent.space)?.root ?? workspace.activeSpace?.root
  const targets = batchTargets(instruction)
  if (!root || (!targets.folders.length && !targets.tags.length)) {
    host.line(parent, t('Name a folder or a tag'))
    return
  }
  const notes = await batchNotes(root, targets)
  const stopper = new AbortController()
  const task = tasks.add({
    thread: parent.id,
    kind: 'batch',
    label: instruction,
    stop: () => stopper.abort(),
  })
  let done = 0
  let next = 0
  const one = async (): Promise<void> => {
    while (next < notes.length && !stopper.signal.aborted) {
      const path = notes[next++] ?? ''
      const helper = helperOf(
        parent,
        `${instruction.slice(0, 60)} · ${linkOf(path, root)}`,
        false,
        'agent',
      )
      host.adopt(helper)
      const ended = await host
        .turn(helper, `${instruction}\n\nWork on this one note only: [[${linkOf(path, root)}]]`, {
          signal: stopper.signal,
        })
        .catch(() => null)
      if (ended && ended.stop !== 'error' && ended.stop !== 'stopped') done++
    }
  }
  host.touched(parent)
  try {
    await Promise.all(Array.from({ length: Math.min(AT_ONCE, notes.length) }, one))
  } finally {
    tasks.done(task.id)
  }
  host.line(parent, `↳ ${instruction}\n\n✓ ${done}/${notes.length}`)
}

/** What `/deep-research` asks its helper. Not translated: the model's to read. */
export function researchPrompt(question: string): string {
  return [
    `Research this question: ${question}`,
    'Search the web and read the pages with your browser tools, in tabs of your own; follow the best sources and cross-check what they say.',
    'Then write a report as one new note under Research/ with create_note, named after the question:',
    'a short answer first, then the findings, each claim with a numbered citation, and the sources as a numbered list of links at the end.',
    'Answer here with the note’s name and the short answer.',
  ].join(' ')
}

/** `/deep-research <question>`: a helper in Agent mode that reads the web and writes a
 *  cited note; its answer comes back here. Reaching the web is the grant's browser
 *  scope: without it the helper's first browser call is refused and says so. */
export async function research(host: Host, parent: Thread, question: string): Promise<void> {
  const helper = helperOf(parent, question.slice(0, 80), false, 'agent')
  host.touched(parent)
  const ended = await run(host, parent, helper, 'research', researchPrompt(question), question)
  if (ended?.stop === 'stopped') return
  host.line(parent, answered(question, ended))
}
