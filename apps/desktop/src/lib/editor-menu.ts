import {
  type BlockKind,
  type BlockShape,
  blocksFor,
  blockTargets,
  clearFormatting,
  deleteBlocks,
  duplicateBlocks,
  type EditorView,
  indentBlocks,
  insertCodeFence,
  insertHorizontalRule,
  insertLink,
  insertPageBreak,
  calloutSign,
  insertTableToEdit,
  isSpellWord,
  moveBlocks,
  outdentBlocks,
  type StateCommand,
  toggleBulletList,
  toggleOrderedList,
  setCalloutSign,
  toggleQuote,
  toggleWrap,
  type Transaction,
  turnBlocksInto,
} from '@nib/editor'
import { copySelection, copyText, cutSelection } from './clipboard'
import { countText } from './counts'
import { linkTo } from './composer'
import { composerEntries } from './composer-commands'
import { t } from './i18n.svelte'
import { DIVIDER, type MenuEntry, menu } from './menu.svelte'
import { modes } from './modes.svelte'
import { recordingAt, transcribeEmbed } from './recorder/commands'
import { canTranscribe } from './recorder/transcribe'
import { shortcuts } from './shortcuts.svelte'
import { noteName, relativeTo } from './space-paths'
import { workspace } from './workspace.svelte'
import { viewport } from './viewport.svelte'

/** The editor's own context menu, so the browser's never appears.
 *
 *  Everything here calls the same commands the keyboard and the app menu call;
 *  what differs is how much of it is offered. A phone gets the clipboard alone,
 *  and a locked note gets the clipboard plus the way back out - a menu of things
 *  that cannot happen is worse than a short one. */

function runCommand(view: EditorView | undefined, command: StateCommand) {
  if (!view) return

  command({ state: view.state, dispatch: (transaction: Transaction) => view.dispatch(transaction) })
  view.focus()
}

async function paste(view: EditorView) {
  const text = await navigator.clipboard.readText().catch(() => '')
  if (!text) return

  const range = view.state.selection.main
  view.dispatch({ changes: { from: range.from, to: range.to, insert: text } })
  view.focus()
}

/** What a block is called, in the reader's own language. The editor answers with
 *  a word of its own and never with one anybody reads; this is where that word
 *  becomes one. */
function blockName(kind: BlockKind): string {
  switch (kind) {
    case 'heading':
      return t('Heading')
    case 'paragraph':
      return t('Paragraph')
    case 'list':
      return t('List item')
    case 'quote':
      return t('Quote')
    case 'code':
      return t('Code block')
    case 'table':
      return t('Table')
    case 'math':
      return t('Equation')
    case 'properties':
      return t('Properties')
    case 'rule':
      return t('Horizontal rule')
    case 'block':
      return t('Block')
  }
}

/** The rows about the block a press landed in: what it is, and what can be done
 *  to it.
 *
 *  To it, or to every block a selection covers: a selection in nib is a selection
 *  of text and never a mode, so the blocks it lies across are simply the blocks it
 *  lies across. The first row is not a row to press - it says which block the rest
 *  of them are about, and how much of the note that is, which is the only place
 *  the app counts anything smaller than a note.
 *
 *  Nothing at all in a note nobody can write in: every one of these writes, and a
 *  row that cannot happen is worse than no row.
 *
 *  Every row acts on all of them. A reader holding four blocks wants what they would
 *  want holding one - turn these into a list, take them a step in, move them, link to
 *  them - and the editor answers each of those for a run of blocks as readily as for
 *  one; see block/commands.ts in @nib/editor. What the rows say changes with the
 *  count and what they do does not. */
