/** A canvas as a picture: one SVG, and the two other formats made out of it.
 *
 *  SVG is the only drawing here. A PNG is that SVG rasterised by the browser,
 *  and a PDF is that SVG on a page handed to the same printer the notes use, so
 *  there is one description of what a canvas looks like on paper rather than
 *  three that drift apart. Pictures are inlined as data, so the file stands on
 *  its own once it has left the app.
 *
 *  Cards keep their words, and how depends on where the picture is going. An SVG
 *  and a printed page put the rendered markdown inside a `foreignObject`, so a
 *  heading is a heading and a list is a list. A PNG cannot: a browser marks a
 *  canvas as tainted the moment an SVG holding a `foreignObject` is drawn on it,
 *  and a tainted canvas will not hand over its pixels. So the PNG is drawn from
 *  the same picture with the cards set as plain wrapped lines instead, which is
 *  the one thing that both reads the same and rasterises at all. */

import { inlineImages, printInFrame } from '../export'
import { writtenPdf } from '../export/print'
import { chooseTarget, download } from '../export/save'
import { type Canvas, type CanvasNode } from './format'
import {
  arrowAt,
  bounds,
  type Box,
  boxOf,
  edgeEnds,
  edgeMiddle,
  edgePath,
  isLineShape,
  shapeLine,
  shapePath,
} from './geometry'
import { strokeBox } from './ink'
import { inkSvg } from './svg'
import type { Palette } from './paint'
import { cardHtml, fileUrl, isPicture } from './render'
import { assetPath, invoke, isDesktop } from '../tauri'
import { message, t } from '../i18n.svelte'

/** Room left round the drawing, in plane units. */
const PADDING = 32

