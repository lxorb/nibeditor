/** The wallpaper somebody chose: taking a picture for a side, making the window's
 *  pictures out of it, making them again when a dial that is baked into them moves,
 *  and going back to the accent field.
 *
 *  Behind a door. Nothing here is in front of the first paint: the window wears what
 *  held.ts wrote down, and this is fetched by what can change it - the Picture row in
 *  Appearance (preferences.ts), the dials beside it, a picture's own row in the file
 *  list - and, once the launch has painted, by a window whose picture is sharp enough
 *  to want its copy at the screen's own size. See render.ts for the canvas, kept.ts for
 *  the app's copies and look.ts for what the dials make of them.
 *
 *  Two records: the picture, which both sides wear, and the dark side's own where it
 *  has been given one. */

import { accentColour } from '../accents'
import { chooseFiles, PICTURES } from '../choose-files'
import { fileBytes } from '../bytes'
import { key, message } from '../i18n.svelte'
import { settings } from '../settings.svelte'
import { forget, keep } from '../stored'
import { theme } from '../theme.svelte'
import { afterQuiet, onceAFrame } from '../timing'
import {
  DARK_KEY,
  type Held,
  heldDark,
  heldWallpaper,
  type Scheme,
  WALLPAPER_KEY,
  WALLPAPER_THEME,
} from './held'
import { type Copy, forgetSource, keepSource, keptSource } from './kept'
import { sharpBelow } from './pixels'
import { copyOf, decode, type Drawable, made, sharp, type Tone, toneKey } from './render'
import { toneOf } from './settings'
import { showPicture } from './sheet'

/** A record: the picture, or the dark side's own. */
type Slot = 'main' | 'dark'
const SLOTS = ['main', 'dark'] as const

const KEYS: Record<Slot, string> = { main: WALLPAPER_KEY, dark: DARK_KEY }
const COPIES: Record<Slot, Copy> = { main: 'source', dark: 'source-dark' }
/** Which side of the sheet a record is said on: the picture at the root, which is the
 *  light side's and the dark side's too until it has its own. */
const SAID: Record<Slot, Scheme> = { main: 'light', dark: 'dark' }

/** How many pixels across the screen copy is made while a dial is still moving: enough
 *  to judge a light blur by, few enough to make inside a frame or two. */
const MOVING = 1280
/** And at most once it rests: a large screen's own. */
const LARGEST_COPY = 3200

/** How long a side of the screen is, in CSS pixels, which is what the picture is
 *  stretched over. A window is moved between screens and resized, so the screen rather
 *  than the window. */
function screenSide(): number {
  return Math.max(screen.width, screen.height, window.innerWidth, window.innerHeight)
}

/** The same in the screen's own pixels, which the sharp copy is made at. */
function devicePixels(): number {
  return Math.min(LARGEST_COPY, Math.round(screenSide() * (window.devicePixelRatio || 1)))
}

/** What the dials say now. */
function blurDial(): number {
  return Number(theme.values.blur ?? 28)
}

function toneDial(): Tone {
  const asked = toneOf(theme.values, theme.accent)
  // A tint toward an accent is toward its dark side's shade, the deeper of the two,
  // on both sides: one picture serves both until the dark side has its own.
  return { ...asked, colour: accentColour(asked.colour, 'dark') }
}

class Wallpaper {
  /** What each record holds, or null for none. */
  held = $state<Record<Slot, Held | null>>({ main: heldWallpaper(), dark: heldDark() })

  /** The app's copies, decoded, once something has asked for them this run. */
  private sources: Record<Slot, Drawable | null> = { main: null, dark: null }
  /** Which making is the latest asked for: a dial turned during a choice, or a second
   *  choice before the first was made, is not overtaken by the older one. */
  private asked = 0
  /** The sharp copy the window wears, as the address it was handed. */
  private sharpAddress: string | null = null

  /** Written down once the dials have rested: a drag is a dozen pictures, and only the
   *  last of them is worth the disk. Not while a dial is still held, so what is kept is
   *  always what was let go of. */
  private readonly keepLater = afterQuiet(() => {
    if (theme.previewing) {
      this.keepLater()
      return
    }
    void this.remake(true).then(() => {
      for (const slot of SLOTS) this.write(slot)
      theme.rewear(WALLPAPER_THEME)
    })
  }, 400)

  /** What a side wears: its own picture, else the picture. */
  of(scheme: Scheme): Held | null {
    return scheme === 'dark' ? (this.held.dark ?? this.held.main) : this.held.main
  }

  /** Whether a side has a picture of its own. */
  owns(scheme: Scheme): boolean {
    return this.held[scheme === 'dark' ? 'dark' : 'main'] !== null
  }

  /** The record a side is wearing. */
  private wornBy(scheme: Scheme): Slot {
    return scheme === 'dark' && this.held.dark ? 'dark' : 'main'
  }

