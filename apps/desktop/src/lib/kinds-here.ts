/** Which kinds of tab this device can make, and which of them are offered once a reader
 *  has turned some off.
 *
 *  Emil, 2026-10-12: *"a settings subpage where you can enable / disable different note
 *  types [...] if they're disabled they won't be shown e.g. in the Ctrl + T menu BUT when
 *  they exist already they are ofc still fully usable"*. So turning one off is about
 *  making alone: every place that offers to make a kind asks here, and nothing that
 *  opens, edits, links, syncs or exports a file does. That is the opposite of
 *  Obsidian's core plugins, where a vault with Canvas turned off can no longer open the
 *  canvases it has.
 *
 *  Light on purpose. The file list, the palette, the shortcuts and the tab strip ask
 *  this on the way to the first paint, and the rows themselves - with the terminal's
 *  shells behind them - are fetched with the first chooser; see new-kinds.ts. The
 *  choice is hidden-kinds.svelte.ts; what is here is pure but for `kindsHere`, which
 *  reads the device. */

import { account } from './account.svelte'
import { t } from './i18n.svelte'
import { isString } from './stored'
import { isDesktop } from './tauri'
import { viewport } from './viewport.svelte'

/** Every kind there is, in the order a reader is offered them: what is written, what
 *  runs, and the web. See `newKinds`. */
const KIND_NAMES = [
  'note',
  'canvas',
  'pages',
  'chat',
  'terminal',
  'remote',
  'online',
  'web',
  'private',
] as const

export type KindName = (typeof KIND_NAMES)[number]

/** What a press that makes one says: the chooser's card, the palette's row, the file
 *  list's. Said once, so no two of them can call one kind two things. */
export function kindLabel(kind: KindName): string {
  return {
    note: () => t('New note'),
    canvas: () => t('New canvas'),
    pages: () => t('New page note'),
    chat: () => t('New chat'),
    terminal: () => t('New terminal'),
    remote: () => t('Remote'),
    online: () => t('Online terminal'),
    web: () => t('New web note'),
    private: () => t('New private tab'),
  }[kind]()
}

/** What the kind is called where it is not being made: its row in Settings › Note
 *  types. */
export function kindName(kind: KindName): string {
  return {
    note: () => t('Note'),
    canvas: () => t('Canvas'),
    pages: () => t('Page note'),
    chat: () => t('Chat'),
    terminal: () => t('Terminal'),
    remote: () => t('Remote'),
    online: () => t('Online terminal'),
    web: () => t('Web note'),
    private: () => t('Private tab'),
  }[kind]()
}

/** The kinds this device can make at all, before anybody turned any off.
 *
 *  A chat is made by the account, so only with one. A shell is a desktop's alone: a
 *  phone has none to give an app and a page in a browser has no machine under it. An
 *  online terminal is on every device, since it is the one a phone can have. A website
 *  is a bookmark on a phone - it opens in the phone's own browser, with no tab to make -
 *  and a private tab is a desktop's, where a web tab is a page of the app's. The
 *  glasses' plugin has the things that are written and nothing else. */
export function kindsHere(): KindName[] {
  if (__EVEN_PLUGIN__) return ['note', 'canvas', 'pages']

  const web = viewport.device !== 'phone'
  return KIND_NAMES.filter((kind) => {
    if (kind === 'chat') return !!account.accountToken
    if (kind === 'terminal' || kind === 'remote') return isDesktop
    if (kind === 'web') return web
    if (kind === 'private') return web && isDesktop
    return true
  })
}

/** The kinds offered, out of the ones `here`: every one not turned off. With every one
 *  of them turned off - on another device, which had a kind this one has not - the
 *  first stays, so there is always something to make. */
export function shownOf(here: readonly KindName[], hidden: readonly string[]): KindName[] {
  const shown = here.filter((kind) => !hidden.includes(kind))
  return shown.length ? shown : here.slice(0, 1)
}

/** Whether a kind may be turned off now: it is offered, and it is not the last one
 *  that is. */
export function mayHide(kind: KindName, here: readonly KindName[], hidden: readonly string[]) {
  const shown = shownOf(here, hidden)
  return shown.includes(kind) && shown.length > 1
}

/** How many kinds a reader may turn off, and how a kind is spelled. The same numbers
 *  the account holds itself to; see services/sync/src/settings.ts. */
const MOST_KINDS = 32
const KIND = /^[a-z][a-z-]{0,23}$/

/** A stored or received list, cleaned: words that could be kinds, nothing twice. A
 *  word this version has never heard of is kept, so a kind a newer build turned off
 *  stays off when this one writes the list back. */
export function hiddenOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const out: string[] = []
  for (const one of value) {
    if (!isString(one) || !KIND.test(one) || out.includes(one)) continue
    out.push(one)
    if (out.length >= MOST_KINDS) break
  }
  return out
}
