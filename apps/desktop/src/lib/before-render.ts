/** What a render has to have in hand before it can be one synchronous pass.
 *
 *  Rendering a note is one pass down it that returns a string, and three of the
 *  things it needs cannot be got in the middle of one: a diagram has to be drawn, a
 *  fence's grammar has to be fetched, and an embedded note has to be read off the
 *  disk. Each is awaited here, and what comes back answers those questions without
 *  waiting. Every surface that shows a whole note calls these first - the reading
 *  view, the slides, and the exporter.
 *
 *  Its own module rather than part of export.ts, where both of these used to live,
 *  because the reading view and the slides are not exports and were paying for one:
 *  reaching them through `import('../export')` pulled the exporter's whole closure
 *  into the first switch to the reading view, half a megabyte of it, and a hundred
 *  and forty kilobytes of that was the print stylesheets as JavaScript strings for a
 *  surface that has a stylesheet of its own. See before-render.weight.test.ts, which
 *  is what keeps the two apart. */

import { DIAGRAM_LANGUAGES, RENDERED_LANGUAGES } from '@nib/editor'
import { codeBlocks, findLinks, type Wikilink } from '@nib/markdown'
import { loadFor } from '@nib/markdown/engines'
import { highlightedFence } from '@nib/markdown/highlight'
import { escapeAll } from '@nib/markdown/html'
import { embedKind } from '@nib/markdown/links'
import { drawDiagram } from './diagrams'
import { loadParsers, type Parser } from './highlight'
import type { Scheme } from './theme.svelte'

/** A fence already drawn or coloured: the HTML for the whole block, or null
 *  to leave it as plain code. */
export type Fence = (code: string, language: string) => string | null

/** The notes a document embeds, read before it is rendered. A note that cannot
 *  be read is left out, and the embed then renders as a link, which is what an
 *  embed of a note the space has not got does anyway. */
export async function prepareEmbeds(
  source: string,
  read: (target: string) => Promise<string | null>,
): Promise<(link: Wikilink) => string | null> {
  const wanted = new Set(
    findLinks(source)
      // A file is not read: the renderer draws a picture, a player or a card
      // from the name alone, and reading a film as text would be a waste of a
      // disk. See `media` and `card` in the renderer.
      .filter(
        (link) =>
          link.embed && link.kind === 'wikilink' && link.target && embedKind(link.target) === null,
      )
      .map((link) => link.target),
  )

  const bodies = new Map<string, string>()
  await Promise.all(
    [...wanted].map(async (target) => {
      const body = await read(target).catch(() => null)
      if (body !== null) bodies.set(target, body)
    }),
  )

  return (link) => bodies.get(link.target) ?? null
}

export type Drawer = (code: string, language: string, scheme: Scheme) => Promise<string>

/** Draws every diagram and loads a parser for every language the note uses,
 *  so rendering can then picture and colour each fence without waiting. A
 *  diagram that will not draw stays as code, which beats an empty space.
 *
 *  The formula engine and the emoji table are waited for here as well, where the
 *  note turns out to want either. They are not fences, but they are the same
 *  bargain - heavy, loaded on demand, and needed by a render that cannot wait -
 *  and every surface that renders a whole note already awaits this one call. See
 *  @nib/markdown/engines. */
/** The fences the space answers: a search, and the Tasks plugin's query block. */
const ANSWERED = new Set(['query', 'tasks'])

export async function prepareFences(
  source: string,
  scheme: Scheme,
  options: {
    highlight?: boolean
    /** What a ` ```query ` fence answers with, where anything can answer. Absent
     *  for an export and for a published page, which have no space to search, and
     *  where such a fence stays the code it is; see query-block.ts. */
    query?: ((code: string, language: string) => Promise<string | null>) | undefined
    /** Whether a ` ```base ` fence is left as a box the app draws its view into, as
     *  the reading view does; everywhere else it stays the code it is. See
     *  views/mount.ts. */
    base?: boolean
  } = {},
  draw: Drawer = drawDiagram,
): Promise<Fence> {
  const blocks = codeBlocks(source)
  const diagrams = new Map<string, string>()
  const answers = new Map<string, string>()
  const languages = new Set<string>()

  const drawings = blocks
    .filter((block) => DIAGRAM_LANGUAGES.has(block.language))
    .map(async (block) => {
      const svg = await draw(block.code, block.language, scheme).catch(() => null)
      if (svg) diagrams.set(`${block.language}\n${block.code}`, svg)
    })

  // A query fence is answered before the render, for the reason the diagrams are:
  // rendering is one synchronous pass and searching a space is a round trip.
  const asking = options.query
  const answering = asking
    ? blocks
        .filter((block) => ANSWERED.has(block.language))
        .map(async (block) => {
          const html = await asking(block.code, block.language).catch(() => null)
          if (html)
            answers.set(
              `${block.language}
${block.code}`,
              html,
            )
        })
    : []

  for (const block of blocks) {
    // A fence the renderer draws is not a fence anybody colours; see
    // `RENDERED_LANGUAGES`. Loading a parser for `chart` would be loading one
    // for a language nobody has a grammar for.
    if (block.language && !RENDERED_LANGUAGES.has(block.language)) languages.add(block.language)
  }

  const [parsers] = await Promise.all([
    options.highlight === false ? new Map<string, Parser>() : loadParsers(languages),
    loadFor(source),
    ...drawings,
    ...answering,
  ])

  return (code, language) => {
    if (language === 'base' && options.base) {
      // The words go with the box, which is all the view needs; until it is drawn the
      // box holds them as the code they are.
      const words = escapeAll(code)
      return `<figure class="base-fence" data-base-code="${words}"><pre><code>${words}</code></pre></figure>\n`
    }

    if (ANSWERED.has(language)) {
      const rows = answers.get(`${language}
${code}`)
      return rows === undefined ? null : `<figure class="query">${rows}</figure>\n`
    }

    if (DIAGRAM_LANGUAGES.has(language)) {
      const svg = diagrams.get(`${language}\n${code}`)
      return svg ? `<figure class="diagram" data-language="${language}">${svg}</figure>\n` : null
    }

    const parser = parsers.get(language)
    if (!parser) return null

    return highlightedFence(code, language, parser)
  }
}
