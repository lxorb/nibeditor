/** The arithmetic of a message's pictures and sounds (docs/chats.md 4.8): how a
 *  gallery is laid out, how big one picture is drawn, and the 64 bars of loudness a
 *  voice message carries. Pure, so a test reads the shapes as numbers.
 *
 *  Every size is known before anything loads - the sender stated each picture's width
 *  and height, and a voice message's bars - so a row is the right height from its first
 *  frame and never jumps when the picture arrives. */

import type { FileRef } from '@nib/chats'
import { WAVE_BARS } from '@nib/chats/limits'

/** The most pictures a gallery shows; the rest are a count on the last. */
const GALLERY_MOST = 6

/** How tall one picture alone may be drawn, and how wide. */
const PICTURE_TALLEST = 360
const PICTURE_WIDEST = 480

export function isPicture(file: FileRef): boolean {
  return file.type.startsWith('image/')
}

export function isVideo(file: FileRef): boolean {
  return file.type.startsWith('video/')
}

function isSound(file: FileRef): boolean {
  return file.type.startsWith('audio/')
}

/** A message's files sorted into what draws them: pictures and videos as a gallery,
 *  sounds as players, the rest as cards. */
export function sortFiles(files: readonly FileRef[]): {
  seen: FileRef[]
  heard: FileRef[]
  other: FileRef[]
} {
  return {
    seen: files.filter((one) => isPicture(one) || isVideo(one)),
    heard: files.filter(isSound),
    other: files.filter((one) => !isPicture(one) && !isVideo(one) && !isSound(one)),
  }
}

/** One picture's size, fitted inside the column and the caps, its shape kept. A
 *  picture whose size was not stated is drawn as a square. */
export function fitted(file: FileRef, column: number): { width: number; height: number } {
  const width = file.width ?? 0
  const height = file.height ?? 0
  const widest = Math.min(column, PICTURE_WIDEST)
  if (width <= 0 || height <= 0) {
    const side = Math.min(widest, 240)
    return { width: side, height: side }
  }
  const scale = Math.min(1, widest / width, PICTURE_TALLEST / height)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/** A gallery of two or more: how many across, the ones drawn, and how many more there
 *  are than are drawn. */
export function gallery(files: readonly FileRef[]): {
  across: number
  shown: FileRef[]
  more: number
} {
  const shown = files.slice(0, GALLERY_MOST)
  const across = shown.length === 2 || shown.length === 4 ? 2 : 3
  return { across, shown, more: files.length - shown.length }
}

/** The bars of loudness a voice message carries: the root mean square of each of
 *  `WAVE_BARS` stretches, as 0 to 255 of the loudest, so a quiet recording still fills
 *  its row. What the sender computes once, so nobody else decodes anything to draw it. */
export function barsOf(samples: Float32Array, bars = WAVE_BARS): number[] {
  if (samples.length === 0) return Array.from({ length: bars }, () => 0)
  const out: number[] = []
  const per = samples.length / bars
  for (let bar = 0; bar < bars; bar++) {
    const from = Math.floor(bar * per)
    const to = Math.max(from + 1, Math.floor((bar + 1) * per))
    let sum = 0
    for (let i = from; i < to && i < samples.length; i++) sum += (samples[i] ?? 0) ** 2
    out.push(Math.sqrt(sum / (to - from)))
  }
  const loudest = Math.max(...out)
  return out.map((one) => (loudest > 0 ? Math.round((one / loudest) * 255) : 0))
}

/** How far through a sound a press on its bars is, 0 to 1. */
export function seekAt(x: number, left: number, width: number): number {
  if (width <= 0) return 0
  return Math.min(1, Math.max(0, (x - left) / width))
}

/** A length of time as a player says it: `0:42`, `12:05`. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}
