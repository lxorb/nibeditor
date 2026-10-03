/** The `/` menu before the command lane lands: the commands of docs/ai-sidebar.md
 *  section 3 that are one of the panel's own controls, under the vendors' names and
 *  synonyms, each running exactly what its control runs. The registry of all of
 *  section 3 replaces this list whole (seams.ts); nothing here decides anything a
 *  control does not. */

import { isEffort } from '../chat/effort'
import type { PanelActions, PanelCommand } from './seams'

const always = () => true as const

function row(
  name: string,
  synonyms: string[],
  run: PanelCommand['run'],
  args?: string,
): PanelCommand {
  return { name, synonyms, ...(args ? { args } : {}), available: always, run }
}

export function panelCommands(panel: PanelActions): PanelCommand[] {
  return [
    row('new', ['clear', 'reset'], () => panel.newThread()),
    row('resume', ['continue', 'history'], ({ args }) => panel.showThreads(args), '[name]'),
    row('rename', ['title'], ({ args }) => void panel.rename(args || undefined), '[name]'),
    row('branch', [], ({ args }) => panel.branch(args || undefined), '[name]'),
    row('export', ['save'], () => void panel.exportThread()),
    row('archive', [], () => panel.archive()),
    row('delete', [], () => void panel.remove()),
    row('stop', [], () => panel.stop()),
    row('compact', [], ({ args }) => panel.compact(args || undefined), '[focus]'),
    row('context', [], () => panel.openContext()),
    row(
      'model',
      ['models'],
      ({ args }) => {
        if (!args || !panel.modelNamed(args)) panel.openModels()
      },
      '[name]',
    ),
    row(
      'effort',
      ['reasoning', 'think'],
      ({ args }) => {
        const level = args.toLowerCase() === 'extra' ? 'xhigh' : args.toLowerCase()
        panel.setEffort(isEffort(level) ? level : 'next')
      },
      '[level]',
    ),
    row('fast', [], ({ args }) => panel.setFast(args ? args === 'on' : undefined), '[on|off]'),
    row('ask', [], ({ args }) => modeThen(panel, 'ask', args), '[question]'),
    row('plan', [], ({ args }) => modeThen(panel, 'plan', args), '[task]'),
    row('agent', [], ({ args }) => modeThen(panel, 'agent', args), '[task]'),
    row('focus', [], () => panel.toggleFolded()),
  ]
}

/** A mode, and the words after it sent in that mode. */
function modeThen(panel: PanelActions, mode: 'ask' | 'plan' | 'agent', words: string): void {
  panel.setMode(mode)
  if (words) panel.send(words)
}
