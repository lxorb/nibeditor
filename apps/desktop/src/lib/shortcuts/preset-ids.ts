/** The names of the keyboards, without the keyboards.
 *
 *  What the first paint needs of the presets is a name: the one written down on this
 *  machine, or the one the account carries, read back and checked. The maps behind
 *  the names are wanted only by the Settings sheet, which is fetched when it is opened,
 *  so they live in presets.ts and are not in front of the window; see weight.test.ts.
 *  presets.test.ts holds the two lists to one another. */

/** In the order the select shows them. */
export const PRESET_IDS = ['default', 'notion', 'obsidian', 'vscode', 'vim'] as const

/** Custom is not chosen, it is arrived at: the map becomes it the moment one
 *  key is rebound by hand. */
export type PresetId = (typeof PRESET_IDS)[number] | 'custom'

/** What a name written down here or carried by the account means.
 *
 *  Nothing at all is no opinion, and the machine keeps what it had. A name
 *  this version has never heard of - a preset a newer app added - is a map
 *  this one cannot put a name to, which is what Custom is for. */
export function knownPreset(value: unknown): PresetId | null {
  if (typeof value !== 'string' || !value) return null
  if (value === 'custom' || (PRESET_IDS as readonly string[]).includes(value)) {
    return value as PresetId
  }

  return 'custom'
}
