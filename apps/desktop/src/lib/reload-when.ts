/** What reloading.svelte.ts does about a chunk that did not arrive: asks the site for
 *  its page, and reloads for a newer build once nothing is owed and no hand is on the
 *  page, or offers Reload for the same one. Fetched at the launch's last turn rather
 *  than carried (see `warmDoors`), so a deploy after that finds it already here.
 *
 *  Chromium and WebKit never fetch a failed module's address again while the page lives
 *  (measured 2026-09-30), so only a reload brings the chunk back; Linear and Vercel pick
 *  up a deploy the same way. No answer from the site offers nothing, since a reload then
 *  would not come back. The installed app has no site to ask and goes to the offer. */

import { overlays } from './overlays'
import { keep, storedText } from './stored'
import { isNative } from './tauri'
import { afterQuiet } from './timing'

/** A pause between sentences. */
const HANDS_OFF = 3000

/** The build a reload went for, so a stale cache is reloaded for once, not forever. */
const RELOADED_FOR = 'nib:reloaded-for'

/** Any of these puts the reload off again. */
const HANDS = ['keydown', 'pointerdown', 'pointerup', 'pointercancel', 'pointermove', 'wheel']

/** What the page lends the answer. */
interface Missing {
  /** A button held, or something the page must not go from under. */
  held: () => boolean
  /** Whether the disk has everything it is owed, once the writes waiting are done. */
  settled: () => Promise<boolean>
  offer: () => void
}

/** A page's first module script, which carries the build's hash. */
export function entryOf(markup: string): string | null {
  for (const [tag] of markup.matchAll(/<script\b[^>]*>/gi)) {
    if (!/\btype\s*=\s*["']?module\b/i.test(tag)) continue
    const source = /\bsrc\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]
    if (source) return source
  }

  return null
}

/** What a missing piece calls for. */
export function verdict(
  running: string | null,
  served: string,
  reloadedFor: string | null,
): 'reload' | 'offer' {
  return served !== running && served !== reloadedFor ? 'reload' : 'offer'
}

/** Answers whether the site could be asked; a reload, when that is the answer, is the
 *  page going and never returns. */
export async function answer(page: Missing): Promise<boolean> {
  const served = isNative || __EVEN_PLUGIN__ ? entryRunning() : await entryServed()
  if (served === null) return false

  if (verdict(entryRunning(), served, storedText(RELOADED_FOR)) === 'offer') page.offer()
  else {
    do {
      await handsOff(page)
    } while (!(await page.settled()))

    keep(RELOADED_FOR, served)
    location.reload()
  }

  return true
}

/** Focus in a field nothing writes down; the note is written as it changes. */
function inField(): boolean {
  const field = document.activeElement
  if (!field || field.closest('.cm-editor')) return false

  return field.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
}

/** Once no hand has moved for a moment (or the page is hidden) and nothing is busy. */
function handsOff(page: Missing): Promise<void> {
  return new Promise((done) => {
    const look = afterQuiet(() => {
      if (page.held() || overlays.depth > 0 || inField()) look()
      else {
        stop()
        done()
      }
    }, HANDS_OFF)
    const touched = () => look()
    const hidden = () => {
      if (document.hidden) look.flush()
    }
    const stop = () => {
      look.cancel()
      for (const hand of HANDS) removeEventListener(hand, touched, true)
      document.removeEventListener('visibilitychange', hidden)
    }

    for (const hand of HANDS) addEventListener(hand, touched, { capture: true, passive: true })
    document.addEventListener('visibilitychange', hidden)
    look()
    hidden()
  })
}

function entryRunning(): string | null {
  return document.querySelector('script[type="module"][src]')?.getAttribute('src') ?? null
}

/** The entry the site's root serves now, or null when it could not be asked. */
async function entryServed(): Promise<string | null> {
  try {
    const page = await fetch('/', { cache: 'no-store', headers: { accept: 'text/html' } })
    return page.ok ? entryOf(await page.text()) : null
  } catch {
    // Offline, or the site down: asked again when the network is back.
    return null
  }
}
