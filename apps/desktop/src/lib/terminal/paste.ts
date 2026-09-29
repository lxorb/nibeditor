/** What a paste into a terminal becomes, and when it asks first.
 *
 *  A line break pasted into a shell is Enter: copy three commands off a web page and all
 *  three run the moment they land. Windows Terminal asks before every paste of more than
 *  one line; VS Code asks only when the shell cannot tell a paste from typing - when
 *  bracketed paste is off, which is the one case where the lines really would run.
 *  VS Code's is the rule here, because a question before every paste is a question
 *  everybody learns to click through.
 *
 *  And a single line loses the whitespace after it, which is Windows Terminal's
 *  `trimPaste`: a command copied out of a note or a page usually carries the line break
 *  that ended it, and pasted with it, it ran before anybody could look at it.
 *
 *  Pure; xterm.js does the rest, turning line breaks into the carriage returns a
 *  terminal expects and wrapping the text in the brackets when the shell asked for
 *  them. */

/** The text as it is sent. */
export function pasted(text: string): string {
  const trimmed = text.replace(/\s+$/, '')
  return /[\r\n]/.test(trimmed) ? text : trimmed
}

/** How many lines a paste is, after `pasted`. */
export function linesIn(text: string): number {
  return pasted(text).split(/\r\n|\r|\n/).length
}

/** Whether to ask before the paste goes in: more than one line, and a shell that would
 *  run each of them as it arrives. */
export function asksFirst(text: string, bracketed: boolean): boolean {
  return !bracketed && linesIn(text) > 1
}
