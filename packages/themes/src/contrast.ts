import contrast from './contrast.css?raw'

/** The high contrast theme, as text: a whole palette of its own on both sides,
 *  stated in the tokens any other theme states. The app injects it the way it
 *  injects a theme read from a file, so a built-in theme and an installed one are
 *  applied by one road. See contrast.css, and theme.svelte.ts.
 *
 *  A door of its own, and a small one, because the shell reads this sheet at every
 *  launch. `raw.ts` beside it holds every sheet the app can write out, and a module
 *  is the unit a bundler puts in a chunk: one export of that file taken eagerly is
 *  all of them - a hundred and twenty-six kilobytes of CSS as JavaScript, fetched,
 *  parsed and run before a window is on screen, for the three kilobytes here.
 *  Nothing else in this package is wanted before the first paint, and nothing else
 *  is in this file. See `assets` in test/weight.test.ts, which holds it to that.
 *
 *  Imported rather than fetched when the theme is chosen, deliberately: the palette
 *  has to be there on the frame it is chosen on, and on a first launch with no
 *  network at all. */
export const contrastCss = contrast
