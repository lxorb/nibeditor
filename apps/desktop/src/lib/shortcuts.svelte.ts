/** What the reader chose instead of the defaults, and what happens when a key
 *  is pressed.
 *
 *  Only the differences from the defaults are kept, here and on the account: a
 *  full dump would freeze today's defaults into every entry that ever saved
 *  one, and a default that changed later would never reach anybody. A preset is
 *  the same thing, written by somebody else; see shortcuts/presets.ts. */

import { defaultKeyFor, type EditorView, type KeyOverrides, setShortcutKeys } from '@nib/editor'
import { account } from './account.svelte'
import { api, type AccountSettings } from './api'
import { t } from './i18n.svelte'
import {
  currentPlatform,
  matchesCombination,
  parseCombination,
  sameCombination,
  showCombination,
} from './keys'
import { modes } from './modes.svelte'
import { knownPreset, type PresetId, presetById } from './shortcuts/presets'
import { without } from './records'
import {
  type AppContext,
  BROWSER_KEYS,
  BY_ID,
  FIXED_ENTRIES,
  SHORTCUTS,
  type Shortcut,
  SYSTEM_KEYS,
} from './shortcuts/registry'
import { isRecord, keep, stored, storedText } from './stored'
import { isNative } from './tauri'

export { CATEGORIES, type Category, SHORTCUTS, type Shortcut } from './shortcuts/registry'

const STORAGE_KEY = 'nib:shortcuts'
/** Beside the map rather than inside it, so an entry written before there were
 *  presets still reads as the map it is. */
const PRESET_KEY = 'nib:preset'

/** How many entries the account will carry, and how long a key may be. The
 *  same numbers the server enforces; see services/sync/src/settings.ts. */
const MOST_OVERRIDES = 200

class Shortcuts {
  /** Only what differs from the defaults, by id. A key, or null where the
   *  reader took the key away.
   *
   *  Ids this version knows nothing about are kept exactly as they came in.
   *  A newer version of the app may have bound something this one has never
   *  heard of, and dropping it here would be this machine quietly undoing
   *  that machine's choice the next time anything else changed. */
  overrides = $state<KeyOverrides>({})

  /** Whose keyboard this is. Custom the moment one key is rebound by hand. */
  preset = $state<PresetId>('default')

  readonly platform = currentPlatform()

  restore() {
    // A corrupt or missing entry reads as no overrides, which is the defaults.
    this.overrides = usable(stored(STORAGE_KEY))
    // An entry written before there were presets has no name for its map, and
    // a map with something in it is exactly what Custom means.
    this.preset =
      knownPreset(storedText(PRESET_KEY)) ??
      (Object.keys(this.overrides).length ? 'custom' : 'default')
  }

  /** Hands the whole keyboard over to a preset. Modal editing is part of what
   *  a preset says, so the Vim one turns it on and the others turn it off; the
   *  switch in the Editor pane is what puts it back on top of another map.
   *
   *  Takes a name rather than one of the four, because what arrives is what a
   *  select handed over; a name this version does not have changes nothing. */
  choose(id: string) {
    const preset = presetById(id)
    if (!preset) return

    this.preset = preset.id
    this.overrides = { ...preset.keys }
    this.settle()
    modes.setVimKeys(preset.vim)
  }

  /** The key an entry answers to, resolved for this platform: what the reader
   *  chose, or the default. Null where it is unbound. */
  keyFor(id: string): string | null {
    // Null is a choice here - the key taken away - so only a missing entry
    // falls through to the default.
    const chosen = this.overrides[id]
    if (chosen !== undefined) return chosen

    const entry = BY_ID.get(id)
    return entry ? defaultKeyFor(entry, this.platform) : null
  }

  /** What it started as, for the button that puts it back. */
  defaultFor(id: string): string | null {
    const entry = BY_ID.get(id)
    return entry ? defaultKeyFor(entry, this.platform) : null
  }

  changed(id: string): boolean {
    return id in this.overrides && this.overrides[id] !== this.defaultFor(id)
  }

  /** The key as a reader reads it, for a menu row or the palette. Undefined
   *  when there is none, so a caller can leave the hint off entirely. */
  hint(id: string): string | undefined {
    const key = this.keyFor(id)
    return key ? showCombination(key, this.platform) : undefined
  }

  /** The entries a combination would collide with.
   *
   *  Contextual bindings are left out on both sides: they look for a table or
   *  a picture where the caret is and give way when it is not there, which is
   *  how six of them already share the arrow keys with the editor's own
   *  motion. Everything else that would answer to the same keystroke is a
   *  real collision, app and editor alike - an app binding is read off the
   *  window and never reaches the editor, so the two cannot share a key. */
  conflicts(id: string, key: string): Shortcut[] {
    const entry = BY_ID.get(id)
    if (!key || entry?.contextual) return []

    return SHORTCUTS.filter((one) => {
      if (one.id === id || one.contextual || one.scope === 'fixed') return false

      const held = this.keyFor(one.id)
      return !!held && sameCombination(held, key, this.platform)
    })
  }

  /** A fixed key the combination would land on. Not resolvable - it says what
   *  will happen, and the reader decides. */
  fixedHolder(key: string): Shortcut | undefined {
    if (!key) return undefined

    return FIXED_ENTRIES.find((one) => {
      const held = defaultKeyFor(one, this.platform)
      return !!held && sameCombination(held, key, this.platform)
    })
  }

  /** Why a combination may never arrive. Null when nothing is known against
   *  it, which is not a promise that it works - only that nothing here says
   *  otherwise. */
  warning(key: string | null): string | null {
    if (!key) return null

    const taken = (list: string[]) => list.some((one) => sameCombination(one, key, this.platform))
    if (taken(SYSTEM_KEYS[this.platform]))
      return t('Your system takes this key before the app sees it.')
    if (!isNative && taken(BROWSER_KEYS))
      return t('Your browser takes this key before the app sees it.')

    return null
  }