function blockEntries(
  view: EditorView | undefined,
  at: number | null,
  path: string | null | undefined,
): MenuEntry[] {
  if (!view || at === null || view.state.readOnly) return []

  const spans = blocksFor(view, at)
  if (!spans.length) return []

  const words = countText(
    spans.map((span) => view.state.doc.sliceString(span.from, span.to)).join('\n'),
  ).words
  const name = path ? noteName(path) : null
  const first = spans[0]

  return [
    DIVIDER,
    {
      label:
        spans.length > 1
          ? t('{blocks} blocks, {count} words', { blocks: spans.length, count: words })
          : t('{kind}, {count} words', {
              kind: blockName(first?.kind ?? 'block'),
              count: words,
            }),
      disabled: true,
      run: () => undefined,
    },
    // Behind one word rather than in front of seven: a row's own menu has no room
    // for a list, and the sheet the app already asks its short questions with reads
    // the same on a phone as under a pointer. See prompt.svelte.ts.
    { label: t('Turn into'), run: () => void turnInto(view, at) },
    DIVIDER,
    { label: t('Indent'), run: () => indentBlocks(view, at) },
    { label: t('Outdent'), run: () => outdentBlocks(view, at) },
    { label: t('Move up'), run: () => moveBlocks(view, at, -1) },
    { label: t('Move down'), run: () => moveBlocks(view, at, 1) },
    ...calloutEntries(view),
    DIVIDER,
    { label: t('Duplicate'), run: () => duplicateBlocks(view, at) },
    {
      // A link to a block needs the block to have a name, and giving it one is a
      // change to the note; see blockTarget in @nib/editor. A note nobody has
      // saved yet has no path and so nothing to point at: the row is there and
      // says it cannot happen, which is shorter than explaining why.
      //
      // One link per block, each on its own line, which is a list of links a note
      // can be pasted into. The row says the same word for one block or four
      // because it is the same thing: the link to what is in hand.
      label: t('Copy link'),
      disabled: !name,
      run: () => {
        const targets = name ? blockTargets(view, at) : []
        if (!name || !targets.length) return

        // Through `linkTo` like every other link the app writes, so a space set
        // to markdown links gets one here too; see composer.ts. The block's own
        // path and the note it is written from are both this note, which is what
        // makes a relative link to it the bare file name.
        const root = workspace.activeSpace?.root
        const relative =
          root !== undefined && path?.startsWith(root) ? relativeTo(root, path) : null
        void copyText(
          targets
            .map((target) =>
              linkTo(name, null, {
                fragment: target.slice(1),
                ...(relative ? { path: relative, from: relative } : {}),
              }),
            )
            .join('\n'),
        )
      },
    },
    { label: t('Delete'), danger: true, run: () => deleteBlocks(view, at) },
    ...blockBookmark(view, at, path),
  ]
}

/** The fold sign on the callout the caret is in, as two switches.
 *
 *  Nothing at all anywhere else, because two greyed rows in every menu would be two
 *  rows about something that is not there.
 *
 *  A callout folds in nib whatever it says - the chevron in the margin folds any
 *  block - so what these write is what the file carries, which is the half Obsidian
 *  reads and the half nib reads on the way in: `+` says the callout may be folded,
 *  `-` says it opens shut. Written here rather than typed by hand, which is the whole
 *  reason for the rows; see callouts.ts in @nib/markdown and fold.ts in @nib/editor. */
function calloutEntries(view: EditorView): MenuEntry[] {
  const sign = calloutSign(view.state)
  if (sign === null) return []

  return [
    DIVIDER,
    {
      label: t('Foldable'),
      checked: sign !== '',
      run: () => runCommand(view, setCalloutSign('+')),
    },
    {
      label: t('Starts folded'),
      checked: sign === '-',
      run: () => runCommand(view, setCalloutSign('-')),
    },
  ]
}

/** What the blocks in hand could become, in the order a note is written in: the
 *  three heading levels anybody uses, plain words, the three kinds of list, and a
 *  quote. Obsidian and Notion offer the same handful, because it is the handful
 *  markdown has.
 *
 *  The labels are the app's own words for these, already written: the heading rows
 *  are the row the palette offers for each level, and the rest are the words the
 *  slash menu and the format menu use. */
const SHAPES: readonly { shape: BlockShape; label: () => string }[] = [
  { shape: 'heading1', label: () => t('Heading {level}', { level: 1 }) },
  { shape: 'heading2', label: () => t('Heading {level}', { level: 2 }) },
  { shape: 'heading3', label: () => t('Heading {level}', { level: 3 }) },
  { shape: 'paragraph', label: () => t('Paragraph') },
  { shape: 'bullet', label: () => t('Bulleted list') },
  { shape: 'numbered', label: () => t('Numbered list') },
  { shape: 'task', label: () => t('Task list') },
  { shape: 'quote', label: () => t('Quote') },
]

/** Asks which, and turns them into it.
 *
 *  The sheet is fetched rather than imported: it is the app's short-question surface
 *  and carries its own drawing, and the menu row is already a press by the time this
 *  runs. The same shape the rewrite sheet is opened with; see `rewrite` below. */
async function turnInto(view: EditorView, at: number) {
  const { prompt } = await import('./prompt.svelte')
  const chosen = await prompt.choose({
    title: t('Turn into'),
    options: SHAPES.map((one) => ({ id: one.shape, label: one.label() })),
  })

  const shape = SHAPES.find((one) => one.shape === chosen)
  if (shape) turnBlocksInto(view, at, shape.shape)
}

/** The first words of a block, which is what a list of them can be read by: the
 *  line it opens with, without the markup that opens it. A name of the block's
 *  own is what `^a1b2c3` is not. */
