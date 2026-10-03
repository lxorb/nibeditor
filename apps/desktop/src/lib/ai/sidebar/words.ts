/** The words the panel's two choices are said in: each mode, each level of effort.
 *  Keys of the catalogues, translated where they are drawn. */

import { key } from '../../i18n.svelte'
import type { Effort, Mode } from '../chat/types'

const EFFORTS: Record<Effort, string> = {
  auto: key('Auto'),
  off: key('Off'),
  minimal: key('Minimal'),
  low: key('Low'),
  medium: key('Medium'),
  high: key('High'),
  xhigh: key('Extra'),
  max: key('Max'),
}

const MODES: Record<Mode, string> = {
  ask: key('Ask'),
  plan: key('Plan'),
  agent: key('Agent'),
}

export function effortWord(effort: Effort): string {
  return EFFORTS[effort]
}

export function modeWord(mode: Mode): string {
  return MODES[mode]
}
