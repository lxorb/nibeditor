import { LanguageDescription, type LanguageSupport } from '@codemirror/language'
import { CODE_PALETTES, type CodePalette, fenceLanguages } from '@nib/editor'
import { everySurface } from '@nib/themes/write'

export type Parser = LanguageSupport['language']['parser']

/** The groups, the classes and the colouring itself are @nib/markdown/highlight:
 *  the Worker that publishes a note colours a fence with the same list, and one
 *  list is what keeps a published page and the reading view the same page. What
 *  is left here is the app's own half - finding a parser among the hundred and
 *  forty-three the editor can load, and putting the reader's chosen palette on
 *  the screen. */
export { highlightCode } from '@nib/markdown/highlight'

/** A parser for each language named, loaded once. The list is the editor's
 *  own, so an exported document is coloured by whatever coloured it on screen:
 *  a fence may name a language, spell it the short way, or use its file
 *  extension. A language nothing is known about is simply absent, and its code
 *  stays plain. */
export async function loadParsers(names: Iterable<string>): Promise<Map<string, Parser>> {
  const parsers = new Map<string, Parser>()
  // The whole list, because this is the caller that wants all of it: a document on
  // its way out names whatever languages its fences name, and the export is already
  // a wait. See languages.ts, which fetches it once.
  const known = await fenceLanguages()

  await Promise.all(
    [...new Set(names)].map(async (name) => {
      const description =
        LanguageDescription.matchLanguageName(known, name, true) ??
        LanguageDescription.matchFilename(known, `code.${name}`)
      if (!description) return

      const support = await description.load().catch(() => null)
      if (support) parsers.set(name, support.language.parser)
    }),
  )

  return parsers
}

/** One rule per class, in the palette's colours. `var()` values resolve
 *  against the theme tokens the document carries. */
export function paletteCss(palette: CodePalette): string {
  const colours: [string, string][] = [
    ['keyword', palette.keyword],
    ['string', palette.string],
    ['number', palette.number],
    ['comment', palette.comment],
    ['function', palette.function],
    ['type', palette.type],
    ['punctuation', palette.punctuation],
    ['property', palette.property],
    ['invalid', 'var(--danger)'],
    // What a diff means, not what a palette makes of it - see code-theme.ts.
    ['inserted', 'var(--success)'],
    ['deleted', 'var(--danger)'],
  ]

  return colours.map(([name, colour]) => `#write .hl-${name} { color: ${colour}; }`).join('\n')
}

const PALETTE_ID = 'nib-code-palette'

/** Puts the chosen palette on the page, for everything the renderer draws
 *  inside `#write`: the reading view, a text card on a canvas, a slide on the
 *  stage. The classes are written by `highlightCode` above and mean nothing
 *  without them, so a fence came out in one colour wherever the app itself was
 *  showing it - an exported document has always carried the same rules in its
 *  own head, which is why it did not.
 *
 *  An id nothing recognises - a palette a later build added - falls back to the
 *  first, which is the one that follows the theme. */
export function paintCodePalette(id: string) {
  const palette = CODE_PALETTES.find((one) => one.id === id) ?? CODE_PALETTES.at(0)

  let sheet = document.getElementById(PALETTE_ID)
  if (!sheet) {
    sheet = document.createElement('style')
    sheet.id = PALETTE_ID
    // First in the head, so a theme file and a reader's own custom.css both
    // still have the last word on how code is coloured.
    document.head.prepend(sheet)
  }

  // On every page a note is on, which in the app is more than one; see write.ts.
  sheet.textContent = palette ? everySurface(paletteCss(palette)) : ''
}
