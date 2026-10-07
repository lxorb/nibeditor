/** The sets an icon can come from, and the data behind each one.
 *
 *  Three, and each earns its place by answering something the others cannot:
 *
 *  - **Emoji.** The whole Unicode set, drawn by the platform's own colour font. The
 *    breadth is the point - there is an emoji for very nearly anything somebody
 *    would name a folder after - and the drawings cost nothing to ship, because
 *    every phone and every desktop already has them. What is shipped is the index
 *    that makes them findable: the name, the group and the keywords of each, which is
 *    what turns a wall of pictures into something you can type "money" into.
 *  - **Lucide.** The stroked set the interface itself is drawn in, so an icon
 *    chosen here sits in a list beside the app's own marks without looking
 *    borrowed. Monochrome, and the one set a tint applies to; see icons.ts.
 *  - **Flat Color Icons.** Everyday objects drawn flat and in colour - a calendar,
 *    a folder, a graph, a suitcase. Icons8's set, MIT, 329 of them in 166 KB, which
 *    is small enough to be a set rather than a download. Where Lucide is a line and
 *    an emoji is a face, this is the drawing you would put on a filing cabinet.
 *
 *  Two coloured sets with real breadth were weighed and refused on size: Twemoji
 *  (10.5 MB, CC-BY-4.0) and Fluent Emoji Flat (9.2 MB, MIT) both redraw the emoji
 *  the platform font already draws in colour, and Iconify's brand set (7.6 MB,
 *  CC0-1.0) is nine megabytes of other people's trademarks. Nothing here is worth
 *  nine megabytes when the same picture is already on the device.
 *
 *  Every set is fetched the first time somebody opens its tab, once however often
 *  it is asked for, and from the app's own build - never from a CDN, which would
 *  make a private notes app phone a stranger to draw a folder. See
 *  icon-library.svelte.ts, which holds what has arrived, and the bundle test, which
 *  holds the sets out of the first chunk and out of the plugin. */

import { EMOJI_SET, type IconEntry, type IconNode, loadIcons, LUCIDE, squash } from './icons'
import { key } from './i18n.svelte'

/** Lucide's own tags: what each of its icons is *for*, in the words people look for
 *  it by. 14,545 of them over 1,799 icons, and the angle carries "math", which is the
 *  whole of the complaint - the picker knew what every icon was called and nothing
 *  about what any of it was for, so "math" found nothing and "function" found one.
 *
 *  `lucide-static` rather than `lucide`: the same project under the same ISC licence
 *  and pinned to the same version, but the drawing package ships drawings and the
 *  static one ships `tags.json` beside them. It is the tags this wants and not the
 *  49 MB of SVG files they come with, which is why the import names the file.
 *
 *  Categories are not read. Lucide keeps them per icon in its repository rather than
 *  in anything it publishes, and where a category says "math" its tags already do; a
 *  second index of the same words would be weight for nothing. What tags genuinely do
 *  not cover - nobody tagged the briefcase "work" - is what nib's own synonym list in
 *  icons.ts is for.
 *
 *  Kept once, because two sets read it: the stroked one it describes, and the coloured
 *  one it is lent to. */
let tagged: Map<string, string> | null = null

async function loadTags(): Promise<Map<string, string>> {
  if (tagged) return tagged

  const found = new Map<string, string>()

  try {
    const tags = (await import('lucide-static/tags.json')).default as Record<string, string[]>
    // Squashed, because the file writes `square-function` and the library exports
    // `SquareFunction`, and because `iconValue` spells a few of the ones with digits
    // in them a third way again.
    for (const [name, words] of Object.entries(tags)) {
      found.set(squash(name), words.join(' ').toLowerCase())
    }
  } catch {
    // The plugin build leaves the file out and a chunk can fail to arrive. Either way
    // every set still loads: an icon found by its name alone is the picker as it was,
    // and a picker that would not open because a list of search words was missing is
    // a picker as it never was.
  }

  tagged = found
  return found
}

/** How a set is drawn, once its data is here.
 *
 *  Three shapes because there are three honest ways to put a picture on screen: a
 *  character the font draws, a stroked path this app dresses itself, and somebody
 *  else's finished drawing that has to be left exactly as it was. Nothing is gained
 *  by pretending the three are one. */
export type IconShape =
  | { kind: 'emoji'; text: string }
  | { kind: 'stroked'; icon: IconNode }
  /** A finished drawing: the elements of an SVG, and the box they were drawn in. */
  | { kind: 'drawn'; body: string; box: string }

/** What a loaded set holds. */
export interface LoadedSet {
  entries: IconEntry[]
  /** The groups the picker offers under the search field, in the set's own order.
   *  Empty for a set that has none, which is every set but the emoji. */
  groups: { label: string; names: string[] }[]
  shape(name: string): IconShape | null
}

