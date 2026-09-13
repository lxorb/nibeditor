/** A website in the space as a file of its own: `Svelte docs.url`.
 *
 *  The format is nobody's invention. `.url` is the Windows Internet Shortcut, an
 *  INI file with one section and one key that matters, and it is what Explorer
 *  writes when a page is dragged out of a browser onto the desktop. Double-clicking
 *  one opens it in the reader's browser on a machine that has never heard of nib;
 *  every browser writes one; a backup, a sync and a search over the folder all see
 *  a small text file with an address in it.
 *
 *  ```ini
 *  [InternetShortcut]
 *  URL=https://svelte.dev/docs
 *  Title=Svelte docs
 *  Nib-Added=2026-09-12T08:30:00.000Z
 *  ```
 *
 *  `URL` is the format's own key and the only one it requires. The other two are
 *  nib's, in the same block, spelled the way the format spells keys - a reader that
 *  does not know them steps over them, which is what an INI parser does with a key
 *  it has no use for. Three keys is the whole file: where it points, what it is
 *  called, and when it was written down. A title is here rather than taken from the
 *  file name because a name on disk cannot hold `?`, `:` or `/` and a page's title
 *  often does.
 *
 *  Written with CRLF, because that is what the format is written with and what the
 *  Windows profile-string parser behind `ShellExecute` was built to read. Read with
 *  either.
 *
 *  **`.webloc` is read too, and never written.** It is the same idea on macOS - a
 *  plist with a `URL` string in it - and a page dragged out of Safari into a space
 *  arrives as one. nib opens it as a website rather than as a file it has no use
 *  for. Only the XML kind: a binary plist is a format this app has no business
 *  carrying a parser for, and Safari writes XML.
 *
 *  What the old format was, and why it is not this: a website used to be a `.md`
 *  note whose front matter said `url:`. It read as a note in Obsidian, which was the
 *  argument for it, and the cost was that every website in a space was also a note
 *  in it - in the note count, in the graph, in the notes a link could be made
 *  against, and in the words a search read. Obsidian simply does not list an
 *  extension it has never heard of, which is a row that is not there rather than a
 *  row that is wrong. See docs/web-tabs.md. */

import { isWebAddress } from './address'

/** The one section a `.url` file has. Compared without case, because an INI
 *  section is a name and not a string. */
const SECTION = 'internetshortcut'

/** The key that makes the file a shortcut at all. */
const URL_KEY = 'url'

/** nib's own, in the same block. */
const TITLE_KEY = 'title'
const ADDED_KEY = 'nib-added'
const HOME_KEY = 'nib-home'
const ICON_KEY = 'nib-icon'

/** What a shortcut file says. */
export interface Shortcut {
  /** Where it points, which is **where the reading has got to**: a web note is a
   *  browser tab, so following a link inside the page moves this - and opening the
   *  note again, here or on another machine the space syncs to, opens the page that
   *  was open rather than the site's front door.
   *
   *  Always a web address: a file whose `URL` is anything else is not a website this
   *  app will open, and reads as no shortcut at all. */
  url: string
  /** What it is called, or null when the file does not say and the name is all
   *  there is. */
  title: string | null
  /** When it was written down, as the file says it. Carried rather than read: only
   *  the file it came from has any use for it. */
  added: string | null
  /** Where the note points, as against where the reading has got to: the address
   *  somebody typed into the bar, or the one the note was made with. Null when it is
   *  the same as `url`, which is a note nobody has followed a link out of.
   *
   *  It is here because `URL` had to be the one a browser opens - double-clicking the
   *  file in Explorer should land where the reading is - and because a note whose
   *  address had quietly become the eighth page of somebody's browsing would be a note
   *  no link could point at. Home is what the note is; `URL` is where it is. */
  home: string | null
  /** The site's own mark, as an address: what the page's `<link rel=icon>` said the
   *  last time the page was open.
   *
   *  An address rather than the picture itself, because a picture inside a text file
   *  is a text file nothing else will read, and because the one thing a favicon always
   *  has is somewhere to be fetched from. It is here so that the tab strip and the file
   *  list have the site's mark before the page has loaded and on a machine that has
   *  never opened it. */
  icon: string | null
}

