/** The verbs that do something.
 *
 *  Each of them goes through the call the app itself makes: opening a note is
 *  `workspace.open`, running a command is the row out of the registry the palette
 *  reads, a search is the panel's own search, writing words into a note is the
 *  workspace's replacement, which snapshots the note first and is one thing to
 *  undo. Nothing here writes a file, records an undo or asks the crate anything
 *  directly. That is the rule the whole feature rests on: a link and the command
 *  line can only do what somebody sitting in front of the app could do, and it
 *  happens the same way, so it is visible, undoable and syncs.
 *
 *  What is deliberately not here: anything that would delete or overwrite without
 *  being asked twice. `confirms` in verbs.ts is what asks. */

import { frontMatterEdit } from '@nib/markdown/front-matter'
import { appCommands } from '../commands'
import { links } from '../link-index.svelte'
import { search } from '../search.svelte'
import { folderOf, insideSpace, nameOf, relativeTo } from '../space-paths'
import { views } from '../views.svelte'
import { workspace } from '../workspace.svelte'
import { type Road, said, type Said, words, yes } from './args'
import { publishStatus } from './answers'
import { waited } from '../timing'
import { insidePath, noteFor, relativeIn, spaceFor } from './space'

/** What a note's name may end in for the app to treat it as one. */
const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i

/** How long a search is waited for before its hits are read. The field's own
 *  pause plus the walk; a space that is still answering after this has more to
 *  say than a caller was asking for. */
const SEARCH_PATIENCE = 8000

/** How often the search is asked again while that runs out. Long enough for the
 *  disk to have answered, short enough that a fast space is not waited on. */
const LOOKING_AGAIN = 50

/** Opens a note, and lands on a heading or a block when the caller named one.
 *
 *  The three roads are the workspace's own, which is what makes this the same act
 *  as following a link in a note: a bookmark of a heading takes the first, a
 *  `[[note#^block]]` takes the second. */
export async function openNote(args: Said): Promise<unknown> {
  const space = await spaceFor(args)
  const asked = said(args, 'path')
  if (!asked) throw new Error('say which path')

  // A name rather than a path is what a link written by hand usually says, and
  // what the index already answers: `nib://open?path=Plan` finds `notes/Plan.md`.
  // Resolved first and judged after, so the index's answer is a path on the same
  // terms as one the caller wrote out; see `insidePath`.
  const relative = insidePath((await named(asked)) ?? asked)
  const path = insideSpace(space.root, relative)

  const heading = said(args, 'heading')
  const block = said(args, 'block')

  // The same three calls the app makes itself: the palette's file rows take the
  // third, a bookmark of a heading the second, a `[[note#^block]]` the first.
  if (block) await workspace.openAtBlock(`${relative}#^${block}`)
  else if (heading) await workspace.openAtHeading(relative, heading)
  else await workspace.openEntry(path)

  if (!workspace.tabs.some((tab) => tab.path === path)) {
    throw new Error(`there is no note at ${relative}`)
  }

  return { path: relative, heading: heading ?? null, block: block ?? null }
}

/** The path the index holds for a bare note name, or null when the caller gave
 *  something that looks like a path already. Not a judged path: what it answers is
 *  judged by the caller, which is the only caller it has.
 *
 *  Through the resolver a `[[wikilink]]` goes through, which is what the table in
 *  docs/automation.md says a link with a name in it does. It used to ask
 *  `fileNamed`, which reads the list of files *beside* the notes - the pictures,
 *  the PDFs, the recordings - and a note is never in that list, so every
 *  `nib://open?path=Plan` written by hand answered "that link could not be
 *  followed". A name carrying an extension the resolver knows, `paper.pdf`,
 *  resolves as itself: the same rule the editor follows a wikilink by.
 *
 *  And after the scan has landed. A link is followed the moment the space is
 *  restored, and the index is read off the launch's critical path on purpose, so a
 *  link that *starts* the app arrived while the index was still empty and the name
 *  resolved to nothing - while the same link a moment later worked. `scanned`
 *  answers at once when nothing is in flight; see link-index.svelte.ts. */
async function named(asked: string): Promise<string | null> {
  if (asked.includes('/') || asked.includes('\\')) return null

  await links.scanned()
  return links.targetOf(null, { kind: 'wikilink', target: asked })
}

/** Makes a note, or adds to one that is already there.
 *
 *  Three shapes, and a caller picks one by what it says:
 *
 *  - nothing about a note that exists: a new note, under a name that is stepped
 *    the way every new file's is, so nothing is ever written over.
 *  - `append` or `prepend`: the words go onto the note that is there. Through the
 *    workspace's replacement, so the note is snapshotted, a caret in a pane
 *    showing it does not move, and it is one thing to undo.
 *  - `silent`: the note is written and not opened. The row still appears in the
 *    file list, which is the result on screen.
 *
 *  A note that exists and no `append` or `prepend` is refused rather than
 *  overwritten. A link that could replace a note is a link nobody should be able
 *  to send somebody. */
