import { LanguageDescription, type LanguageSupport } from '@codemirror/language'
import { door } from '@nib/markdown/door'

/** Every language a fence may name - and nothing of any of them until a fence does.
 *
 *  `@codemirror/language-data` brings 143 of them and each one imports itself the
 *  first time a fence asks for it, so no parser was ever in the startup bundle. The
 *  *list* was: a hundred and forty-three descriptions, the vocabulary over them and
 *  the modes beside them, evaluated before the window had drawn anything, for a
 *  reader who opens a note. Most notes hold no fence at all, and a note that holds
 *  one names one language.
 *
 *  So the list arrives with the first fence that names anything. `fenceLanguage`
 *  below is what `markdown()` is handed in its place: it answers for that fence
 *  with a description whose parser is still on its way, CodeMirror skips the region
 *  and parses it again when the parser lands, and the fence is plain text for as
 *  long as the fetch takes. That is not a new mechanism - it is the one path all 143
 *  languages already take, because each of them is fetched exactly that way.
 *
 *  What the list is short on is *spellings*: it knows a language by its name, and a
 *  fence is opened by whatever word came to hand. So the bulk of it is a vocabulary,
 *  and only then a language list. Adding a spelling to a language that is already
 *  there is one line in `SPELLINGS`, in language-spellings.ts; adding a language
 *  nobody has ported is one entry in `ADDED`, in language-modes.ts. This file is only
 *  the order they go in, and the door they come through. */

/** The list once it is here. Read rather than awaited by `fenceLanguage`, so every
 *  fence after the first is answered in the parse that asked. */
let here: readonly LanguageDescription[] | null = null

/** The whole list, fetched once.
 *
 *  Kept, so a note of twenty fences is one list, unless it failed; see door.ts in
 *  @nib/markdown.
 *
 *  Exported for the two callers that want all of it rather than one language: the
 *  export, which colours a document with whatever coloured it on screen, and the
 *  tests that hold the vocabulary and the list to each other. */
export const fenceLanguages: () => Promise<readonly LanguageDescription[]> = door(() =>
  Promise.all([
    import('./language-spellings'),
    import('./language-modes'),
    import('./mermaid'),
  ]).then(([spellings, modes, mermaid]) => {
    here = [
      // Plain text first, so the near-match rule sends anything else ending in
      // -text here rather than to LaTeX; see language-modes.ts.
      modes.plainTextDescription,
      ...spellings.spelled,
      ...modes.ADDED,
      // Mermaid's parser lives beside the code that draws the diagram.
      mermaid.mermaidDescription,
    ]

    return here
  }),
)

/** Which language a fence's info word names, as far as this device knows yet.
 *
 *  Once the list is here this is the lookup it always was: a language's name, its
 *  aliases, and a near match among them, which is what `markdown()` does with a list
 *  of its own. Before that it is a description of its own, named after the word and
 *  loading whatever the word turns out to mean.
 *
 *  `markdown()` strips a fence's info string at the first space before it asks, so
 *  the word arriving here is the whole of what the fence named. */
export function fenceLanguage(info: string): LanguageDescription | null {
  if (here) return LanguageDescription.matchLanguageName(here, info, true)

  return LanguageDescription.of({ name: info, load: () => meant(info) })
}

/** What one info word turns out to mean, once the list has landed. A word nothing
 *  answers to is plain text, which is what the lookup above gives it too - by
 *  returning nothing at all, which leaves CodeMirror to colour the fence as it
 *  already had. */
async function meant(info: string): Promise<LanguageSupport> {
  const [known, modes] = await Promise.all([fenceLanguages(), import('./language-modes')])
  const found = LanguageDescription.matchLanguageName(known, info, true)
  if (!found) return modes.plainTextDescription.load()

  return found.support ?? found.load()
}
