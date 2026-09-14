import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { Facet } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { blocksOf } from '@nib/markdown/links'
import { label } from '../labels'
import {
  fuzzy,
  type LinkWrite,
  linkWriter,
  type NoteIndex,
  noteIndex,
  type NoteRef,
  resolveNote,
  type SpaceBlock,
} from './notes'

/** What `[[` offers: the notes in the space, then the headings and blocks inside
 *  the one that was chosen - or, when the space is what you want to search, every
 *  heading and every block there is.
 *
 *  Five lists, decided by what has been typed between the brackets. Nothing
 *  before a `#` is a note; after a `#` it is a heading of that note; after a `#^`
 *  it is one of its blocks - and picking a block that has no name yet is what
 *  gives it one, which is the only thing here that writes to another note and so
 *  the only thing that goes back out through a facet.
 *
 *  The other two are for the link you want to write without remembering which
 *  note it is in, which is most of them:
 *
 *  - `[[##` offers every heading of the space, each with the note it is in beside
 *    it, and writes a link to that note's heading. Free, because the index already
 *    holds every heading of every note.
 *  - `[[^^` offers every block of the space, and writes a link to it. The blocks
 *    that already have a name come first, out of the index; the rest are found by
 *    their own words through the app's search, which is the only thing that can
 *    read a space without the editor reading a space. Two characters before it
 *    asks, so a `[[^^` on its own is a list and not a query, and once it has asked
 *    the popup filters what came back rather than asking again per keystroke.
 *
 *  Neither is Obsidian's; both are the same popup, the same keys and the same
 *  brackets. A note written with one travels as `[[Note#Heading]]`, which is
 *  Obsidian's own spelling, so nothing about the file is nib's.
 *
 *  What every row here actually writes is the app's business rather than this
 *  file's: a space set to markdown links gets `[Note](folder/Note.md#heading)` out
 *  of the same pick. One writer answers that for the whole app - the Links setting,
 *  which the grip's Copy link, a split, an import and a cited PDF page all go
 *  through - and it arrives as `linkWriter`; see notes.ts and composer.ts in the
 *  app. On its own the editor writes the wikilink, which is that setting's own
 *  default. */

/** Gives a block of another note a name and returns it, so a link can point at
 *  the block rather than at the note. Supplied by the app, which owns the file;
 *  on its own the editor offers only the blocks that are already named. */
export const blockNamer = Facet.define<
  (path: string, line: number) => Promise<string | null>,
  (path: string, line: number) => Promise<string | null>
>({ combine: (values) => values[0] ?? (() => Promise.resolve(null)) })

/** Where a row that was picked starts: at the `[[` that opened the link, so the
 *  whole link is rewritten rather than only the part after the brackets.
 *
 *  Found rather than counted back from the popup's own start, because every kind
 *  of row starts the popup somewhere else - past the brackets, past a `#`, past a
 *  doubled mark - and all of them replace the same thing. The popup only ever
 *  fires inside a `[[`, so there is one on the line in front of the caret. */
function opened(view: EditorView, from: number): number {
  const line = view.state.doc.lineAt(from)
  const at = view.state.doc.sliceString(line.from, from).lastIndexOf('[[')
  return at === -1 ? from : line.from + at
}

/** How many of each kind the list shows. Long enough to reach any note by
 *  typing two or three letters, short enough that the popup is a list. */
const MOST_SHOWN = 40

/** How much has to be typed after `^^` before the space is searched. Two
 *  characters, because one is every note in the space and the answer to it is a
 *  list nobody can read. */
const LEAST_SEARCHED = 2

/** How long the two characters that open a space-wide list are. The popup starts
 *  past them so that what is typed filters on a heading's own words rather than on
 *  the marks that asked for headings; the row that is picked rewrites the whole
 *  link anyway, marks and all. */
const MARKER = 2

/** A note's extension, which is not part of the name a link writes. */
const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i

/** Everything between `[[` and the caret, or null when the caret is not in a
 *  link. `]]` is not required: the link is being written. */
