/** Glass following what is open: which colour is in front, worked out and worn.
 *
 *  Behind a door glass alone opens (see chrome.svelte.ts). One effect reads what is in
 *  front - the tab, its page's ground or mark, a note's cover or icon colour, the accent
 *  - with the scheme and the material, and hands chrome.svelte.ts the answer. It runs
 *  when one of those changes: a tab switch, a page landing, a scheme or a material
 *  changing. Never on a frame, and nothing it reads moves on one.
 *
 *  A page's ground is read when the page lands or moves (`landed`), a quarter of a second
 *  after the last such news, and kept per address so a tab opened again is its colour at
 *  once (grounds.ts). */

import { glassCss } from '@nib/themes/glass'
import { untrack } from 'svelte'
import { accentColour } from '../accents'
import { chosenTint } from '../chosen-icon'
import { hexOf, type Rgb, rgbOf } from '../legibility'
import { links } from '../link-index.svelte'
import { isDesktop } from '../tauri'
import { theme } from '../theme.svelte'
import { paletteOf } from '../wallpaper/floors'
import { pages, siteMark } from '../web-tab/pages.svelte'
import { workspace } from '../workspace.svelte'
import { chrome, type Ground } from './chrome.svelte'
import { dominant } from './colours'
import { grounds } from './grounds.svelte'
import { pixelsOf } from './pictures'
import { groundOf } from './reading'
import { alphaFor, layered, linkOf, type PaperInks } from '../content-ground'
import { ACCENT_SWATCH, contentOf } from '../translucent-settings'
import { PAPER, schemeTokens } from '../scheme-tokens'
import { dialsOf, glassValues } from './settings'
import { barFor, frameFor, type Material, type Sides, type Source } from './tint'

/** How long after a page's last news it is read: a page lands, then names itself, then
 *  shows its mark, all in the same breath. */
const SETTLES = 250

/** A mark is counted at this size: a favicon's own, and plenty for a cover's colour. */
const MARK = { width: 24, height: 24 }

/** Glass's two sides, read out of its sheet once. */
const SIDES: Sides | null = (() => {
  const names = { scrim: '--glass-chrome', layer: '--glass-layer' }
  const dark = paletteOf(glassCss, 'dark', names)
  const light = paletteOf(glassCss, 'light', names)
  return dark && light ? { dark, light } : null
})()

/** The colour of each mark asked about, by its address; null for one that has none. */
const marks = $state<Record<string, string | null>>({})
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping nothing draws
const asking = new Set<string>()

/** A mark's colour, asked for the first time it is wanted and read when it arrives. */
function markColour(src: string | null): Rgb | null {
  if (!src) return null
  const said = marks[src]
  if (said !== undefined) return said === null ? null : rgbOf(said)
  if (!asking.has(src)) {
    asking.add(src)
    void pixelsOf(src, MARK).then((pixels) => {
      const colour = pixels ? dominant(pixels) : null
      marks[src] = colour ? hexOf(colour) : null
    })
  }
  return null
}

/** Moved to look for a cover again, while the editor has not drawn it yet. */
let looked = $state(0)
/** How many frames a cover is looked for before the note is taken to have none drawn. */
const LOOKS = 30
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping nothing draws
const looks = new Map<string, number>()

/** The cover of the note in a pane, as the editor drew it: the picture the window
 *  already has, so nothing is fetched or resolved twice. A note just opened has not
 *  drawn it yet, so it is looked for again on the next frames, a few times. */
function coverIn(pane: string, path: string): string | null {
  // Read, so the effect asking runs again on the frame that looks once more.
  if (looked < 0) return null
  const drawn = document.querySelectorAll<HTMLImageElement>(
    `[data-pane="${CSS.escape(pane)}"] .nib-cover img`,
  )
  for (const one of drawn) if (one.offsetParent !== null && one.currentSrc) return one.currentSrc

  const tries = looks.get(path) ?? 0
  if (tries < LOOKS) {
    looks.set(path, tries + 1)
    requestAnimationFrame(() => looked++)
  }
  return null
}

/** What the window stands on behind the frame. */
function materialOf(said: string | null): Material {
  return said === 'mica' || said === 'acrylic' || said === 'clear' ? said : null
}

/** The paper the window is painted with where nothing is behind it. */
function paper(): Rgb {
  const said = getComputedStyle(document.documentElement).getPropertyValue('--bg')
  return rgbOf(said) ?? (chrome.app === 'dark' ? [14, 16, 19] : [251, 252, 253])
}

/** A tab's address, for its ground kept by address and its mark. Asked without making
 *  a page for a tab that has none open. */
function addressOf(tab: string, written: string | undefined): string | null {
  return pages.addressOf(tab) ?? written ?? null
}

/** Each tab's read, waiting for its page to settle. */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping nothing draws
const waiting = new Map<string, ReturnType<typeof setTimeout>>()
/** Which tab and address the effect has asked to be read, so it asks once. */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping nothing draws
const askedFor = new Set<string>()

