/** What a note's live card in a message shows of it (docs/chats.md 4.13): its first
 *  lines as they read, without the front matter, the marks of markdown or a heading
 *  that only says the note's name again. Pure, so a test reads it. */

import { stripFrontMatter } from '@nib/markdown/front-matter'

/** The lines a card shows. */
const LINES = 2

/** The longest line a card shows. */
const LONGEST = 160

/** A line of markdown as it reads: no heading, list, quote or task marks, no emphasis,
 *  a link's words without its address, a wikilink's name. */
function plain(line: string): string {
  return line
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d{1,9}[.)]\s+)/, '')
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, alias?: string) =>
      (alias ?? target).trim(),
    )
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|==|\*|_|`)(.+?)\1/g, '$2')
    .trim()
}

/** The first lines of a note, for a card under its name. */
export function cardLines(text: string, name: string): string[] {
  const lines: string[] = []
  let fenced = false
  for (const raw of stripFrontMatter(text).split('\n')) {
    if (/^\s{0,3}(```|~~~)/.test(raw)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const line = plain(raw)
    if (!line || (lines.length === 0 && line.toLowerCase() === name.toLowerCase())) continue
    lines.push(line.length > LONGEST ? `${line.slice(0, LONGEST)}…` : line)
    if (lines.length === LINES) break
  }
  return lines
}

/** The note a message is about, for its card: the first `[[wikilink]]` in its words, its
 *  heading and alias set aside, and none inside code, an embed, or a quote of a note. */
export function cardTarget(body: string): string | null {
  const words = body.replace(/```[\s\S]*?(?:```|$)/g, '').replace(/`[^`\n]*`/g, '')
  for (const found of words.matchAll(/(!?)\[\[([^\]|#^]+)[^\]]*\]\]/g)) {
    const start = words.lastIndexOf('\n', found.index) + 1
    if (found[1] || words.slice(start, found.index).trimStart().startsWith('>')) continue
    const target = found[2]?.trim()
    if (target) return target
  }
  return null
}
