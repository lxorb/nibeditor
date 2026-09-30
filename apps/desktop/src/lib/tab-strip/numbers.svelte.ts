/** Each tab's number, shown while Alt is held on its own: the key that brings it to the
 *  front, small and quiet at the corner of its mark, the way Office's KeyTips sit at the
 *  corner of a button. Only on the strip of the pane being worked in, because that is
 *  the strip Alt and a digit counts along; see `showTab` in shortcuts/registry.ts.
 *
 *  After a moment and not at once, so a hand that knows the key never sees them; gone on
 *  the release, on any other key, on a press of the pointer or the wheel, and when the
 *  window loses the keyboard. Which number, and when a hold is a hold, is numbers.ts.
 *
 *  Keys pressed inside a web tab's page are the page's, but Alt going down there and
 *  every key pressed while it is held are told to the window by the crate, on both
 *  engines (`meaning` in web_keys.rs), and played here as the keys they were; so the
 *  numbers come over a page as they do over a note. A terminal hands Alt and a digit to
 *  the app rather than to the shell (terminal/keys.ts), so it shows them too.
 *
 *  Fetched at the launch's last turn, where it listens for itself; nothing of it is in
 *  front of the first paint. */

import { mount } from 'svelte'
import { i18n } from '../i18n.svelte'
import { shortcuts } from '../shortcuts.svelte'
import { isDesktop } from '../tauri'
import { viewport } from '../viewport.svelte'
import { workspace } from '../workspace.svelte'
import { AltHold, HOLD_MS, numerals } from './numbers'
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
  private timer: ReturnType<typeof setTimeout> | undefined
  private mounted = false

  constructor() {
    // Capturing, so a terminal or a list that stops a key on its way cannot hide it.
    const options = { capture: true, passive: true }
    const drop = () => this.drop()
    addEventListener('keydown', (event) => this.down(event), options)
    addEventListener('keyup', drop, options)
    addEventListener('pointerdown', drop, options)
    addEventListener('wheel', drop, options)
    // The window's own blur, and not a field's, which the capturing turn hears too.
    addEventListener(
      'blur',
      (event) => {
        if (!(event.target instanceof Element)) this.drop()
      },
      options,
    )
    document.addEventListener('visibilitychange', drop)
    // The window losing the keyboard while it is in a web page, which this document is
    // not told of: it lost the keyboard to the page already. Alt+Tab is that.
    if (isDesktop) {
      void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
        getCurrentWindow().onFocusChanged(({ payload }) => {
          if (!payload) this.drop()
        }),
      )
    }
  }

  private down(event: KeyboardEvent) {
    const began = this.hold.down({
      key: event.key,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      repeat: event.repeat,
      altGraph: event.getModifierState('AltGraph'),
    })

    // A held Alt repeats, and is the same hold with its clock still running.
    if (this.hold.holding && !began) return

    clearTimeout(this.timer)
    if (began) this.timer = setTimeout(() => this.show(), HOLD_MS)
    else if (this.worn.length) this.worn = []
  }

  private drop() {
    this.hold.broken()
    clearTimeout(this.timer)
    if (this.worn.length) this.worn = []
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

    if (!this.mounted) {
      this.mounted = true
      mount(TabNumbers, { target: document.body, props: { numbers: this } })
    }
  }
}

export const numbers = new Numbers()
