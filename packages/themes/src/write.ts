/** Every page a note is written or read on, as one selector.
 *
 *  `#write` is Typora's name for the page, and it is what every sheet in this package,
 *  every theme in the registry and every reader's own custom.css is written against. An
 *  id is one element, though, and a document is one page: an exported note and a
 *  published one have exactly one, and keep it. The app does not. Two panes side by
 *  side are two pages, a column of stacked notes is several, the card over a link is
 *  one more with an editor inside it, and the presenter's window shows this slide and
 *  the next - so `id="write"` was on the screen four and five times at once, which is
 *  a page that lies to `getElementById`, to a screen reader and to whatever asks the
 *  document for "the" note.
 *
 *  So in the app every page wears the class, and only the page in the focused pane
 *  wears the id as well (see Editor.svelte and Reading.svelte): the one a reader is
 *  in, which is what a drive, a shortcut and a theme mean by `#write`. The rules reach
 *  every page by being read, where the app puts them on the page, as
 *  `:is(#write, .nib-write)` - which has the specificity of the id whichever of the
 *  two it matched, so which rule wins is exactly what it was. The sheets themselves
 *  stay written in Typora's word, so a document written out of them is unchanged and
 *  a theme author writes what they have always written.
 *
 *  Said once, here; the app's build runs its stylesheets through it (vite.config.ts),
 *  and the sheets it puts on the page itself - a theme, custom.css, the code palette -
 *  go through it on the way in. */

const SURFACE_CLASS = 'nib-write'

const SURFACE = `:is(#write, .${SURFACE_CLASS})`

/** Every `#write` in a stylesheet or a selector, reaching every page. Twice is once:
 *  what it has already widened it leaves alone. */
export function everySurface(css: string): string {
  return css.replace(/:is\(#write, \.nib-write\)|#write(?![\w-])/g, (found) =>
    found === '#write' ? SURFACE : found,
  )
}
