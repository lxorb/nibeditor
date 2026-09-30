/** What travels with a site's login besides the site's own storage: what Chrome brings
 *  back after a restart that lives in the browser rather than in the site (docs/sync-v2.md
 *  section 6.3). The size each of its hosts is drawn at, what each was allowed or
 *  refused, and where each web note on it was left - the page, the place on it and the
 *  trail behind it - with the one note whose tab's sessionStorage went into the bundle.
 *
 *  A note is named by its space and its path in that space, because the two computers
 *  keep the space in different folders and the space's id is the same on both. Carried
 *  in the bundle's `app` as it is, sealed with everything else; read back at the other
 *  end field by field, since it arrived from another computer. Pure but for the three
 *  stores it reads and writes, which are this device's own. */

import { insideSpace, withinSpace } from '../space-paths'
import { isRecord } from '../stored'
import { plainOrigin } from './address'
import { grants, type Ask, ASKS } from './permissions.svelte'
import { placeKept, placeOf, type Place } from './place'
import { keepZoom, zoomOf } from './sites'

type Answer = 'allow' | 'block'

export interface Carried {
  v: 1
  /** By host as the bar shows it, where it is not a hundred per cent. */
  zooms: Record<string, number>
  /** By host as the bar shows it, what it was told. */
  grants: Record<string, Partial<Record<Ask, Answer>>>
  places: { space: string; path: string; place: Place }[]
  /** The web note whose tab's sessionStorage is in the bundle. */
  tab: { space: string; path: string } | null
}

interface Space {
  id: string
  root: string
}

/** A note by its space and its path there, or null for one in no space. */
function named(path: string, spaces: readonly Space[]): { space: string; path: string } | null {
  for (const space of spaces) {
    const inside = withinSpace(space.root, path)
    if (inside !== null) return { space: space.id, path: inside }
  }
  return null
}

/** What goes up with a site: `origins` are the site's origins this device has been on,
 *  `notes` the web notes open on it, and `tab` the one whose sessionStorage is read. */
export function carriedOut(
  origins: Iterable<string>,
  notes: Iterable<string>,
  tab: string | null,
  spaces: readonly Space[],
): Carried {
  const zooms: Carried['zooms'] = {}
  const told: Carried['grants'] = {}
  for (const origin of origins) {
    const host = plainOrigin(origin)
    const zoom = zoomOf(host)
    if (zoom !== 1) zooms[host] = zoom
    const said = grants.of(host)
    if (Object.keys(said).length) told[host] = { ...said }
  }

  const places: Carried['places'] = []
  for (const path of notes) {
    const where = named(path, spaces)
    const place = placeOf(path)
    if (where && place) places.push({ ...where, place })
  }

  return { v: 1, zooms, grants: told, places, tab: tab === null ? null : named(tab, spaces) }
}

const isAnswer = (value: unknown): value is Answer => value === 'allow' || value === 'block'
const isAsk = (value: string): value is Ask => ASKS.some((one) => one === value)

function readPlace(value: unknown): Place | null {
  if (!isRecord(value)) return null
  const { url, x, y, trail, at } = value
  if (typeof url !== 'string' || typeof x !== 'number' || typeof y !== 'number') return null
  const walked = Array.isArray(trail) ? trail.filter((one) => typeof one === 'string') : []
  return {
    url,
    x,
    y,
    ...(walked.length ? { trail: walked } : {}),
    ...(typeof at === 'number' ? { at } : {}),
  }
}

/** Puts what came down with a site into this device's stores, and answers the note
 *  whose tab the bundle's sessionStorage belongs to, as a path on this disk. Anything
 *  that does not read as what it should be is left out. */
export function carriedIn(value: unknown, spaces: readonly Space[]): string | null {
  if (!isRecord(value) || value.v !== 1) return null

  if (isRecord(value.zooms)) {
    for (const [host, zoom] of Object.entries(value.zooms)) {
      if (typeof zoom === 'number') keepZoom(host, zoom)
    }
  }

  if (isRecord(value.grants)) {
    for (const [host, said] of Object.entries(value.grants)) {
      if (!isRecord(said)) continue
      for (const [ask, answer] of Object.entries(said)) {
        if (isAsk(ask) && isAnswer(answer)) grants.remember(host, ask, answer)
      }
    }
  }

  const here = (one: unknown): string | null => {
    if (!isRecord(one) || typeof one.space !== 'string' || typeof one.path !== 'string') return null
    const space = spaces.find((each) => each.id === one.space)
    return space ? insideSpace(space.root, one.path) : null
  }

  if (Array.isArray(value.places)) {
    for (const one of value.places) {
      const path = here(one)
      const place = isRecord(one) ? readPlace(one.place) : null
      if (path && place) placeKept(path, place)
    }
  }

  return here(value.tab)
}