function typing(context: CompletionContext) {
  return context.matchBefore(/\[\[[^[\]\n]*/)
}

/** Writes the whole link the row stands for, so a chosen note needs no closing
 *  brackets typed after it. Whatever `]]` is already there goes with it rather
 *  than being doubled, which is what close-brackets leaves behind.
 *
 *  The link's spelling is the app's, through `linkWriter`: a space set to markdown
 *  links gets one here, exactly as the grip's Copy link does. Which is why the
 *  whole construct is replaced from its `[[` rather than only the words after it -
 *  a markdown link has no brackets of that shape to keep. */
function insert(target: LinkWrite) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const start = opened(view, from)
    const closed = view.state.doc.sliceString(to, to + 2) === ']]'
    const text = view.state.facet(linkWriter)(target)

    view.dispatch({
      changes: { from: start, to: closed ? to + 2 : to, insert: text },
      selection: { anchor: start + text.length },
      userEvent: 'input.complete',
    })
  }
}

/** Everything a link the popup writes knows about its target except which part of
 *  the note it points at: the name to write, where the note sits, and the note the
 *  link is being written in. The rows add the heading or the block. */
function about(index: NoteIndex, note: NoteRef): LinkWrite {
  return { name: nameFor(index, note), path: note.path, from: index.path }
}

/** The name to write for a note: its own, unless the space holds another note by
 *  that name, in which case the path says which one is meant - the shortest form
 *  that is unambiguous, as Obsidian writes it. */
function nameFor(index: NoteIndex, note: NoteRef): string {
  const same = index.notes.filter((one) => one.name.toLowerCase() === note.name.toLowerCase())
  return same.length > 1 ? note.path.replace(MARKDOWN, '') : note.name
}

/** A folder to read at a glance, or nothing for a note at the top of the space. */
function folderOf(path: string): string | undefined {
  const at = path.lastIndexOf('/')
  return at === -1 ? undefined : path.slice(0, at)
}

/** A note's own row, and one for every other name it answers to.
 *
 *  An alias row carries the note's real name where a plain row carries the
 *  folder, so choosing one is never a guess about which note it writes. What it
 *  writes is the alias itself: that is the name the writer gave the note for
 *  reading, and a link is words as much as it is a target. */
function rowsFor(index: NoteIndex, note: NoteRef, needle: string): Completion[] {
  const rows: Completion[] = []
  const folder = folderOf(note.path)
  // A note that has been put away says so where the folder would be: the reader asked
  // for this one by its whole name, so the word confirms what they are about to write
  // rather than warning them off it. See `offers`.
  const detail = note.archived === true ? label('archived') : folder

  if (offers(note, needle)) {
    rows.push({
      label: note.name,
      ...(detail === undefined ? {} : { detail }),
      apply: insert(about(index, note)),
      type: 'text',
    })
  }

  for (const alias of note.aliases) {
    if (!alias.trim()) continue
    if (needle && !alias.toLowerCase().includes(needle)) continue
    // An archived note's other names are offered on the same terms its own is: the
    // whole of one, typed.
    if (note.archived === true && alias.trim().toLowerCase() !== needle) continue

    // The alias is the name, so a wikilink writes the alias and a markdown link
    // shows it over the note's own path - which is the same sentence either way.
    rows.push({
      label: alias,
      detail: note.name,
      apply: insert({ ...about(index, note), name: alias }),
      type: 'text',
    })
  }

  return rows
}

function noteOptions(index: NoteIndex, typed: string): Completion[] {
  const needle = typed.trim().toLowerCase()
  const rows: Completion[] = []

  // Cut after the rows are built rather than before: an alias is a row of its
  // own, and slicing the notes first would drop it for a reason nobody could
  // see.
  for (const note of index.notes) {
    rows.push(...rowsFor(index, note, needle))
    if (rows.length >= MOST_SHOWN) break
  }

  return rows.slice(0, MOST_SHOWN)
}

/** Whether a note is worth offering for what has been typed.
 *
 *  Every note that matches, except an archived one: that is offered only to somebody
 *  who has typed its whole name, which is somebody who knows the note is there and means
 *  that one. An archived note sitting in the list under two letters would be the archive
 *  not working - the `[[` list is the space offering its notes, and an archived note has
 *  stopped being offered - while refusing it outright would break the one case that
 *  matters: writing a link to a note you have deliberately put away.
 *
 *  Nothing typed at all offers every note and no archived one, for the same reason. */
