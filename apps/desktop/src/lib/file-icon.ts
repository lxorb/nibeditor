/** Giving a file an icon, and taking it away again.
 *
 *  It goes in the file itself, which is the one place that makes it the file's
 *  rather than this machine's: it syncs with the file, it survives a copy to
 *  another vault, and Obsidian reads it as metadata like any other. A note says it
 *  under `icon:` in its front matter; a canvas says it under `nib.icon`, because
 *  JSON has no front matter and that key is the one place the JSON Canvas spec
 *  leaves for something no other app has to look at. A chat says it in its `.chat`
 *  pointer, beside the id, which is the one file a chat has. See icons.ts for what
 *  the value says.
 *
 *  A space's icon is a device's own choice and lives in this device's store, and a
 *  folder's is a per-space map, because neither is a file with anywhere to keep
 *  one; see workspace/device.svelte.ts and workspace/folder-icons.svelte.ts.
 *
 *  Written the way renaming a tag is written, and for the same reason: through
 *  the workspace, as an edit the size of the words that changed. So a note open
 *  in a pane takes the change in its editor rather than being read back off the
 *  disk under its reader's caret, an open canvas takes it in the plane it is
 *  drawn from, the version before it is snapshotted, and one undo puts it back.
 *  See tag-edits.ts, which is the same shape of change. */

import { frontMatterEdits } from '@nib/markdown/front-matter'
import { isCanvasTarget, isChatTarget, isPagesTarget } from '@nib/markdown/links'
import { oneEdit, type TextEdit } from '@nib/markdown/edits'
import { isFolderNote } from './folder-notes'
import { ICON_COLOUR_KEY, ICON_KEY, readTint } from './icons'
import { key, message } from './i18n.svelte'
import { changeOf } from './search/replace'
import { settings } from './settings.svelte'
import { folderOf } from './space-paths'
import { workspace } from './workspace.svelte'

/** Writes the icon a note or a canvas wears, or takes it away when `value` is null.
 *
 *  `value` is the written form the picker composed - an emoji, a Lucide name, or
 *  `set:name`; see `writtenIcon` in icons.ts. `tint` is the colour a stroked icon is
 *  drawn in, and goes in beside it under a key of its own so that another app reading
 *  the file still finds the icon. Both in one write, so choosing an icon is one thing
 *  to undo.
 *
 *  Nothing is written where the file already says that, so choosing the icon it
 *  already wears costs no file, no snapshot and no undo step.
 *
 *  A file that cannot be written says so, the way renaming a tag does: this is
 *  somebody's file, and an icon that silently did not arrive would look like the
 *  picker being broken. */
export async function setFileIcon(
  path: string,
  value: string | null,
  tint: string | null = null,
): Promise<void> {
  const before = await workspace.noteText(path)
  if (before === null) return

  // `A/A.md` and `A/` are one row, so the file is where that row's icon is kept
  // from here on and the space's map stops having a say about the folder. The map
  // is what dressed the row while the folder had no note - a folder out of
  // somebody's vault - and two places to keep one icon is one of them going
  // stale. See chosen-icon.ts and workspace/folder-icons.svelte.ts.
  if (isFolderNote(path)) workspace.setFolderIcon(folderOf(path), null)

  // A colour with no icon to colour is not a colour, and a tint this build has never
  // heard of is not one either: both come out as no key at all.
  const colour = value === null ? null : readTint(tint)

  // A page note keeps its icon where a canvas keeps one, because it is the same
  // JSON: `nib.icon`, written by the same edit.
  //
  // The reader that makes the canvas edit is fetched rather than imported: it is the
  // whole of JSON Canvas, and this one line was the last thing holding it in front of
  // the first paint. Asked for here, where somebody has chosen an icon for a plane, and
  // never for a note; see scan-canvas.ts, which is fetched the same way.
  const edit = isChatTarget(path)
    ? await chatIconEdit(before, value, colour)
    : isCanvasTarget(path) || isPagesTarget(path)
      ? (await import('@nib/markdown/canvas')).canvasIconEdit(before, value, colour)
      : frontMatterEdits(before, [
          [ICON_KEY, value],
          [ICON_COLOUR_KEY, colour],
        ])
  if (!edit) return

  try {
    await workspace.replaceInNotes([changeOf(path, before, [edit])])
  } catch (error) {
    settings.error = message(error, key('That icon could not be written.'))
  }
}

/** A chat's pointer written again wearing the icon, as the smallest edit there is, or
 *  null where it already does or the file is no pointer. The pointer's reader is the
 *  chats' own, fetched here as the canvas's is above. */
async function chatIconEdit(
  before: string,
  icon: string | null,
  colour: string | null,
): Promise<TextEdit | null> {
  if (__EVEN_PLUGIN__) return null
  const { chatOf, chatText, withIcon } = await import('@nib/chats')
  const pointer = chatOf(before)
  return pointer && oneEdit(before, chatText(withIcon(pointer, icon, colour)))
}
