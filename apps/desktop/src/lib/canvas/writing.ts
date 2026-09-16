/** The card being written in, and the one way to make it hand its words over now.
 *
 *  A card gives what was typed in it to the plane when the caret leaves, because
 *  every keystroke reaching the plane would be a serialised canvas per character -
 *  the same bargain the editor's table cells make. Everything that reads the plane
 *  in between reads a card that is still empty, and two of those readers matter:
 *  saving on purpose wrote a blank card over the file, and a window shut mid-word
 *  wrote the plane without the word in it and took it with it.
 *
 *  So this is the twin of `flushTableEdits` in @nib/editor, and for the same reason:
 *  whatever is about to read the document says so first. One card, because there is
 *  one caret; nothing at all when nobody is writing, so it is safe to say anywhere.
 *
 *  Its own module rather than a field on the canvas store: the card is a component
 *  and the store is a store, and the two things that have to say this - the plane's
 *  own parting write and the workspace's save - reach neither of them from the
 *  other. See CanvasNode.svelte, `part` in store.svelte.ts and `save` in
 *  workspace/saving.svelte.ts. */

/** What the card being written in does with its words. Null while no card is open. */
let handing: (() => void) | null = null

/** Said by a card as its editor is mounted, and again with null as it goes. */
export function cardWriting(commit: (() => void) | null): void {
  handing = commit
}

/** The card being written in, made to give the plane its words. */
export function flushCardEdits(): void {
  handing?.()
}
