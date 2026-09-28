/** A picture put on the clipboard as a picture, for the row on its menu: pasted into a
 *  mail, a chat or another editor, it arrives as the picture rather than as its path.
 *
 *  PNG whatever the file is, because PNG is the one kind of picture every platform's
 *  clipboard takes from a web page; anything else is drawn into one first. Handed over
 *  as a promise rather than awaited, which is what WebKit asks for: the write has to
 *  begin inside the press that asked for it, and the bytes may arrive after. */

export async function copyPicture(url: string): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngOf(url) })])
}

async function pngOf(url: string): Promise<Blob> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} answered ${String(response.status)}`)

  const blob = await response.blob()
  return blob.type === 'image/png' ? blob : drawn(blob)
}

/** Any picture the page can show, as PNG. Through an object URL, which is this page's
 *  own, so the canvas is never tainted by where the picture came from. */
async function drawn(blob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = url
    await image.decode()

    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    canvas.getContext('2d')?.drawImage(image, 0, 0)

    return await new Promise((resolve, reject) => {
      canvas.toBlob((png) => {
        if (png) resolve(png)
        else reject(new Error('the picture could not be drawn'))
      }, 'image/png')
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}