/** One set as the picker knows it before anything is loaded. */
export interface IconSet {
  id: string
  /** What its tab says, marked for translation and translated where it is drawn. */
  label: string
  /** Who drew it and under what licence, for the credits; empty for the emoji,
   *  which nobody here drew and nobody here ships. */
  credit: string
  load(): Promise<LoadedSet>
}

/** The emoji index, as `unicode-emoji-json` publishes it: nine groups in Unicode's
 *  own order, each holding the base emoji of that group with the name Unicode gives
 *  it.
 *
 *  Base emoji only, which is the folding the requirement asks for: the file lists
 *  one entry per emoji with a flag saying whether it takes a skin tone, rather than
 *  five entries for five tones. A picker with five of every person in it is a
 *  picker nobody can find anything in. */
interface EmojiGroup {
  name: string
  slug: string
  emojis: { emoji: string; name: string; slug: string }[]
}

/** The keywords an emoji goes by, which Unicode's names do not carry: 🚀 is called
 *  "rocket", and nothing in that says "launch". `emojilib`'s list, keyed by the
 *  character, which is the one key the two files share.
 *
 *  A dependency of its own here, though the app already has it: `node-emoji` brings
 *  the same file for the editor's `:shortcode:` completions, so this reads a chunk that
 *  is there either way and weighs nothing to read. Named and imported the way the sets
 *  themselves are anyway, so the day the editor stops asking for it the picker is not
 *  what drags it in front of the first paint. 1,570 of the 1,914 base emoji are
 *  covered; the rest keep their name and their slug, which is all any of them had
 *  before.
 *
 *  The shortcode is a keyword as well as a key. Slack and GitHub have taught a lot of
 *  people that 📅 is `:date:`, and Unicode calls it a calendar. */
async function loadEmojiWords(): Promise<Map<string, string>> {
  const said = new Map<string, string[]>()

  try {
    const listed = (await import('emojilib/emojis.json')).default as Record<
      string,
      { char?: string; keywords?: string[] }
    >

    for (const [shortcode, one] of Object.entries(listed)) {
      if (!one.char) continue

      const found = said.get(plain(one.char)) ?? []
      found.push(...(one.keywords ?? []), shortcode)
      said.set(plain(one.char), found)
    }
  } catch {
    // The plugin leaves the emoji out altogether, so this never runs there; and a
    // chunk that will not arrive costs the keywords rather than the set.
  }

  // Words rather than spellings, and each of them once: the list writes "outer space"
  // and `outer_space` for the same emoji, and two of one word is a longer string to
  // search for no more found.
  return new Map(
    [...said].map(([char, words]) => [
      char,
      [
        ...new Set(
          words.map((word) =>
            word
              .replace(/[^a-z\d]+/gi, ' ')
              .trim()
              .toLowerCase(),
          ),
        ),
      ].join(' '),
    ]),
  )
}

/** An emoji without the selector that asks a platform to draw it in colour rather
 *  than as a glyph. The two lists disagree about it on 142 of them - ❤️ against ❤ -
 *  and it is not a character anybody searches by. */
function plain(emoji: string): string {
  return emoji.replace(/\uFE0F/g, '')
}

async function loadEmoji(): Promise<LoadedSet> {
  const [groups, said] = await Promise.all([
    import('unicode-emoji-json/data-by-group.json'),
    loadEmojiWords(),
  ])

  const entries: IconEntry[] = []
  const shown: { label: string; names: string[] }[] = []

  for (const group of groups.default as EmojiGroup[]) {
    const names: string[] = []

    for (const one of group.emojis) {
      // The slug behind the name, rather than beside it: `smiling_face_with_heart_eyes`
      // holds words the name hyphenates instead, and a search for "heart" should find
      // it whichever of the two the person was thinking of - but a tooltip that says
      // the same thing twice is a tooltip nobody reads.
      entries.push({
        name: one.emoji,
        words: one.name.toLowerCase(),
        terms: `${one.slug.replace(/_/g, ' ')} ${said.get(plain(one.emoji)) ?? ''}`.trim(),
      })
      names.push(one.emoji)
    }

    // Unicode's own group names, which are already the words a person would use.
    shown.push({ label: group.name, names })
  }

  return {
    entries,
    groups: shown,
    shape: (name) => ({ kind: 'emoji', text: name }),
  }
}

/** The emoji a skin tone applies to, out of the same index: what a chat's picker
 *  offers tones for (lib/emoji/data.ts). The one module that reads the file is this. */
export async function tonedEmoji(): Promise<Set<string>> {
  const groups = (await import('unicode-emoji-json/data-by-group.json')).default as Toned[]
  return new Set(
    groups.flatMap((group) =>
      group.emojis.filter((one) => one.skin_tone_support).map((one) => one.emoji),
    ),
  )
}

