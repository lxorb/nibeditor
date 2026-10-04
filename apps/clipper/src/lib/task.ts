/** A page as a task: the clipper's "As a task" (docs/tasks.md 3, row 16), one line in
 *  the space's inbox with the page linked in it, the way Todoist's own extension adds
 *  a website as a task.
 *
 *  What is under the cursor decides the words: the link it is on, the words it chose,
 *  or the page itself. Pure, so the line is a test; the worker sends it. */

/** What the page's menu knows when it is pressed. */
export interface Pressed {
  title: string
  url: string
  /** The link under the cursor, where the menu was opened on one. */
  link?: string
  /** The words chosen, where there are some. */
  selection?: string
}

/** One line of words, as long as a task line holds. */
function line(words: string, most = 300): string {
  const said = words.replace(/\s+/g, ' ').trim()
  return said.length > most ? `${said.slice(0, most - 1)}…` : said
}

/** Square brackets taken out of the words of a link, which would end it early. */
const linkWords = (words: string) => line(words).replace(/[[\]]/g, '')

/** The task's words: the chosen words or the page's title, linked to the link under
 *  the cursor or to the page. */
export function taskText(pressed: Pressed): string {
  const address = pressed.link ?? pressed.url
  const words = pressed.selection?.trim() ? pressed.selection : pressed.title
  const shown = linkWords(words) || address
  return /^https?:\/\//.test(address) ? `[${shown}](${address})` : line(words)
}
