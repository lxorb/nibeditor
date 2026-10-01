/** The line an installed theme starts with, which is the whole record of the install.
 *
 *  Apart from the reviewer in validate.ts because the two are read at different times.
 *  Every launch reads the stamp off each theme file in the folder, to name it in the
 *  picker and to know which version of the store's is installed; nothing reviews a
 *  theme until somebody installs one from the store. So this is in front of the first
 *  paint and the reviewer, the gallery and the catalogue are not. See
 *  test/weight.test.ts. */

/** What the theme says about itself, written into the file when it is
 *  installed, so an installed theme carries its own name and version and there
 *  is no second file to keep in step with it. */
export interface Stamp {
  id: string
  name: string
  author: string
  version: string
}

/** The stamp itself, at the front of a file, with its JSON as the one group. Taken
 *  off before the file is read for what it sets: what it says is a name, not CSS. */
export const STAMP_LINE = /^\s*\/\*!\s*nib-theme\s*(\{.*?\})\s*\*\//

/** The stamp line an installed theme starts with. One line of JSON inside a
 *  comment: the file is the whole record of the install, so there is nothing to
 *  keep in step and a theme copied to another machine by hand still knows what
 *  it is and which version it is at.
 *
 *  What goes in it is a name and a version out of the catalogue, which is a file
 *  on somebody else's server; a comment holding those verbatim is a comment they
 *  can close. So every `/` is written as `\/`, which JSON reads back as itself
 *  and CSS can make no comment out of, and the fields are cleaned first: the
 *  stamp is the one part of an installed theme the reviewer never sees. */
export function stamped(stamp: Stamp, css: string): string {
  const clean = (text: string) => text.replace(/[/*\\]/g, '').replace(/\p{Cc}/gu, '')
  const said = {
    id: clean(stamp.id),
    name: clean(stamp.name),
    author: clean(stamp.author),
    version: clean(stamp.version),
  }

  return `/*! nib-theme ${JSON.stringify(said).replace(/\//g, '\\/')} */\n${css}\n`
}

/** What the stamp said, for a file that has one. Anything else is a theme
 *  somebody wrote by hand, which the store has nothing to say about. */
export function stampOf(css: string): Stamp | null {
  const line = STAMP_LINE.exec(css)
  if (!line?.[1]) return null

  try {
    const value: unknown = JSON.parse(line[1])
    if (typeof value !== 'object' || value === null) return null

    const { id, name, author, version } = value as Record<string, unknown>
    if (
      typeof id !== 'string' ||
      typeof name !== 'string' ||
      typeof author !== 'string' ||
      typeof version !== 'string'
    ) {
      return null
    }

    return { id, name, author, version }
  } catch {
    return null
  }
}
