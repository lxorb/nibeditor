/** What a hand typing into the space switcher has asked for: a number or a name.
 *
 *  Emil, 2026-10-03: a digit switches the moment only one space can be meant, and
 *  letters find a space by its name and wait for Enter. Vimium's filtered hints are the
 *  shape - digits pick, text filters, and nothing is a field - and the one thing its
 *  users complained of is why a name waits: a match that went the moment it was the
 *  last one left took the next keystroke with it.
 *
 *  Every space wears its place in the list, 1 and up. With ten or more, `1` is space 1
 *  and the start of 10 to 19, so it waits `WAIT` for a second digit before it goes;
 *  Explorer's own typing in a list forgets after about as long. A digit no number
 *  starts with, and a letter no name holds, are refused: what is typed always shows at
 *  least one row.
 *
 *  Pure; space-typing.svelte.ts holds the typing and the wait. */

import { foldName } from '@nib/markdown/links'
import { fuzzyFolded } from './palette/match'

/** How long a number that a second digit could still make longer waits for it. */
export const WAIT = 600

/** What is typed, read against the list. */
export interface Reading {
  /** The places of the rows still shown, in the list's own order. */
  shown: number[]
  /** The row the keyboard stands on: the number typed, or the name that matched best. */
  best: number
  /** The place to switch to now, without Enter. */
  go: number | null
  /** Whether a number is typed that a second digit could still make longer. */
  waits: boolean
}

/** Whether what is typed is a number rather than a name: it starts with a digit. */
export function isNumber(typed: string): boolean {
  return /^\d/.test(typed)
}

/** The places whose number starts with the digits typed. */
function numbered(typed: string, count: number): number[] {
  const out: number[] = []
  for (let at = 0; at < count; at++) if (String(at + 1).startsWith(typed)) out.push(at)
  return out
}

/** The places whose name holds the letters typed, each with how well. */
function named(typed: string, names: readonly string[]): { at: number; score: number }[] {
  const needle = foldName(typed.trim())
  return names.flatMap((name, at) => {
    const score = fuzzyFolded(needle, foldName(name))
    return score === null ? [] : [{ at, score }]
  })
}

/** What `typed` shows of `names`, which are the spaces in their order. */
export function read(typed: string, names: readonly string[]): Reading {
  const all = names.map((_, at) => at)
  if (!typed) return { shown: all, best: -1, go: null, waits: false }

  if (isNumber(typed)) {
    const shown = numbered(typed, names.length)
    const exact = Number(typed) - 1
    const hits = shown.includes(exact)
    return {
      shown,
      best: hits ? exact : (shown[0] ?? -1),
      go: hits && shown.length === 1 ? exact : null,
      waits: hits && shown.length > 1,
    }
  }

  const found = named(typed, names)
  // The best score, the first of a tie: the order the list is in breaks it.
  const best = found.reduce<{ at: number; score: number } | null>(
    (top, one) => (top === null || one.score > top.score ? one : top),
    null,
  )
  return { shown: found.map((one) => one.at), best: best?.at ?? -1, go: null, waits: false }
}

/** What is typed once `character` is added, or null where nothing would be left to
 *  show. A space starts nothing, and a digit after a name is part of the name. */
export function typedOn(typed: string, character: string, names: readonly string[]): string | null {
  if (character === ' ' && !typed) return null

  const next = typed + character
  return read(next, names).shown.length ? next : null
}

/** The character a key types into the switcher, or null for a key that types none.
 *  A digit is read by where it is on the keyboard while a number is being typed, so
 *  the top row of a French keyboard, which types `&` and `é` without Shift, still
 *  picks a space by its number. The number pad's digits are their own keys already. */
export function typedBy(key: string, code: string, typed: string): string | null {
  const digit = /^Digit(\d)$/.exec(code)?.[1]
  if (digit !== undefined && (!typed || isNumber(typed))) return digit
  return /^.$/u.test(key) ? key : null
}