function askOnce(tab: string, address: string | null): void {
  const key = `${tab} ${address ?? ''}`
  if (askedFor.has(key)) return
  askedFor.add(key)
  landed(tab)
}

/** The paper's inks in the reader's own scheme, which is the scheme a note is in: glass's
 *  stronger greys, and the app's own paper and link. Read once per scheme and accent. */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping nothing draws
const inked = new Map<string, PaperInks>()
function inksOf(sides: Sides): PaperInks {
  const app = chrome.app
  const key = `${app} ${theme.accent}`
  const held = inked.get(key)
  if (held) return held
  const side = sides[app]
  const read = schemeTokens(app, ['--bg', '--text-strong'])
  const accent = rgbOf(accentColour(theme.accent, app)) ?? side.text
  const inks = {
    bg: read['--bg'] ?? PAPER[app],
    text: side.text,
    muted: side.ink,
    link: linkOf(accent, read['--text-strong'] ?? side.text),
  }
  inked.set(key, inks)
  return inks
}

/** What is in front, as the colour the frame takes: what is open, or - with the frame
 *  not following - the reader's own colour, as strong as a page's. */
function sourceOf(): Source {
  const tab = workspace.active
  const app = chrome.app
  const accent = rgbOf(accentColour(theme.accent, app)) ?? [124, 107, 245]

  const values = glassValues()
  if (values.follow === false) {
    const chosen = String(values.colour ?? ACCENT_SWATCH)
    const colour = chosen === ACCENT_SWATCH ? accent : rgbOf(accentColour(chosen, app))
    return { colour: colour ?? accent, page: true }
  }

  if (tab?.kind === 'web') {
    const address = addressOf(tab.id, tab.address)
    const page = pages.of(tab.id)
    // A page in front that has finished loading and not been read where it is - one
    // that landed before glass was listening, or whose landing went unheard - is read
    // now, once for each address. A browser's frame says so itself as it loads.
    if (isDesktop && !page.loading && !grounds.heard(tab.id, address)) askOnce(tab.id, address)

    const ground = grounds.of(tab.id, address)
    if (ground) return { colour: ground, page: true }

    const mark = markColour(siteMark(page.icon, address))
    return { colour: mark ?? accent, page: false }
  }

  const path = tab?.path ?? null
  if (tab && path) {
    // Read so a cover written or taken away is followed; the picture is the editor's.
    const covered = tab.kind === 'note' && links.coverOf(path) !== null
    const cover = covered ? markColour(coverIn(tab.paneId, path)) : null
    if (cover) return { colour: cover, page: false }

    const tint = chosenTint(path)
    const icon = tint ? rgbOf(accentColour(tint, app)) : null
    if (icon) return { colour: icon, page: false }
  }

  return { colour: accent, page: false }
}

/** Every web tab whose page has said what it stands on, with its bar: none while the
 *  tab is not to take the page's colour. */
function barsOf(sides: Sides): Record<string, Ground> {
  const bars: Record<string, Ground> = {}
  if (glassValues().tab === false) return bars
  for (const tab of workspace.tabs) {
    if (tab.kind !== 'web') continue
    const ground = grounds.of(tab.id, addressOf(tab.id, tab.address))
    if (ground) bars[tab.id] = barFor(ground, chrome.app, sides)
  }
  return bars
}

let stop: (() => void) | null = null

/** Starts following, once; it stops of its own accord while glass is not worn. */
export function follow(): void {
  if (stop || !SIDES) return
  const sides = SIDES

  // Pages already open when glass is put on have landed before anyone was listening.
  for (const [tab] of pages.each()) landed(tab)

  stop = $effect.root(() => {
    $effect(() => {
      if (!chrome.on) return
      const material = materialOf(chrome.material)
      const frame = frameFor(
        sourceOf(),
        chrome.app,
        material,
        sides,
        paper(),
        dialsOf(glassValues()),
        material ? inksOf(sides) : null,
      )
      // The Content row's level over the floors; paper on paper is the paper itself.
      const level = material ? contentOf(glassValues().content) : 'opaque'
      const laid = alphaFor(level, frame.paper)
      const worn = {
        scheme: frame.scheme,
        tint: frame.tint,
        wash: frame.wash,
        paper: laid,
        terminal: layered(alphaFor(level, frame.terminal), laid),
      }
      const bars = barsOf(sides)
      const tab = workspace.active?.id ?? null
      // What was worn last is compared rather than followed.
      untrack(() => {
        chrome.floor = frame.floor
        chrome.wear(worn, bars, tab)
      })
    })
  })
}

/** A page has landed or moved: its ground is read once it has settled. */
export function landed(tab: string): void {
  clearTimeout(waiting.get(tab))
  waiting.set(
    tab,
    setTimeout(() => {
      waiting.delete(tab)
      if (!chrome.on) return
      const written = workspace.tabs.find((one) => one.id === tab)?.address
      void groundOf(tab).then((ground) => {
        if (ground !== undefined) grounds.said(tab, addressOf(tab, written), ground)
      })
    }, SETTLES),
  )
}
