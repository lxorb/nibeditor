/** Every verb the app answers, and the one place both roads in go through.
 *
 *  There is one table because there was nearly two. A `nib://` link and the `nib`
 *  command ask for the same things in the same words, and two lists of them would
 *  have drifted the first time one of them grew a verb - which is also how one of
 *  them would have ended up with a check the other did not have. So the link
 *  router and the endpoint both call `dispatch`, and the only difference between
 *  them is what the table says each is allowed to ask for.
 *
 *  What the columns mean:
 *
 *  - `takes` names the arguments a caller may give without naming them, in order,
 *    which is what the command line's positional words become. The verbs
 *    themselves only ever read named arguments, so the command line does not have
 *    to know the shape of anything.
 *  - `byLink` is whether a `nib://` link may ask for it, and whether it answers one.
 *    Off by default, and off for everything that writes or reads the window: a link
 *    can be written by anybody and sent to anybody, so the most one can do is what a
 *    person clicking about in the app could undo in a moment. `'quiet'` means a link
 *    may ask and hears nothing back; `'back'` means the outcome goes to the link's
 *    own `x-success`, which only a verb that changed something says.
 *  - `confirms` is whether the caller has to say `yes` first. In the table rather
 *    than in the command line, so the app refuses whoever asks rather than
 *    trusting a flag somebody else's script did or did not pass.
 *
 *  The names are the command line's spelling, dots and all, because that is the
 *  surface somebody reads in a terminal. The four link actions map onto them; see
 *  `BY_LINK` below. */

import {
  appendNote,
  deleteFile,
  moveFile,
  newNote,
  openNote,
  publishNow,
  runCommand,
  searchSpace,
  setProperty,
  syncNow,
  writeFile,
} from './acts'
import {
  countWords,
  listBacklinks,
  listBookmarks,
  listCommands,
  listFiles,
  listLinks,
  listOrphans,
  listTags,
  publishStatus,
  readFile,
  readNoteProperties,
  readOutline,
  syncStatus,
  windowRect,
} from './answers'
import { said as wordsOf, type Road, type Said, yes } from './args'

/** One verb, whole. */
interface Verb {
  /** The arguments a caller may give in order without naming them. */
  takes?: readonly string[]
  /** Whether a `nib://` link may ask for it, and what it tells one afterwards.
   *
   *  `'quiet'` is the answer for every verb that only moves the window about, and it
   *  is not politeness. A link carries the address its outcome goes to, so whatever
   *  a verb answers a link is an answer the writer of the link has read - and
   *  `nib://open?path=Plan` answers the path it landed on. Said back, that is a
   *  question about the space: send somebody a hundred of these, each with an
   *  `x-success` of your own, and what comes back is a list of what they keep notes
   *  about, from a scheme that was only ever allowed to move a window.
   *
   *  `'back'` is for a verb the caller already knows the answer to, because the
   *  caller is the one who changed it: `nib://new` was told the name it made. That is
   *  the shape x-callback-url exists for, a shortcut that files something and carries
   *  on, and it is the only shape that says anything. */
  byLink?: 'quiet' | 'back'
  /** Whether it has to be confirmed before it runs. */
  confirms?: boolean
  /** What it answers. A verb that has nothing to wait for is written without a
   *  promise, and `dispatch` awaits whatever comes back either way.
   *
   *  The road is handed to every verb and read by one: a command's row may say it
   *  is only for somebody at the keyboard. It is a parameter rather than an
   *  argument because an argument is something a link can write. */
  run: (args: Said, road: Road) => unknown
}

const VERBS: Record<string, Verb> = {
  // The five a link can ask for. Opening, searching and running a command change
  // nothing a person could not change back; making a note never writes over one, and
  // appending only ever adds to the end of one. See acts.ts.
  //
  // None of them confirms, and that is not an oversight: a link writes its own query
  // string, so it would write the `yes` as well. What keeps a link out is `byLink`
  // being absent, which is how every verb that could overwrite, move or delete a note
  // is out of reach.
  open: { takes: ['path'], byLink: 'quiet', run: openNote },
  new: { takes: ['name'], byLink: 'back', run: newNote },
  append: { takes: ['path', 'content'], byLink: 'back', run: appendNote },
  search: { takes: ['query'], byLink: 'quiet', run: searchSpace },
  'commands.run': { takes: ['id'], byLink: 'quiet', run: runCommand },

  // Questions. None of them changes anything, and none is answered to a link
  // either: a link cannot read the answer, so the only thing it could do with one
  // is put somebody else's note into an `x-success` address.
  'files.list': { run: listFiles },
  'files.read': { takes: ['path'], run: readFile },
  'commands.list': { run: listCommands },
  links: { takes: ['path'], run: listLinks },
  backlinks: { takes: ['path'], run: listBacklinks },
  orphans: { run: listOrphans },
  tags: { run: listTags },
  'properties.read': { takes: ['path'], run: readNoteProperties },
  outline: { takes: ['path'], run: readOutline },
  bookmarks: { run: listBookmarks },
  words: { takes: ['path'], run: countWords },
  'sync.status': { run: syncStatus },
  'publish.status': { run: publishStatus },
  window: { run: windowRect },

  // What the app calls itself every twenty seconds, asked for now. Nothing to
  // confirm: a pass is what the app is already doing, and neither verb can lose
  // anything - a clash keeps both copies, as it does on every other pass.
  'sync.now': { run: syncNow },
  'publish.now': { run: publishNow },

  // Its own name for its own list, so the command line's help can be the app's
  // answer rather than a second copy of it that goes stale.
  verbs: { run: () => ({ verbs: verbNames() }) },

  // Changes. Every one of them is out of a link's reach and behind a confirmation.
  'files.write': { takes: ['path', 'content'], confirms: true, run: writeFile },
  'files.move': { takes: ['path', 'to'], confirms: true, run: moveFile },
  'files.delete': { takes: ['path'], confirms: true, run: deleteFile },
  'properties.set': { takes: ['key', 'value'], confirms: true, run: setProperty },

  // Running whatever it is sent inside the window. The endpoint refuses it before
  // it reaches here unless this installation's own file says otherwise, and a link
  // can never ask for it at all; see src-tauri/src/endpoint.rs and eval.ts.
  eval: { takes: ['code'], confirms: true, run: runEval },
}

