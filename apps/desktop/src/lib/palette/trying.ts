/** A theme, a mode or an accent tried on while the palette's arrows are on its row, the
 *  way the theme picker tries one under the pointer (see theme-picker/picking.svelte.ts):
 *  the whole app wears it at once, nothing is written down, and moving off the row or
 *  closing the palette puts back what was kept. Enter keeps it, through the row's own
 *  command, which is the call Settings makes.
 *
 *  Pure: which look a row is. What wears it is the palette. */

import type { SchemeChoice } from '../theme.svelte'
import type { Row } from './rows'

/** A whole look, as the three choices it is made of. */
export interface Look {
  id: string
  scheme: SchemeChoice
  accent: string
}

const SCHEMES: readonly string[] = ['light', 'dark', 'system']

const isScheme = (value: string): value is SchemeChoice => SCHEMES.includes(value)

/** The look a row would put on the app over `kept`, or null for a row that is not one
 *  - or one that cannot be shown, such as a mode the theme in force does not have. */
export function lookOf(row: Row | undefined, kept: Look): Look | null {
  if (row?.kind !== 'command' || row.command.disabled) return null

  const id = row.command.id
  const at = id.indexOf(':')
  const [part, value] = [id.slice(0, at), id.slice(at + 1)]
  if (at < 0) return null
  if (part === 'theme') return { ...kept, id: value }
  if (part === 'accent') return { ...kept, accent: value }
  if (part === 'scheme' && isScheme(value)) return { ...kept, scheme: value }

  return null
}
