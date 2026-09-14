import { CODE_PALETTES } from '@nib/editor'
import { frontMatterValue, renderMarkdown, type Wikilink } from '@nib/markdown'
import { sourcesOf } from '@nib/markdown/sources'
import { exportCss, themeCss } from '@nib/themes/raw'
import { accentTokens, DEFAULT_ACCENT } from './accents'
import { type Fence, prepareEmbeds, prepareFences } from './before-render'
import { titleOf } from './export/document'
import { inlinePictures, type Picture, swapSources } from './export/pictures'
import { chooseTarget } from './export/save'
import { PANDOC_FORMATS, type PandocFormat } from './export-formats'
import { paletteCss } from './highlight'
import { mathCss } from './math-fonts'
import {
  DEFAULT_PAGE_SETUP,
  type PageSetup,
  pageCss,
  pageSetupFor,
  runningDate,
  withRunningText,
} from './page-setup'
import { assetPath, invoke, isDesktop } from './tauri'
import type { Scheme } from './theme.svelte'

export { PANDOC_FORMATS, type PandocFormat } from './export-formats'
// Where they live now, and still named here because an export is one of the three
// surfaces that waits for them; see before-render.ts.
export { type Drawer, type Fence, prepareEmbeds, prepareFences } from './before-render'

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (character) => ESCAPES[character] ?? character)
}

export interface HtmlOptions {
  /** Leave the stylesheet out, for pasting into a site that has its own. The
   *  markup stays semantic: no colouring spans, and images keep the paths the
   *  note wrote. Diagrams are still drawn, since they are content. */
  bare?: boolean
  /** Turns a path written in the note into one the filesystem understands. */
  resolveImage?: (src: string) => string
  /** Light unless asked otherwise: a document is read on paper more often
   *  than a screen, and the print stylesheet turns light regardless. */
  scheme?: Scheme
  /** The accent and code palette chosen in the app. */
  accent?: string
  codeTheme?: string
  /** Stylesheets on top of the built-in theme: a theme file and custom.css,
   *  when the export should look exactly as the app does. */
  css?: string
  /** Paper and running text. The note's own front matter wins over this. */
  page?: PageSetup
  /** The date the running text prints. Passed in so a build is reproducible. */
  date?: string
  /** Fences already prepared; see `prepareFences`. */
  fence?: Fence
  /** Reads the note a `![[…]]` names, so the embeds in a document can be
   *  gathered before it is rendered - the renderer cannot wait on a disk. */
  readNote?: (target: string) => Promise<string | null>
  /** The notes an embed names, already read; see `prepareEmbeds`. */
  embed?: (link: Wikilink) => string | null
}

function declarations(tokens: Record<string, string>): string {
  return Object.entries(tokens)
    .map(([token, value]) => `${token}: ${value};`)
    .join(' ')
}

/** The accent for the scheme on screen, and its light shade on paper. */
function accentCss(accent: string, scheme: Scheme): string {
  return [
    `:root { ${declarations(accentTokens(accent, scheme))} }`,
    `@media print { :root { ${declarations(accentTokens(accent, 'light'))} } }`,
  ].join('\n')
}

/** The note's own markup, with no page around it. What the standalone page below
 *  fills its `#write` with, and what a package that brings its own pages - an
 *  ePub - asks for on its own. One reading of the note either way, so a book and
 *  a page cannot come out saying different things. */
export function buildBody(source: string, options: HtmlOptions = {}): string {
  return renderMarkdown(source, {
    footnotes: true,
    toc: true,
    // The note's cover, where it names one: the banner is the top of the note, so
    // a document of it opens on the same picture the app shows. Its own picture
    // like any other, so `inlineImages` below carries it into the file.
    cover: true,
    ...(options.fence ? { code: options.fence } : {}),
    // No link resolver: an exported document stands on its own, and a link to a
    // note that is not in it has nowhere to point, so it reads as its own words.
    ...(options.embed ? { resolveEmbed: options.embed } : {}),
  })
}

