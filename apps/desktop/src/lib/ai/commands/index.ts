/** The `/` menu's rows (docs/ai-sidebar.md 3, 6.5): every command of the table, run
 *  the way its row says for the thread's provider, and the reader's own commands found
 *  as notes after them.
 *
 *  The panel fetches this file through its seam (lib/ai/sidebar/seams.ts) the first time
 *  `/` is typed, so none of it is in the first paint, and calls `commands(panel)` each
 *  time the menu opens: the reader's commands are found in the background and are in the
 *  next menu once they are. A custom command never takes a built-in's name or synonym. */

import { isEffort } from '../chat/effort'
import type { Effort, Thread } from '../chat/types'
import { sign, doctor, status, usage } from './account'
import { availability } from './available'
import { autocompact, copy, exportThread, listJobs, recap } from './conversation'
import { foundNow } from './found'
import { batch, fork, research, subtask } from './helpers'
import { type Host, hostOf, sendHere } from './host'
import { expand, type NoteCommand } from './notes'
import { goal, loop } from './running'
import { agents, init, memory, mention, outputStyle, skills } from './space'
import { ROWS, takenNames } from './table'
import { tasks } from './tasks.svelte'
import { planDay, showTasks } from './todos'
import type { CommandContext, Panel, PanelCommand } from './types'
import { explain, review, rewrite, summarize } from './words'
import { message, t } from '../../i18n.svelte'

/** Lane 3's half of `/rewind` and `/diff`, once it is on main: `lib/ai/review/commands.ts`
 *  exporting both, each run with the command's context (6.5). Found by name, so this
 *  file needs nothing changed when it lands. */
interface ReviewCommands {
  rewind(context: CommandContext): void | Promise<void>
  changes(context: CommandContext): void | Promise<void>
}
const REVIEW = import.meta.glob<ReviewCommands>('../review/commands.ts')
const loadReview = Object.values(REVIEW)[0]

async function reviewCommand(which: keyof ReviewCommands, context: CommandContext): Promise<void> {
  if (loadReview) await (await loadReview())[which](context)
}

/** The open thread, or the one the panel makes for a command that needs one. */
function threadOf(context: CommandContext): Thread | null {
  return context.thread ?? context.panel.ensure?.() ?? null
}

/** A line of words a command reports, in the thread it is about. */
async function report(host: Host, context: CommandContext, said: Promise<string>): Promise<void> {
  const thread = threadOf(context)
  const words = await said
  if (thread) host.line(thread, words)
}

/** `/effort`'s word as a level: Claude Code's and Codex's spellings, or the next. */
export function effortIn(args: string): Effort | 'next' {
  const word = args.trim().toLowerCase()
  if (word === 'extra' || word === 'x-high') return 'xhigh'
  if (word === 'none') return 'off'
  return isEffort(word) ? word : 'next'
}

/** `on`, `off`, or the other of the two. */
function onOff(args: string): boolean | undefined {
  const word = args.trim().toLowerCase()
  return word === 'on' ? true : word === 'off' ? false : undefined
}

async function settingsAt(section: 'ai' | 'agents' | 'shortcuts'): Promise<void> {
  const { settings } = await import('../../settings.svelte')
  settings.show(section)
}

type Run = (context: CommandContext, host: Host) => void | Promise<void>

