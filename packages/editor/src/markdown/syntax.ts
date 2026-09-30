/** What the markdown extensions are written in: the character codes lezer's
 *  parsers work with, the highlighting tags for constructs CommonMark and GFM
 *  do not name, and the one test they all share.
 *
 *  Its own file because both halves of the parser need it - the constructs in
 *  constructs.ts and the fenced-code parser in fences.ts - and neither should
 *  have to import the other to get at it. */

/** Lezer hands a parser character codes rather than characters, so the ones
 *  these constructs are spelled with are named here. */
export const DOLLAR = 36
export const BACKTICK = 96
export const TILDE = 126
export const EQUALS = 61
export const PERCENT = 37
export const BRACKET_OPEN = 91
export const BRACKET_CLOSE = 93
export const CARET = 94
export const BACKSLASH = 92
export const BANG = 33
export const HASH = 35
export const NEWLINE = 10

/** Whether a code is whitespace, a line break, or the end of the input, which
 *  is what -1 means. */
export function isSpace(code: number): boolean {
  return code === 32 || code === 9 || code === NEWLINE || code === -1
}