/** Everything that dresses the note: the maths fonts it uses, the theme, the
 *  accent, the export sheet, the code palette, the paper, and whatever the
 *  reader has put on top. Apart from the page for the same reason as the body:
 *  an ePub carries these in a stylesheet of its own. */
export function buildStyles(body: string, source: string, options: HtmlOptions = {}): string {
  // The first palette is the one that follows the theme, and stands in for an
  // id nothing here recognises - one written by a later build, say.
  const palette =
    CODE_PALETTES.find((entry) => entry.id === options.codeTheme) ?? CODE_PALETTES.at(0)

  return [
    mathCss(body),
    themeCss,
    accentCss(options.accent ?? DEFAULT_ACCENT, options.scheme ?? 'light'),
    exportCss,
    palette ? paletteCss(palette) : '',
    pageCss(pageSetupFor(source, options.page ?? DEFAULT_PAGE_SETUP)),
    options.css ?? '',
  ]
    .filter(Boolean)
    .join('\n')
}

/** A standalone page: the note, its theme, and nothing else. Pure, so it can
 *  be tested; the fences are drawn beforehand by `prepareFences`. */
export function buildHtml(source: string, name: string, options: HtmlOptions = {}): string {
  const title = titleOf(source, name)
  const author = frontMatterValue(source, 'author')
  const lang = frontMatterValue(source, 'lang') ?? 'en'
  const body = buildBody(source, options)

  const meta = [
    '<meta charset="utf-8">',
    author ? `<meta name="author" content="${escape(author)}">` : '',
    `<title>${escape(title)}</title>`,
  ]
    .filter(Boolean)
    .join('\n')

  if (options.bare) {
    return `<!doctype html>\n<html lang="${escape(lang)}">\n<head>\n${meta}\n</head>\n<body>\n${body}</body>\n</html>\n`
  }

  const scheme = options.scheme ?? 'light'
  const setup = pageSetupFor(source, options.page ?? DEFAULT_PAGE_SETUP)
  const date = runningDate(source, options.date)

  const styles = buildStyles(body, source, options)
  const page = withRunningText(`<div id="write">\n${body}</div>\n`, setup, title, date)

  return `<!doctype html>
<html lang="${escape(lang)}" data-theme="${scheme}">
<head>
${meta}
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="Nib">
<style>
${styles}
</style>
</head>
<body>
${page}</body>
</html>
`
}

/** Every `src` in the page that points at a file rather than at the network.
 *
 *  A path the note wrote is one. So is an address `assetUrl` made, which is what a
 *  page that has already been resolved for a screen carries - a plane drawn to SVG
 *  is the one of those that is also exported; see canvas/picture.ts. Those wear a
 *  scheme and a host on some platforms, which is why they are asked about by name
 *  rather than sorted out by their shape. */
export function localSources(html: string): string[] {
  return sourcesOf(html, (src) => assetPath(src) !== null || !/^(data:|https?:|\/\/)/i.test(src))
}

/** Swaps local image paths for `data:` URIs so the exported file stands alone.
 *  An image that cannot be read is left pointing where it did. */
export async function inlineImages(
  html: string,
  resolve: (src: string) => string,
): Promise<string> {
  const sources = localSources(html)
  if (!sources.length) return html

  const inlined = new Map<string, string>()

  await Promise.all(
    sources.map(async (src) => {
      const data = await invoke<string>('read_asset', { path: resolve(src) }).catch(() => null)
      if (data) inlined.set(src, data)
    }),
  )

  return swapSources(html, inlined)
}

/** The whole document, ready to write: fences drawn, pictures inside it.
 *
 *  `pictures` are the ones the caller has already read, which is how a picture
 *  off the network gets into the file as well: without them only the ones beside
 *  the note are inlined, and a page that still points at a server is a page that
 *  does not open on a train. */
