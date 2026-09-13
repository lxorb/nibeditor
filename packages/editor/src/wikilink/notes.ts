import { type Extension, Facet, StateEffect, StateField } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { isTabFile, type LinkKind, pageFragment, type Wikilink } from '@nib/markdown/links'

/** What the editor knows about the space around the open note, and what it does
 *  when a link is followed.
 *
 *  Both arrive through a facet the app fills in, the way an image path becomes a
 *  URL (see images.ts): the editor never reads a file, so it cannot know which
 *  notes exist or what should happen when one is opened. Everything below is the
 *  arithmetic on top of that - which note a name means, and where a link goes. */

/** One note in the space, as a link needs to see it. */
export interface NoteRef {
  /** Path relative to the space, `/`-separated: `folder/Note.md`. */
  path: string
  /** The name a link uses: the file's name without its extension. */
  name: string
  /** Every heading in the note, in the order they appear. */
  headings: readonly string[]
  /** Every block name in the note: the `^abc123` at the end of a paragraph. */
  blocks: readonly string[]
  /** The other names the note gave itself, in its own front matter. A link may
   *  use any of them; see `resolveNote`. */
  aliases: readonly string[]
}

/** One tag the space uses, and how many of its notes carry it.
 *
 *  The count is notes and not uses, which is what the app can answer from the
 *  scan it already has: a note is counted once however many times it writes the
 *  tag. `#work/nib` counts towards `work` as well, because that is what the tag
 *  tree and the `tag:` operator both mean by a slash. */
export interface SpaceTag {
  /** The path, without the hash: `work/nib`. */
  tag: string
  notes: number
}

/** One block somewhere in the space, as a row that can be linked to.
 *
 *  A line rather than a whole block, because this comes back from the search and
 *  the search answers in lines: the line is what matched, and the name a link
 *  needs goes at the end of the block that line belongs to. */
export interface SpaceBlock {
  /** The note it is in, relative to the space. */
  path: string
  /** Which line, counting from zero, which is what the app's writer takes. */
  line: number
  /** The line as a row shows it: trimmed, and cut short. */
  text: string
  /** The name it already carries, or null for a block nothing links to yet. */
  id: string | null
}

export interface NoteIndex {
  notes: readonly NoteRef[]
  /** Everything in the space that is not a note, relative to it: the PDF a
   *  `[[paper.pdf]]` names, the canvas a `[[Board.canvas]]` names, the picture an
   *  embed shows. A file is not a note and has no headings, so it is a plain path
   *  rather than a `NoteRef`. */
  files: readonly string[]
  /** The note this view is showing, so `[[#Heading]]` knows which note it means
   *  and a name that could mean two notes is read from where it was written.
   *  Relative to the space, like every path here. Null for a note with no home
   *  yet. */
  path: string | null
  /** Every tag of the space, most used first, for the `#` popup. Empty where the
   *  editor is standing on its own, which offers nothing rather than nothing
   *  useful. Here rather than in a facet of its own because it is the same fact
   *  the notes are - what the space holds - and it arrives and is replaced with
   *  them; see tags.ts. */
  tags?: readonly SpaceTag[] | undefined
  /** Blocks anywhere in the space whose words hold `text`, at most `most` of
   *  them: what `[[^^` offers past the blocks that already have a name.
   *
   *  The app's own search, which is the only thing that can answer it: a space's
   *  bodies are on a disk or in a worker's cache, and the editor reading every
   *  note per keystroke is the one implementation that was never allowed. Absent
   *  where the editor stands alone, and `[[^^` then offers the named blocks the
   *  index already knows. */
  searchBlocks?: ((text: string, most: number) => Promise<readonly SpaceBlock[]>) | undefined
  /** The markdown of one note, by path. An embed and the hover preview draw
   *  their frame first and fill it in when this lands. */
  read: (path: string) => Promise<string | null>
  /** What a ` ```query ` fence answers with, as HTML the fence can hold: the app
   *  searches the space, and the rows it draws are the Search panel's own. Null
   *  where there is nothing to answer from, and absent entirely where the editor is
   *  standing on its own - a fence then stays the code it is.
   *
   *  Here rather than in a facet of its own because it is the same fact the rest of
   *  this is: what the space holds, which changes while the editor is open. The
   *  field this index sits in is replaced when it does, and that is what makes a
   *  fence answer again. */
  query?: ((code: string) => Promise<string | null>) | undefined
  /** Something in a query fence was pressed. Handed the press's target rather
   *  than a note and a line, because the app wrote the rows and is the one that
   *  should read them; it answers whether it was one of its own, so the editor can
   *  keep the press rather than putting the caret inside the fence. */
  pressRow?: ((target: EventTarget | null) => boolean) | undefined
  /** One note as the HTML that shows it: what an `![[embed]]` draws and what the
   *  hover preview over a link shows. The app's own call, and the same one the
   *  reading view makes, so a note glanced at is that note's reading view rather
   *  than a second, thinner rendering of it - coloured fences, drawn diagrams,
   *  answered query fences, its metadata as rows, its pictures where the host
   *  says they live.
   *
   *  Handed the markdown and the note's path relative to the space, because both
   *  the pictures and the links in a note resolve from where the note sits, and
   *  an embed shows a note other than the one in the pane.
   *
   *  Here with `query` and `pressRow` rather than in a facet of its own for the
   *  same reason they are: it is a thing the app can do and the editor cannot,
   *  and it arrives and is replaced with the rest of what the space holds.
   *  Absent where the editor stands on its own, and preview.ts then renders what
   *  a renderer alone can. */
  render?: ((source: string, path: string | null) => Promise<string>) | undefined
}

