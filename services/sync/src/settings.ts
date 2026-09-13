import { Hono } from 'hono'
import { NOT_AN_OBJECT } from './refused'
import { objectBody, objectIn } from './body'
import { byteLength } from './crypto'
import { EFFORTS } from './ask/asking'
import { keyState } from './ask/key'
import type { Env, Variables } from './types'
import { KEEP_DAYS } from './versions'

/** The settings that follow the account from machine to machine, and what
 *  each may be. Anything else in a request is refused, so the column never
 *  holds what no version of the app knows what to do with.
 *
 *  Each entry says what is wrong rather than only that something is, because
 *  the message is what the app shows: see the ERROR path in api.ts. */
type Check = (value: unknown) => string | null

/** Where the app writes a pasted picture. Named rather than described, because
 *  the folder itself is worked out on the machine that has the note. */
const ATTACHMENT_FOLDERS = ['space', 'note', 'named']

/** Which keyboard a shortcut map is. Named rather than described: what each
 *  one holds is the app's business, and `custom` is a map somebody put together
 *  themselves. A list rather than any string, because this one is shown as a
 *  word and an account should not be able to carry a sentence into a select. */
const PRESETS = ['default', 'notion', 'obsidian', 'vim', 'custom']

/** How much of a note the ligature glyphs are drawn over. It was a switch
 *  before it was a scope, so both shapes are accepted and both are handed back
 *  as they arrived: an account is read by every version of the app at once, and
 *  a build with the switch reads `true` where a newer one wrote `all`. */
const LIGATURE_SCOPES = ['off', 'code', 'all']
/** The Glasses section, which only the Even Hub plugin shows.
 *
 *  At which heading level a new page starts on the panel, and how hard the model
 *  that answers a spoken question is asked to think. Lists rather than any number
 *  or any string, for the same reason as the presets below: the app shows each of
 *  these in a select, and an account should not be able to put a sentence in one.
 *  The efforts are the API's own, read off the error it answers an invalid one
 *  with on 2026-09-09. */
const GLASSES_BREAKS = [0, 1, 2, 3, 4, 5, 6]
/** The API's own list, from the one module that talks to it. */
const GLASSES_EFFORTS: readonly string[] = EFFORTS

/** How much of a note's white space reaches the panel, and who scrolls it. Lists
 *  rather than any string, for the same reason as everything else on this row: the
 *  app shows each of these in a select. */
const GLASSES_COMPACTIONS = ['none', 'collapse', 'aggressive']
const GLASSES_SCROLLS = ['paged', 'native']

/** Which of a note's markers may be turned on, by construct. Named here rather
 *  than accepted as any object, so an account cannot carry a switch no version of
 *  the app has ever heard of. */
const GLASSES_MARKS = ['heading', 'bold', 'italic', 'strike', 'highlight', 'code', 'fence', 'link']

/** How many phrases a reader may rebind, and how long one may be. A spoken
 *  command is a phrase, not a paragraph. */
const MOST_WORDS = 40
const LONGEST_WORD = 60

/** An object of named switches, each of which must be one of a list. */
function switchMap(name: string, allowed: readonly string[]): Check {
  return (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return `${name} must be an object`
    }

    for (const [key, on] of Object.entries(value as Record<string, unknown>)) {
      if (!allowed.includes(key)) return `${name} has no ${key}`
      if (typeof on !== 'boolean') return `${name}.${key} must be true or false`
    }

    return null
  }
}

/** The phrases a spoken command answers to, by command id.
 *
 *  The ids are the app's own and are not listed here, for the same reason the
 *  shortcut ids are not: a server that knew them would have to be deployed before
 *  every new command. What is checked is the shape and the size. */
function phraseMap(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'glassesWords must be an object'
  }

  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > MOST_WORDS) return `glassesWords holds at most ${MOST_WORDS} phrases`

  for (const [id, phrase] of entries) {
    if (id.length > LONGEST_ID || !ID.test(id)) return `${id} is not a command`
    if (typeof phrase !== 'string' || phrase.length > LONGEST_WORD) {
      return `${id} must be a phrase of at most ${LONGEST_WORD} characters`
    }
  }

  return null
}

/** How many words a reader's own dictionary holds, and how long one may be. A
 *  phrase is not a word, and a dictionary of sentences is a dictionary that
 *  turns the checker off. The app holds itself to the same two numbers. */
const MOST_SPELL_WORDS = 500
const LONGEST_SPELL_WORD = 64