/** What each row does. Where one needs a thread and none can be had, it does nothing. */
const RUNS: Record<string, Run> = {
  // 3.1
  new: async ({ args, panel }) => {
    panel.newThread()
    if (args) await panel.rename(args)
  },
  resume: ({ args, panel }) => panel.showThreads(args),
  rename: async ({ args, thread, panel }, host) => {
    if (args || !thread?.turns.length) await panel.rename(args || undefined)
    else await panel.rename((await recap(host, thread)) || undefined)
  },
  recap: async ({ thread, panel }, host) => {
    if (thread?.turns.length) await panel.rename((await recap(host, thread)) || undefined)
  },
  branch: ({ args, panel }) => panel.branch(args || undefined),
  fork: ({ args, thread }, host) => {
    if (thread) fork(host, thread, args)
  },
  rewind: (context) => reviewCommand('rewind', context),
  compact: ({ args, panel }) => panel.compact(args || undefined),
  autocompact: (context, host) => {
    const thread = threadOf(context)
    if (thread) autocompact(host, thread, context.args)
  },
  context: ({ panel }) => panel.openContext(),
  btw: async ({ args }) => {
    const { quick } = await import('../quick.svelte')
    quick.show()
    if (args && quick.open) {
      quick.question = args
      await quick.ask()
    }
  },
  copy: async ({ args, thread }) => {
    if (thread) await copy(thread, args)
  },
  export: async ({ args, thread, panel }) => {
    if (thread) await exportThread(thread, args)
    else await panel.exportThread()
  },
  archive: ({ panel }) => panel.archive(),
  delete: ({ panel }) => panel.remove(),
  stop: ({ thread, panel }) => {
    panel.stop()
    if (thread) tasks.stop(thread.id)
  },
  jobs: (context, host) => {
    const thread = threadOf(context)
    if (thread) listJobs(host, thread)
  },
  focus: ({ panel }) => panel.toggleFolded(),
  help: ({ panel }) => {
    if (panel.text === undefined) return settingsAt('shortcuts')
    panel.text = '/'
  },

  // 3.2
  model: ({ args, panel }) => {
    if (!args || !panel.modelNamed(args)) panel.openModels()
  },
  effort: ({ args, panel }) => panel.setEffort(effortIn(args)),
  fast: ({ args, panel }) => panel.setFast(onOff(args)),
  'output-style': ({ args, thread }, host) => outputStyle(host, thread, args),

  // 3.3
  approve: ({ args, panel }) => {
    panel.setMode('approve')
    if (args) panel.send(args)
  },
  plan: ({ args, panel }) => {
    panel.setMode('plan')
    if (args) panel.send(args)
  },
  agent: ({ args, panel }) => {
    panel.setMode('agent')
    if (args) panel.send(args)
  },
  agents: ({ args, thread }, host) => agents(host, thread, args),
  permissions: () => settingsAt('agents'),
  goal: (context, host) => {
    const thread = threadOf(context)
    if (thread) goal(host, thread, context.args)
  },
  loop: (context, host) => {
    const thread = threadOf(context)
    if (thread) loop(host, thread, context.args)
  },
  subtask: async (context, host) => {
    const thread = threadOf(context)
    if (thread && context.args) await subtask(host, thread, context.args)
  },
  bg: ({ args, panel }) => {
    if (args) panel.send(args)
    panel.newThread()
  },
  batch: async (context, host) => {
    const thread = threadOf(context)
    if (thread && context.args) await batch(host, thread, context.args)
  },
  'deep-research': async (context, host) => {
    const thread = threadOf(context)
    if (thread && context.args) await research(host, thread, context.args)
  },

  // 3.4
  mention: ({ args }, host) => mention(host, args),
  'add-space': ({ args }, host) => mention(host, args),
  memory: ({ args, thread }, host) => memory(host, thread, args),
  init: ({ thread }, host) => init(host, thread),
  skills: ({ args, thread }, host) => skills(host, thread, args),
  mcp: () => settingsAt('agents'),

  // 3.5
  shorter: () => void rewrite('shorter'),
  longer: () => void rewrite('longer'),
  fix: () => void rewrite('grammar'),
  translate: ({ args }) => void rewrite('translate', args),
  explain: ({ thread }, host) => explain(host, thread),
  summarize: ({ args, thread }, host) => summarize(host, thread, args),
  review: ({ args, thread }, host) => review(host, thread, args),
  diff: (context) => reviewCommand('changes', context),

  // 3.6
  tasks: async (context, host) => {
    const thread = threadOf(context)
    if (thread) await showTasks(host, thread, context.args)
  },
  today: ({ args, thread }, host) => planDay(host, thread, args),
  status: (context, host) =>
    report(host, context, status(context.thread, host.panel.provider ?? null)),
  usage: (context, host) =>
    report(host, context, usage(context.thread, host.panel.provider ?? null)),
  login: (_context, host) => sign(host.panel.provider ?? null, false),
  logout: (_context, host) => sign(host.panel.provider ?? null, true),
  doctor: (context, host) => report(host, context, doctor(host.panel.provider ?? null)),
  config: () => settingsAt('ai'),
  keybindings: () => settingsAt('shortcuts'),
  theme: async () => (await import('../../theme-picker/picking.svelte')).pickTheme(),
  vim: async () => {
    const { modes } = await import('../../modes.svelte')
    modes.setVimKeys(!modes.vim)
  },
  voice: ({ args, panel }) => panel.voice?.(onOff(args)),
}

/** Runs a row, and puts what went wrong in the thread rather than nowhere: the menu runs
 *  a command and lets go of it. */
async function guarded(host: Host, context: CommandContext, run: Run | undefined): Promise<void> {
  try {
    await run?.(context, host)
  } catch (error) {
    if (context.thread) host.line(context.thread, message(error, t('The model did not answer.')))
  }
}

/** The menu's row for a command written as a note. */
function noteRow(note: NoteCommand, host: Host): PanelCommand {
  const once = {
    ...(note.model ? { model: note.model } : {}),
    ...(note.effort ? { effort: note.effort } : {}),
    ...(note.mode ? { mode: note.mode } : {}),
  }
  const differs = Object.keys(once).length > 0
  return {
    name: note.name,
    synonyms: [],
    ...(note.arguments.length ? { args: note.arguments.map((one) => `<${one}>`).join(' ') } : {}),
    ...(note.description ? { description: note.description } : {}),
    source: note.path,
    available: () => true,
    run: ({ args, thread }) =>
      sendHere(host, thread, expand(note, args), differs ? once : undefined),
  }
}

/** Every row of the menu, for this panel. */
export function commands(panel: Panel): readonly PanelCommand[] {
  const host = hostOf(panel)
  const ready = { review: !!loadReview }
  const builtIn = ROWS.map((row): PanelCommand => ({
    name: row.name,
    synonyms: [...row.synonyms],
    ...(row.args ? { args: row.args } : {}),
    description: t(row.description),
    source: 'nib',
    available: (kind) => availability(row.name, kind, ready),
    run: (context) => guarded(host, context, RUNS[row.name]),
  }))
  const taken = takenNames()
  const own = foundNow()
    .filter((one) => one.kind === 'command' && !taken.has(one.name))
    .map((one) => noteRow(one, host))
  return [...builtIn, ...own]
}
