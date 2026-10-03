/** What the files of the spaces that are not open wear: a note's chosen icon and its
 *  colour, a website's mark and where it points.
 *
 *  The link index holds these for the open space and no other - it is a scan of one
 *  space - so a tab, a bookmark or a search hit from another space asked it and got
 *  nothing, and a note wore its chosen icon only while its own space was the open one.
 *  Emil, 2026-10-03. So a file outside the open space is read once, on its own, the
 *  first time a mark asks about it, and what it wears is kept here by its path until
 *  it is saved, moved or gone, or the open space changes (which is when what was the
 *  open space's index stops speaking for its files). See chosen-icon.ts, the one door
 *  every mark goes through.
 *
 *  Read rather than scanned: a front matter key or two for a note, a few lines for a
 *  website, the `nib` key for a plane - never the space. */

import { frontMatterValue } from '@nib/markdown/front-matter'
import { isCanvasTarget, isPagesTarget, isWebTarget } from '@nib/markdown/links'
import { SvelteMap } from 'svelte/reactivity'
import { ICON_COLOUR_KEY, ICON_KEY } from './icons'
import { isMarkdownPath, pathKey, within } from './space-paths'
import { invoke } from './tauri'
import { readWebFile } from './web-tab/shortcut'

/** What one file wears, in the link index's own words for each. */
interface Worn {
  icon: string | null
  iconColor: string | null
  favicon: string | null
  address: string | null
}

const NOTHING: Worn = { icon: null, iconColor: null, favicon: null, address: null }

/** Whether a file can wear anything at all: a folder, a picture and a PDF cannot,
 *  and are never read. */
function wears(path: string): boolean {
  return isMarkdownPath(path) || isCanvasTarget(path) || isPagesTarget(path) || isWebTarget(path)
}

/** What a file's words say it wears. */
async function wornBy(path: string, content: string): Promise<Worn> {
  if (isWebTarget(path)) {
    const said = readWebFile(path, content)
    return { ...NOTHING, favicon: said?.icon ?? null, address: said?.url ?? null }
  }

  if (isCanvasTarget(path) || isPagesTarget(path)) {
    const { planeMarks } = await import('./scan-canvas')
    const { icon, iconColor } = planeMarks(content)
    return { ...NOTHING, icon, iconColor }
  }

  return {
    ...NOTHING,
    icon: frontMatterValue(content, ICON_KEY),
    iconColor: frontMatterValue(content, ICON_COLOUR_KEY),
  }
}

class Elsewhere {
  /** By `pathKey`, so two spellings of one file are one entry. */
  private readonly held = new SvelteMap<string, Worn>()
  /** Every file asked about, by key, with the path it was asked under. Plain rather
   *  than state: a mark asks from inside a derivation, which may read state and never
   *  write it, so the read is started a microtask later and only its answer lands in
   *  `held`. */
  private readonly asked = new Map<string, string>()
  /** Bumped by `clear`, so a read that was in the air when everything was let go of
   *  does not land afterwards. */
  private round = 0

  /** What the file at this path wears, or null until it has been read - which this
   *  starts, and whose answer redraws whatever asked. */
  of(path: string): Worn | null {
    if (!wears(path)) return null

    const key = pathKey(path)
    const known = this.held.get(key)
    if (known || this.asked.has(key)) return known ?? null

    this.asked.set(key, path)
    const round = this.round
    queueMicrotask(() => void this.read(path, key, round))
    return null
  }

  private async read(path: string, key: string, round: number) {
    const content = await invoke<string>('read_note', { path }).catch(() => null)
    const worn = content === null ? NOTHING : await wornBy(path, content)
    if (round === this.round) this.held.set(key, worn)
  }

  /** A file outside the open space written by this app: what it wears now. Only for
   *  one somebody has already asked about; the rest are read when they are. */
  saved(path: string, content: string) {
    const key = pathKey(path)
    if (!this.held.has(key) || !wears(path)) return

    const round = this.round
    void wornBy(path, content).then((worn) => {
      if (round === this.round) this.held.set(key, worn)
    })
  }

  /** A file or folder that moved or went: everything at it or under it is read again
   *  when it is next asked about. */
  forget(path: string) {
    for (const [key, asked] of [...this.asked]) {
      if (within(path, asked) === null) continue
      this.held.delete(key)
      this.asked.delete(key)
    }
  }

  /** All of it, for a space that has just opened: what was the open space's index
   *  no longer speaks for its files, and what was read about the new one is the
   *  index's to say now. */
  clear() {
    this.round++
    this.held.clear()
    this.asked.clear()
  }
}

export const elsewhere = new Elsewhere()
