/** The commands of docs/ai-sidebar.md section 3, as a table: each row's name, the
 *  vendors' other names for it, its arguments, its group and its few words for the menu.
 *
 *  The names are Claude Code's first and Codex's where they differ, so a habit from
 *  either works here; table.test.ts reads the document's own tables and holds this one
 *  to them, row for row, and holds section 3.7's names out. What each row does is
 *  index.ts's; whether it can run for a provider is available.ts's. Pure data. */

import { key } from '../../i18n.svelte'

/** The sections of the document's table, in its order. */
type Group = 'conversation' | 'model' | 'modes' | 'context' | 'words' | 'app'

export interface Row {
  name: string
  synonyms: readonly string[]
  /** What may follow the name, as the menu shows it. */
  args?: string
  group: Group
  /** A few words for the menu: a key, translated where it is drawn. */
  description: string
}

const row = (
  group: Group,
  name: string,
  synonyms: readonly string[],
  description: string,
  args?: string,
): Row => ({ name, synonyms, group, description, ...(args ? { args } : {}) })

export const ROWS: readonly Row[] = [
  // 3.1 Conversation
  row('conversation', 'new', ['clear', 'reset'], key('New thread'), '[name]'),
  row('conversation', 'resume', ['continue', 'history'], key('Open a past thread'), '[name]'),
  row('conversation', 'rename', ['title'], key('Rename the thread'), '[name]'),
  row('conversation', 'recap', [], key('One line about the thread')),
  row('conversation', 'branch', [], key('Branch from here'), '[name]'),
  row('conversation', 'fork', [], key('Copy it into the background'), '[prompt]'),
  row('conversation', 'rewind', ['undo', 'checkpoint'], key('Go back to a message')),
  row('conversation', 'compact', [], key('Summarize the older turns'), '[focus]'),
  row('conversation', 'autocompact', [], key('When it compacts'), '[auto|<tokens>|off]'),
  row('conversation', 'context', [], key('What fills the window'), '[all]'),
  row('conversation', 'btw', ['side'], key('A side question'), '[question]'),
  row('conversation', 'copy', [], key('Copy an answer'), '[n]'),
  row('conversation', 'export', ['save'], key('Save as a note'), '[note]'),
  row('conversation', 'archive', [], key('Archive the thread')),
  row('conversation', 'delete', [], key('Delete the thread')),
  row('conversation', 'stop', [], key('Stop everything it runs')),
  row('conversation', 'tasks', ['ps', 'bashes'], key('Background work')),
  row('conversation', 'focus', [], key('Fold tools and thinking')),
  row('conversation', 'help', [], key('Commands and keys')),

  // 3.2 Model
  row('model', 'model', ['models'], key('Choose the model'), '[name]'),
  row('model', 'effort', ['reasoning', 'think'], key('How hard it thinks'), '[level|auto]'),
  row('model', 'fast', [], key('The faster tier'), '[on|off]'),
  row('model', 'output-style', ['personality', 'style'], key('How answers read'), '[style]'),

  // 3.3 Modes and long work
  row('modes', 'ask', [], key('Ask mode'), '[question]'),
  row('modes', 'plan', [], key('Plan mode'), '[task]'),
  row('modes', 'agent', [], key('Agent mode'), '[task]'),
  row('modes', 'agents', ['subagents'], key('Agent profile'), '[name]'),
  row(
    'modes',
    'permissions',
    ['approvals', 'allowed-tools', 'approve'],
    key('What the agent may do'),
  ),
  row('modes', 'goal', [], key('Work toward a goal'), '[condition|pause|resume|clear]'),
  row('modes', 'loop', ['proactive'], key('Run again and again'), '[interval] [prompt]'),
  row('modes', 'subtask', [], key('A helper in the background'), '<task>'),
  row('modes', 'bg', ['background'], key('Send, and start another'), '[prompt]'),
  row('modes', 'batch', [], key('One instruction over many notes'), '<instruction>'),
  row('modes', 'deep-research', ['research'], key('A cited report'), '<question>'),

  // 3.4 Context and instructions
  row('context', 'mention', ['add', 'attach'], key('Attach something'), '<thing>'),
  row('context', 'add-space', ['add-dir'], key('Reach another space'), '<space>'),
  row('context', 'memory', ['memories', 'instructions', 'rules'], key('Instructions and memory')),
  row('context', 'init', [], key('Write AGENTS.md')),
  row('context', 'skills', ['commands', 'prompts'], key('Your own commands'), '[name]'),
  row('context', 'mcp', ['tools'], key('Tools')),

  // 3.5 On words
  row('words', 'shorter', [], key('Shorter')),
  row('words', 'longer', [], key('Longer')),
  row('words', 'fix', ['grammar'], key('Fix grammar')),
  row('words', 'translate', [], key('Translate'), '[language]'),
  row('words', 'explain', [], key('Explain')),
  row('words', 'summarize', [], key('Summarize'), '[note]'),
  row('words', 'review', ['code-review'], key('Review'), '[note|changes]'),
  row('words', 'diff', ['changes'], key('What it changed')),

  // 3.6 Account and app
  row('app', 'status', [], key('Status')),
  row('app', 'usage', ['cost', 'stats', 'rate-limit-options'], key('Usage')),
  row('app', 'login', [], key('Sign in')),
  row('app', 'logout', [], key('Sign out')),
  row('app', 'doctor', ['checkup', 'debug-config'], key('Check the setup')),
  row('app', 'config', ['settings'], key('Settings')),
  row('app', 'keybindings', ['keymap'], key('Shortcuts')),
  row('app', 'theme', [], key('Switch theme')),
  row('app', 'vim', [], key('Vim keys')),
  row('app', 'voice', [], key('Dictate'), '[on|off]'),
]

/** `/goal`'s word for ending it, and Claude Code's five others for the same. */
export const GOAL_CLEAR: readonly string[] = ['clear', 'stop', 'off', 'reset', 'none', 'cancel']

/** Every name and synonym the table takes, which a custom command may not. */
export function takenNames(): Set<string> {
  return new Set(ROWS.flatMap((one) => [one.name, ...one.synonyms]))
}
