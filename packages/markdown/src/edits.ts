/** One edit, and the smallest one two versions of a text differ by.
 *
 *  Here rather than in either caller because two of them want the same answer for
 *  the same reason. A note's front matter and a canvas's `nib` key are both metadata
 *  somebody's file carries, and setting one has to come out as an edit of the
 *  characters that moved rather than as a rewritten file: a note open in a pane takes
 *  the edit and keeps every caret in it where its reader left it, and the version
 *  kept before the write is a version of the file rather than of the app's idea of
 *  it. See front-matter.ts and canvas.ts. */

/** A replacement of one span of a text. The offsets are into the text before it. */
export interface TextEdit {
  from: number
  to: number
  insert: string
}

/** The single span two texts differ over: everything they share at the front and at
 *  the back taken off. Null where they do not differ at all, which is a caller that
 *  should write no file.
 *
 *  One span and not a diff. Setting a key changes one run of characters in one place
 *  even when it takes two passes to work out what that run is, and a caller that
 *  wanted several spans would want a diff library rather than this. */
export function oneEdit(before: string, after: string): TextEdit | null {
  if (before === after) return null

  let from = 0
  while (from < before.length && from < after.length && before[from] === after[from]) from++

  let back = 0
  while (
    back < before.length - from &&
    back < after.length - from &&
    before[before.length - 1 - back] === after[after.length - 1 - back]
  ) {
    back++
  }

  return { from, to: before.length - back, insert: after.slice(from, after.length - back) }
}

/** The text as several edits leave it. The edits are in the order they sit in the
 *  text, never overlap, and each one's offsets are into the text before any of them,
 *  which is the shape CodeMirror takes a change in too. */
export function appliedEdits(before: string, edits: readonly TextEdit[]): string {
  let text = ''
  let at = 0
  for (const edit of edits) {
    text += before.slice(at, edit.from) + edit.insert
    at = edit.to
  }
  return text + before.slice(at)
}