const EMPTY: NoteIndex = { notes: [], files: [], path: null, read: () => Promise.resolve(null) }

export const noteIndex = Facet.define<NoteIndex, NoteIndex>({
  combine: (values) => values[0] ?? EMPTY,
})

/** The space changes while the editor is open: a note saved gains a heading, a
 *  note renamed answers to another name, and every link on screen has to be
 *  drawn again against the new answer.
 *
 *  Held in a field and replaced by an effect rather than swapped in a
 *  compartment, because reconfiguring an editor resets what the reconfiguration
 *  had nothing to do with: a note saved in the background while `[[` was being
 *  typed took the list of names away with it. An effect is an ordinary
 *  transaction and leaves everything else where it was. */
const setIndex = StateEffect.define<NoteIndex>()

const indexField = StateField.define<NoteIndex>({
  create: () => EMPTY,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setIndex)) return effect.value
    }
    return value
  },
  provide: (field) => noteIndex.from(field),
})

export function noteIndexExtension(index: NoteIndex | undefined): Extension {
  return indexField.init(() => index ?? EMPTY)
}

/** The index as an effect, so a pane taking another note on can put it in the
 *  same transaction as everything else it changes. */
export function noteIndexEffect(index: NoteIndex): StateEffect<unknown> {
  return setIndex.of(index)
}

/** Hands over a new index. Compared by identity where it matters, so the app
 *  should give a fresh object when something changed and the same one when
 *  nothing did. */
export function setNoteIndex(view: EditorView, index: NoteIndex) {
  view.dispatch({ effects: setIndex.of(index) })
}

/** Where a followed link goes. `path` is null when nothing in the space answers
 *  to the name, which is the app's cue to make the note and open that. */
export interface NoteJump {
  path: string | null
  /** What the link said, so a note that does not exist yet can be named. */
  target: string
  heading: string | null
  block: string | null
  /** The page of a PDF the link names, from `[[paper.pdf#page=3]]`. Null for a
   *  link into a note, which lands on a heading or a block instead. */
  page: number | null
}

/** Follows a link. The app opens the note, scrolls to the heading or the block,
 *  or makes the note when there is none; on its own the editor does nothing,
 *  since none of that is the editor's to do. */
export const noteOpener = Facet.define<(jump: NoteJump) => void, (jump: NoteJump) => void>({
  combine: (values) => values[0] ?? (() => undefined),
})

/** What a link the editor is about to write points at, as the app's one writer
 *  takes it.
 *
 *  The same four facts `LinkTarget` in the app's link-format.ts holds, said again
 *  here because the editor cannot import the app - and only the four the editor
 *  ever knows: nothing in the popup writes an alias or an embed. */
export interface LinkWrite {
  /** The name a wikilink uses for the target. Empty for a link into the note it
   *  is being written in, which is what `[[#Heading]]` is. */
  name: string
  /** Where the target sits in the space, extension and all: what the spellings
   *  that write a path need. */
  path?: string | null
  /** The note the link is being written in, as a path inside the space, which is
   *  what a relative path is relative to. */
  from?: string | null
  /** What follows the target, written without its `#`: a heading, a `^blockid`. */
  fragment?: string | null
}

