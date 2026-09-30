/** A row's name cut where the typed letters landed, so they can be drawn stronger:
 *  what VS Code, JetBrains and Raycast all do, and what tells a reader why a row is in
 *  a list that mixes notes, commands and settings. Each word typed is placed on its
 *  own, the way rank.ts finds them. Nothing is marked where the words were found
 *  somewhere other than the name - a folder, an address - since the name then holds
 *  none of them. */

import { fuzzyPlaces } from './match'

export interface Piece {
  text: string
  hit: boolean
}

export function pieces(name: string, term: string): Piece[] {
  const hits = new Set<number>()
  for (const word of term.split(/\s+/).filter(Boolean)) {
    const at = fuzzyPlaces(word, name)
    if (!at) return [{ text: name, hit: false }]
    for (const one of at) hits.add(one)
  }

  // By UTF-16 unit, which is what the places count in: a letter outside the basic
  // plane is two units, never a hit, and so never cut in half.
  const out: Piece[] = []
  for (let index = 0; index < name.length; index++) {
    const hit = hits.has(index)
    const last = out.at(-1)
    if (last?.hit === hit) last.text += name.charAt(index)
    else out.push({ text: name.charAt(index), hit })
  }

  return out
}
