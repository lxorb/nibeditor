/** What a control's tooltip says: its name, and the key that does the same thing.
 *
 *  `Back (Alt+←)`, and `Back (⌃[)` on a Mac: VS Code's shape, a name with the key in
 *  brackets after it, which Edge and Firefox put on their own toolbars too. A button
 *  that says its key once is how a hand learns the keyboard, and after that the button
 *  is there for the times it is on the pointer instead.
 *
 *  The key is read off the registry as it stands, so a key rebound in Settings is the
 *  one the next hover shows, and a key taken away takes the brackets with it. A touch
 *  screen is shown the name alone: a key means nothing to a thumb.
 *
 *  The brackets are a catalogue row rather than written here, so a language that
 *  brackets differently can say so. */

import { t } from './i18n.svelte'
import { shortcuts } from './shortcuts.svelte'
import { viewport } from './viewport.svelte'

export function titled(label: string, id: string | null = null): string {
  const key = id !== null && !viewport.touch ? shortcuts.hint(id) : undefined
  return key ? t('{label} ({key})', { label, key }) : label
}
