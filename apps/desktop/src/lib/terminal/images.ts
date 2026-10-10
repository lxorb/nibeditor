/** A picture into a terminal on another machine (Emil, issue 228: _"inserting images into
 *  claude session with alt + v should also work"_).
 *
 *  A coding agent pastes a picture by reading the clipboard itself when its key is
 *  pressed - Claude Code's Alt+V on Windows and Ctrl+V elsewhere, through PowerShell,
 *  `xclip` or `wl-paste`. In a terminal on this computer that is this computer's clipboard,
 *  and the key only has to arrive, which it does (keys.ts). On another machine - a Remote
 *  host over `ssh`, or the online machine - it is that machine's clipboard, which is empty.
 *
 *  So there the picture is brought over and pasted as its path on that machine, which an
 *  agent takes as an image the way it takes one dragged onto a terminal - VS Code Remote's
 *  answer for the same question. Three ways in, each the one a terminal already has:
 *
 *  - the agent's own key, `imageKey`, with a picture on the clipboard; with none, the key
 *    goes on as it would have;
 *  - a paste with a picture and no text on the clipboard: Ctrl+V on Windows, Ctrl+Shift+V,
 *    Cmd+V, Shift+Insert, the menu;
 *  - a picture's row of the file list dropped on it.
 *
 *  How it travels is the source's: a second `ssh` to the host (`remote_image` in
 *  src-tauri/src/terminal/remote.rs), or parts up the online terminal's own socket
 *  (services/machine/src/images.ts). While it does, the line across the top of the panes
 *  sweeps, and says so where it could not. Fetched with the first picture. */

import { type ImageKind, MOST_IMAGE } from '@nib/online/wire'
import { busy } from '../busy.svelte'
import { fileBytes } from '../bytes'
import { t } from '../i18n.svelte'
import { imageKindAt, imageKindOf, spokenPath } from './paste'
import type { Source } from './source'

/** A picture to carry over: its kind, and its bytes when they are asked for. */
export interface Picture {
  kind: ImageKind
  bytes: () => Promise<Uint8Array>
}

/** A picture out of the clipboard or a paste, or null for anything an agent does not read. */
export function pictureOf(blob: Blob): Picture | null {
  const kind = imageKindOf(blob.type)
  return kind && { kind, bytes: async () => new Uint8Array(await blob.arrayBuffer()) }
}

/** A picture in a space, by its path, or null for a file that is not one. */
export function pictureAt(path: string): Picture | null {
  const kind = imageKindAt(path)
  return kind && { kind, bytes: () => fileBytes(path) }
}

/** The picture on the clipboard, asked for the way a key has to ask - text beside it or
 *  not, since the key is the agent's for a picture. Null where there is none, or where the
 *  clipboard may not be read. */
export async function clipboardPicture(): Promise<Picture | null> {
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((one) => imageKindOf(one) !== null)
      if (type) return pictureOf(await item.getType(type))
    }
  } catch {
    // Refused, or nothing there that reads: no picture.
  }
  return null
}

/** The pictures written on the machine `source` reaches, as the paste that names them
 *  there: their paths, a space apart, quoted where a shell would split one. Null where
 *  any could not be, which the line across the top of the panes says. */
export async function carried(source: Source, pictures: Picture[]): Promise<string | null> {
  const image = source.image?.bind(source)
  if (!image || !pictures.length) return null

  try {
    const paths = await busy.run(t('Sending the image'), async () => {
      const paths: string[] = []
      for (const picture of pictures) {
        const bytes = await picture.bytes()
        if (bytes.length > MOST_IMAGE) throw new Error('larger than a paste carries')
        paths.push(await image(bytes, picture.kind))
      }
      return paths
    })
    return paths.map((path) => spokenPath(path, '/bin/sh')).join(' ')
  } catch {
    busy.failed(t('Could not send the image'))
    return null
  }
}
