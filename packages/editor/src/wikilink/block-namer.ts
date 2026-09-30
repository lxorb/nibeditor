import { Facet } from '@codemirror/state'

/** Gives a block of another note a name and returns it, so a link can point at
 *  the block rather than at the note. Supplied by the app, which owns the file;
 *  on its own the editor offers only the blocks that are already named.
 *
 *  A module of its own because every editor is built with it and only the `[[`
 *  popup reads it: the popup arrives with the completion library, after the first
 *  paint (see completion.ts), and a facet declared beside it would bring the whole
 *  popup along in front of that paint for the sake of one definition. */
export const blockNamer = Facet.define<
  (path: string, line: number) => Promise<string | null>,
  (path: string, line: number) => Promise<string | null>
>({ combine: (values) => values[0] ?? (() => Promise.resolve(null)) })