export async function newNote(args: Said): Promise<unknown> {
  const space = await spaceFor(args)
  const content = words(args, 'content') ?? ''
  const silent = yes(args, 'silent')
  const append = yes(args, 'append')
  const prepend = yes(args, 'prepend')

  const relative = wanted(args)
  const path = insideSpace(space.root, relative)
  const before = await workspace.noteText(path)

  if (before !== null) {
    if (!append && !prepend) {
      throw new Error(`${relative} is already there: say append or prepend to add to it`)
    }

    const after = append ? joined(before, content) : joined(content, before)
    await workspace.replaceInNotes([
      {
        path,
        before,
        after,
        edits: [{ from: 0, to: before.length, insert: after }],
        back: [{ from: 0, to: after.length, insert: before }],
      },
    ])

    if (!silent) await workspace.open(path)
    return { path: relative, added: true }
  }

  // Where the reader was, so a silent write can put them back: making a note
  // opens it, which is the right thing for every other caller.
  const wasShowing = workspace.activeTabId

  const folder = folderOf(relative)
  await workspace.createNote(
    folder ? insideSpace(space.root, folder) : space.root,
    withExtension(nameOf(relative)),
  )

  // Whatever name was free is the note that is open now, which is the one the
  // words belong in and the path to answer with.
  const made = workspace.active
  if (content) {
    workspace.replace(content)
    await workspace.save()
  }

  if (silent && made) {
    workspace.close(made.id)
    if (wasShowing !== null && workspace.tabs.some((tab) => tab.id === wasShowing)) {
      workspace.activate(wasShowing)
    }
  }

  return { path: relativeTo(space.root, made?.path ?? path), added: false }
}

/** Words onto the end of a note, and a note made if it is not there yet.
 *
 *  The thing a shortcut, a watch and a script all want: a line into the day's note
 *  without knowing or caring whether today's note exists. `nib://new?…&append` could
 *  already do it, which is a thing nobody would guess the name of - so it is an action
 *  of its own, and it is `new` with the answer to "and if it is already there?" given
 *  in advance. One road, so the path is judged once, the words are joined once, and a
 *  link can do exactly what a link could do before and no more: appending never
 *  overwrites and never deletes, which is why it is a link's to ask for at all.
 *
 *  `prepend` is not read here. The action is append; a caller who wants the top of the
 *  note asks `new` for it. */
export function appendNote(args: Said): Promise<unknown> {
  return newNote({ ...args, append: true, prepend: false })
}

/** Two bodies with exactly one blank line between them, however the first ended.
 *  A note appended to twice should not grow a run of empty lines. */
function joined(first: string, second: string): string {
  if (!first.trim()) return second
  if (!second.trim()) return first

  return `${first.replace(/\s+$/, '')}\n\n${second.replace(/^\s+/, '')}\n`
}

/** The path a new note is asked for, from a path or from a name. */
function wanted(args: Said): string {
  if (said(args, 'path') !== null) return withExtension(relativeIn(args))

  const name = said(args, 'name')
  if (!name) throw new Error('say a name or a path')

  const safe = relativeIn({ path: name }, 'path')
  if (safe.includes('/')) throw new Error('a name is not a path: use path for that')

  return withExtension(safe)
}

/** A name with `.md` on it, unless it is already a markdown name. Markdown and no
 *  other ending: this makes a note, and `nib new Board.canvas` asking for a plane
 *  would be a verb doing something other than what it says. */
function withExtension(name: string): string {
  return MARKDOWN.test(name) ? name : `${name}.md`
}

/** Searches the space, and shows the search while it does.
 *
 *  The panel is revealed through the registry's own row, which is what the key and
 *  the palette press, so an automated search and a search somebody typed are the
 *  same search in the same place. The hits come back as well, because a caller
 *  asking from the command line wants the answer and not only the panel. */
export async function searchSpace(args: Said): Promise<unknown> {
  await spaceFor(args)
  const query = said(args, 'query')
  if (!query) throw new Error('say what to search for')

  // Through the registry, so an automated search opens the panel the same way the
  // key and the palette row do rather than by a road of its own.
  runCommand({ id: 'search-space' })
  search.ask(query)

  const until = Date.now() + SEARCH_PATIENCE
  // The field waits for the typing to pause before it asks anything, so the first
  // moment says nothing either way.
  while (Date.now() < until) {
    await waited(LOOKING_AGAIN)
    if (!search.running) break
  }

  return {
    query,
    running: search.running,
    hits: search.hits.map((hit) => ({
      path: hit.path,
      name: hit.name,
      line: hit.line,
      text: hit.text,
    })),
  }
}

/** Runs one command out of the registry, by the id the palette knows it as.
 *
 *  The row itself, with its own `run`, so this cannot come to a different answer
 *  from the palette about what a command does or whether it can run at all. A row
 *  that is greyed out is refused here too, and says so: a command that cannot run
 *  and silently does nothing is the worst of the three answers.
 *
 *  And a row may say it is only for somebody at the keyboard. This is the one verb
 *  a link may ask for that is a whole list rather than one act, and a few of those
 *  rows turn on a microphone, open a camera or sign the machine out - which a page
 *  on the web is not going to do by handing the system an address. The row says so
 *  itself; see `byHand` in commands.ts. */