function offers(note: NoteRef, needle: string): boolean {
  if (note.archived === true) return needle !== '' && note.name.toLowerCase() === needle

  return !needle || matches(note, needle)
}

/** A note matches what has been typed when its name, its path or one of the
 *  other names it answers to contains it. Substring rather than fuzzy: the
 *  palette's fuzzy matching is for finding a note by a few letters, and a link
 *  is being written, not searched for. */
function matches(note: NoteRef, needle: string): boolean {
  return (
    note.name.toLowerCase().includes(needle) ||
    note.path.toLowerCase().includes(needle) ||
    note.aliases.some((alias) => alias.toLowerCase().includes(needle))
  )
}

function headingOptions(target: LinkWrite, note: NoteRef, typed: string): Completion[] {
  const needle = typed.trim().toLowerCase()

  return note.headings
    .filter((heading) => !needle || heading.toLowerCase().includes(needle))
    .slice(0, MOST_SHOWN)
    .map((heading) => ({
      label: heading,
      apply: insert({ ...target, fragment: heading }),
      type: 'keyword',
    }))
}

/** The target note's blocks. Its text is read for this rather than kept in the
 *  index: a block has no name until one is picked, so there would be nothing to
 *  index, and one note is read at the moment somebody asks about it. */
async function blockOptions(
  index: NoteIndex,
  target: LinkWrite,
  note: NoteRef,
  typed: string,
): Promise<Completion[]> {
  const source = await index.read(note.path)
  if (source === null) return []

  const needle = typed.trim().toLowerCase()

  return blocksOf(source)
    .filter((block) => block.text !== '')
    .filter((block) => !needle || block.text.toLowerCase().includes(needle))
    .slice(0, MOST_SHOWN)
    .map((block) => ({
      label: block.text,
      apply:
        block.id === null
          ? name(note.path, block.line, target)
          : insert({ ...target, fragment: `^${block.id}` }),
      type: 'property',
    }))
}

/** Picks a block that has nothing to link to yet: the app names it, and the name
 *  it gives back is what goes into the link. Nothing is written into this note
 *  until that lands, so a target that could not be written leaves no link
 *  pointing at a name nothing has.
 *
 *  `target` is everything about the link except which block it points at, which is
 *  what the name that comes back finishes; see `insert`. */
function name(path: string, line: number, target: LinkWrite) {
  return (view: EditorView, completion: Completion, from: number, to: number) => {
    void view.state
      .facet(blockNamer)(path, line)
      .then((id) => {
        if (id) insert({ ...target, fragment: `^${id}` })(view, completion, from, to)
      })
      // Nothing to say to the writer: the link is still there to be finished by
      // hand, which is what inserting nothing leaves them with.
      .catch(() => undefined)
  }
}

/** Every heading in the space, as rows that write the whole link.
 *
 *  Out of the index, which already holds them: no note is read, whatever has been
 *  typed. The note's name is the row's detail, muted beside the heading, because
 *  the heading is what is being looked for and the note is which one it is. */
function spaceHeadings(index: NoteIndex, typed: string): Completion[] {
  const needle = typed.trim().toLowerCase()
  const rows: Completion[] = []

  for (const note of index.notes) {
    for (const heading of note.headings) {
      if (!fuzzy(heading, needle)) continue

      rows.push({
        label: heading,
        detail: note.name,
        apply: insert({ ...about(index, note), fragment: heading }),
        type: 'keyword',
      })
      if (rows.length >= MOST_SHOWN) return rows
    }
  }

  return rows
}

/** The blocks of the space that already answer to a name, out of the index.
 *
 *  First in the list, because they are the ones somebody has already made a link
 *  to and picking one writes nothing into any note. A name is all there is to show
 *  for one - the index holds the names and not the words around them - so these
 *  are matched on the name itself, which is what somebody typing `a1b` means. */
function namedBlocks(index: NoteIndex, needle: string): Completion[] {
  const rows: Completion[] = []

  for (const note of index.notes) {
    for (const id of note.blocks) {
      if (!fuzzy(id, needle)) continue

      rows.push({
        label: `^${id}`,
        detail: note.name,
        apply: insert({ ...about(index, note), fragment: `^${id}` }),
        type: 'property',
        // Above the found ones, whatever the popup's own scores make of them.
        boost: 1,
      })
      if (rows.length >= MOST_SHOWN) return rows
    }
  }

  return rows
}