function firstWords(text: string): string {
  const line = text.split('\n')[0] ?? ''
  return line
    .replace(/^\s*(?:#{1,6}|[-*+]|\d+[.)]|>|`{3,}|~{3,})\s*/, '')
    .trim()
    .slice(0, 60)
}

/** Keeping this block in the bookmarks above the file list.
 *
 *  The same naming a link to it uses - a heading by its words, anything else by a
 *  name written into the note; see blockTarget in @nib/editor - so the row and
 *  the link point at the same thing and neither has a way of its own. */
function blockBookmark(view: EditorView, at: number, path: string | null | undefined): MenuEntry[] {
  const root = workspace.activeSpace?.root
  if (!path || root === undefined || !path.startsWith(root)) return []

  const relative = relativeTo(root, path)
  const spans = blocksFor(view, at)
  const span = spans[0]
  if (!span) return []

  const words = firstWords(view.state.doc.sliceString(span.from, span.to))
  const held = workspace.bookmarks.list.find(
    (one) => one.kind === 'block' && one.path.startsWith(`${relative}#`) && one.text === words,
  )

  return [
    held
      ? { label: t('Remove bookmark'), run: () => workspace.bookmarks.toggle(held) }
      : {
          // One bookmark per block, each under its own first words, so a run of them
          // arrives in the list as the blocks they are rather than as one row standing
          // for several.
          label: spans.length > 1 ? t('Bookmark these blocks') : t('Bookmark this block'),
          run: () => {
            // The words are read before any naming: giving a block a name writes into
            // the note and moves every offset after it.
            const said = blocksFor(view, at).map((one) =>
              firstWords(view.state.doc.sliceString(one.from, one.to)),
            )

            for (const [index, target] of blockTargets(view, at).entries()) {
              const mark = workspace.bookmarks.forBlock(relative, target, said[index] ?? words)
              if (mark) workspace.bookmarks.toggle(mark)
            }
          },
        },
  ]
}

/** The rewrite sheet, opened on what is selected.
 *
 *  Fetched rather than imported: the four rewrites carry everything the app knows about
 *  talking to a model, and a menu that only has to draw one row has no use for any of
 *  it. The row is already a press on an open menu by the time this runs, so the fetch
 *  happens under the sheet's own way in. See ai/rewriting.svelte.ts. */
async function rewrite(view: EditorView) {
  const { rewriting } = await import('./ai/rewriting.svelte')
  rewriting.show(view)
}

function editorMenu(view: EditorView | undefined, block: MenuEntry[]): MenuEntry[] {
  const selected = !!view && !view.state.selection.main.empty
  const locked = !!view && view.state.readOnly
  const run = (command: StateCommand) => () => runCommand(view, command)

  const clipboard: MenuEntry[] = [
    {
      label: t('Cut'),
      hint: shortcuts.hint('fixed.cut'),
      disabled: !selected || locked,
      run: cutSelection,
    },
    {
      label: t('Copy'),
      hint: shortcuts.hint('fixed.copy'),
      disabled: !selected,
      run: copySelection,
    },
    {
      label: t('Paste'),
      hint: shortcuts.hint('fixed.paste'),
      disabled: locked,
      run: () => {
        if (view) void paste(view)
      },
    },
  ]

  // On a phone a press on the text is for the clipboard, the way it is in
  // every other app there. The formatting lives in the bar above the
  // keyboard and in the app menu, and sixteen rows would cover the text
  // they are about.
  if (viewport.touch) return [...clipboard, ...block]

  // A locked note leaves the clipboard rows and the way back out. The rest of
  // this menu writes.
  if (locked) {
    return [
      ...clipboard,
      DIVIDER,
      {
        label: t('Leave read-only'),
        hint: shortcuts.hint('app.read-only'),
        run: () => modes.toggleReadOnly(view),
      },
    ]
  }

  return [
    ...clipboard,
    ...block,
    // One row for the four rewrites, on a selection and only on one: what they do is
    // replace what is selected, and four rows here would be four rows greyed out in
    // every menu opened anywhere else. See ai/rewriting.svelte.ts.
    ...(selected
      ? [
          DIVIDER,
          // `selected` is what says there is a view: it is false without one, which
          // is why nothing here has to ask again.
          { label: t('Rewrite…'), run: () => void rewrite(view) },
        ]
      : []),
    DIVIDER,
    { label: t('Bold'), hint: shortcuts.hint('format.bold'), run: run(toggleWrap('**')) },
    { label: t('Italic'), hint: shortcuts.hint('format.italic'), run: run(toggleWrap('*')) },
    { label: t('Code'), hint: shortcuts.hint('format.code'), run: run(toggleWrap('`')) },
    { label: t('Link'), hint: shortcuts.hint('format.link'), run: run(insertLink) },
    {
      label: t('Clear formatting'),
      hint: shortcuts.hint('format.clear'),
      run: run(clearFormatting),
    },
    DIVIDER,
    { label: t('Quote'), hint: shortcuts.hint('paragraph.quote'), run: run(toggleQuote) },
    {
      label: t('Bulleted list'),
      hint: shortcuts.hint('paragraph.bullet-list'),
      run: run(toggleBulletList),
    },
    {
      label: t('Numbered list'),
      hint: shortcuts.hint('paragraph.ordered-list'),
      run: run(toggleOrderedList),
    },
    // Not through `run`: the new table takes the focus into its first cell,
    // and focusing the editor afterwards would take it straight back out.
    {
      label: t('Table'),
      hint: shortcuts.hint('paragraph.table'),
      run: () => {
        if (view) insertTableToEdit(view)
      },
    },
    {
      label: t('Code block'),
      hint: shortcuts.hint('paragraph.code-block'),
      run: run(insertCodeFence),
    },
    {
      label: t('Horizontal rule'),
      hint: shortcuts.hint('paragraph.rule'),
      run: run(insertHorizontalRule),
    },
    { label: t('Page break'), run: run(insertPageBreak) },
    DIVIDER,
    // Moving text between notes. Here rather than only in the palette because
    // what they act on is the caret and the selection, which is what a right
    // click is already about.
    ...composerEntries(view),
    DIVIDER,
    {
      label: modes.source ? t('Leave source mode') : t('Source mode'),
      hint: shortcuts.hint('app.source'),
      run: () => modes.toggleSource(view),
    },
  ]
}

/** The word a right click landed on, or null where it landed on none.
 *
 *  This is as close as a page can get to "the misspelled word": no browser will
 *  say which words its checker thinks are wrong, on any platform. It does not
 *  need to - the wavy line is under the word, the pointer is on the word, and
 *  the word is what the reader means. See spelling.ts in the editor package. */
function wordUnder(view: EditorView, event: MouseEvent): string | null {
  const at = view.posAtCoords({ x: event.clientX, y: event.clientY })
  if (at === null) return null

  const range = view.state.wordAt(at)
  if (!range) return null

  const word = view.state.doc.sliceString(range.from, range.to)
  return isSpellWord(word) ? word : null
}

/** Adding the word under the pointer to the reader's own list, or taking it out
 *  again. Only while the checker is on: with it off there is no wavy line to
 *  take away, and a row that does nothing visible is a row that lies. */
function spellingEntries(view: EditorView | undefined, event: MouseEvent): MenuEntry[] {
  if (!view || !modes.spellcheck) return []

  // A press on the mark in the margin is about the block and not about a word:
  // the nearest word to the margin is only the first one on the line.
  const on = event.target
  if (on instanceof Element && on.closest('.nib-block-handle')) return []

  const word = wordUnder(view, event)
  if (word === null) return []

  const known = modes.knowsWord(word)
  return [
    DIVIDER,
    {
      label: known
        ? t('Remove {word} from the dictionary', { word })
        : t('Add {word} to the dictionary', { word }),
      run: () => modes.toggleSpellWord(word, view),
    },
  ]
}

/** The row a recording in the note offers: turning it into words.
 *
 *  On the embed's own menu because that is where it is about something: the file the
 *  press landed on, rather than a row in the palette that would have to guess which of
 *  the recordings in a note was meant. The words go under the player through the same
 *  Whisper path a meeting's live transcript goes through; see recorder/commands.ts.
 *
 *  Only with an account, because that path is on the Worker. Left out rather than
 *  greyed out: somebody with no account has nothing to press it for. */
function recordingEntries(view: EditorView | undefined, at: number | null): MenuEntry[] {
  if (!view || at === null || view.state.readOnly || !canTranscribe()) return []
  if (!recordingAt(view, at)) return []

  return [DIVIDER, { label: t('Transcribe'), run: () => void transcribeEmbed(view, at) }]
}

/** Opens it at the pointer. One place, so the two things a right click on the
 *  text has to do - build the menu for this moment and place it - stay
 *  together. */
export function showEditorMenu(
  event: MouseEvent,
  view: EditorView | undefined,
  // Null and not only absent: a note that has never been saved has no path, and
  // that is a note like any other until it is written down.
  path?: string | null,
) {
  // Never the precise position: a press on the mark in the margin lands beside
  // the text rather than in it, and that press is about the block it stands by.
  const at = view ? view.posAtCoords({ x: event.clientX, y: event.clientY }, false) : null

  menu.show(
    event,
    [
      ...editorMenu(view, blockEntries(view, at, path)),
      ...recordingEntries(view, at),
      ...spellingEntries(view, event),
    ],
    { near: true },
  )
}
