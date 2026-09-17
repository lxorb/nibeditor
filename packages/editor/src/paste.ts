import { EditorSelection, type Extension } from '@codemirror/state'
import { type Command, EditorView } from '@codemirror/view'
import { ourOwn } from './copy'

/** The converter, fetched the first time a web page is pasted.
 *
 *  Turndown and the GFM rules over it are what turn HTML into the markdown this app
 *  writes, and a window that opens on a note has no use for either: most pastes carry
 *  no HTML at all, and the ones that do are a page somebody went and copied. So it
 *  arrives with the first such paste. One promise, kept, so only that paste ever
 *  waits - and it waits for a fetch from the cache, which is a beat rather than a
 *  round trip.
 *
 *  Everything a paste decides without it stays where it was: a spreadsheet's tabs are
 *  read here, and a clipboard holding nothing but plain text is handed straight back
 *  to CodeMirror. See `richPaste`.
 *
 *  Nothing held on the side: a module is fetched once and kept by the loader, so every
 *  paste after the first is answered out of the cache in the turn that asked. */
function converter(): Promise<(html: string) => string> {
  return import('@nib/markdown/from-html').then((one) => one.htmlToMarkdown)
}

/** Spreadsheet cells arrive as tab-separated lines; Typora turns them into a
 *  table, which is nearly always what was meant. */
export function delimitedToTable(text: string): string | null {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => line.length > 0)
  const [firstLine] = lines
  if (firstLine === undefined || lines.length < 2) return null

  // A tab on the first line settles it: nothing but a spreadsheet puts tabs on
  // the clipboard. A comma has to be on every line *twice* - `Hello, world` and
  // `Goodbye, world` are two sentences, and one comma each was enough to turn
  // them into a two-column table.
  const separator = firstLine.includes('\t')
    ? '\t'
    : lines.every((line) => line.split(',').length > 2)
      ? ','
      : null
  if (!separator) return null

  const rows = lines.map((line) => line.split(separator).map((cell) => cell.trim()))
  // An empty header falls out below on the column count, so the default needs
  // no check of its own.
  const [header = [], ...body] = rows
  const columns = header.length
  if (columns < 2 || rows.some((row) => row.length !== columns)) return null

  const escape = (cell: string) => cell.replace(/\|/g, '\\|')
  const render = (row: string[]) => `| ${row.map(escape).join(' | ')} |`

  return [
    render(header),
    `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`,
    ...body.map(render),
  ].join('\n')
}

/** The note's own markdown, where a copy out of this app is what filled the
 *  clipboard, and null for a page from anywhere else.
 *
 *  A clipboard carries the same words twice and a paste picks one of them. For a
 *  web page the HTML is the richer of the two by far - the headings, the lists and
 *  the links are in it and not in the text - which is what a rich paste is for. For
 *  a note it is the poorer: the markdown beside it is the source, and the HTML is
 *  one rendering of it with everything markdown says and HTML does not already
 *  spent. Reading that back guessed at the source and landed beside it, most
 *  visibly at a formula: `$$\left\{ y \in \mathbb{R}^n \right\}$$` copied out of a
 *  note came back as `{y∈Rn}`, the symbols it had been drawn as.
 *
 *  So the words a copy took are the words a paste puts back, character for
 *  character. See `OURS` in copy.ts, which is the mark being read. */
function copiedHere(html: string, text: string): string | null {
  return text && ourOwn(html) ? text : null
}

function insert(view: EditorView, text: string) {
  const range = view.state.selection.main
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: EditorSelection.cursor(range.from + text.length),
    scrollIntoView: true,
    userEvent: 'input.paste',
  })
}

/** What a clipboard's two flavours come to, as markdown. Null where there is
 *  nothing worth inserting, which leaves the paste to whoever asked.
 *
 *  Answered rather than returned, because turning HTML into markdown means fetching
 *  the converter. Only the HTML flavour does: a spreadsheet and a clipboard of plain
 *  text are both settled before anything is asked for. */
