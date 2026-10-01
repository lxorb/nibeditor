/** The wallpaper somebody chose: taking a picture, making the window's picture out of
 *  it, making it again when the Blur dial moves, and going back to the accent field.
 *
 *  Behind a door. Nothing here is in front of the first paint: the window wears what
 *  held.ts wrote down, and this is fetched by what can change it - the Picture row in
 *  Appearance (preferences.ts), the dial beside it, and a picture's own row in the
 *  file list. See render.ts for the canvas and kept.ts for the app's copy. */

import { wallpaperCss } from '@nib/themes/wallpaper'
import { chooseFiles, PICTURES } from '../choose-files'
import { fileBytes } from '../bytes'
import { key, message } from '../i18n.svelte'
import { settings } from '../settings.svelte'
import { forget, keep } from '../stored'
import { theme } from '../theme.svelte'
import { afterQuiet } from '../timing'
import { type Palette, paletteOf } from './floors'
import { type Held, heldWallpaper, WALLPAPER_KEY, WALLPAPER_THEME } from './held'
import { forgetSource, keepSource, keptSource } from './kept'
import { copyOf, decode, made } from './render'
import { showPicture } from './sheet'

/** Each side's palette, read out of the theme's own sheet. */
function palettes(): { dark: Palette; light: Palette } {
  const dark = paletteOf(wallpaperCss, 'dark')
  const light = paletteOf(wallpaperCss, 'light')
  if (!dark || !light) throw new Error('wallpaper.css does not state its palette')
  return { dark, light }
}

/** How long a side of the screen is, which is what the picture is stretched over. A
 *  window is moved between screens and resized, so the screen rather than the window. */
function screenSide(): number {
  return Math.max(screen.width, screen.height, window.innerWidth, window.innerHeight)
}

/** What the dial says now, in CSS pixels. */
function dialled(): number {
  return Number(theme.values.blur ?? 28)
}

class Wallpaper {
  /** What the window wears, or null for the accent field. */
  held = $state<Held | null>(heldWallpaper())

  /** The app's copy, decoded, once something has asked for it this run. */
  private source: Awaited<ReturnType<typeof decode>> | null = null
  /** Which picture is the latest asked for: a dial turned during a choice, or a
   *  second choice before the first was made, is not overtaken by the older one. */
  private asked = 0

  /** Written down once the dial has rested: a drag is a dozen pictures, and only the
   *  last of them is worth the disk. */
  private readonly keepLater = afterQuiet(() => {
    this.write()
    theme.rewear(WALLPAPER_THEME)
  }, 400)

  /** Takes a picture as the wallpaper: copies it, makes the window's picture, wears
   *  it, and puts the theme on if it was not. Answers whether it was taken. */
  async take(picture: Blob): Promise<boolean> {
    const asking = ++this.asked
    try {
      const copy = await copyOf(await decode(picture))
      const source = await decode(copy)
      if (asking !== this.asked) return false

      this.source = source
      void keepSource(copy)
      this.make(dialled())
      this.write()
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
  async choose(): Promise<void> {
    const [file] = await chooseFiles({ accept: PICTURES })
    if (file) await this.take(file)
  }

  /** A picture in one of the spaces, from its row in the file list. */
  async takeFrom(path: string): Promise<void> {
    const bytes = await fileBytes(path).catch(() => new Uint8Array())
    await this.take(new Blob([bytes as BlobPart]))
  }

  /** Back to the accent field: the copy and the picture both forgotten. */
  clear(): void {
    this.asked++
    this.source = null
    this.held = null
    this.keepLater.cancel()
    forget(WALLPAPER_KEY)
    void forgetSource()
    showPicture(undefined)
    theme.rewear(WALLPAPER_THEME)
  }

  /** The picture again at another blur, from the copy - out of the store if this run
   *  has not decoded it yet. */
  async reblur(blur: number): Promise<void> {
    if (!this.held || this.held.blur === blur) return

    const asking = ++this.asked
    if (!this.source) {
      const kept = await keptSource()
      const source = kept ? await decode(kept).catch(() => null) : null
      if (!source || asking !== this.asked) return
      this.source = source
    }

    this.make(blur)
    // Shown at once and kept nowhere while the dial moves; both once it rests.
    theme.rewear(WALLPAPER_THEME, false)
    this.keepLater()
  }

  private make(blur: number): void {
    if (!this.source) return
    this.held = made(this.source, blur, screenSide(), palettes())
    showPicture(this.held)
  }

  private write(): void {
    if (this.held && keep(WALLPAPER_KEY, JSON.stringify(this.held))) showPicture(undefined)
  }
}

export const wallpaper = new Wallpaper()

// The dial, followed for as long as the app runs once anything has fetched this. A
// frame's worth of turning is one picture: a new one is asked for only after the
// last has been made, so a fast drag skips the positions it passed over.
$effect.root(() => {
  let making = false
  let wanted: number | null = null

  const next = () => {
    if (making || wanted === null) return
    const blur = wanted
    wanted = null
    making = true
    void wallpaper.reblur(blur).finally(() => {
      making = false
      requestAnimationFrame(next)
    })
  }

  $effect(() => {
    // Only once the sheet's own dial has been read: before that the value is the
    // default, and a picture made at it would be made again a frame later.
    if (theme.id !== WALLPAPER_THEME || !theme.settings.some((one) => one.id === 'blur')) return
    wanted = dialled()
    next()
  })
})
