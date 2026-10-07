/** Who a message calls for (docs/chats.md 3, #36 and #37).
 *
 *  Completion writes a person as `@` and the name the chat shows them by, their
 *  nickname in the space or their account's name, and the event carries who that is by
 *  id, so a rename later never changes who was called. This reads the ids back out of
 *  the words: what the composer sends as `mentions`, and what the object checks a
 *  program's post by. A name may have spaces in it, so the longest name that fits wins:
 *  `@Lucile Martin` is Lucile Martin even where a Lucile is in the chat too. Nothing
 *  inside code is a mention, as nothing inside code is a link. */

import type { Member, Mention } from './types'

/** A letter, a digit or an underscore: what may not touch a mention on either side,
 *  so `ana@example.com` calls nobody and `@Lucile2` is not Lucile. */
const WORDY = /[\p{L}\p{N}_]/u

const SPECIALS = ['here', 'everyone'] as const

/** Everybody a message's words call for, each once, in the order they are first
 *  called. */
export function mentionsIn(body: string, members: readonly Member[]): Mention[] {
  const text = withoutCode(body)
  const labels = labelsOf(members)
  const found: Mention[] = []
  const add = (mention: Mention) => {
    if (!found.includes(mention)) found.push(mention)
  }

  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    if (at > 0 && (WORDY.test(text.charAt(at - 1)) || text.charAt(at - 1) === '@')) continue
    const special = SPECIALS.find((word) => calls(text, at + 1, word))
    if (special) {
      add(special)
      continue
    }
    const member = labels.find(([label]) => calls(text, at + 1, label))
    if (member) add(member[1])
  }
  return found
}

/** Every name a member answers to, longest first, so the longest that fits is found
 *  first. */
function labelsOf(members: readonly Member[]): [string, Mention][] {
  const labels: [string, Mention][] = []
  for (const member of members) {
    for (const label of [member.nick, member.name]) {
      const clean = label?.trim()
      if (clean) labels.push([clean, member.who])
    }
  }
  return labels.sort(([a], [b]) => b.length - a.length)
}

/** Whether `label` is written at `from`, in any case, and ends there. */
function calls(text: string, from: number, label: string): boolean {
  const written = text.slice(from, from + label.length)
  if (written.length !== label.length) return false
  if (written.normalize('NFC').toLowerCase() !== label.normalize('NFC').toLowerCase()) return false
  return !WORDY.test(text.charAt(from + label.length))
}

/** The words with every fenced block and every code span blanked out, the same length,
 *  so what is left is only what a reader reads as prose. */
function withoutCode(body: string): string {
  const blank = (part: string) => part.replace(/[^\n]/g, ' ')
  const fenced = body.replace(
    /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[`~]*[ \t]*$|(?![\s\S]))/gm,
    blank,
  )
  return fenced.replace(/(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, blank)
}
