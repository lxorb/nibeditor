/** One export, whatever format it is: gather what the format needs, hand it to
 *  the writer for that format, and give the file to whoever asked for it.
 *
 *  Every row in the File menu, in the palette and in the shortcut settings comes
 *  through here, so the nine formats cannot drift apart in what they read, what
 *  they are called or where they end up. Each writer is a pure function in a file
 *  of its own; this is the only part that touches a disk, a dialog or a network,
 *  and it is loaded when an export is actually run rather than at startup - the
 *  Word writer and the zip are a good deal larger than the list of names. */

import { loadFor } from '@nib/markdown/engines'
import type { FoundLink } from '@nib/markdown/links'
import {
  buildBody,
  buildStyles,
  type HtmlOptions,
  prepareEmbeds,
  prepareFences,
  printInFrame,
  renderNote,
} from '../export'
import { t } from '../i18n.svelte'
import {
  DEFAULT_PAGE_SETUP,
  pageSetupFor,
  paperInches,
  type PaperTwips,
  paperTwips,
  runningDate,
} from '../page-setup'
import { invoke, isDesktop, isNative } from '../tauri'
import { documentOf, picturesIn } from './document'
import { type Exportable, EXPORT_FORMATS, EXPORT_VARIANTS, extensionFor, TEXTPACK } from './formats'
import { toMarkdown } from './markdown'
import { fileNameFor, stemOf } from './naming'
import { writtenPdf } from './print'
import { type Picture, readPictures, sourcesIn } from './pictures'
import { chooseTarget, deliver, type Payload } from './save'
import { toPlainText } from './text'
import { bundleFiles, packEntries } from './textbundle'
import { zipOf } from './zip'

/** The note being exported, and where it lives. */
export interface Note {
  source: string
  name: string
  path: string | null
}

export interface RunOptions extends HtmlOptions {
  /** Where a `[[wikilink]]` points, as a path relative to the note. Null leaves
   *  it as the words it showed, which is what a document with no space around it
   *  can honestly say. */
  link?: (link: FoundLink) => string | null
  /** The paper behind a picture of the note. */
  background?: string
  /** When the file says it was made. Passed in so a build is reproducible. */
  now?: string
}

/** How tall one picture may be. Every engine refuses a canvas past about 32767
 *  pixels, and refuses it by handing back a blank one rather than by saying so,
 *  so a long note is cut into pieces well before that. */
const MOST_PIXELS = 16384

/** What the save dialog calls this kind of file. */
function labelFor(id: Exportable): string {
  const format = EXPORT_FORMATS.find((one) => one.id === id)
  if (format) return t(format.label)

  const variant = EXPORT_VARIANTS.find((one) => one.id === id)
  return variant ? t(variant.label) : id
}

/** The page as one self-contained file: fences drawn, every picture inside it. */
async function pageOf(note: Note, options: RunOptions, pictures?: readonly Picture[]) {
  return renderNote(note.source, note.name, options, pictures)
}

/** The note's own markup and its stylesheet, for a package that brings its own
 *  pages. The same two halves the standalone page is built from. */
async function partsOf(note: Note, options: RunOptions) {
  const fence = await prepareFences(note.source, options.scheme ?? 'light')
  const embed = options.readNote ? await prepareEmbeds(note.source, options.readNote) : undefined
  const body = buildBody(note.source, { ...options, fence, ...(embed ? { embed } : {}) })

  return { body, css: buildStyles(body, note.source, options) }
}

/** The pictures a document names, read. */
function picturesOf(sources: readonly string[], options: RunOptions) {
  return readPictures(sources, options.resolveImage ?? ((src) => src))
}

/** The page the settings ask for, with the note's own `export:` front matter over
 *  the top of it, in the twips a Word document and an RTF are both measured in.
 *  The same resolution the printed page and the HTML road use, so one note comes
 *  out on one size of paper whichever road it takes. */
function paperFor(note: Note, options: RunOptions, title: string): PaperTwips {
  const setup = pageSetupFor(note.source, options.page ?? DEFAULT_PAGE_SETUP)

  return paperTwips(setup, title, runningDate(note.source, options.date))
}

/** Writes a PDF. On a desktop whose webview can print to a file it goes straight
 *  to disk with the paper from the settings; elsewhere the print dialog does the
 *  saving. Always light: it is going on paper. */
async function exportPdf(note: Note, options: RunOptions): Promise<string | null> {
  const native = isDesktop && (await invoke<boolean>('pdf_supported').catch(() => false))
  const target = native ? await chooseTarget(note.name, 'pdf', 'PDF') : null
  if (native && !target) return null

  const html = await pageOf(note, { ...options, scheme: 'light' })

  if (target) {
    const page = paperInches(pageSetupFor(note.source, options.page ?? DEFAULT_PAGE_SETUP))
    // The dialog can still save the file, so the person is not left with nothing
    // to show for the wait - and the line says the road changed; see print.ts.
    if (await writtenPdf(html, target, page)) return target
  }

  await printInFrame(html)
  return null
}

/** The note drawn, as one picture or as several of equal height. */
async function exportPicture(
  id: 'jpg' | 'png',
  note: Note,
  options: RunOptions,
): Promise<string | null> {
  const mime = id === 'png' ? 'image/png' : 'image/jpeg'
  const html = await pageOf(note, options, await picturesFor(note, options, true))
  const { toImages } = await import('./image')

  const pages = await toImages(html, {
    mime,
    scale: 2,
    background: options.background ?? '#ffffff',
    pageHeight: MOST_PIXELS,
  })

  const first = pages[0]
  if (!first) throw new Error(t('Nothing came out of that export'))
  if (pages.length === 1) return deliver(note.name, id, labelFor(id), { bytes: first, mime })

  // Several pictures cannot be one file, so the reader names the first and the
  // rest land beside it, numbered.
  const stem = stemOf(note.name)
  return deliver(note.name, id, labelFor(id), {
    files: pages.map((bytes, at) => ({ path: `${stem} ${at + 1}.${id}`, body: bytes })),
    folder: false,
  })
}