export async function renderNote(
  source: string,
  name: string,
  options: HtmlOptions = {},
  pictures?: readonly Picture[],
): Promise<string> {
  const fence = await prepareFences(source, options.scheme ?? 'light', { highlight: !options.bare })
  const embed = options.readNote ? await prepareEmbeds(source, options.readNote) : undefined
  const html = buildHtml(source, name, { ...options, fence, ...(embed ? { embed } : {}) })

  // A bare page keeps the paths the note wrote: it is going into a site that has
  // its own pictures beside it.
  if (options.bare) return html
  if (pictures) return inlinePictures(html, pictures)

  return options.resolveImage ? inlineImages(html, options.resolveImage) : html
}

/** Shows the page to the browser's print dialog, which is where "Save as PDF"
 *  lives when nothing better is available. The frame is kept until the dialog
 *  has closed; taking it away sooner cancels the print in some engines. */
export function printInFrame(html: string): Promise<void> {
  return new Promise((resolve) => {
    /** What had the keyboard before the frame took it. Read now, because by the
     *  time the dialog closes the answer is the frame. */
    const from = document.activeElement

    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;'

    let done = false
    const finish = () => {
      if (done) return
      done = true

      // The frame is focused below, because an engine prints the window that has
      // the keyboard; nothing gives it back when the frame goes, and a reader who
      // printed a note and carried on typing was typing into a frame that had
      // already been taken away. Only where the frame is still holding it - what
      // somebody clicked while the dialog was up is theirs - and only to something
      // still in the page, the way trap.ts hands it back.
      const ours = document.activeElement === frame
      frame.remove()
      if (ours && from instanceof HTMLElement && from.isConnected) from.focus()

      resolve()
    }

    const show = async () => {
      const inner = frame.contentWindow
      if (!inner) {
        finish()
        return
      }

      // Fonts arrive inline but still have to be decoded before the page is measured.
      await inner.document.fonts.ready.catch(() => undefined)
      inner.addEventListener('afterprint', finish, { once: true })
      inner.focus()
      inner.print()
      // An engine that never says afterprint would otherwise keep the frame forever.
      window.setTimeout(finish, 5 * 60 * 1000)
    }

    // Whatever goes wrong on the way to the dialog, the frame goes and the
    // caller is let go of; a print that never resolves would hold the line at
    // the top of the document for as long as the app is open.
    frame.addEventListener('load', () => void show().catch(finish))

    frame.srcdoc = html
    document.body.append(frame)
  })
}

export async function pandocAvailable(): Promise<boolean> {
  if (!isDesktop) return false
  return invoke<boolean>('has_pandoc').catch(() => false)
}

/** Reads a Word, ODT, EPUB, RST or similar file in as markdown. */
export async function importDocument(): Promise<{ name: string; markdown: string } | null> {
  if (!isDesktop) return null

  const { open } = await import('@tauri-apps/plugin-dialog')
  const picked = await open({
    filters: [
      {
        name: 'Documents',
        extensions: ['docx', 'odt', 'rtf', 'epub', 'rst', 'textile', 'tex', 'html', 'opml', 'org'],
      },
    ],
  })

  if (typeof picked !== 'string') return null

  const markdown = await invoke<string>('import_document', { path: picked })
  const name =
    picked
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.[^.]+$/, '') ?? 'Imported'

  return { name: `${name}.md`, markdown }
}

/** The formats that are pandoc's rather than ours, for a machine that has it.
 *  Nib writes its own Word, RTF and ePub, so those are not here: two roads to
 *  one format would mean a note came out differently depending on the machine. */
export async function exportPandoc(source: string, name: string, format: PandocFormat) {
  if (!isDesktop) return

  const spec = PANDOC_FORMATS.find((entry) => entry.id === format)
  if (!spec) return

  const target = await chooseTarget(name, spec.extension, spec.label)
  if (!target) return

  await invoke('run_pandoc', { source, output: target, format })
  return target
}