function escaped(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function colourOf(node: { color?: string }, palette: Palette, fallback: string): string {
  const colour = node.color
  if (colour === undefined) return fallback
  return palette[colour] ?? colour
}

/** How the words inside a card are set, since an SVG carries no stylesheet of
 *  its own and a `foreignObject` inherits nothing from the page it came from. */
function styles(palette: Palette): string {
  return `
    .card { box-sizing: border-box; width: 100%; height: 100%; padding: 8px 12px;
      overflow: hidden; color: ${palette.text ?? '#111'};
      font: 13px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
    .card > :first-child { margin-top: 0 }
    .card > :last-child { margin-bottom: 0 }
    .card h1, .card h2, .card h3 { margin: 0 0 4px; font-size: 1.15em; line-height: 1.3 }
    .card p { margin: 0 0 6px }
    .card ul, .card ol { margin: 0 0 6px; padding-left: 1.2em }
    .card img { max-width: 100% }
    .card code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .92em }
    .card a { color: ${palette.accent ?? '#4c6ef5'}; text-decoration: none }
    .label { font: 550 13px/1 ui-sans-serif, system-ui, sans-serif }
  `
}

/** Markdown's HTML as XML.
 *
 *  An SVG is XML, and an SVG opened as an image is parsed strictly: one `<br>`
 *  or one bare `&` in a card and the whole picture fails to load with nothing
 *  said. The browser's own parsers are the only thing that gets this right, so
 *  the HTML goes through the one that is lenient and comes back out of the one
 *  that is exact. */
function asXml(html: string): string {
  const page = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const root = page.body.firstElementChild
  if (!root) return ''

  return new XMLSerializer().serializeToString(root).replace(/^<div[^>]*>|<\/div>$/g, '')
}

/** Markdown as the lines a reader would see, with the marks taken off. What a
 *  card says when it cannot be set as HTML. */
function plainLines(text: string): string[] {
  return text.split('\n').map((line) =>
    line
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/^\s{0,3}[-*+]\s+/, '• ')
      .replace(/^\s{0,3}>\s?/, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/([*_~`])(.+?)\1/g, '$2')
      .replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_all, target: string, shown?: string) =>
        (shown ?? target).trim(),
      )
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1'),
  )
}

/** How wide a character is as a share of the font size, and how tall a line is.
 *  Measuring properly would want a DOM; half the size is close enough for a
 *  picture nobody is going to typeset from. */
const PER_CHARACTER = 0.52
const LINE = 17
const CARD_FONT = 13

/** The lines of a card, broken to its width. */
function fitted(text: string, width: number): string[] {
  const most = Math.max(4, Math.floor((width - 24) / (CARD_FONT * PER_CHARACTER)))
  const out: string[] = []

  for (const line of plainLines(text)) {
    let rest = line

    while (rest.length > most) {
      const space = rest.lastIndexOf(' ', most)
      const cut = space > most / 2 ? space : most
      out.push(rest.slice(0, cut))
      rest = rest.slice(space > most / 2 ? cut + 1 : cut)
    }

    out.push(rest)
  }

  return out
}

/** A card's words as SVG text, for the picture a browser can rasterise. */
function plainCard(text: string, box: Box, palette: Palette): string {
  const lines = fitted(text, box.width).slice(0, Math.floor((box.height - 12) / LINE))
  if (!lines.length) return ''

  const spans = lines
    .map(
      (line, index) =>
        `<tspan x="${box.x + 12}" y="${box.y + 20 + index * LINE}">${escaped(line)}</tspan>`,
    )
    .join('')

  return `<text font-size="${CARD_FONT}" fill="${palette.text ?? '#111'}" class="label">${spans}</text>`
}

function cardBody(node: CanvasNode, canvasPath: string | null): string {
  switch (node.type) {
    case 'text':
      // Trusting, like every other export: a picture is a file somebody asked for
      // and takes away, and nothing in it runs - an SVG drawn as an image has no
      // scripts. The rule about whose HTML runs is about the app's own surfaces;
      // see trust.ts.
      return `<div class="card" xmlns="http://www.w3.org/1999/xhtml">${asXml(cardHtml(node.text, canvasPath, true))}</div>`
    case 'link':
      return `<div class="card" xmlns="http://www.w3.org/1999/xhtml"><strong>${escaped(hostOf(node.url))}</strong><br/><span style="opacity:.6">${escaped(node.url)}</span></div>`
    case 'file':
      if (isPicture(node.file)) return ''
      return `<div class="card" xmlns="http://www.w3.org/1999/xhtml" style="opacity:.75">${escaped(node.file)}</div>`
    case 'group':
    case 'shape':
    case 'page':
      // Drawn as themselves rather than as a card with words in it. A page never
      // reaches a canvas's picture at all - a page note goes out through pages/out.ts,
      // which puts one page on one sheet - and is here so the switch covers every kind.
      return ''
  }
}

/** The words inside a shape, in the middle of it. Through the same two routes a card
 *  takes: the real renderer where a browser is drawing the picture, and plain lines
 *  where it is not. */
function shapeWords(
  node: CanvasNode & { type: 'shape' },
  box: Box,
  palette: Palette,
  canvasPath: string | null,
  plain: boolean,
): string {
  if (!node.text) return ''

  if (plain) return plainCard(node.text, box, palette)

  return `<foreignObject x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"><div class="card" xmlns="http://www.w3.org/1999/xhtml" style="display:flex;flex-direction:column;justify-content:center;text-align:center">${asXml(cardHtml(node.text, canvasPath, true))}</div></foreignObject>`
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    // Not a URL a browser would parse, so the whole of it is the name.
    return url
  }
}

/** One node as SVG. A group is a dashed frame with its name above it, a shape is
 *  itself, a picture is the picture, and everything else is a card. */
function drawnNode(
  node: CanvasNode,
  palette: Palette,
  canvasPath: string | null,
  root: string | null,
  plain: boolean,
): string {
  const box = boxOf(node)
  const line = colourOf(node, palette, palette.line ?? '#d6d9de')

  if (node.type === 'group') {
    const name = node.label
      ? `<text class="label" x="${box.x + 2}" y="${box.y - 6}" fill="${line}">${escaped(node.label)}</text>`
      : ''
    return `<g><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="10" fill="${line}" fill-opacity="0.07" stroke="${line}" stroke-dasharray="6 5"/>${name}</g>`
  }

  if (node.type === 'shape') {
    const stroke = colourOf(node, palette, palette.text ?? '#111')
    const fill = node.fill ? stroke : 'none'
    const opacity = node.fill ? 0.18 : 1

    const words = shapeWords(node, box, palette, canvasPath, plain)

    if (node.shape === 'rect') {
      return `<g><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="4" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="2"/>${words}</g>`
    }
    if (node.shape === 'ellipse') {
      return `<g><ellipse cx="${box.x + box.width / 2}" cy="${box.y + box.height / 2}" rx="${box.width / 2}" ry="${box.height / 2}" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="2"/>${words}</g>`
    }

    // Everything else - a diamond, a triangle, a line, an arrow, an elbow - is the
    // corners the plane draws it through, so a picture that has left the app is the
    // picture that was on it. See shapePath in geometry.ts.
    const corners = shapePath(node)
    const open = isLineShape(node.shape)
    const d = `M ${corners.map((one) => `${one.x} ${one.y}`).join(' L ')}${open ? '' : ' Z'}`

    const ends = shapeLine(node)
    const head =
      node.shape === 'arrow'
        ? `<path d="M 0 0 L -11 -5.5 L -11 5.5 Z" fill="${stroke}" transform="translate(${ends.to.x} ${ends.to.y}) rotate(${(Math.atan2(ends.to.y - ends.from.y, ends.to.x - ends.from.x) * 180) / Math.PI})"/>`
        : ''

    const body = `<path d="${d}" fill="${open ? 'none' : fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
    return `<g>${body}${head}${shapeWords(node, box, palette, canvasPath, plain)}</g>`
  }

  if (node.type === 'file' && isPicture(node.file)) {
    return `<image x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" preserveAspectRatio="xMidYMid slice" href="${escaped(fileUrl(node.file, root))}"/>`
  }

  const wash = node.color === undefined ? '' : ` fill-opacity="0.09"`
  const paper = node.color === undefined ? (palette.surface ?? '#fff') : line
  const card = `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="8" fill="${paper}"${wash} stroke="${line}"/>`

  if (plain) {
    return `<g>${card}${plainCard(saidBy(node), box, palette)}</g>`
  }

  return `<g>${card}<foreignObject x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}">${cardBody(node, canvasPath)}</foreignObject></g>`
}

/** What a card says, as words. */
function saidBy(node: CanvasNode): string {
  switch (node.type) {
    case 'text':
      return node.text
    case 'link':
      return `${hostOf(node.url)}\n${node.url}`
    case 'file':
      return node.file
    case 'group':
    case 'shape':
    case 'page':
      return ''
  }
}

function drawnEdges(canvas: Canvas, palette: Palette): string {
  const byId = new Map(canvas.nodes.map((node) => [node.id, node]))
  const out: string[] = []

  for (const edge of canvas.edges) {
    const from = byId.get(edge.fromNode)
    const to = byId.get(edge.toNode)
    if (!from || !to) continue

    const colour = colourOf(edge, palette, palette.muted ?? '#8a9099')
    const ends = edgeEnds(edge, boxOf(from), boxOf(to))
    const heads: string[] = []

    for (const head of [
      edge.fromEnd === 'arrow' ? arrowAt(ends.from, ends.fromSide) : null,
      edge.toEnd === 'none' ? null : arrowAt(ends.to, ends.toSide),
    ]) {
      if (head) {
        heads.push(
          `<path d="M 0 0 L -9 -4.5 L -9 4.5 Z" fill="${colour}" transform="translate(${head.x} ${head.y}) rotate(${head.angle})"/>`,
        )
      }
    }

    const middle = edge.label === undefined ? '' : edgeMiddle(ends)
    const label =
      typeof middle === 'string' || edge.label === undefined
        ? ''
        : `<text x="${middle.x}" y="${middle.y}" font-size="12" text-anchor="middle" dominant-baseline="middle" fill="${palette.text ?? '#111'}" paint-order="stroke" stroke="${palette.bg ?? '#fff'}" stroke-width="4" stroke-linejoin="round" class="label">${escaped(edge.label)}</text>`

    out.push(
      `<g><path d="${edgePath(ends)}" fill="none" stroke="${colour}" stroke-width="2" stroke-linecap="round"/>${heads.join('')}${label}</g>`,
    )
  }

  return out.join('')
}

/** The whole plane as one SVG, sized to what is on it.
 *
 *  Exported because a plane is also drawn inside the note that embeds it, where the
 *  same reasoning holds: there is one description of what a canvas looks like as a
 *  picture, and an embed that drew its own would be a second one to drift from.
 *  That reader asks for `plain`, and reading/drawn.ts says why. */
export function canvasSvg(
  canvas: Canvas,
  palette: Palette,
  canvasPath: string | null,
  root: string | null,
  plain = false,
): string {
  const box = bounds(canvas.nodes, canvas.ink.map(strokeBox)) ?? {
    x: 0,
    y: 0,
    width: 400,
    height: 300,
  }

  const x = Math.round(box.x - PADDING)
  const y = Math.round(box.y - PADDING)
  const width = Math.max(1, Math.round(box.width + 2 * PADDING))
  const height = Math.max(1, Math.round(box.height + 2 * PADDING))

  const nodes = canvas.nodes
    .map((node) => drawnNode(node, palette, canvasPath, root, plain))
    .join('')

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`,
    ` viewBox="${x} ${y} ${width} ${height}" width="${width}" height="${height}">`,
    `<style>${styles(palette)}</style>`,
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${palette.bg ?? '#fff'}"/>`,
    drawnEdges(canvas, palette),
    nodes,
    inkSvg(canvas.ink, palette),
    `</svg>`,
  ].join('')
}

/** How many device pixels a plane unit becomes in a PNG. Two, so the picture is
 *  crisp where it is going to be looked at, and no more, so a large plane is
 *  still an image somebody can send. */
const PNG_SCALE = 2
const PNG_MOST = 8000

/** The SVG rasterised by the browser itself. Nothing else can draw a
 *  `foreignObject`, and nothing else has the fonts. */
async function svgToPng(svg: string): Promise<Blob | null> {
  const size = /viewBox="(-?\d+) (-?\d+) (\d+) (\d+)"/.exec(svg)
  const width = Number(size?.[3] ?? 800)
  const height = Number(size?.[4] ?? 600)
  const scale = Math.min(PNG_SCALE, PNG_MOST / Math.max(width, height, 1))

  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))

  try {
    const image = new Image()
    image.decoding = 'sync'
    await new Promise<void>((resolve, reject) => {
      image.addEventListener('load', () => resolve(), { once: true })
      image.addEventListener('error', () => reject(new Error('the drawing could not be read')), {
        once: true,
      })
      image.src = url
    })

    const paper = document.createElement('canvas')
    paper.width = Math.max(1, Math.round(width * scale))
    paper.height = Math.max(1, Math.round(height * scale))

    const ctx = paper.getContext('2d')
    if (!ctx) return null

    ctx.drawImage(image, 0, 0, paper.width, paper.height)
    return await new Promise((resolve) => paper.toBlob(resolve, 'image/png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** What a canvas is called once it has left the app. */
function stem(name: string): string {
  return name.replace(/\.[^.]+$/, '') || 'Canvas'
}

export interface Drawing {
  canvas: Canvas
  palette: Palette
  path: string | null
  root: string | null
  name: string
}

/** The SVG, with every picture in it inlined so the file stands alone. */
async function readySvg(drawing: Drawing, plain = false): Promise<string> {
  const svg = canvasSvg(drawing.canvas, drawing.palette, drawing.path, drawing.root, plain)
  // `inlineImages` matches `<img src>`, which is what a card's markdown holds;
  // an `<image href>` is swapped the same way by asking for the same resolver.
  //
  // A picture on the plane is drawn there through `assetUrl`, so what the SVG
  // holds is an address rather than a path: `assetPath` is that journey back, and
  // it is the same one line on a desktop and in a browser.
  return inlineImages(
    svg.replace(/<image /g, '<img ').replace(/href="/g, 'src="'),
    (src) => assetPath(src) ?? src,
  )
    .then((inlined) => inlined.replace(/<img /g, '<image ').replace(/src="/g, 'href="'))
    .catch(() => svg)
}

export async function exportCanvasSvg(drawing: Drawing) {
  const svg = await readySvg(drawing)
  const file = `${stem(drawing.name)}.svg`

  if (!isDesktop) {
    download(file, { text: svg, mime: 'image/svg+xml' })
    return file
  }

  const target = await chooseTarget(drawing.name, 'svg', 'SVG')
  if (!target) return

  await invoke('write_note', { path: target, content: svg })
  return target
}

/** A PNG is handed over rather than written to a path of the reader's choosing:
 *  the app's own file commands write text, and a picture is bytes. The browser's
 *  own save is what every other binary download in the app uses too. */
export async function exportCanvasPng(drawing: Drawing) {
  const blob = await svgToPng(await readySvg(drawing, true)).catch(() => null)
  if (!blob) {
    message(new Error('that drawing could not be turned into a picture'), t('Nothing here'))
    return
  }

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${stem(drawing.name)}.png`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)

  return link.download
}

/** The plane on a page, through the same printer a note goes through. */
export async function exportCanvasPdf(drawing: Drawing) {
  const svg = await readySvg(drawing)
  const size = /viewBox="(-?\d+) (-?\d+) (\d+) (\d+)"/.exec(svg)
  const width = Number(size?.[3] ?? 800)
  const height = Number(size?.[4] ?? 600)

  // The paper is the drawing: a plane has no columns to break into pages, so it
  // goes on one sheet of its own size rather than being cut across A4.
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escaped(stem(drawing.name))}</title><style>@page{size:${width}px ${height}px;margin:0}html,body{margin:0;padding:0}svg{display:block}</style></head><body>${svg}</body></html>`

  const native = isDesktop && (await invoke<boolean>('pdf_supported').catch(() => false))
  const target = native ? await chooseTarget(drawing.name, 'pdf', 'PDF') : null

  if (target) {
    // The print dialog can still save the file, so nobody is left with nothing -
    // and the line says the road changed; see export/print.ts.
    const page = { width: width / 96, height: height / 96, margin: 0, landscape: false }
    if (await writtenPdf(html, target, page)) return target
  }

  await printInFrame(html)
}
