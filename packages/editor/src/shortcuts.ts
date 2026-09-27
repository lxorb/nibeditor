import { Compartment, Facet, type Extension, type StateEffect } from '@codemirror/state'
import { type EditorView, keymap, type KeyBinding } from '@codemirror/view'

/** Bindings the editor knows by name.
 *
 *  A CodeMirror `KeyBinding` is a key and a command and nothing else, which is
 *  enough to make a key work and not enough to let anyone change it: there is
 *  no way to say "this is the bold one" from outside. So every binding this
 *  package installs is declared as a spec with a stable id first, and the
 *  KeyBinding is built from it. The id is what the app hangs a label, a
 *  category and the reader's own choice of key on; see
 *  apps/desktop/src/lib/shortcuts.svelte.ts, which holds the other half of
 *  every entry here and has a test that neither half can grow without the
 *  other. */
export interface BindingSpec {
  /** Stable, and never reused for something else: it is what a saved choice
   *  of key is filed under, on this machine and on the account. */
  id: string
  /** The default, in CodeMirror's own notation. Null means the platform this
   *  entry names has no default for it. */
  key: string | null
  mac?: string | null
  win?: string | null
  linux?: string | null
  /** Required, and never undefined: a spec is a command with a name, and one
   *  without a command would go into the keymap as a key that swallows the
   *  keystroke and does nothing. */
  run: NonNullable<KeyBinding['run']>
  /** The same key with Shift held, where CodeMirror's own binding paired the
   *  two - Find next and Find previous are one binding to it. */
  shift?: NonNullable<KeyBinding['shift']>
  scope?: string
  preventDefault?: boolean
  /** A binding that gives way: it looks for something around the caret - a
   *  table in the way, a selected picture - and returns false when it is not
   *  there, so the key goes on to whatever is bound under it. Two of these
   *  can hold the same key without either being in the other's way, which is
   *  why the conflict check leaves them alone. */
  contextual?: boolean
  /** A second key for a command that already has one. It carries the same
   *  label in the list, marked as the second key, so an alias is rebindable
   *  like everything else rather than being an unlisted key that fires. */
  alias?: boolean
}

/** What the reader chose, as differences from the defaults: a key by id, or
 *  null where they took the key away. An id that is not in here is at its
 *  default, which is the whole point - a default that changes in a later
 *  version reaches everyone who never touched that entry. */
export type KeyOverrides = Record<string, string | null>

/** The overrides, as something the editor state can be asked for.
 *
 *  A facet rather than a plain variable, because the keymaps built from it are
 *  `keymap.compute`d against it: change the facet and every keymap that reads
 *  it is rebuilt, including the one live preview installs for pictures, which
 *  is inside a compartment this module never sees. */
const shortcutKeys = Facet.define<KeyOverrides, KeyOverrides>({
  combine: (values) => values[0] ?? {},
})

const chosen = new Compartment()

/** The overrides a new editor starts with. */
export function shortcutExtensions(overrides: KeyOverrides = {}): Extension {
  return chosen.of(shortcutKeys.of(overrides))
}

/** The keys as an effect, so a pane taking another note on can put them in the
 *  same transaction as everything else it changes. */
export function shortcutEffect(overrides: KeyOverrides): StateEffect<unknown> {
  return chosen.reconfigure(shortcutKeys.of(overrides))
}

/** Puts a new set of keys in force, without rebuilding the editor. */
export function setShortcutKeys(view: EditorView, overrides: KeyOverrides) {
  view.dispatch({ effects: shortcutEffect(overrides) })
}

/** The default key for a spec on one platform, in CodeMirror's notation.
 *  Takes only the four fields it reads, so the app can ask this about its own
 *  entries, which carry the same four and a command it runs itself. */
export function defaultKeyFor(
  spec: Pick<BindingSpec, 'key' | 'mac' | 'win' | 'linux'>,
  platform: 'mac' | 'win' | 'linux',
): string | null {
  const own = platform === 'mac' ? spec.mac : platform === 'win' ? spec.win : spec.linux
  return own === undefined ? spec.key : own
}

const PLATFORMS = ['mac', 'win', 'linux'] as const

/** Specs as CodeMirror bindings, with the reader's keys where they gave one.
 *
 *  A spec whose key was taken away is left out rather than bound to nothing:
 *  an entry with no key at all is what CodeMirror reads as "any key", and the
 *  command would then run on every keystroke. */
export function bindings(specs: BindingSpec[], overrides: KeyOverrides): KeyBinding[] {
  const built: KeyBinding[] = []

  for (const spec of specs) {
    // A key of null is the reader taking the key away; an id that is not in
    // the overrides at all is the default. `in` is what tells those apart,
    // since the lookup answers undefined either way.
    const chosen = spec.id in overrides ? (overrides[spec.id] ?? null) : undefined
    if (chosen === null) continue

    const binding: KeyBinding = { run: spec.run }
    if (spec.shift) binding.shift = spec.shift
    if (spec.scope) binding.scope = spec.scope
    if (spec.preventDefault) binding.preventDefault = true

    if (chosen === undefined) {
      // The platform fields only mean something beside a `key`, so a spec
      // that is unbound by default on this platform is left out here too. And
      // CodeMirror reads an empty platform field as "use `key`", so a spec with
      // no key on one platform spells the key out for each of the others.
      const split = PLATFORMS.some((platform) => spec[platform] === null)
      if (spec.key !== null && !split) binding.key = spec.key
      for (const platform of PLATFORMS) {
        const key = split ? defaultKeyFor(spec, platform) : spec[platform]
        if (key) binding[platform] = key
      }
      if (!binding.key && !binding.mac && !binding.win && !binding.linux) continue
    } else {
      binding.key = chosen
    }

    built.push(binding)
  }

  return built
}

/** A keymap that rebuilds itself whenever the keys in force change. */
export function boundKeymap(specs: BindingSpec[]): Extension {
  return keymap.compute([shortcutKeys], (state) => bindings(specs, state.facet(shortcutKeys)))
}
