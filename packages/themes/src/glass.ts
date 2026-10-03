import glass from './glass.css?raw'

/** The glass theme, as text: a palette that is mostly a wash over the platform's
 *  material, and the rules that let the paper under a note be seen through. Its dials
 *  are said in code, in glass/settings.ts in the app. The app injects it
 *  the way it injects a theme read from a file, so a built-in theme and an installed
 *  one are applied by one road. See glass.css, and theme.svelte.ts.
 *
 *  A door of its own, like contrast.ts beside it, and for the opposite reason. That
 *  sheet is in front of every launch on purpose: the launch that needs more contrast
 *  most is a first launch with no network. This one is behind a dynamic import, so
 *  its bytes arrive on the frame after the theme is chosen and never at all for the
 *  window that never chooses it - `assets` in apps/desktop/test/weight.test.ts holds
 *  the shell to quoting exactly one stylesheet, and this is not it.
 *
 *  Imported rather than fetched all the same: it is a module of the app's own bundle,
 *  so choosing it works offline like everything else. */
export const glassCss = glass
