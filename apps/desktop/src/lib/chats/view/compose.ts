/** The composer's decisions, apart from its editor (docs/chats.md 4.15, 4.16): what
 *  Enter does where the caret is, which `@` is being typed and who it could be, and
 *  what Send makes of the words. Pure, so each is a table a test reads.
 *
 *  Enter sends, as in every chat; inside a fenced block or a list it goes on writing
 *  it, as in a note, and Ctrl+Enter sends from anywhere. Shift+Enter is a new line. */

import type { Member, Who } from '@nib/chats'

export type EnterDoes = 'send' | 'line' | 'editor'

/** What Enter does with the words before the caret, and the modifiers held. */
export function enterDoes(before: string, held: { shift: boolean; mod: boolean }): EnterDoes {
  if (held.mod) return 'send'
  if (held.shift) return 'line'
  if (inFence(before) || inList(before)) return 'editor'
  return 'send'
}

/** Whether the caret is inside a fenced block: an odd number of fence lines above it. */
function inFence(before: string): boolean {
  const fences = before.match(/^ {0,3}(`{3,}|~{3,})/gm)
  return (fences?.length ?? 0) % 2 === 1
}

/** Whether the caret's line is a list item with something written in it: an empty
 *  item is the editor's too, which ends the list. */
function inList(before: string): boolean {
  const line = before.slice(before.lastIndexOf('\n') + 1)
  return /^\s*(?:[-*+]|\d{1,9}[.)])\s(?:\[[ xX]\]\s)?/.test(line)
}

/** A mention being typed: where its `@` is and what follows it. Null when the caret is
 *  not in one: no `@` on the line, one touching a word before it (an address), or a
 *  space typed since. */
export function mentionAt(text: string, caret: number): { from: number; query: string } | null {
  const line = text.slice(text.lastIndexOf('\n', caret - 1) + 1, caret)
  const at = line.lastIndexOf('@')
  if (at === -1) return null
  const query = line.slice(at + 1)
  if (/\s/.test(query) || query.length > 32) return null
  if (at > 0 && /[\p{L}\p{N}_]/u.test(line.charAt(at - 1))) return null
  return { from: caret - query.length - 1, query }
}

/** What an `@` may call besides a person: the reader's own agent at the start of a
 *  message (docs/chats.md 4.14), everybody with a device active, everybody. */
export type Special = 'nib' | 'here' | 'everyone'

/** Whether words are a question to the reader's own agent rather than a message:
 *  `@nib` first, then the question. Nothing is sent; the AI sidebar answers it. */
export function nibAsked(words: string): string | null {
  const found = /^\s*@nib(?:\s+([\s\S]*))?$/i.exec(words)
  return found ? (found[1] ?? '').trim() : null
}

/** Who a mention could be: people whose name or nickname starts with what was typed,
 *  then whose name has a word that does, and the specials where they fit: `nib` only
 *  at the start of a message (`first`), which is where it asks. */
export function mentionChoices(
  query: string,
  members: readonly Member[],
  me: Who | null,
  first = false,
): (Member | Special)[] {
  const wanted = fold(query)
  const named = members.filter((one) => one.who !== me)
  const starts = named.filter((one) =>
    [one.nick, one.name].some((name) => name !== undefined && fold(name).startsWith(wanted)),
  )
  const inside = named.filter(
    (one) =>
      !starts.includes(one) &&
      [one.nick, one.name].some(
        (name) =>
          name !== undefined &&
          fold(name)
            .split(/\s+/)
            .some((word) => word.startsWith(wanted)),
      ),
  )
  const specials = (['nib', 'here', 'everyone'] as const).filter(
    (one) => one.startsWith(wanted) && (first || one !== 'nib'),
  )
  return [...starts, ...inside, ...specials].slice(0, 8)
}

/** What a chosen mention writes: `@` and the name the chat shows them by, and a space. */
export function mentionText(choice: Member | Special): string {
  return typeof choice === 'string' ? `@${choice} ` : `@${choice.nick ?? choice.name} `
}

/** The words a message is sent with: without blank lines either side. Who they call is
 *  the store's to read out of them. */
export function trimmed(text: string): string {
  return text.replace(/^\s*\n/, '').replace(/\s+$/, '')
}

function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
}
