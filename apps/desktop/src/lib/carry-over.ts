/** Puts an app's habits into nib's settings, through the same setters the Settings
 *  sheet uses, so each answer is saved and shared with the account exactly as if
 *  the reader had chosen it. What is decided, and why, is import/carry.ts. */

import type { Carried } from './import/carry'
import { modes } from './modes.svelte'
import { shortcuts } from './shortcuts.svelte'

export async function carryOver(carried: Carried) {
  // The keyboard first, because a preset says whether modal editing is on and
  // the vault's own answer about that is the one that should stand.
  if (carried.keys) {
    // The maps are the Settings sheet's and not the window's; see presets.ts. A
    // map somebody wrote by hand is theirs, and a vault does not replace it.
    const { presetById } = await import('./shortcuts/presets')
    const preset = presetById(carried.keys)
    if (preset && shortcuts.preset !== 'custom') shortcuts.choose(preset)
  }

  if (carried.vim !== undefined) modes.setVimKeys(carried.vim)
  if (carried.linkFormat) modes.setLinkFormat(carried.linkFormat)
  if (carried.attachments) modes.setAttachments(carried.attachments)
  if (carried.properties) modes.setProperties(carried.properties)
  if (carried.hardBreaks !== undefined && carried.hardBreaks !== modes.hardBreaks) {
    modes.toggleHardBreaks()
  }
  if (carried.quietMarks !== undefined && carried.quietMarks !== modes.quietMarks) {
    modes.toggleQuietMarks()
  }
}