export async function pastedMarkdown(html: string, text: string): Promise<string | null> {
  // A note this app copied, which is the one clipboard whose plain text is already
  // the answer.
  const ours = copiedHere(html, text)
  if (ours) return ours

  // A spreadsheet puts both on the clipboard; the plain text is the table.
  const table = delimitedToTable(text)
  if (table) return table

  if (!html.trim()) return null

  const htmlToMarkdown = await converter()
  return htmlToMarkdown(html) || null
}

/** Pasting a web page gives markdown, the way Typora does it. */
export function richPaste(): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      // Handed back to CodeMirror, which refuses it too while the document is
      // read-only. Turning a web page into markdown first would be work done
      // for a change that is not going to land.
      if (view.state.readOnly) return false

      const data = event.clipboardData
      if (!data || data.files.length) return false

      const html = data.getData('text/html')
      const text = data.getData('text/plain')

      // A note this app copied: handed back to CodeMirror, which puts the plain
      // text in as it stands - and the plain text is the note's own markdown. See
      // `copiedHere`.
      if (copiedHere(html, text)) return false

      // A spreadsheet puts both flavours on the clipboard and the plain text is the
      // table, so that paste is worked out here and lands in the frame it happened in.
      const table = delimitedToTable(text)
      if (table) {
        event.preventDefault()
        insert(view, table)
        return true
      }

      // Nothing but plain text: handed back to CodeMirror, exactly as before.
      if (!html.trim()) return false

      // A web page. The event has to be answered now - a paste the browser has
      // already carried out cannot be taken back - and the converter may still be on
      // its way, so the words are inserted when it lands. That is one beat, on the
      // first page pasted in a run of the app and on no other.
      event.preventDefault()
      void converter()
        .then((htmlToMarkdown) => {
          // A page that comes to nothing - all chrome and no prose - is pasted as the
          // plain text beside it, which is what handing the paste back would have
          // done with it.
          const words = htmlToMarkdown(html) || text
          if (words) insert(view, words)
        })
        .catch(() => {
          if (text) insert(view, text)
        })

      return true
    },
  })
}

/** The Paste row in the menu, which has no paste event to ride on.
 *
 *  `Ctrl+V` never comes through here: the browser raises a paste event and
 *  `richPaste` above answers it, which is the only way to see a picture on the
 *  clipboard at all. A menu row has to go and ask instead, and asking gives the
 *  same two flavours read the same way, so a page pasted from the menu is the
 *  page pasted with the keyboard.
 *
 *  A clipboard the browser will not hand over - no permission, or not a secure
 *  context - pastes nothing, and says so by pasting nothing. */
export const pasteHere: Command = (view) => {
  if (view.state.readOnly) return false

  void readClipboard()
    .then(async (clipboard) => {
      if (!clipboard) return
      const markdown = await pastedMarkdown(clipboard.html, clipboard.text)
      const text = markdown ?? clipboard.text
      if (text) insert(view, text)
    })
    .catch(() => undefined)

  return true
}

/** The clipboard's HTML and its text, as far as this browser will say.
 *
 *  `read` is the one that sees HTML and the one a webview is most likely to
 *  refuse; `readText` is the fallback, and a paste of plain text is a great deal
 *  better than a paste of nothing. */
async function readClipboard(): Promise<{ html: string; text: string } | null> {
  try {
    const items = await navigator.clipboard.read()
    let html = ''
    let text = ''

    for (const item of items) {
      if (!html && item.types.includes('text/html'))
        html = await (await item.getType('text/html')).text()
      if (!text && item.types.includes('text/plain'))
        text = await (await item.getType('text/plain')).text()
    }

    if (html || text) return { html, text }
  } catch {
    // Fall through to the text below, which some webviews allow when `read` is
    // refused outright.
  }

  const text = await navigator.clipboard.readText().catch(() => '')
  return text ? { html: '', text } : null
}

/** `Ctrl+Shift+V` - take the clipboard exactly as it is.
 *
 *  A clipboard the browser will not hand over - no permission, or not a secure
 *  context - pastes nothing, and says so by pasting nothing. The rejection is
 *  caught rather than dropped: nothing else would answer for it, and an
 *  unhandled one is noise at best. */
export const pastePlain: Command = (view) => {
  if (view.state.readOnly) return false

  navigator.clipboard
    .readText()
    .then((text) => {
      if (text) insert(view, text)
    })
    .catch(() => undefined)
  return true
}