/** The pictures the page names. `whole` reads the rendered page rather than the
 *  note, which is how a picture inside an embedded note is found too. */
async function picturesFor(note: Note, options: RunOptions, whole: boolean): Promise<Picture[]> {
  if (!whole) return picturesOf(picturesIn(documentOf(note.source, note.name)), options)

  const html = await pageOf(note, { ...options, bare: true })
  return picturesOf(sourcesIn(html), options)
}

/** A TextBundle, or the same thing zipped where a folder cannot be handed over. */
async function exportBundle(note: Note, options: RunOptions): Promise<string | null> {
  const pictures = await picturesFor(note, options, false)
  const files = bundleFiles(note.source, pictures, options.link ? { link: options.link } : {})

  if (isNative) {
    return deliver(note.name, 'textbundle', labelFor('textbundle'), { files, folder: true })
  }

  const bundle = fileNameFor(note.name, 'textbundle')
  const bytes = await zipOf(packEntries(bundle, files))

  return deliver(note.name, TEXTPACK, labelFor('textbundle'), {
    bytes,
    mime: 'application/octet-stream',
  })
}

/** Markdown with the pictures beside it: the note, then an `assets` folder next
 *  to it. A browser cannot be handed a folder, so there it is one zip. */
async function exportMarkdownWithPictures(note: Note, options: RunOptions): Promise<string | null> {
  const pictures = await picturesFor(note, options, false)
  const files = bundleFiles(note.source, pictures, options.link ? { link: options.link } : {})
  // The bundle's own metadata is the wrapper's, not the note's, and the note
  // keeps its own name rather than becoming `text.md`.
  const beside = files
    .filter((file) => file.path !== 'info.json')
    .map((file) =>
      file.path === 'text.md' ? { ...file, path: fileNameFor(note.name, 'md') } : file,
    )

  if (isNative) {
    return deliver(note.name, 'md', labelFor('md-assets'), { files: beside, folder: false })
  }

  const bytes = await zipOf(beside)
  return deliver(note.name, 'zip', labelFor('md-assets'), {
    bytes,
    mime: 'application/zip',
  })
}

/** The formats that come to one file of text or bytes. The rest each need
 *  something of their own: a print engine, a canvas, or a folder. */
type OneFile = Exclude<Exportable, 'pdf' | 'jpg' | 'png' | 'textbundle' | 'md-assets'>

/** What a format comes to, for the formats that are one file of text or bytes. */
async function payloadFor(id: OneFile, note: Note, options: RunOptions): Promise<Payload> {
  switch (id) {
    case 'txt':
      return { text: toPlainText(documentOf(note.source, note.name)), mime: 'text/plain' }

    case 'md':
      return {
        text: toMarkdown(note.source, options.link ? { link: options.link } : {}),
        mime: 'text/markdown',
      }

    case 'html':
      return {
        text: await pageOf(note, options, await picturesFor(note, options, true)),
        mime: 'text/html',
      }

    case 'html-bare':
      return { text: await pageOf(note, { ...options, bare: true }), mime: 'text/html' }

    case 'rtf': {
      const { toRtf } = await import('./rtf')
      const doc = documentOf(note.source, note.name)
      return {
        text: toRtf(
          doc,
          await picturesOf(picturesIn(doc), options),
          paperFor(note, options, doc.title),
        ),
        mime: 'application/rtf',
      }
    }

    case 'docx': {
      const { toDocx } = await import('./docx')
      const doc = documentOf(note.source, note.name)
      const bytes = await toDocx(
        doc,
        await picturesOf(picturesIn(doc), options),
        paperFor(note, options, doc.title),
      )
      return {
        bytes,
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }
    }

    case 'epub': {
      const { toEpub } = await import('./epub')
      const doc = documentOf(note.source, note.name)
      const { body, css } = await partsOf(note, options)

      const bytes = await toEpub({
        title: doc.title,
        author: doc.author,
        lang: doc.lang,
        identifier: `urn:nib:${encodeURIComponent(note.path ?? doc.title)}`,
        modified: (options.now ?? new Date().toISOString()).replace(/\.\d+Z$/, 'Z'),
        body,
        css,
        pictures: await picturesOf(sourcesIn(body), options),
      })

      return { bytes, mime: 'application/epub+zip' }
    }
  }
}

/** Runs one export, and answers where the file went, or null when the reader
 *  closed the dialog. Whatever goes wrong is thrown, for the caller to show. */
export async function runExport(
  id: Exportable,
  note: Note,
  options: RunOptions = {},
): Promise<string | null> {
  // The formula engine and the emoji table, where this note turns out to want
  // either: both are loaded on demand rather than at startup, and a document that
  // has left the app must have its formulas set in it rather than their source.
  // Once, here, because every format below renders or lexes the note somewhere
  // inside it and none of those places has an await to spare. See
  // @nib/markdown/engines.
  await loadFor(note.source)

  if (id === 'pdf') return exportPdf(note, options)
  if (id === 'jpg' || id === 'png') return exportPicture(id, note, options)
  if (id === 'textbundle') return exportBundle(note, options)
  if (id === 'md-assets') return exportMarkdownWithPictures(note, options)

  const payload = await payloadFor(id, note, options)
  return deliver(note.name, extensionFor(id), labelFor(id), payload)
}