interface Toned {
  emojis: { emoji: string; skin_tone_support: boolean }[]
}

async function loadLucide(): Promise<LoadedSet> {
  const [library, tags] = await Promise.all([loadIcons(), loadTags()])

  /** The names that draw the same picture. Lucide exports 2,053 names over 1,799
   *  drawings: `AlertCircle` and `CircleAlert` are one icon under two names, and each
   *  of those names is a word somebody might look for the other by.
   *
   *  Grouped by the array itself, which the library hands out to an icon and to every
   *  alias of it, so the grouping costs a comparison rather than a naming convention.
   *  The tags follow the drawing too: Lucide files them under its current name, and an
   *  alias is the same picture. */
  const alike = new Map<IconNode, string[]>()
  for (const [name, icon] of Object.entries(library)) {
    const named = alike.get(icon)
    if (named) named.push(name)
    else alike.set(icon, [name])
  }

  /** What each name can be found by that is not the name itself: its aliases, and the
   *  tags of the drawing they all share. Built as a map rather than in place, so the
   *  set stays in the library's own alphabetical order - an alias belongs where its
   *  own letter is, not next to the icon it points at. */
  const terms = new Map<string, string>()
  for (const named of alike.values()) {
    const said = [...new Set(named.flatMap((one) => tags.get(squash(one)) ?? []))]

    for (const name of named) {
      terms.set(name, [...named.filter((one) => one !== name).map(spaced), ...said].join(' '))
    }
  }

  return {
    entries: Object.keys(library).map((name) => ({
      name,
      words: spaced(name),
      terms: terms.get(name) ?? '',
    })),
    groups: [],
    shape: (name) => {
      const icon = library[name]
      return icon ? { kind: 'stroked', icon } : null
    },
  }
}

/** An Iconify collection, which is the shape every one of them ships in: a map of
 *  name to the elements of the drawing, and the box they were all drawn in. */
interface IconifyCollection {
  icons: Record<string, { body: string; width?: number; height?: number }>
  width?: number
  height?: number
}

/** One Iconify collection as a set. Ten lines rather than a dependency: the format
 *  is a body and a box, and drawing it is putting the body in an `<svg>` of that
 *  box. A library to do that would be a library to concatenate two strings.
 *
 *  The tags are lent from elsewhere, because an Iconify collection carries none: the
 *  coloured set's metadata file is an empty object and its names are all it has. What
 *  it does have is 53 drawings of the everyday things Lucide draws too - a calendar, a
 *  folder, a briefcase - so the words that find Lucide's calendar find this one, and a
 *  drawing Lucide has no name for keeps its own name, which is what it had. */
function iconify(collection: IconifyCollection, tags: Map<string, string>): LoadedSet {
  const wide = collection.width ?? 24
  const tall = collection.height ?? 24

  return {
    entries: Object.keys(collection.icons).map((name) => ({
      name,
      words: spaced(name),
      terms: tags.get(squash(name)) ?? '',
    })),
    groups: [],
    shape: (name) => {
      const icon = collection.icons[name]
      if (!icon) return null

      return {
        kind: 'drawn',
        body: icon.body,
        box: `0 0 ${icon.width ?? wide} ${icon.height ?? tall}`,
      }
    },
  }
}

async function loadFlatColour(): Promise<LoadedSet> {
  const [collection, tags] = await Promise.all([
    import('@iconify-json/flat-color-icons/icons.json'),
    loadTags(),
  ])

  return iconify(collection.default, tags)
}

/** A name as the words somebody would search for: `BookOpen` and `book-open` both
 *  read as "book open". */
function spaced(name: string): string {
  return name
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .toLowerCase()
}

/** The set the picker opens on, and the one a bare name means. Lucide, because it
 *  is the set the app is drawn in and the one every file already speaks. */
export const DEFAULT_SET = LUCIDE

/** The id of the coloured set, so the credits and the tests can name it. */
export const FLAT_COLOUR = 'flat-color-icons'

/** Every set, in the order the picker shows them: the one the app is drawn in
 *  first, then the pictures. */
export const ICON_SETS: readonly IconSet[] = [
  {
    id: LUCIDE,
    label: key('Line'),
    credit: 'Lucide, ISC',
    load: loadLucide,
  },
  {
    id: EMOJI_SET,
    label: key('Emoji'),
    credit: '',
    load: loadEmoji,
  },
  {
    id: FLAT_COLOUR,
    label: key('Colour'),
    credit: 'Flat Color Icons by Icons8, MIT',
    load: loadFlatColour,
  },
]

export function setNamed(id: string): IconSet | null {
  return ICON_SETS.find((one) => one.id === id) ?? null
}