/** One block the app's search found, as a row.
 *
 *  The line that matched is the label, since that is what was being looked for.
 *  A block that has a name is linked to by it; one that has not is named when it
 *  is picked, by the app, which is the same writer the grip's Copy link uses. */
function foundBlock(index: NoteIndex, block: SpaceBlock): Completion {
  const note = index.notes.find((one) => one.path === block.path)
  const target: LinkWrite = note
    ? about(index, note)
    : { name: block.path.replace(MARKDOWN, ''), path: block.path, from: index.path }

  return {
    label: block.text,
    ...(note ? { detail: note.name } : {}),
    apply: block.id
      ? insert({ ...target, fragment: `^${block.id}` })
      : name(block.path, block.line, target),
    type: 'property',
  }
}

/** Every block in the space: the named ones, and then the ones the search found
 *  by their own words.
 *
 *  The search is asked once, for two or more characters, and only after the index
 *  has given what it can. Nothing here reads a note - the app answers out of the
 *  space's own search, which is a walk in Rust or a worker with the bodies already
 *  in hand - and the popup filters what came back as more is typed rather than
 *  asking again. Blocks of the note being written in are left to `[[#^`, which
 *  offers them out of the text on the screen rather than the copy on the disk. */
async function spaceBlocks(index: NoteIndex, typed: string): Promise<Completion[]> {
  const needle = typed.trim().toLowerCase()
  const rows = namedBlocks(index, needle)
  const named = new Set(rows.map((row) => row.label))

  if (!index.searchBlocks || needle.length < LEAST_SEARCHED) return rows

  const found = await index.searchBlocks(needle, MOST_SHOWN).catch(() => [])

  for (const block of found) {
    if (!block.text.trim()) continue
    if (block.path === index.path) continue
    if (block.id && named.has(`^${block.id}`)) continue

    rows.push(foundBlock(index, block))
    if (rows.length >= MOST_SHOWN) break
  }

  return rows
}

export function wikilinkCompletions(
  context: CompletionContext,
): CompletionResult | Promise<CompletionResult | null> | null {
  const typed = typing(context)
  if (!typed) return null

  const index = context.state.facet(noteIndex)
  const inner = typed.text.slice(2)
  const hash = inner.indexOf('#')

  // The whole space, which is what the doubled mark asks for. The popup starts
  // past the two characters so that what is typed matches a heading's own words,
  // and the row that is picked takes them with it; see `insert`.
  const across = typed.from + 2 + MARKER

  if (inner.startsWith('##')) {
    const options = spaceHeadings(index, inner.slice(MARKER))
    return options.length ? { from: across, options, validFor: /^[^[\]\n#|^]*$/ } : null
  }

  if (inner.startsWith('^^')) {
    return spaceBlocks(index, inner.slice(MARKER)).then((options) =>
      options.length ? { from: across, options, validFor: /^[^[\]\n#|^]*$/ } : null,
    )
  }

  if (hash === -1) {
    const options = noteOptions(index, inner)
    return options.length ? { from: typed.from + 2, options, validFor: /^[^[\]\n#|]*$/ } : null
  }

  const named = inner.slice(0, hash).trim()
  // No note before the `#` means the note being written in.
  const note = named
    ? resolveNote(index, named)
    : (index.notes.find((one) => one.path === index.path) ?? null)
  if (!note) return null

  const after = inner.slice(hash + 1)
  const from = typed.from + 2 + hash + 1
  // The name exactly as it was typed, so a link somebody wrote path-qualified stays
  // that way - and empty where they wrote none, which is a link into this very note
  // and is spelled as the anchor on its own.
  const target: LinkWrite = { name: named, path: note.path, from: index.path }

  if (!after.startsWith('^')) {
    const options = headingOptions(target, note, after)
    return options.length ? { from, options, validFor: /^[^[\]\n|^]*$/ } : null
  }

  return blockOptions(index, target, note, after.slice(1)).then((options) =>
    options.length ? { from, options, validFor: /^\^[^[\]\n|]*$/ } : null,
  )
}
