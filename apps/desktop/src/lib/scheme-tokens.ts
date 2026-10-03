/** What a scheme's tokens resolve to on this page, for the sums that need a colour the
 *  theme in force did not write down itself - the paper under a translucent theme is the
 *  app's own `--bg`, which neither glass.css nor wallpaper.css restates.
 *
 *  A hidden element wearing the scheme is asked, which is what the cascade answers for
 *  any part of the window in that scheme. Behind the doors of the themes that need it. */

import { type Rgb, rgbOf } from './legibility'

export type Scheme = 'dark' | 'light'

/** A colour a token holds that is not written plainly - a `color-mix` - resolved by
 *  asking the page to paint with it. */
function painted(said: string): Rgb | null {
  const probe = document.createElement('span')
  probe.style.color = said
  probe.hidden = true
  document.documentElement.append(probe)
  const resolved = rgbOf(getComputedStyle(probe).color)
  probe.remove()
  return resolved
}

/** Whether there is a page to ask: not in a test without one, nor a worker. */
function askable(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof document.documentElement.append === 'function' &&
    typeof getComputedStyle === 'function'
  )
}

/** Each named token as one scheme resolves it, or null where it says no colour - or
 *  where there is no page to ask, which the callers answer with tokens.css's. */
export function schemeTokens(scheme: Scheme, names: string[]): Record<string, Rgb | null> {
  if (!askable()) return Object.fromEntries(names.map((name) => [name, null]))
  const probe = document.createElement('span')
  probe.dataset.theme = scheme
  probe.hidden = true
  document.documentElement.append(probe)
  const style = getComputedStyle(probe)
  const found = Object.fromEntries(
    names.map((name) => {
      const said = style.getPropertyValue(name).trim()
      return [name, said ? (rgbOf(said) ?? painted(said)) : null]
    }),
  )
  probe.remove()
  return found
}

/** The paper each scheme falls back to where a page cannot be asked: tokens.css's. */
export const PAPER: Record<Scheme, Rgb> = { dark: [14, 16, 19], light: [251, 252, 253] }
