/** The glass frame as the window wears it: its colour, and whose palette is written on
 *  each part of it.
 *
 *  Under glass the frame takes its colour from what is open (see tint.ts), and where
 *  that colour wants the other scheme's words - a black page under the light scheme -
 *  the parts of the frame wear that scheme: `data-theme` on the title bar, the strips,
 *  the side panels and the foot row, so every token there is a palette that was
 *  measured rather than a colour picked on the spot. A web bar and the open tab on it
 *  stand on their page's colour, and wear its scheme.
 *
 *  What is worked out is behind a door (follow.svelte.ts), opened only by glass. This is
 *  the part in front of the first paint, and all it holds is the answer: the last one is
 *  kept, so a launch under glass opens on the colour it was left on, and every part reads
 *  it through a `$derived` that changes when the colour does - on a page landing, a
 *  navigation, a tab switch - and never on a frame. */

import { forget, isNumber, isRecord, isString, keep, stored } from '../stored'

export type Scheme = 'dark' | 'light'

/** What a page's bar and its open tab stand on. */
export interface Ground {
  colour: string
  scheme: Scheme
}

/** What the frame wears; see tint.ts. */
export interface Worn {
  scheme: Scheme
  tint: string
  wash: number
}

/** What the next launch opens on: the frame, and the bar of the tab that was open. */
interface Kept extends Worn {
  app: Scheme
  tab: string | null
  bar: Ground | null
}

const KEY = 'nib:glass-chrome'

function isScheme(value: unknown): value is Scheme {
  return value === 'dark' || value === 'light'
}

function isGround(value: unknown): value is Ground {
  return isRecord(value) && isString(value.colour) && isScheme(value.scheme)
}

function kept(): Kept | null {
  const said = stored(KEY)
  if (!isRecord(said) || !isScheme(said.app) || !isScheme(said.scheme)) return null
  if (!isString(said.tint) || !/^#[0-9a-f]{6}$/i.test(said.tint) || !isNumber(said.wash))
    return null
  return {
    app: said.app,
    scheme: said.scheme,
    tint: said.tint,
    wash: said.wash,
    tab: isString(said.tab) ? said.tab : null,
    bar: isGround(said.bar) ? said.bar : null,
  }
}

class Chrome {
  /** Whether glass is following what is open. */
  on = $state(false)
  /** The scheme the reader asked for, which the note's paper is in. */
  app = $state<Scheme>('dark')
  /** The scheme the frame's words are in. */
  frame = $state<Scheme | null>(null)
  /** Each web tab's bar, for a page that has said what it stands on. */
  bars = $state<Record<string, Ground>>({})
  /** What the platform put behind the window; see material.ts. */
  material = $state<string | null>(null)

  /** `data-theme` for a part of the frame: the frame's scheme where it is not the
   *  reader's, and nothing otherwise, so the frame is the app's own palette. */
  readonly theme = $derived<Scheme | undefined>(
    this.on && this.frame !== null && this.frame !== this.app ? this.frame : undefined,
  )

  /** A web tab's bar: its colour, while its page has said one. */
  barOf(tab: string): Ground | undefined {
    return this.on ? this.bars[tab] : undefined
  }

  /** `data-theme` for a web bar, which sits in the pane rather than on the frame. */
  barTheme(tab: string): Scheme | undefined {
    const scheme = this.barOf(tab)?.scheme
    return scheme === this.app ? undefined : scheme
  }

  /** `data-theme` for the open tab in a strip: the scheme of what it runs down into - its
   *  page's bar, or the note's paper - where that is not the strip's own. */
  tabTheme(tab: string): Scheme | undefined {
    if (!this.on) return undefined
    const own = this.bars[tab]?.scheme ?? this.app
    return own === (this.theme ?? this.app) ? undefined : own
  }

  /** Glass is worn, in this scheme. The first time, the frame is what it was left as, so
   *  the first frame is the right colour before anything has been worked out. */
  wake(app: Scheme): void {
    const was = this.on
    this.app = app
    if (was) return

    this.on = true
    const root = document.documentElement
    root.dataset.tinted = ''
    this.material = root.dataset.translucent ?? null
    const last = kept()
    if (last?.app !== app) return

    this.paint(last)
    this.frame = last.scheme
    if (last.tab !== null && last.bar !== null) this.bars = { [last.tab]: last.bar }
  }

  /** Glass is put away: every colour and attribute it put on the window goes with it. */
  sleep(): void {
    if (!this.on) return

    this.on = false
    this.frame = null
    this.bars = {}
    const root = document.documentElement
    delete root.dataset.tinted
    root.style.removeProperty('--glass-tint')
    root.style.removeProperty('--glass-tinted')
  }

  /** What the frame wears now, and each page's bar; `tab` is the one in front, whose
   *  bar the next launch opens on. */
  wear(worn: Worn, bars: Record<string, Ground>, tab: string | null): void {
    if (!this.on) return

    this.paint(worn)
    if (this.frame !== worn.scheme) this.frame = worn.scheme
    if (JSON.stringify(bars) !== JSON.stringify(this.bars)) this.bars = bars

    const next: Kept = {
      ...worn,
      app: this.app,
      tab,
      bar: tab === null ? null : (bars[tab] ?? null),
    }
    const text = JSON.stringify(next)
    if (text === this.written) return
    this.written = text
    keep(KEY, text)
  }

  /** Forgets the colour kept for the next launch: the reader left glass. */
  forget(): void {
    forget(KEY)
    this.written = ''
  }

  /** What was last written down, so the same answer is not written twice. */
  private written = ''

  /** The colour on the root, touched only when it changes: the root's style is what
   *  every rule under it is worked out from. */
  private paint(worn: Worn): void {
    const style = document.documentElement.style
    const wash = `${Math.round(worn.wash * 100)}%`
    if (style.getPropertyValue('--glass-tint') !== worn.tint) {
      style.setProperty('--glass-tint', worn.tint)
    }
    if (style.getPropertyValue('--glass-tinted') !== wash) style.setProperty('--glass-tinted', wash)
  }
}

export const chrome = new Chrome()

/** A page has landed or moved somewhere else, which is when glass reads what it stands
 *  on; nothing at all unless glass is worn. */
export function landed(tab: string): void {
  if (chrome.on) void import('./follow.svelte').then((one) => one.landed(tab))
}