/** What each `nib://` action is called in the table. Only where the two differ:
 *  `nib://command` is the link spelling of the row the palette runs. */
const BY_LINK: Record<string, string> = { command: 'commands.run' }

/** The verb a link action names, or null for one no link may ask for - which
 *  includes every name that is not a verb at all. */
export function verbForAction(action: string): string | null {
  // A verb with a link spelling of its own is asked for by that spelling and no
  // other: two names for one action, on a surface anybody can write, is one name
  // too many. The dotted one stays the command line's.
  if (Object.values(BY_LINK).includes(action)) return null

  const name = BY_LINK[action] ?? action
  return VERBS[name]?.byLink === undefined ? null : name
}

/** Whether a link hears how the verb went, which is whether the verb changed
 *  something the link itself asked for; see `byLink`. Read by the road in start.ts,
 *  so the rule lives in the table with the rest of what a link may do. */
export function linkHearsFrom(verb: string): boolean {
  return VERBS[verb]?.byLink === 'back'
}

/** Whether a link action names a verb at all, whether or not a link may ask for
 *  it. What tells "the app will not do that from a link" apart from "there is no
 *  such thing", which are two different things to answer a link with. */
export function isVerb(action: string): boolean {
  return (BY_LINK[action] ?? action) in VERBS
}

/** Every verb by name. Read out of the table, so a verb cannot exist without
 *  being listed or be listed without existing. */
function verbNames(): string[] {
  return Object.keys(VERBS).sort()
}

/** Runs one verb.
 *
 *  Answers rather than throws: both callers have to say something either way, and
 *  a shape they both read is what lets the endpoint hand the answer straight on
 *  without an opinion of its own. */
export async function dispatch(
  verb: string,
  args: Said,
  rest: readonly string[] = [],
  road: Road = 'here',
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const [name, words] = twoWords(verb, rest)

  const found = VERBS[name]
  if (!found) return { ok: false, error: `there is no verb called ${name}` }

  const said = { ...withPositions(found, words), ...args }

  if (found.confirms === true && !yes(said, 'yes')) {
    return { ok: false, error: `${name} changes something: say yes to go ahead` }
  }

  try {
    return { ok: true, value: await found.run(said, road) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Half the verbs are written as two words - `files read`, `sync now` - and a
 *  terminal hands them over as two words. Joining them is done here rather than in
 *  the command line, so that the one thing which knows what the verbs are called is
 *  the table: the command line sends the words as typed and never has a list of its
 *  own to fall out of step.
 *
 *  A first word that is already a verb wins, so nothing can be turned into a
 *  two-word name by a value that happens to follow it. */
function twoWords(verb: string, rest: readonly string[]): [string, readonly string[]] {
  const [next, ...after] = rest
  if (verb in VERBS || next === undefined) return [verb, rest]

  return `${verb}.${next}` in VERBS ? [`${verb}.${next}`, after] : [verb, rest]
}

/** The words a caller gave in order, under the names the verb reads them by.
 *  Anything past the names it takes is ignored rather than refused: a verb that
 *  grows an argument should not break a script that was passing one too many. */
function withPositions(verb: Verb, rest: readonly string[]): Said {
  const out: Said = {}
  for (const [at, name] of (verb.takes ?? []).entries()) {
    const value = rest[at]
    if (value !== undefined) out[name] = value
  }

  return out
}

/** Running JavaScript inside the window.
 *
 *  In a module of its own, reached only from here and only after the check above,
 *  because the module is the one place in the app that turns a string into code.
 *  The Even Realities plugin must not carry it at all - the store's review reads
 *  the bundle for exactly that and has refused a build over it - so the guard is
 *  the first thing in the function, which is what takes the import and the whole
 *  chunk behind it out of that build. See vite.even.config.ts and
 *  src/lib/even/bundle.test.ts. */
async function runEval(args: Said): Promise<unknown> {
  if (__EVEN_PLUGIN__) throw new Error('the plugin does not run code')

  const code = wordsOf(args, 'code')
  if (!code) throw new Error('say what to run')

  const { evaluate } = await import('./eval')
  return evaluate(code)
}
