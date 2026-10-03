/** The wallpaper theme's sheet: wallpaper.css, and the reader's pictures and dials said
 *  after it. One sheet rather than a sheet and properties on the root, so the sheet the
 *  app keeps for the next launch's first frame (`SHEET_KEY` in theme.svelte.ts) is the
 *  pictures, their floors and the dials as well, and that frame needs nothing of this
 *  theme but what every theme with a door already has. */

import { wallpaperCss } from '@nib/themes/wallpaper'
import { theme } from '../theme.svelte'
import { valueOf } from '../themes/settings'
import { coloursOf, fieldFloors } from './colours'
import { type Held, heldDark, heldWallpaper, type Scheme, WALLPAPER_THEME } from './held'
import { type Dials, picturesRule, wallpaperRule } from './look'
import { dialsOf, wallpaperSettings } from './settings'

/** Each side's picture being shown while a dial moves faster than it is written down;
 *  undefined for what was written down. */
const shown: Record<Scheme, Held | null | undefined> = { light: undefined, dark: undefined }

export function showPicture(scheme: Scheme, held: Held | null | undefined): void {
  shown[scheme] = held
}

/** The dials as they stand: what is being tried, else what was kept, else where they
 *  start - read off the kept drawer too, for a launch whose settings door has not
 *  opened yet. */
function dials(): Dials {
  const values = Object.fromEntries(
    wallpaperSettings().map((one) => [
      one.id,
      valueOf(one, theme.values[one.id] ?? theme.keptFor(WALLPAPER_THEME, one.id)),
    ]),
  )
  return dialsOf(values)
}

export function wallpaperSheet(): string {
  const pictures = {
    light: shown.light === undefined ? heldWallpaper() : shown.light,
    dark: shown.dark === undefined ? heldDark() : shown.dark,
  }
  let rule: string
  try {
    rule = wallpaperRule(pictures, dials(), coloursOf(theme.accent), fieldFloors())
  } catch {
    rule = picturesRule(pictures)
  }
  return `${wallpaperCss}\n${rule}`
}
