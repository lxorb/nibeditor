/** The still a tab's hover card shows: the top of the page's last photograph, at the
 *  card's own size, made once per photograph and kept.
 *
 *  The photograph is the whole page at the screen's pixels - a few megabytes of PNG - and
 *  the card is a sixteen by nine window on it a quarter of a page wide. Handed the
 *  photograph itself, the card decoded those megabytes on every hover and showed an empty
 *  box until they were done. Chrome keeps a small picture per tab for its card instead
 *  (`ThumbnailTabHelper`), and so does this: one JPEG the card's size, decoded before the
 *  card asks for it. */

/** How many tabs' stills are kept. */
const KEEP = 32

/** Sixteen by nine, the card's still and Chrome's. */
const RATIO = 9 / 16

interface Kept {
  shot: string
  still: Promise<string>
}

const kept = new Map<string, Kept>()

/** The still for `tabId`'s photograph `shot`, `width` CSS pixels wide: made the first
 *  time it is asked for and the same promise every time after, until the tab has a new
 *  photograph. The photograph itself where no picture can be drawn. */
export function stillOf(tabId: string, shot: string, width: number): Promise<string> {
  const known = kept.get(tabId)
  if (known?.shot === shot) return known.still

  const still = made(shot, width)
  kept.delete(tabId)
  kept.set(tabId, { shot, still })
  // The oldest tab's goes: a map keeps the order things were put in it.
  const oldest = kept.keys().next().value
  if (kept.size > KEEP && oldest !== undefined) kept.delete(oldest)
  return still
}

/** The top of the photograph, cropped to sixteen by nine and scaled to `width` at the
 *  screen's density, as a JPEG. */
async function made(shot: string, width: number): Promise<string> {
  try {
    const page = new Image()
    page.src = shot
    await page.decode()

    const wide = Math.round(width * (window.devicePixelRatio || 1))
    const tall = Math.round(wide * RATIO)
    const canvas = document.createElement('canvas')
    canvas.width = wide
    canvas.height = tall
    const paint = canvas.getContext('2d')
    if (!paint || page.naturalWidth === 0) return shot

    const at = drawn(page.naturalWidth, page.naturalHeight, wide, tall)
    paint.imageSmoothingQuality = 'high'
    paint.drawImage(page, at.x, 0, at.width, at.height)

    const still = canvas.toDataURL('image/jpeg', 0.86)
    // Decoded now, so the card has it in the frame it arrives in.
    const ready = new Image()
    ready.src = still
    await ready.decode()
    return still
  } catch {
    return shot
  }
}

/** Where a photograph `width` by `height` is drawn on a still `wide` by `tall`: covering
 *  it from the top, as the card's `object-fit` would - the whole width of a page taller
 *  than sixteen by nine, the middle of one wider than that. Pure. */
export function drawn(
  width: number,
  height: number,
  wide: number,
  tall: number,
): { x: number; width: number; height: number } {
  const scale = Math.max(wide / width, tall / height)
  return { x: (wide - width * scale) / 2, width: width * scale, height: height * scale }
}
