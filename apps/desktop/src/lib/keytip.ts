/** How a KeyTip comes and goes: the number a tab wears while Alt is held, and a space's
 *  in a list of spaces. Its look is `.nib-keytip` in the themes package.
 *
 *  In over `--dur-instant`, from part of the way there rather than from nothing: a fade
 *  from nothing spends its first frame or two on a badge no eye can see yet, and Emil
 *  felt the numbers as late (2026-10-01). The first frame they are in is one they show
 *  in. */

import type { TransitionConfig } from 'svelte/transition'
import { fade } from 'svelte/transition'
import { dur } from './motion'

export function keytipIn(_: Element): TransitionConfig {
  return { duration: dur(70), css: (t) => `opacity: ${0.5 + 0.5 * t}` }
}

export function keytipOut(node: Element): TransitionConfig {
  return fade(node, { duration: dur(70) })
}