/** A word of a language rather than anything that means something to a pattern.
 *  What the app writes into a `spellcheck="false"` mark; see spelling.ts there.
 *  Checked here as well as there, because what a note is checked against on one
 *  machine arrives from this column on the next one. */
const SPELL_WORD = /^[\p{L}\p{N}][\p{L}\p{N}'’_-]*$/u

function wordList(value: unknown): string | null {
  if (!Array.isArray(value)) return 'spellWords must be a list of words'
  if (value.length > MOST_SPELL_WORDS) {
    return `spellWords holds at most ${MOST_SPELL_WORDS} words`
  }

  for (const word of value as unknown[]) {
    if (typeof word !== 'string' || word.length > LONGEST_SPELL_WORD || !SPELL_WORD.test(word)) {
      return 'every one of spellWords must be a single word'
    }
  }

  return null
}

/** A model id, which is a name and not a sentence. */
const MOST_MODEL = 100

/** A string within a length, said the way the app would say it. */
function shortEnough(name: string, most: number): Check {
  return (value) =>
    typeof value === 'string' && value.length <= most
      ? null
      : `${name} must be a string of at most ${String(most)} characters`
}

/** One of a list of words. */
function wordOf(name: string, allowed: readonly string[]): Check {
  return (value) =>
    typeof value === 'string' && allowed.includes(value)
      ? null
      : `${name} must be one of ${allowed.join(', ')}`
}

/** True or false, said the way the app would say it. */
function switched(name: string): Check {
  return (value) => (typeof value === 'boolean' ? null : `${name} must be true or false`)
}

/** How often a note being written in is kept, in minutes, and how long what is
 *  kept lives, in days. A list rather than any number, for the same reason as
 *  the presets: the app shows each of these as a word in a select, and an
 *  account should not be able to ask it for a timer every nine milliseconds. */
const RECOVERY_MINUTES = [0, 1, 5, 15]
const RECOVERY_DAYS = [1, 7, 30]

/** What a device does when the same note was written in two places. Named after
 *  what happens rather than after a policy: `both` keeps the other copy beside
 *  the note, `newest` lets the later of the two stand, and `ask` leaves the note
 *  alone until somebody says. See apps/desktop/src/lib/sync/mirror.ts. */
const CONFLICT_RULES = ['both', 'newest', 'ask']

/** How a link to another note is written: a wikilink, or a markdown link with one
 *  of three shapes of target. A list rather than any string, for the reason every
 *  other list here is one: the app shows it in a select. See link-format.ts in the
 *  app, which is where the writing itself is decided. */
const LINK_FORMATS = ['wikilink', 'shortest', 'relative', 'absolute']

/** What a note's front matter is drawn as, which the app asks with three words;
 *  see properties.ts in @nib/markdown. */
const PROPERTIES_MODES = ['properties', 'source', 'hidden']

/** One of a list of numbers, said the way the app would say it. */
function oneOf(name: string, allowed: readonly number[]): Check {
  return (value) =>
    typeof value === 'number' && allowed.includes(value)
      ? null
      : `${name} must be one of ${allowed.join(', ')}`
}

const KNOWN: Record<string, Check> = {
  ligatures: (value) =>
    typeof value === 'boolean' || (typeof value === 'string' && LIGATURE_SCOPES.includes(value))
      ? null
      : `ligatures must be true, false, or one of ${LIGATURE_SCOPES.join(', ')}`,
  glassesBreak: oneOf('glassesBreak', GLASSES_BREAKS),
  glassesLineNumbers: switched('glassesLineNumbers'),
  // Still accepted, and no longer sent: the app decides a page number from the
  // scroll mode now, and refusing this would fail an older build's patch for a
  // setting it is right to have written. See apps/desktop/src/lib/even/settings.ts.
  glassesPageNumber: switched('glassesPageNumber'),
  glassesVoice: switched('glassesVoice'),
  glassesCompaction: wordOf('glassesCompaction', GLASSES_COMPACTIONS),
  glassesScroll: wordOf('glassesScroll', GLASSES_SCROLLS),
  glassesMarks: switchMap('glassesMarks', GLASSES_MARKS),
  glassesWords: phraseMap,
  glassesSeen: switched('glassesSeen'),
  // `glassesKey` was here, and was a plaintext OpenAI key in a column that every
  // read handed back. It is not a setting any more: it is encrypted on the user's
  // row and written through `PUT /v1/ask/key`, which is the only way in. An older
  // build that still patches it is answered "unknown setting glassesKey", which is
  // the truth and is better than quietly keeping a key nothing will use.
  glassesModel: shortEnough('glassesModel', MOST_MODEL),
  glassesEffort: wordOf('glassesEffort', GLASSES_EFFORTS),
  vim: (value) => (typeof value === 'boolean' ? null : 'vim must be true or false'),
  attachments: (value) =>
    typeof value === 'string' && ATTACHMENT_FOLDERS.includes(value)
      ? null
      : `attachments must be one of ${ATTACHMENT_FOLDERS.join(', ')}`,
  spellWords: wordList,
  preset: (value) =>
    typeof value === 'string' && PRESETS.includes(value)
      ? null
      : `preset must be one of ${PRESETS.join(', ')}`,
  shortcuts: shortcutMap,
  toolbar: buttonList,
  pull: pulledCommand,
  recoveryEvery: oneOf('recoveryEvery', RECOVERY_MINUTES),
  recoveryDays: oneOf('recoveryDays', RECOVERY_DAYS),
  // How long the account keeps what a note said before: a month, or a year.
  // Days, and only the two the app offers - the sweep reads this straight out of
  // the column, so a number nobody chose would be a horizon nobody asked for.
  // See versions.ts.
  keepVersions: oneOf('keepVersions', KEEP_DAYS),
  conflicts: wordOf('conflicts', CONFLICT_RULES),
  // Which colour the highlight button writes. A palette tone by number, or null
  // for a highlight with no colour of its own; the app decides what a tone it has
  // never heard of means, which is the plain one. See highlights.ts in
  // @nib/markdown.
  highlightTone: (value) =>
    value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0)
      ? null
      : 'highlightTone must be a whole number or null',
  // Whether a single newline breaks the line. Read by the blog as well as by the
  // app, so a published note reads the way its author reads it; see blog.ts.
  hardBreaks: switched('hardBreaks'),
  linkFormat: wordOf('linkFormat', LINK_FORMATS),
  properties: wordOf('properties', PROPERTIES_MODES),
}

