/** The commands about what the model knows and how it works (docs/ai-sidebar.md 3.2 to
 *  3.4): instructions and memory, `/init`, the reader's own commands, agent profiles and
 *  output styles.
 *
 *  Everything here is a note of the reader's: the space's `AGENTS.md`, a note with
 *  `command:`, `agent:` or `output-style:` in its front matter. Nothing is kept anywhere a
 *  reader cannot open. */

import { t } from '../../i18n.svelte'
import { workspace } from '../../workspace.svelte'
import type { Thread } from '../chat/types'
import { found, foundNamed } from './found'
import { type Host, sendHere } from './host'
import { type Held, setRemembers, STYLES } from './instructions'
import { commandName } from './notes'

/** The space's instructions, at its root. */
const AGENTS = 'AGENTS.md'

function rootOf(thread: Thread | null): string | null {
  const space = thread ? workspace.spaces.find((one) => one.id === thread.space) : null
  return space?.root ?? workspace.activeSpace?.root ?? null
}

/** `/memory [on|off]`: remembering switched, or the space's `AGENTS.md` opened, made
 *  first where there is none. */
export async function memory(host: Host, thread: Thread | null, args: string): Promise<void> {
  const word = args.trim().toLowerCase()
  if (word === 'on' || word === 'off') {
    setRemembers(word === 'on')
    if (thread) host.line(thread, `${t('Memory')} · ${word === 'on' ? '✓' : '✕'}`)
    return
  }
  const root = rootOf(thread)
  if (!root) return
  const path = `${root}/${AGENTS}`
  if ((await workspace.noteText(path).catch(() => null)) === null) {
    await workspace.noteFrom('# AGENTS\n\n## Memory\n', root)
  }
  await workspace.open(path)
}

/** What `/init` asks. Not translated: the model's to read. */
const INIT = [
  'Write AGENTS.md at the root of this space: the instructions an assistant should follow here.',
  'First look around with your tools: the folders and what goes in each, the tags in use, the templates, how notes are named and linked, the languages they are written in, and the habits they show.',
  'Then write it as a short note in sections (Layout, Conventions, Memory, with an empty Memory section for later),',
  'with create_note, or with edit_note to improve the one that is there. Change no other note.',
].join(' ')

export function init(host: Host, thread: Thread | null): void {
  sendHere(host, thread, INIT, { mode: 'agent' })
}

/** `/mention <thing>`, `/add-space <space>`: what `@` would attach, with the menu of
 *  matches open in the field. */
export function mention(host: Host, thing: string): void {
  const { panel } = host
  if (panel.text !== undefined) panel.text = `@${thing.trim().replace(/^@/, '')}`
}

/** The names a list line shows, the chosen one marked. */
function listed(names: readonly string[], chosen?: string, prefix = ''): string {
  return names.map((name) => `${name === chosen ? '● ' : ''}${prefix}${name}`).join('  ') || '∅'
}

/** `/skills [name]`: the reader's own commands, or one of them opened to edit. */
export async function skills(host: Host, thread: Thread | null, args: string): Promise<void> {
  const notes = (await found()).filter((one) => one.kind === 'command')
  const name = commandName(args)
  const one = name ? notes.find((note) => note.name === name) : null
  if (one) {
    await workspace.open(one.path)
    return
  }
  if (thread)
    host.line(
      thread,
      listed(
        notes.map((note) => note.name),
        undefined,
        '/',
      ),
    )
}

/** `/agents [name]`: the thread's profile chosen (its model, effort and mode with it),
 *  cleared with `none`, or listed. */
export async function agents(host: Host, thread: Thread | null, args: string): Promise<void> {
  const open = thread ?? host.panel.ensure?.() ?? null
  if (!open) return
  const held = open as Held
  const name = commandName(args)
  if (!name) {
    const profiles = (await found()).filter((one) => one.kind === 'agent').map((one) => one.name)
    host.line(open, listed(profiles, held.agent))
    return
  }
  if (name === 'none' || name === 'default') {
    delete held.agent
    host.touched(open)
    return
  }
  const profile = await foundNamed('agent', name)
  if (!profile) {
    host.line(open, t('No such agent'))
    return
  }
  held.agent = profile.name
  if (profile.model) host.panel.modelNamed(profile.model)
  if (profile.effort) host.panel.setEffort(profile.effort)
  if (profile.mode) host.panel.setMode(profile.mode)
  host.touched(open)
}

/** `/output-style [style]`: how answers read, chosen or listed. */
export async function outputStyle(host: Host, thread: Thread | null, args: string): Promise<void> {
  const open = thread ?? host.panel.ensure?.() ?? null
  if (!open) return
  const held = open as Held
  const name = commandName(args)
  const notes = (await found()).filter((one) => one.kind === 'output-style').map((one) => one.name)
  const all = [...Object.keys(STYLES), ...notes]
  if (!name) {
    host.line(open, listed(all, held.style ?? 'default'))
    return
  }
  if (!all.includes(name)) {
    host.line(open, t('No such style'))
    return
  }
  if (name === 'default') delete held.style
  else held.style = name
  host.touched(open)
}