export function runCommand(args: Said, road: Road = 'here'): unknown {
  const id = said(args, 'id')
  if (!id) throw new Error('say which command')

  const found = appCommands(views.of(workspace.panes.focusedId)).find((one) => one.id === id)
  if (!found) throw new Error(`there is no command called ${id}`)
  if (found.disabled === true) throw new Error(`${id} cannot run just now`)
  if (found.byHand === true && road === 'link') {
    throw new Error(`${id} is not something a link may run`)
  }

  found.run()
  return { id, label: found.label }
}

/** Writes a note, words and all. The one verb that replaces what a note said, so
 *  it is behind a confirmation and out of reach of a link. */
export async function writeFile(args: Said): Promise<unknown> {
  const space = await spaceFor(args)
  const relative = relativeIn(args)
  const path = insideSpace(space.root, relative)
  const content = words(args, 'content')
  if (content === null) throw new Error('say the content')

  const before = await workspace.noteText(path)
  if (before === null) {
    // Nothing there to replace, so this is the same act as making it.
    await newNote({ ...args, path: relative, content })
    return { path: relative, written: content.length }
  }

  await workspace.replaceInNotes([
    {
      path,
      before,
      after: content,
      edits: [{ from: 0, to: before.length, insert: content }],
      back: [{ from: 0, to: content.length, insert: before }],
    },
  ])

  return { path: relative, written: content.length }
}

/** Moves or renames a file, which in this app is one act: a note's name is where
 *  it is. Every link to it is rewritten, because that is what the workspace's own
 *  rename does. */
export async function moveFile(args: Said): Promise<unknown> {
  const space = await spaceFor(args)
  const from = relativeIn(args, 'path')
  const to = relativeIn(args, 'to')

  const source = insideSpace(space.root, from)
  if ((await workspace.noteText(source)) === null) {
    throw new Error(`there is no note at ${from}`)
  }

  const folder = folderOf(to)
  if (folder === folderOf(from)) {
    await workspace.rename(source, withExtension(nameOf(to)))
    return { from, to: withExtension(to) }
  }

  await workspace.moveMany([source], folder ? insideSpace(space.root, folder) : space.root)
  if (nameOf(to) !== nameOf(from)) {
    await workspace.rename(
      insideSpace(space.root, folder ? `${folder}/${nameOf(from)}` : nameOf(from)),
      withExtension(nameOf(to)),
    )
  }

  return { from, to: withExtension(to) }
}

/** Takes a file away. It goes to Recently deleted, which is where every other
 *  delete in the app puts one, so a mistake is one row away from being undone. */
export async function deleteFile(args: Said): Promise<unknown> {
  const space = await spaceFor(args)
  const relative = relativeIn(args)
  const path = insideSpace(space.root, relative)

  if ((await workspace.noteText(path)) === null) {
    throw new Error(`there is no note at ${relative}`)
  }

  await workspace.remove(path, false)
  return { path: relative, deleted: true }
}

/** Sets one front matter key, or takes it away when the caller says no value.
 *
 *  Through the same single edit the icon picker writes, so the block is edited
 *  rather than rebuilt: every other key keeps its place and its spelling, and a
 *  caret in the words below the block does not move. */
export async function setProperty(args: Said): Promise<unknown> {
  const note = await noteFor(args)
  const key = said(args, 'key')
  if (!key) throw new Error('say which key')

  const value = said(args, 'value')
  const edit = frontMatterEdit(note.text, key, value)
  if (!edit) return { path: note.relative, key, value, changed: false }

  const after = note.text.slice(0, edit.from) + edit.insert + note.text.slice(edit.to)
  await workspace.replaceInNotes([
    {
      path: note.path,
      before: note.text,
      after,
      edits: [{ from: edit.from, to: edit.to, insert: edit.insert }],
      back: [
        {
          from: edit.from,
          to: edit.from + edit.insert.length,
          insert: note.text.slice(edit.from, edit.to),
        },
      ],
    },
  ])

  return { path: note.relative, key, value, changed: true }
}

/** One pass of the syncing loop, now, rather than at the next tick. */
export async function syncNow(): Promise<unknown> {
  const { sync } = await import('../sync.svelte')
  const moved = await sync.pass()

  return { moved, status: sync.status, lastError: sync.lastError }
}

/** Puts what the space says now on the web.
 *
 *  Which is a sync and nothing else, because a published page *is* the note on the
 *  account: the blog serves what the account holds, so the only thing standing
 *  between a note written a second ago and the page somebody reads is the pass that
 *  sends it. There is deliberately no second road that pushes a space to the web,
 *  since a second road would be a second copy of the notes. See docs/publishing.md.
 *
 *  Turning a blog on is the sheet's job, not this one's: it is a public act about
 *  an address, and it asks outright. */
export async function publishNow(args: Said): Promise<unknown> {
  const status = await publishStatus(args)
  await syncNow()

  return status
}