/** How much of any of this an account may hold.
 *
 *  The column is one JSON blob on the user's row, and a shortcut map is the
 *  first thing in it that a client could grow without limit - an id is a
 *  string the server never chose. So the count, the length of every part and
 *  the size of the whole are all bounded, and the bounds are generous enough
 *  that a person rebinding every shortcut there is stays well inside them:
 *  the app has around ninety. */
const MOST_SHORTCUTS = 200
const LONGEST_ID = 64
const LONGEST_KEY = 40
const MOST_BYTES = 8 * 1024

/** The modifiers a combination may name. `Mod` is Cmd on a Mac and Ctrl
 *  everywhere else, which is why what is stored says `Mod` rather than either
 *  of them: one account, two kinds of machine. */
const MODIFIERS = new Set([
  'mod',
  'cmd',
  'meta',
  'm',
  'ctrl',
  'control',
  'c',
  'alt',
  'a',
  'option',
  'shift',
  's',
])

/** Whether a string is a key combination in CodeMirror's notation.
 *
 *  Split on every `-` except a trailing one, the way CodeMirror splits it, so
 *  `Mod--` reads as Mod and the minus key rather than as Mod and nothing. */
function isCombination(value: string): boolean {
  if (!value || value.length > LONGEST_KEY) return false
  // Nothing a keyboard produces has whitespace or a control character in its
  // name, and neither does any modifier.
  if (/\s/.test(value) || /\p{Cc}/u.test(value)) return false

  const parts = value.split(/-(?!$)/)
  const key = parts.at(-1)
  if (!key || key.length > 16) return false

  return parts.slice(0, -1).every((modifier) => MODIFIERS.has(modifier.toLowerCase()))
}

/** An id the app files a key under: lower case, in dotted parts. Checked
 *  rather than matched against a list, because the list lives in the app and
 *  a server that knew it would have to be deployed before every new
 *  shortcut. An id this version has never heard of is kept and handed back;
 *  nothing here has to know what it means. */
const ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/

/** How many buttons the phone's format bar may hold. Well past what a phone can
 *  show at once, because a bar longer than the screen scrolls. */
const MOST_BUTTONS = 24

/** The commands on that bar, in order, by the ids the shortcuts are filed
 *  under. Null is the default set, which the app has to be able to say: without
 *  it a device could never learn that another one went back to it.
 *
 *  The ids are read for their shape rather than against a list, for the reason
 *  the shortcut ids are: the commands are the app's, and a server that knew them
 *  would have to be deployed before every new one. Nothing twice, because the
 *  bar is a set of buttons. */
