/** Each tab's number, shown while Alt is held: the key that brings it to the front,
 *  small and quiet at the corner of its mark, the way Office's KeyTips sit at the corner
 *  of a button. Only on the strip of the pane being worked in, because that is the strip
 *  Alt and a digit counts along; see `showTab` in shortcuts/registry.ts.
 *
 *  On the press of Alt itself, in the frame it goes down in, as KeyTips are. Emil,
 *  2026-10-01: *"currently it just feels a bit delayed till the numbers appear when
 *  holding alt"* - a wait of 150 ms, there so that a quick Alt+3 would never flash them,
 *  was the one thing a hand noticed every time; a flash at a quick Alt+3 is the cheaper
 *  of the two. They stay through the digits, following the tab each one brings to the
 *  front, and go on the release, on any other key, on a press of the pointer or the wheel,
 *  and when the window loses the keyboard. Which number, and when a hold is a hold, is
 *  numbers.ts.
 *
 *  Keys pressed inside a web tab's page are the page's, but Alt going down there and
 *  every key pressed while it is held are told to the window by the crate, on both
 *  engines (`told` in web_keys.rs), and Alt and a digit is taken from the page and said as
 *  itself (`meaning`); both are played here as the keys they were, so the numbers come
 *  over a page as they do over a note. A terminal hands Alt and a digit to the app rather
 *  than to the shell (terminal/keys.ts), so it shows them too.
 *
 *  Fetched at the launch's last turn, where it listens for itself and puts its component
 *  up empty, so the first Alt after the launch has nothing left to load or build; nothing
 *  of it is in front of the first paint. */

import { mount } from 'svelte'
import { i18n } from '../i18n.svelte'
import { shortcuts } from '../shortcuts.svelte'
import { isDesktop } from '../tauri'
import { viewport } from '../viewport.svelte'
import { workspace } from '../workspace.svelte'
import { AltHold, numerals } from './numbers'
import TabNumbers from './TabNumbers.svelte'

/** One tab's number, and the corner of its mark on the glass. */
export interface Worn {
  id: string
  label: string
  x: number
  y: number
}

class Numbers {
  worn = $state<Worn[]>([])

  private readonly hold = new AltHold()
  private frame = 0

  constructor() {
    // Capturing, so a terminal or a list that stops a key on its way cannot hide it.
    const options = { capture: true, passive: true }
    addEventListener('keydown', (event) => this.down(event), options)
    addEventListener('keyup', (event) => this.up(event), options)
    addEventListener('pointerdown', () => this.used(), options)
    addEventListener('wheel', () => this.used(), options)
    // The window's own blur, and not a field's, which the capturing turn hears too.
    addEventListener(
      'blur',
      (event) => {
        if (!(event.target instanceof Element)) this.released()
      },
      options,
    )
    document.addEventListener('visibilitychange', () => this.released())
    // The window losing the keyboard while it is in a web page, which this document is
    // not told of: it lost the keyboard to the page already. Alt+Tab is that.
    if (isDesktop) {
      void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
        getCurrentWindow().onFocusChanged(({ payload }) => {
          if (!payload) this.released()
        }),
      )
    }
    mount(TabNumbers, { target: document.body, props: { numbers: this } })
  }

  private down(event: KeyboardEvent) {
    const place = this.hold.down({
      key: event.key,
      code: event.code,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      repeat: event.repeat,
      altGraph: event.getModifierState('AltGraph'),
    })

    if (place) this.place()
    else if (!this.hold.holding) this.clear()
  }

  /** Only Alt's own release, or a key let go of once Alt is: a digit let go of with Alt
   *  still down is a hand on its way to the next one. */
  private up(event: KeyboardEvent) {
    if (event.key === 'Alt' || !event.altKey) this.released()
  }

  private used() {
    this.hold.used()
    this.clear()
  }

  private released() {
    this.hold.released()
    this.clear()
  }

  private clear() {
    cancelAnimationFrame(this.frame)
    if (this.worn.length) this.worn = []
  }

  /** Read where the tabs are at the next frame, before it is painted: by then a digit's
   *  tab is in front and its strip has scrolled to it, which this key's own handlers,
   *  after this one, are what do. */
  private place() {
    cancelAnimationFrame(this.frame)
    this.frame = requestAnimationFrame(() => this.show())
  }

  private show() {
    if (!this.hold.holding || viewport.touch) return

    const paneId = workspace.panes.focusedId
    const strip = document.querySelector(`[data-strip="${CSS.escape(paneId)}"]`)
    if (!strip) return

    const tabs = workspace.tabsIn(paneId)
    const labels = numerals(tabs.length, (id) => shortcuts.keyFor(id), shortcuts.platform)
    const seen = strip.getBoundingClientRect()

    this.worn = tabs.flatMap((tab, at) => {
      const label = labels[at]
      const pick = strip.querySelector(`.pick[data-tab="${CSS.escape(tab.id)}"]`)
      if (!label || !pick) return []

      // The mark where the tab shows one, and the tab's own box where it is too narrow
      // to: a tab scrolled out of the strip wears nothing.
      const face = pick.querySelector('.face')
      const box = (face?.getClientRects().length ? face : pick).getBoundingClientRect()
      if (box.right < seen.left || box.left > seen.right) return []

      return [{ id: tab.id, label, x: i18n.factor > 0 ? box.right : box.left, y: box.bottom }]
    })
  }
}

export const numbers = new Numbers()
