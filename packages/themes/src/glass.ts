import glass from './glass.css?raw'

/** The glass theme, as text: a palette that is mostly a wash, three settings of its
 *  own, and the handful of rules that give what floats its blur. The app injects it
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
