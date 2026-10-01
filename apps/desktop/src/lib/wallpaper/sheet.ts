/** The wallpaper theme's sheet: wallpaper.css, and the reader's picture said after
 *  it. One sheet rather than a sheet and properties on the root, so the sheet the app
 *  keeps for the next launch's first frame (`SHEET_KEY` in theme.svelte.ts) is the
 *  picture as well, and that frame needs nothing of this theme but what every theme
 *  with a door already has. */

import { wallpaperCss } from '@nib/themes/wallpaper'
import { type Held, heldWallpaper, pictureRule } from './held'

/** The picture being shown, while the Blur dial moves faster than it is written down;
 *  undefined for what was written down. */
let shown: Held | null | undefined

export function showPicture(held: Held | null | undefined): void {
  shown = held
}

export function wallpaperSheet(): string {
  const held = shown === undefined ? heldWallpaper() : shown
  return held ? `${wallpaperCss}\n${pictureRule(held)}` : wallpaperCss
}
