/** What a message kept outside its chat is made of (keep.ts), apart from it so a test
 *  reads it: a task's words, a note's name, and a message as a quote. */

/** The first line of words. */
const firstLine = (body: string) => body.split('\n')[0] ?? ''

/** The most words a note's name is made of, and its longest. */
const NAME_WORDS = 8
const NAME_LENGTH = 60

/** The task a message makes: its first line, and `+Name` for each person it called in
 *  place of the `@Name` it called them by, which quick add would read as a label. */
export function taskWords(body: string, called: readonly string[]): string {
  let line = firstLine(body).replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
  for (const name of called) line = line.split(`@${name}`).join(' ')
  line = line.replace(/\s+/g, ' ').trim()
  const people = called.map((name) => `+${name.split(/\s+/)[0] ?? name}`)
  return [line, ...people].filter(Boolean).join(' ')
}

/** A note's name from a message's first words, as a file name may hold them. */
export function noteNameOf(body: string, fallback: string): string {
  const words = firstLine(body)
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, NAME_WORDS)
    .join(' ')
    .slice(0, NAME_LENGTH)
    .trim()
  return words || fallback
}

/** One message as a quote under its writer's name and time, its files' embeds in it. */
export function quoted(who: string, at: string, body: string, files: readonly string[]): string {
  const lines = [
    `**${who}** · ${at}`,
    ...(body ? body.split('\n') : []),
    ...files.map((one) => `![[${one}]]`),
  ]
  return lines.map((line) => (line ? `> ${line}` : '>')).join('\n')
}