/** A shortcut file, from its parts.
 *
 *  `home` and `icon` are left out when there is nothing to say, so the ordinary file
 *  is the three lines it always was: a note nobody has browsed out of writes exactly
 *  what it wrote before this existed. */
export function writeShortcut(
  url: string,
  title: string,
  when: Date,
  home?: string | null,
  icon?: string | null,
): string {
  const rows = [
    `URL=${oneLine(url)}`,
    `Title=${oneLine(title.trim() || url)}`,
    `Nib-Added=${when.toISOString()}`,
  ]

  if (home && home !== url) rows.push(`Nib-Home=${oneLine(home)}`)
  if (icon) rows.push(`Nib-Icon=${oneLine(icon)}`)

  return `[InternetShortcut]\r\n${rows.join('\r\n')}\r\n`
}

/** A value as one line. A newline in a value would be a second key to the parser
 *  that reads this next, so it cannot survive being written. */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

/** What a `.url` file says, or null when it says nothing this app can open.
 *
 *  Read the way an INI file is read rather than the way this app writes one: keys
 *  in any order, any case, any amount of space around them, a comment line, and
 *  whatever other keys the browser that wrote it felt like leaving - `IconFile`,
 *  `IconIndex`, `Modified`, `HotKey` - all stepped over. Only the keys inside
 *  `[InternetShortcut]` are read, because a `.url` can carry other sections and
 *  their keys are not these.
 *
 *  A value keeps everything after the first `=`, since an address is full of them. */
export function readShortcut(text: string | null | undefined): Shortcut | null {
  if (!text) return null

  let section = ''
  const said = new Map<string, string>()

  for (const row of text.split('\n')) {
    const line = row.trim()
    if (line.length === 0 || line.startsWith(';') || line.startsWith('#')) continue

    const named = /^\[(.*)]$/.exec(line)
    if (named) {
      section = (named[1] ?? '').trim().toLowerCase()
      continue
    }

    if (section !== SECTION) continue

    const at = line.indexOf('=')
    if (at < 1) continue

    const key = line.slice(0, at).trim().toLowerCase()
    if (!said.has(key)) said.set(key, line.slice(at + 1).trim())
  }

  const url = said.get(URL_KEY) ?? ''
  if (!isWebAddress(url)) return null

  // An empty value is a key that says nothing, which is the same as a key that is
  // not there: a file with `Title=` in it has no title.
  return {
    url,
    title: nothing(said.get(TITLE_KEY)),
    added: nothing(said.get(ADDED_KEY)),
    home: nothing(said.get(HOME_KEY)),
    icon: nothing(said.get(ICON_KEY)),
  }
}

/** A value that says nothing, as null. */
function nothing(value: string | undefined): string | null {
  const said = value?.trim() ?? ''
  return said.length === 0 ? null : said
}

/** What a website file says, whichever of the two systems wrote it.
 *
 *  The one reader, so the tab that draws a page, the row that opens one and the
 *  session that remembers where a tab was all read the same file the same way. A
 *  `.webloc` says only where it points: the title in one is the file's own name, and
 *  there is no key for when it was written down. */
export function readWebFile(path: string, text: string | null | undefined): Shortcut | null {
  if (!/\.webloc$/i.test(path.trim())) return readShortcut(text)

  const url = readWebloc(text)
  return url === null ? null : { url, title: null, added: null, home: null, icon: null }
}

/** The address in a macOS `.webloc`, or null.
 *
 *  A plist is XML, and the whole of what this needs out of one is the string after
 *  the key called `URL`. Read with a pattern rather than with a parser: the app has
 *  no XML parser and this is not a reason to grow one, a `.webloc` is written by
 *  one program and always has the same four lines, and anything it cannot read
 *  answers null - which is a file that opens as a file rather than as a website. */
export function readWebloc(text: string | null | undefined): string | null {
  if (!text) return null

  const found = /<key>\s*URL\s*<\/key>\s*<string>([\s\S]*?)<\/string>/i.exec(text)
  const url = entities((found?.[1] ?? '').trim())
  return isWebAddress(url) ? url : null
}

/** The five entities XML can hold, which is all a plist writer escapes. */
function entities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}