  /** Takes a picture for a side: copies it, makes the window's pictures, wears them, and
   *  puts the theme on if it was not. The light side's picture is both sides' until the
   *  dark side is given one. Answers whether it was taken. */
  async take(picture: Blob, scheme: Scheme = 'light'): Promise<boolean> {
    const slot: Slot = scheme === 'dark' ? 'dark' : 'main'
    const asking = ++this.asked
    try {
      const original = await decode(picture)
      const ratio = window.devicePixelRatio || 1
      const size: [number, number] = [
        Math.round(original.width / ratio),
        Math.round(original.height / ratio),
      ]
      const copy = await copyOf(original)
      const source = await decode(copy)
      if (asking !== this.asked) return false

      this.sources[slot] = source
      void keepSource(copy, COPIES[slot])
      await this.make(slot, source, [0.5, 0.5], size, true)
      await this.wearSharp()
      this.write(slot)
      // Worn again with the new picture and kept for the next launch, or chosen.
      theme.rewear(WALLPAPER_THEME)
      if (theme.id !== WALLPAPER_THEME) theme.select(WALLPAPER_THEME)
      return true
    } catch (error) {
      settings.error = message(error, key('That picture could not be read.'))
      return false
    }
  }

  /** The system's file chooser, for a picture from anywhere on the computer. */
  async choose(scheme: Scheme = 'light'): Promise<void> {
    const [file] = await chooseFiles({ accept: PICTURES })
    if (file) await this.take(file, scheme)
  }

  /** A picture in one of the spaces, from its row in the file list. */
  async takeFrom(path: string): Promise<void> {
    const bytes = await fileBytes(path).catch(() => new Uint8Array())
    await this.take(new Blob([bytes as BlobPart]))
  }

  /** A side's own picture forgotten: the dark side goes back to the picture, and the
   *  picture to the accent field. */
  clear(scheme: Scheme = 'light'): void {
    const slot: Slot = scheme === 'dark' ? 'dark' : 'main'
    this.asked++
    this.sources[slot] = null
    this.held = { ...this.held, [slot]: null }
    this.keepLater.cancel()
    forget(KEYS[slot])
    void forgetSource(COPIES[slot])
    showPicture(SAID[slot], undefined)
    void this.wearSharp()
    theme.rewear(WALLPAPER_THEME)
  }

  /** Moves the focal point of the picture a side is wearing; kept once the drag lets
   *  go. */
  place(scheme: Scheme, x: number, y: number, kept: boolean): void {
    const slot = this.wornBy(scheme)
    const held = this.held[slot]
    if (!held) return

    const focus: [number, number] = [clamp(x), clamp(y)]
    const next = { ...held, focus }
    this.held = { ...this.held, [slot]: next }
    showPicture(SAID[slot], next)
    theme.rewear(WALLPAPER_THEME, false)
    if (kept) {
      this.write(slot)
      theme.rewear(WALLPAPER_THEME)
    }
  }

  /** Once the launch has painted: a picture made before its colours were kept is made
   *  again, and a sharp one gets its copy at the screen's own size. */
  async wake(): Promise<void> {
    const stale = SLOTS.some((slot) => {
      const held = this.held[slot]
      return held !== null && (held.span === undefined || held.tone !== toneKey(toneDial()))
    })
    if (stale) {
      await this.remake(true)
      for (const slot of SLOTS) this.write(slot)
      theme.rewear(WALLPAPER_THEME)
      return
    }
    await this.wearSharp()
  }

  /** A dial that is baked into the pictures moved: made again, shown at once and kept
   *  nowhere until the dials rest. */
  async redial(): Promise<void> {
    await this.remake(false)
    theme.rewear(WALLPAPER_THEME, false)
    this.keepLater()
  }

  /** A dial the sheet says moved: the sheet worn again, and kept once it rests. */
  resheet(): void {
    theme.rewear(WALLPAPER_THEME, false)
    this.keepLater()
  }

  /** Every record whose pictures are not what the dials say, made again. `kept` makes
   *  the sharp copy at the screen's own size rather than at a moving dial's. */
  private async remake(kept: boolean): Promise<void> {
    const asking = ++this.asked
    const blur = blurDial()
    const tone = toneKey(toneDial())

    for (const slot of SLOTS) {
      const held = this.held[slot]
      if (!held) continue
      const sharpened = blur < sharpBelow(screenSide())
      const current = held.blur === blur && held.tone === tone && held.span !== undefined
      // A sharp picture's floors come from its copy at the screen's size, so letting go
      // of a dial makes that once more at full size even where nothing else changed.
      if (current && !(kept && sharpened)) continue

      const source = await this.sourceOf(slot)
      if (!source || asking !== this.asked) return
      await this.make(slot, source, held.focus, held.size ?? [source.width, source.height], kept)
      if (asking !== this.asked) return
    }
    await this.wearSharp(kept)
  }

