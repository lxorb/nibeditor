/** What Send to chat puts in a composer (send.ts), apart from it so a test reads it:
 *  a link to the note, or a quote of part of it above a link to the heading it is under. */

/** The words a composer is handed for a note, or for a part of one under a heading. */
export function sentWords(name: string, quote?: { text: string; heading?: string | null }): string {
  if (!quote?.text.trim()) return `[[${name}]] `
  const quoted = quote.text
    .trim()
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n')
  const link = quote.heading ? `[[${name}#${quote.heading}]]` : `[[${name}]]`
  return `${quoted}\n\n${link} `
}

/** The heading a place in a note is under, or null above the first. */
export function headingAbove(text: string, at: number): string | null {
  const lines = text.slice(0, at).split('\n')
  for (let index = lines.length - 1; index >= 0; index--) {
    const found = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(lines[index] ?? '')
    if (found?.[1]) return found[1]
  }
  return null
}