  /** Whether a combination is one the app will accept at all. A bare letter
   *  or digit would fire on every keystroke that types it, so it is refused
   *  with the reason rather than saved and wondered about later. */
  refuse(key: string): string | null {
    const combination = parseCombination(key, this.platform)
    if (!combination) return t('That is not a key combination.')

    const bare = !combination.ctrl && !combination.meta && !combination.alt
    if (bare && combination.key.length === 1) return t('Hold Ctrl, Alt or Cmd as well.')

    return null
  }

  set(id: string, key: string | null) {
    if (Object.keys(this.overrides).length >= MOST_OVERRIDES && !(id in this.overrides)) return

    this.overrides = { ...this.overrides, [id]: key }
    this.preset = 'custom'
    this.settle()
  }

  reset(id: string) {
    this.overrides = without(this.overrides, id)
    this.preset = 'custom'
    this.settle()
  }

  /** Every key back where it started, which is the Default preset by another
   *  name. */
  resetAll() {
    this.choose('default')
  }

  /** Writes the choice down, tells the editor on screen, and tells the
   *  account. Everything that shows a key reads it from here, so the menus
   *  and the palette follow on their own. */
  private settle() {
    keep(STORAGE_KEY, JSON.stringify(this.overrides))
    keep(PRESET_KEY, this.preset)
    for (const view of this.views) setShortcutKeys(view, this.overrides)
    this.share()
  }

  /** Every editor on the page: one for each pane. The keys are the reader's
   *  rather than one pane's, so a rebind reaches all of them at once. */
  private readonly views = new Set<EditorView>()

  /** A view is built fresh for every note, and starts at the defaults. */
  apply(view: EditorView) {
    this.views.add(view)
    setShortcutKeys(view, this.overrides)
  }

  /** A view that has left the page. */
  forget(view: EditorView) {
    this.views.delete(view)
  }

  /** What the app hands the editor when it builds one, so the first keystroke
   *  after a note opens is already the reader's own. */
  get forEditor(): KeyOverrides {
    return this.overrides
  }

  /** Takes over the account's keys. Same rule as every other account setting:
   *  the last machine to change something wins, and this is a machine finding
   *  out what that was. Nothing is merged key by key - two machines editing
   *  the same account's shortcuts at once would otherwise end up with a set
   *  neither of them chose. */
  receive(remote: AccountSettings) {
    const theirs = remote.shortcuts
    // An account that has never been told anything about keys takes this
    // machine's, which is how a choice made before signing in follows the
    // account afterwards rather than being lost at the door.
    if (!theirs || typeof theirs !== 'object') {
      if (Object.keys(this.overrides).length || this.preset !== 'default') this.share()
      return
    }

    const usableOnes = usable(theirs)
    const named = knownPreset(remote.preset) ?? this.preset
    if (JSON.stringify(usableOnes) === JSON.stringify(this.overrides) && named === this.preset) {
      return
    }

    this.overrides = usableOnes
    this.preset = named
    keep(STORAGE_KEY, JSON.stringify(this.overrides))
    keep(PRESET_KEY, this.preset)
    for (const view of this.views) setShortcutKeys(view, this.overrides)
  }

  /** Tells the account, when there is one. Signed out, the choice is this
   *  machine's alone and is carried up whenever an account is signed into.
   *  The name travels with the map: two machines have to agree on which
   *  keyboard this is, not only on what is in it. */
  private share() {
    const token = account.accountToken
    if (!token) return

    void api
      .saveSettings(token, { shortcuts: this.overrides, preset: this.preset })
      .catch(() => undefined)
  }

  /** Whether a keystroke is the one an entry holds. What a panel with keys of
   *  its own asks, since those fire where the focus is rather than on the
   *  window. */
  pressed(id: string, event: KeyboardEvent): boolean {
    const key = this.keyFor(id)
    return !!key && matchesCombination(key, event, this.platform)
  }

  /** Runs whatever the keystroke is bound to at app level. True when it did,
   *  which is the caller's signal that the key is spent. */
  handle(event: KeyboardEvent, context: AppContext): boolean {
    // A press a surface has already answered is spent. This is the window's own
    // handler and the last one to run, so anything that stopped the default did it
    // on purpose: the plane takes Ctrl+0 to fit itself, and the same key resets the
    // text size, and only one of those is what somebody on a plane meant. The rule is
    // the one the wheel already follows - see `sizeStepFor` in text-size.ts - and it
    // is what makes a `contextual` binding work as the registry describes it: one that
    // found nothing to do stops nothing, so the app still gets the key.
    if (event.defaultPrevented) return false

    for (const entry of SHORTCUTS) {
      if (entry.scope !== 'app' || !entry.run) continue

      const key = this.keyFor(entry.id)
      if (!key || !matchesCombination(key, event, this.platform)) continue

      event.preventDefault()
      entry.run(context)
      return true
    }

    return false
  }
}

/** A stored map, cleaned of anything that is not a key or a taking-away. The
 *  server checks the same things, but a file on this machine never went
 *  through the server. */
function usable(value: unknown): KeyOverrides {
  if (!isRecord(value)) return {}

  const kept: KeyOverrides = {}
  for (const [id, key] of Object.entries(value)) {
    if (key === null) kept[id] = null
    else if (typeof key === 'string' && key.length <= 40 && key.length > 0) kept[id] = key

    if (Object.keys(kept).length >= MOST_OVERRIDES) break
  }

  return kept
}

export const shortcuts = new Shortcuts()