/** Writes one link to another note, in the spelling the space is set to.
 *
 *  The app's own writer - `linkTo` in composer.ts, the one place in the app a link
 *  is spelled, which is what answers the Links setting - so a link the `[[` popup
 *  writes is spelled the way the grip's Copy link spells one. Without it the
 *  editor writes the wikilink it has always written, which is that setting's own
 *  default and the only spelling an editor standing on its own could know. */
export const linkWriter = Facet.define<
  (target: LinkWrite) => string,
  (target: LinkWrite) => string
>({ combine: (values) => values[0] ?? wikilinkFor })

function wikilinkFor(target: LinkWrite): string {
  return `[[${target.fragment ? `${target.name}#${target.fragment}` : target.name}]]`
}

/** Whether every character of `needle` stands in `text` in order, however far
 *  apart: `pln` finds "The plan", `cnvs` finds `work/nib/canvas`.
 *
 *  One matcher, for every list that offers the space's own words rather than one
 *  note's: the headings and blocks of the whole space behind `[[##` and `[[^^`,
 *  and the tags behind `#`. Those are remembered as a word of themselves and not
 *  as the characters they open with, which is what a substring match wants. The
 *  popup's own filtering is this shape too, so a row kept here is a row it keeps
 *  rather than one it drops again for a reason nobody can see.
 *
 *  `needle` is already folded; `text` is folded here. */
export function fuzzy(text: string, needle: string): boolean {
  if (!needle) return true

  const folded = text.toLowerCase()
  let at = 0

  for (const character of needle) {
    at = folded.indexOf(character, at)
    if (at === -1) return false
    at++
  }

  return true
}

/** The extensions a link may leave out: markdown's four, and the two a website is
 *  written as.
 *
 *  `[[Svelte docs]]` resolves to `Svelte docs.url` the way `[[Plan]]` resolves to
 *  `Plan.md`, because both are documents this app writes and names by their title -
 *  the extension is nib's business rather than the writer's. A canvas and a PDF are
 *  deliberately not here: those carry their extension in the link, since that is how
 *  Obsidian writes them and this grammar is Obsidian's. A link that does carry
 *  `.url` still resolves, through the files rather than the notes; see `isTabFile`. */
const OWN = /\.(md|markdown|mdown|mkd|url|webloc)$/i

/** A path as something to compare: `/` separators, no extension of our own, and
 *  folded case. Obsidian matches a link to a note by name whatever the case,
 *  and so do the two filesystems Nib runs on. */
function comparable(path: string): string {
  return path.replace(/\\/g, '/').replace(OWN, '').toLowerCase()
}

function folderOf(path: string): string {
  const at = path.replace(/\\/g, '/').lastIndexOf('/')
  return at === -1 ? '' : path.slice(0, at)
}

/** Which of several notes a link means: the one beside the note the link was
 *  written in, then the shallowest, then the first by path.
 *
 *  Obsidian picks by nearness in the same way, and a path-qualified
 *  `[[folder/Note]]` is how an author says which one they meant. The order only
 *  has to be the same every time; nothing here guesses at intent. */
function nearest(candidates: readonly NoteRef[], from: string | null): NoteRef | null {
  const here = from === null ? null : folderOf(from)
  const depth = (path: string) => path.split('/').length
  const beside = (note: NoteRef) => (folderOf(note.path) === here ? 0 : 1)

  return (
    [...candidates].sort(
      (one, other) =>
        beside(one) - beside(other) ||
        depth(one.path) - depth(other.path) ||
        (one.path < other.path ? -1 : 1),
    )[0] ?? null
  )
}

/** The note a wikilink target names, or null when the space holds none.
 *
 *  A name matches the end of a path, which is what makes `[[Note]]` find
 *  `ideas/Note.md` and `[[ideas/Note]]` find only that one. Every match is
 *  gathered before one is chosen, rather than settling for the first reading that
 *  answers: a space with `Plan.md` and `ideas/Plan.md` in it has two answers to
 *  `[[Plan]]`, and which is meant depends on where it was written - see
 *  `nearest`. */
