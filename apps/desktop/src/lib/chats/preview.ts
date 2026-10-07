/** A link's preview for a message the reader is writing (docs/chats.md 4.8): the crate
 *  reads the page (src-tauri/src/link_preview.rs), and its picture goes up as a blob,
 *  made small first, so the message names it by hash and nobody who reads the message
 *  ever asks the site. A desktop's alone; elsewhere a message has no preview. */

import type { Preview } from '@nib/chats'
import { isRecord, isString } from '../stored'
import { invoke, isDesktop } from '../tauri'

/** The widest a preview's picture is kept. */
const WIDEST = 480

/** A picture's bytes made small, as WebP; the bytes as they were where the window cannot
 *  draw them. */
async function smaller(bytes: Uint8Array, type: string): Promise<Uint8Array> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return bytes
  try {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type }))
    const scale = Math.min(1, WIDEST / bitmap.width)
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale)),
    )
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 })
    return new Uint8Array(await blob.arrayBuffer())
  } catch {
    return bytes
  }
}

function bytesOf(base64: string): Uint8Array {
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let at = 0; at < raw.length; at++) out[at] = raw.charCodeAt(at)
  return out
}

/** The preview of a link, its picture uploaded with `upload`; null for none. */
export async function previewOf(
  url: string,
  upload: (bytes: Uint8Array) => Promise<string | null>,
): Promise<Preview | null> {
  if (!isDesktop || !/^https?:\/\//i.test(url)) return null
  const page = await invoke<unknown>('link_preview', { url }).catch(() => null)
  if (!isRecord(page) || !isString(page.url) || !isString(page.title) || !page.title) return null

  const preview: Preview = { url: page.url, title: page.title }
  if (isString(page.site) && page.site) preview.site = page.site
  if (isString(page.text) && page.text) preview.text = page.text
  if (isString(page.picture) && isString(page.pictureType)) {
    const picture = await smaller(bytesOf(page.picture), page.pictureType)
    const hash = await upload(picture)
    if (hash) preview.picture = hash
  }
  return preview
}
