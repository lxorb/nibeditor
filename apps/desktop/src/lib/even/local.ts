/** The plugin's own `localStorage`, one that survives a launch.
 *
 *  A packed plugin is served from `http://127.0.0.1:<port>` with a fresh port
 *  every launch, so the page's real `localStorage` is a different origin's every
 *  time and always comes up empty. Every device-local setting the app has goes
 *  through `localStorage` - the theme, the appearance, the last note, the
 *  sidebar, the shortcuts - in about thirty places across fifteen files. Routing
 *  each of them somewhere else would be thirty chances to miss one.
 *
 *  So the storage is replaced instead of the callers. What the app gets is a
 *  `Storage` backed by a map, seeded from a cookie before the first line of the
 *  app runs, and written back to the cookie and to the phone app's own store
 *  whenever it changes. The app is unaware, which is the point.
 *
 *  Why those two: the cookie is scoped to the host and ignores the port, so it
 *  is the same cookie across launches and it can be read synchronously, before
 *  anything is painted. The phone app's store is the durable one but answers
 *  nothing until its channel arrives, seconds later, which is too late to decide
 *  what colour the app is. So the cookie carries what has to be there at once,
 *  and the host store carries all of it. See docs/even.md. */

import { afterQuiet } from '../timing'
import { hostKeep, cookieOf, writeCookie } from './keep'

/** The name both stores keep the settings under. */
const KEY = 'nib:local'

/** What a cookie will take. Four kilobytes is the limit browsers agree on,
 *  including the name and the encoding, so this leaves room to be wrong. */
const COOKIE_ROOM = 3500

/** How long after a change everything is written down. Settings arrive in
 *  bursts - a theme change touches three keys - and each write is a cookie
 *  rewrite and a message to the phone. */
const SETTLE = 400

function parsed(written: string | null): Record<string, string> {
  if (!written) return {}

  try {
    const found: unknown = JSON.parse(written)
    if (typeof found !== 'object' || found === null) return {}

    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(found)) {
      if (typeof value === 'string') out[key] = value
    }

    return out
  } catch {
    // Half a write, or somebody else's value. Either way, no settings.
    return {}
  }
}

/** The keys the cookie is not for.
 *
 *  Everything device-local goes through one map, and the map is written to two
 *  places: the cookie, which is small and is there at once, and the phone app's own
 *  store, which is unbounded and answers seconds later. Sorting by size was supposed
 *  to decide what rode the cookie, and it decided it the wrong way round.
 *
 *  On Emil's account `nib:mirrors` - what the syncing knows about each note - is 133
 *  bytes plus the path per note: 4,408 bytes for his twenty notes, 7,706 once the
 *  cookie's own URI encoding is counted, against a 3,500 byte cookie. From about
 *  fourteen notes on it does not fit, and because the smallest keys are kept first it
 *  is the first thing dropped. Dropped, re-read as nothing, and written back as
 *  nothing: the syncing then believed it had never seen those notes.
 *
 *  So which store a key belongs in is a decision rather than an accident of size.
 *  These are bookkeeping - nothing is painted from them, and every one of them has a
 *  reader that can be asked to read again when the phone app answers - so they ride
 *  the host store alone. Everything else is what the first paint is made of (the
 *  theme, the accent, the appearance, the language, the session, the panes) and stays
 *  on the cookie, where it is there before anything is drawn.
 *
 *  Written out rather than imported from the modules that own them, and that is
 *  deliberate: this file is loaded before any store exists - see lib/even/first.ts -
 *  and an import of `sync.svelte.ts` here would build the store graph before the
 *  storage it reads is in place, which is the bug that hid the space icons. The names
 *  are held to their modules by a test instead; see local.test.ts. */
const HOST_ONLY = new Set([
  'nib:mirrors',
  'nib:recovery',
  'nib:recent',
  'nib:expanded',
  'nib:expanded-tags',
  'nib:icons',
  // The icons a reader gave the folders inside each space, and the colours they are
  // drawn in. Both are a map per space of path to name, so both grow with the vault
  // rather than with the settings - which is the shape `nib:mirrors` had when it was
  // dropped smallest-first and written back as nothing.
  'nib:folder-icons',
  'nib:icon-tints',
  // What each space has archived, which is the same shape: a map per space keyed by
  // path, growing with what was put away. Read again when the host store answers.
  'nib:archived',
])

/** What the cookie may carry, which is everything that is not bookkeeping. */
export function forTheCookie(all: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(all).filter(([key]) => !HOST_ONLY.has(key)))
}

/** As much of the settings as a cookie will hold, smallest first.
 *
 *  Smallest first because the ones that decide what the first paint looks like -
 *  the theme, the accent, the appearance - are a few bytes each, and the ones
 *  that would fill a cookie on their own are the ones nobody notices arriving a
 *  moment late. A backstop now rather than the rule: what could fill a cookie on its
 *  own is not offered to it at all. */
function underTheLimit(all: Record<string, string>): Record<string, string> {
  const bySize = Object.entries(all).sort(([, a], [, b]) => a.length - b.length)

  const out: Record<string, string> = {}
  for (const [key, value] of bySize) {
    const next = { ...out, [key]: value }
    if (encodeURIComponent(JSON.stringify(next)).length > COOKIE_ROOM) break

    out[key] = value
  }

  return out
}

class Local implements Storage {
  private readonly held = new Map<string, string>()
  private readonly later = afterQuiet(() => this.flush(), SETTLE)

  constructor(seed: Record<string, string>) {
    for (const [key, value] of Object.entries(seed)) this.held.set(key, value)
  }

  get length(): number {
    return this.held.size
  }

  key(at: number): string | null {
    return [...this.held.keys()][at] ?? null
  }

  getItem(key: string): string | null {
    return this.held.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.held.set(key, value)
    this.later()
  }

  removeItem(key: string): void {
    this.held.delete(key)
    this.later()
  }

  clear(): void {
    this.held.clear()
    this.later()
  }

  /** Fills in whatever the phone app kept and the cookie could not hold. Only
   *  keys the app has not already set this launch, so a setting changed while
   *  the channel was still arriving is not undone by the old value landing. */
  fillFrom(older: Record<string, string>): void {
    let grew = false
    for (const [key, value] of Object.entries(older)) {
      if (this.held.has(key)) continue

      this.held.set(key, value)
      grew = true
    }

    if (grew) this.later()
  }

  private flush(): void {
    const all = Object.fromEntries(this.held)
    writeCookie(KEY, JSON.stringify(underTheLimit(forTheCookie(all))))
    // Everything, to the one store with room for it. Nothing waits on it.
    void hostKeep.write(KEY, JSON.stringify(all)).catch(() => undefined)
  }
}

/** Puts the plugin's own storage in front of the page's, before anything reads
 *  it. Answers the store so the caller can fill it in when the phone app
 *  answers, which is seconds later. */
export function installLocal(): Local {
  // The cookie, synchronously: whatever decides the first paint is already here.
  //
  // And nothing else: a cookie written by an older build carries bookkeeping that
  // was truncated on the way in, and a short value is worse than none at all. It
  // would be held here, `fillFrom` would leave it alone - it only fills in what
  // nothing has written - and the phone app's own full copy would never land. So
  // what moved to the host store is not seeded from the cookie at all.
  const local = new Local(forTheCookie(parsed(cookieOf(KEY))))
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: local,
  })

  return local
}

/** The rest of it, once the phone app is reachable. */
export async function fillLocal(local: Local): Promise<void> {
  local.fillFrom(parsed(await hostKeep.read(KEY)))
}
