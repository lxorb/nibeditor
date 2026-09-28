/** A `nib://` link, read.
 *
 *  Nothing here touches a note or a space: a link is a string that arrived from
 *  outside the app, and this is the file that decides what it says before
 *  anything acts on it. What the actions are is verbs.ts.
 *
 *  The shape is obsidian's, because somebody automating a markdown editor has
 *  almost certainly written one of those before: `nib://open?path=...`, with
 *  x-callback-url's `x-success`, `x-error` and `x-cancel` on top so a link can be
 *  a step in a shortcut rather than the end of one.
 *
 *  Two schemes, one meaning. `nib:` is what the app registers on a desktop and on
 *  a phone. `web+nib:` is what a browser lets a page register, which is the only
 *  shape a browser allows, and the page hands it back as `?nib=`; see start.ts. */

/** The schemes a link may be written in. */
const SCHEMES = ['nib:', 'web+nib:'] as const

/** The three names a callback is written under, which are arguments of the link
 *  rather than arguments of the action. */
const CALLBACK_KEYS = ['x-success', 'x-error', 'x-cancel'] as const

/** Where to go when the action is through, as x-callback-url spells it. Each is
 *  null when the link did not say. */
interface Callbacks {
  success: string | null
  error: string | null
  cancel: string | null
}

/** A link, read into the three things acting on it needs. */
export interface Followable {
  /** Which action it asks for, folded. */
  action: string
  /** Everything else it said, by folded name. */
  args: Record<string, string>
  callbacks: Callbacks
}

/** Whether a string is one of ours at all. What the browser's `?nib=` and a
 *  callback address are both judged by. */
export function isNibUri(text: string): boolean {
  const folded = text.trim().toLowerCase()
  return SCHEMES.some((scheme) => folded.startsWith(scheme))
}

/** Whether an address is a file rather than a link: what a Mac hands the app for
 *  a document opened from the Finder, which the same system call delivers beside
 *  `nib://` links. A file is opened as a file, by the launch's own road; see
 *  src-tauri/src/launch.rs. */
export function isFileUri(text: string): boolean {
  return text.trim().toLowerCase().startsWith('file:')
}

/** Reads a link, or answers null for one this app has no business following.
 *
 *  Null rather than a throw: a link arrives from outside, and outside is full of
 *  addresses that are not ours. The caller says so on screen once; see start.ts. */
export function readUri(uri: string): Followable | null {
  const trimmed = uri.trim()
  const scheme = SCHEMES.find((one) => trimmed.toLowerCase().startsWith(one))
  if (!scheme) return null

  // The slashes after the colon are optional in every scheme that is not the
  // web's, and both shapes are written in the wild: `nib://open` and `nib:open`.
  const rest = trimmed.slice(scheme.length).replace(/^\/+/, '')
  const cut = rest.indexOf('?')
  const said = (cut < 0 ? rest : rest.slice(0, cut)).replace(/\/+$/, '')
  const query = cut < 0 ? '' : rest.slice(cut + 1)

  // `x-callback-url/open` is how the tools that invented the callbacks write it,
  // and it means the same as `open` with an `x-success` on it.
  // A dot is allowed so that a link naming a verb the app will not do for a link -
  // `nib://files.delete` - is read as that verb and declined by name, rather than
  // read as a broken address. What a link may actually ask for is the table's
  // business and nothing to do with the spelling; see verbs.ts.
  const action = said.replace(/^x-callback-url\//i, '').toLowerCase()
  if (!/^[a-z][a-z.-]*$/.test(action)) return null

  const given: Record<string, string> = {}
  for (const [name, value] of new URLSearchParams(query)) {
    const key = name.toLowerCase()
    // The first one wins. A link that says the same thing twice was built by
    // pasting, and the half somebody meant is the half they wrote first.
    if (!Object.hasOwn(given, key)) given[key] = value
  }

  const callbacks: Callbacks = {
    success: given['x-success'] ?? null,
    error: given['x-error'] ?? null,
    cancel: given['x-cancel'] ?? null,
  }

  // Out of the arguments, so a verb is never handed one of these as if it were
  // something it asked for.
  const args = Object.fromEntries(
    Object.entries(given).filter(([key]) => !CALLBACK_KEYS.some((one) => one === key)),
  )

  return { action, args, callbacks }
}

/** Which kind of address a callback is, or null for one that is not followed.
 *
 *  Two kinds, and nothing else. `http(s)` leaves the app the ordinary way,
 *  through the opener, whose own scope is those and a mailto. A `nib://` address
 *  is this app's own scheme and is followed here, with the system asked nothing.
 *
 *  Every other scheme is refused on purpose. `file:` and `smb:` would ask the
 *  system to open something on this machine, `javascript:` would run in the page,
 *  and a scheme another program registered is a program that a link in a note
 *  could start. Allowing one would mean widening the opener's scope, and that
 *  scope is the whole reason a link in a note cannot open anything it likes; see
 *  isOpenable in tauri.ts and the security section of docs/automation.md. */
export function callbackKind(url: string | null): 'external' | 'nib' | null {
  if (!url) return null
  if (isNibUri(url)) return 'nib'

  return /^https?:\/\//i.test(url) ? 'external' : null
}

/** A callback address with the outcome written onto it, the way x-callback-url
 *  asks: whatever the caller already put in the address is kept, and the app adds
 *  what it has to say under names of its own.
 *
 *  Only strings, and only a handful: an answer is a sentence or a path, and a
 *  shortcut reading it wants a value rather than a document. */
export function withOutcome(url: string, said: Record<string, string>): string {
  const cut = url.indexOf('?')
  const query = new URLSearchParams(cut < 0 ? '' : url.slice(cut + 1))

  for (const [name, value] of Object.entries(said)) query.set(name, value)

  const written = query.toString()
  const head = cut < 0 ? url : url.slice(0, cut)
  return written ? `${head}?${written}` : head
}