export function resolveNote(index: NoteIndex, target: string): NoteRef | null {
  const wanted = comparable(target.trim())
  if (!wanted) return null

  const found = index.notes.filter((note) => {
    const path = comparable(note.path)
    return path === wanted || path.endsWith(`/${wanted}`)
  })

  if (found.length) return nearest(found, index.path)

  // Nothing in the space is called that. A note may still answer to it: an
  // alias is a name a note gave itself in its front matter. Looked at only once
  // no file is named that, so a real file always wins, which is the order
  // Obsidian reads them in too.
  const named = index.notes.filter((note) =>
    note.aliases.some((alias) => comparable(alias) === wanted),
  )

  return named.length ? nearest(named, index.path) : null
}

/** The note a relative markdown target names: `../ideas/Plan.md` beside the note
 *  it was written in. Folded rather than resolved on disk, since the index is
 *  the only map the editor has. */
export function resolveRelative(index: NoteIndex, target: string): NoteRef | null {
  const parts = relativeParts(index, target)
  return parts.length ? resolveNote(index, parts.join('/')) : null
}

/** A relative target as the path it points at, from the folder the note it was
 *  written in sits in. Shared by the two things that resolve one: a note, and a
 *  file beside the notes. */
function relativeParts(index: NoteIndex, target: string): string[] {
  const parts = index.path === null ? [] : folderOf(index.path).split('/').filter(Boolean)

  for (const part of target.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }

  return parts
}

/** The file in the space a target names, or null when the space holds none.
 *
 *  A wikilink names a file the way it names a note - by the end of its path, so
 *  `[[paper.pdf]]` finds `reading/paper.pdf` wherever it sits, which is how
 *  Obsidian finds an attachment. A markdown target is a path beside the note it
 *  was written in, and is matched whole. The extension is part of the name here:
 *  a file has nothing else to be told apart by. */
export function resolveFile(index: NoteIndex, target: string, kind: LinkKind): string | null {
  const wanted = (
    kind === 'markdown' ? relativeParts(index, target).join('/') : target.trim().replace(/\\/g, '/')
  ).toLowerCase()
  if (!wanted) return null

  const found = index.files.filter((path) => {
    const held = path.toLowerCase()
    return kind === 'markdown' ? held === wanted : held === wanted || held.endsWith(`/${wanted}`)
  })

  // The shallowest, then the first by path: the same stable order `nearest`
  // gives notes, so a name that could mean two files always means the one.
  return (
    [...found].sort(
      (one, other) => one.split('/').length - other.split('/').length || (one < other ? -1 : 1),
    )[0] ?? null
  )
}

/** The note one link points at. A wikilink names a note; a markdown link names
 *  a path beside the note it was written in. Null for both when the space holds
 *  nothing by that name, and for a link into the note it was written in, which
 *  has no name to look up. */
export function resolveLink(index: NoteIndex, link: Wikilink, kind: LinkKind): NoteRef | null {
  if (!link.target) return null
  return kind === 'markdown' ? resolveRelative(index, link.target) : resolveNote(index, link.target)
}

/** Whether a link points at something the space actually holds. A link into the
 *  note it was written in always does; an unresolved one is drawn muted, and
 *  following it makes the note.
 *
 *  A PDF and a canvas resolve through the files rather than the notes, because
 *  those are what Nib can open beside a note. Any other file is left unresolved:
 *  a link that cannot be followed should not look as though it can. */
export function resolves(index: NoteIndex, link: Wikilink, kind: LinkKind): boolean {
  if (!link.target) return true
  if (isTabFile(link.target)) return resolveFile(index, link.target, kind) !== null

  return resolveLink(index, link, kind) !== null
}

/** Where following a link would go. */
export function jumpFor(index: NoteIndex, link: Wikilink, kind: LinkKind): NoteJump {
  // A PDF has pages where a note has headings, so the fragment is read as one
  // and the note side of the jump stays empty. A canvas has neither, and
  // `pageFragment` answers nothing for a fragment that is not a page.
  if (link.target && isTabFile(link.target)) {
    return {
      path: resolveFile(index, link.target, kind),
      target: link.target,
      heading: null,
      block: null,
      page: pageFragment(link.heading),
    }
  }

  return {
    // An empty target means the note the link is written in.
    path: link.target ? (resolveLink(index, link, kind)?.path ?? null) : index.path,
    target: link.target,
    heading: link.heading,
    block: link.block,
    page: null,
  }
}