  /** The copy a record was made from, out of the store if this run has not decoded it. */
  private async sourceOf(slot: Slot): Promise<Drawable | null> {
    const held = this.sources[slot]
    if (held) return held
    const kept = await keptSource(COPIES[slot])
    const source = kept ? await decode(kept).catch(() => null) : null
    if (source) this.sources[slot] = source
    return source
  }

  /** One record's pictures at the dials in force. Under a light blur the kept picture
   *  is the lightest the kept size holds, and its colours are the sharp copy's. */
  private async make(
    slot: Slot,
    source: Drawable,
    focus: [number, number],
    size: [number, number],
    kept: boolean,
  ): Promise<void> {
    const blur = blurDial()
    const tone = toneDial()
    const side = screenSide()
    const least = sharpBelow(side)
    let held = made(source, Math.max(blur, least), tone, side, focus, size)
    held = { ...held, blur }

    if (blur < least) {
      const copy = await sharp(source, blur, tone, side, kept ? devicePixels() : MOVING)
      held = { ...held, span: copy.span, mean: copy.mean }
      this.sharpened[slot] = copy.picture
    } else {
      this.sharpened[slot] = null
    }

    this.held = { ...this.held, [slot]: held }
    showPicture(SAID[slot], held)
  }

  /** Each record's sharp copy, where its blur wants one. */
  private sharpened: Record<Slot, Blob | null> = { main: null, dark: null }

  /** The sharp copy of the picture the side in force wears, on the window, or none. */
  private async wearSharp(kept = true): Promise<void> {
    const slot = this.wornBy(theme.current)
    const held = this.held[slot]
    let copy = this.sharpened[slot]
    if (held && held.blur < sharpBelow(screenSide()) && copy === null) {
      const source = await this.sourceOf(slot)
      if (source) {
        const made = await sharp(
          source,
          held.blur,
          toneDial(),
          screenSide(),
          kept ? devicePixels() : MOVING,
        )
        copy = made.picture
        this.sharpened[slot] = copy
      }
    }

    const wanted = held && held.blur < sharpBelow(screenSide()) ? copy : null
    const root = document.documentElement.style
    if (this.sharpAddress) URL.revokeObjectURL(this.sharpAddress)
    this.sharpAddress = wanted ? URL.createObjectURL(wanted) : null
    if (this.sharpAddress) root.setProperty('--wallpaper-sharp', `url("${this.sharpAddress}")`)
    else root.removeProperty('--wallpaper-sharp')
  }

  /** Lets go of the sharp copy: the theme was put away. */
  sleep(): void {
    if (this.sharpAddress) URL.revokeObjectURL(this.sharpAddress)
    this.sharpAddress = null
    document.documentElement.style.removeProperty('--wallpaper-sharp')
  }

  /** The scheme changed: the other side's picture may be the sharp one. */
  rescheme(): void {
    void this.wearSharp()
  }

  private write(slot: Slot): void {
    const held = this.held[slot]
    if (!held) return
    if (keep(KEYS[slot], JSON.stringify(held))) showPicture(SAID[slot], undefined)
  }
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export const wallpaper = new Wallpaper()

// The dials, followed for as long as the app runs once anything has fetched this. A
// frame's worth of turning is one making: another is asked for only after the last has
// been made, so a fast drag skips the positions it passed over.
$effect.root(() => {
  let making = false
  let again = false

  const next = () => {
    if (making) {
      again = true
      return
    }
    making = true
    void wallpaper.redial().finally(() => {
      making = false
      if (!again) return
      again = false
      requestAnimationFrame(next)
    })
  }
  const sheet = onceAFrame(() => wallpaper.resheet())

  // Only once the theme's own dials have been read: before that every value is where
  // it starts, and a picture made at it would be made again a frame later. And only on
  // a change: what the dials said when they were first read is what was kept.
  const following = () =>
    theme.id === WALLPAPER_THEME && theme.settings.some((one) => one.id === 'blur')
  const changed = () => {
    let last: string | null = null
    return (now: string) => {
      const was = last
      last = now
      return was !== null && was !== now
    }
  }
  const baked = changed()
  const said = changed()
  const side = changed()

  $effect(() => {
    if (!following()) return
    if (baked(`${blurDial()} ${toneKey(toneDial())}`)) next()
  })

  $effect(() => {
    if (!following()) return
    const { grain, fit, empty, content } = theme.values
    if (said(JSON.stringify([grain, fit, empty, content, theme.accent]))) sheet()
  })

  $effect(() => {
    if (theme.id !== WALLPAPER_THEME) {
      wallpaper.sleep()
      return
    }
    if (side(theme.current)) wallpaper.rescheme()
  })
})