function buttonList(value: unknown): string | null {
  if (value === null) return null
  if (!Array.isArray(value)) return 'toolbar must be a list of command ids or null'
  if (value.length > MOST_BUTTONS) return `toolbar holds at most ${MOST_BUTTONS} commands`

  const seen = new Set<string>()
  for (const id of value as unknown[]) {
    if (typeof id !== 'string' || id.length > LONGEST_ID || !ID.test(id)) {
      return `${String(id)} is not a command id`
    }
    if (seen.has(id)) return `${id} is on the toolbar twice`
    seen.add(id)
  }

  return null
}

/** Which command the phone's pull gesture runs: one command id, `none` for no
 *  gesture at all, or null for whichever the app offers. Read for its shape for
 *  the reason the ids above are. */
function pulledCommand(value: unknown): string | null {
  if (value === null || value === 'none') return null
  if (typeof value !== 'string' || value.length > LONGEST_ID || !ID.test(value)) {
    return 'pull must be a command id, none, or null'
  }

  return null
}

function shortcutMap(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return 'shortcuts must be an object'

  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > MOST_SHORTCUTS) return `shortcuts holds at most ${MOST_SHORTCUTS} keys`

  for (const [id, key] of entries) {
    if (id.length > LONGEST_ID || !ID.test(id)) return `${id} is not a shortcut id`
    // Null is a key taken away, which is a choice like any other and has to
    // travel: without it a machine could never learn that another one
    // unbound something.
    if (key === null) continue
    if (typeof key !== 'string' || !isCombination(key))
      return `${id} is not set to a key combination`
  }

  return null
}

type AccountSettings = Record<string, unknown>

async function settingsOf(env: Env, userId: string): Promise<AccountSettings> {
  const row = await env.DB.prepare('select settings from users where id = ?')
    .bind(userId)
    .first<{ settings: string }>()
  return parse(row?.settings)
}

function parse(raw: string | undefined): AccountSettings {
  return objectIn(raw) ?? {}
}

export const settings = new Hono<{ Bindings: Env; Variables: Variables }>()

/** Everything the account has chosen, and the one thing about it that cannot be
 *  read: whether an OpenAI key is set and its last four characters. `key` is beside
 *  `settings` rather than inside it because it is not a setting - nothing can send
 *  it here, and a field that comes back but cannot go out does not belong in the
 *  same object as the ones that travel both ways. See ask/key.ts. */
settings.get('/', async (context) => {
  const user = context.get('user')
  return context.json({
    settings: await settingsOf(context.env, user.id),
    key: await keyState(context.env, user.id),
  })
})

/** How much of an unknown name the answer says back. A setting is named by a word,
 *  so anything past this is not a name; see the refusal below. */
const NAMED = 64

/** Changes what is sent and leaves the rest as it was. */
settings.patch('/', async (context) => {
  const user = context.get('user')
  const body = await objectBody(context)
  if (!body) return context.json({ error: NOT_AN_OBJECT }, 400)

  for (const [name, value] of Object.entries(body)) {
    // Asked of the map itself, never through it: `KNOWN['__proto__']` reaches
    // Object's own and would be called as though it were a check.
    const check = Object.hasOwn(KNOWN, name) ? KNOWN[name] : undefined
    // As much of the name as is worth saying back. Enough to recognise a typo, and
    // a bound on a string that arrived from outside and goes back out in an answer:
    // the app shows an error, the log keeps it, and neither wants a kilobyte of
    // somebody's own text because they wrote it as a field name.
    if (!check) return context.json({ error: `unknown setting ${name.slice(0, NAMED)}` }, 400)

    const wrong = check(value)
    if (wrong) return context.json({ error: wrong }, 400)
  }

  const merged = { ...(await settingsOf(context.env, user.id)), ...(body as AccountSettings) }
  const written = JSON.stringify(merged)
  // Measured on what would be stored rather than on what arrived: a patch
  // small enough on its own can still be the one that tips the column over.
  if (byteLength(written) > MOST_BYTES) {
    return context.json({ error: 'that is more settings than an account holds' }, 413)
  }

  await context.env.DB.prepare('update users set settings = ? where id = ?')
    .bind(written, user.id)
    .run()
  return context.json({ settings: merged })
})
