/** Turning a recording that is already in a note into words, and writing them under
 *  it.
 *
 *  Its own module rather than part of commands.ts, because nothing here is any use
 *  until somebody presses Transcribe on an embed's menu: it reads the whole file into
 *  memory, sends it through the Whisper path a piece at a time and writes what came
 *  back as a callout, which brings the transcript's own markdown with it. The row that
 *  offers it is a regular expression over one line, and that stays where the menus can
 *  read it; see commands.ts. */

import type { EditorView } from '@nib/editor'
import { busy } from '../busy.svelte'
import { i18n, key, message, t } from '../i18n.svelte'
import { links } from '../link-index.svelte'
import { settings } from '../settings.svelte'
import { assetUrl, joinPath } from '../tauri'
import { workspace } from '../workspace.svelte'
import { transcribedBy, wordsInFile } from './transcribe'
import { languageName, transcriptCallout } from './transcript'

/** The recording named by an embed, as bytes, or null where the space has no such
 *  file.
 *
 *  Asked for at the very address the player is pointed at, which is the asset protocol
 *  in the app and the asset worker in a browser, so this cannot come to a different
 *  answer about where a file is than the thing that plays it. The same resolution too:
 *  a bare name is looked for anywhere in the space, anything else is a path beside the
 *  note. See note-images.ts. */
async function bytesOf(target: string, notePath: string | null): Promise<ArrayBuffer | null> {
  const root = workspace.activeSpace?.root
  const found = root && !target.includes('/') ? links.fileNamed(target) : null
  const path = found && root ? joinPath(root, found) : beside(notePath, target)
  if (!path) return null

  const response = await fetch(assetUrl(path)).catch(() => null)
  return response?.ok ? response.arrayBuffer() : null
}

function beside(notePath: string | null, target: string): string | null {
  if (!notePath) return null
  return joinPath(notePath.replace(/[\\/][^\\/]*$/, ''), target)
}

/** Writes the words of a recording under the line its embed is on.
 *
 *  Under it rather than in place of it: the sound is the record and the transcript is a
 *  reading of it, and a reading that replaced the recording would throw away the one
 *  thing that cannot be got back. */
export async function transcribeInto(view: EditorView, at: number, target: string) {
  const note = workspace.active
  const line = view.state.doc.lineAt(at)

  try {
    const words = await busy.run(t('Turning the recording into words'), async () => {
      const bytes = await bytesOf(target, note?.path ?? null)
      if (!bytes) throw new Error(key('That recording is not in this space.'))

      return wordsInFile(bytes)
    })

    if (!words.text) {
      settings.error = t('Nothing could be heard in that recording.')
      return
    }

    const said = transcriptCallout(
      words.text,
      words.language ? languageName(words.language, i18n.language) : '',
      transcribedBy(),
    )

    view.dispatch({
      changes: { from: line.to, to: line.to, insert: `\n\n${said}` },
      userEvent: 'input.complete',
    })
  } catch (error) {
    settings.error = message(error, key('That recording could not be turned into words.'))
  }
}
