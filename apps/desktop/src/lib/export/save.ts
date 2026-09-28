/** Where a finished export ends up, which is the one part of exporting that is
 *  different on all three builds.
 *
 *  The desktop asks, in the system's own save dialog, starting in the folder the
 *  last export went to - nobody keeps their documents somewhere new each time.
 *  The browser hands the bytes to itself to download, because a page may not
 *  write a file. A phone has neither a dialog nor a downloads folder, so the file
 *  is written into the app's own documents folder, where the system's Files app
 *  can reach it.
 *
 *  Text and bytes take the same road. DOCX, ePub, JPG, PNG, a TextPack and the
 *  pictures inside a TextBundle are bytes, and `write_bytes` in the crate is the
 *  text writer's twin: the same path check, the same atomic write. */

import { toBase64 } from '../bytes'
import { keep, storedText } from '../stored'
import { folderOf } from '../space-paths'
import { invoke, isDesktop, isMobile, isNative, joinPath } from '../tauri'
import { writeBytes, writeFile as writeText } from '../workspace/write-file'
import { fileNameFor, freeName } from './naming'

/** What a converter produced. Text where the format is text, so a note that is
 *  written out as markdown is byte for byte what the editor holds. */
export type Payload =
  | { text: string; mime: string }
  | { bytes: Uint8Array; mime: string }
  /** Several files at once. `folder` says what the chosen target is: the folder
   *  they all go inside, which is what a `.textbundle` is, or the first file
   *  itself, with the rest landing beside it - a note and its `assets`. */
  | { files: readonly { path: string; body: string | Uint8Array }[]; folder: boolean }

/** Where the last export was written, remembered so the next one starts there. */
const FOLDER_KEY = 'nib:export-folder'

/** The folder inside the app's documents folder a phone writes exports into. */
const EXPORTS = 'Exports'

function remember(target: string) {
  const folder = folderOf(target)
  // Worth nothing, and never worth failing an export over.
  if (folder) keep(FOLDER_KEY, folder)
}

/** The save dialog, opened on the remembered folder. Answers null when the
 *  reader closes it, which is a cancelled export and not a failure. */
export async function chooseTarget(
  name: string,
  extension: string,
  label: string,
): Promise<string | null> {
  const { save } = await import('@tauri-apps/plugin-dialog')
  const file = fileNameFor(name, extension)
  // A browser told to keep no site data starts wherever the dialog last was.
  const folder = storedText(FOLDER_KEY)

  return save({
    defaultPath: folder ? joinPath(folder, file) : file,
    filters: [{ name: label, extensions: [extension] }],
  })
}

/** A browser has no file dialog to offer; the file is handed to it to save. */
export function download(name: string, payload: Payload) {
  // A browser cannot be handed a folder, so nothing gives it one: a TextBundle
  // is zipped into a TextPack before it gets here. See run.ts.
  if ('files' in payload) return

  const blob =
    'text' in payload
      ? new Blob([payload.text], { type: payload.mime })
      : // A fresh buffer, because a `Uint8Array` over a shared one is a view and
        // Blob would take the whole buffer behind it.
        new Blob([payload.bytes.slice()], { type: payload.mime })

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** One file onto the disk, text as text and bytes as bytes. Through the app's one
 *  write path, so an export saved into a space is a file its links reach at once;
 *  see workspace/write-file.ts. */
export async function writeFile(path: string, body: string | Uint8Array): Promise<void> {
  if (typeof body === 'string') return writeText(path, body)

  // Base64 rather than an array of numbers: a two megabyte picture as JSON
  // digits is twenty megabytes of text for the bridge to parse.
  return writeBytes(path, toBase64(body))
}

/** Whether a path out of a payload names one file under the folder it is joined
 *  onto, rather than a way out of it.
 *
 *  A package's paths are partly the note's own words - a picture is called after
 *  the `src` it was written with - so this is the last place that can tell a
 *  picture from a way up the disk. The names are cleaned where they are made; see
 *  `baseName` in pictures.ts. */
export function insideFolder(path: string): boolean {
  if (/^(?:[A-Za-z]:|[\\/])/.test(path)) return false
  return !path.split(/[\\/]/).includes('..')
}

async function writePayload(target: string, payload: Payload): Promise<void> {
  if ('files' in payload) {
    // Where they go: inside the target when it names a folder, beside it when it
    // names the first of them. One after another rather than all at once, since
    // they share a folder and two writes racing to create it is a race for
    // nothing.
    const root = payload.folder ? target : folderOf(target)
    for (const file of payload.files) {
      if (insideFolder(file.path)) await writeFile(joinPath(root, file.path), file.body)
    }
    return
  }

  await writeFile(target, 'text' in payload ? payload.text : payload.bytes)
}

/** Shows the finished file where the system shows files. A phone has no file
 *  manager to open, and a browser has its own downloads list. */
async function reveal(target: string): Promise<void> {
  if (!isDesktop) return

  const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
  await revealItemInDir(target).catch(() => undefined)
}

/** The names already in a folder, for the one build that has to avoid a
 *  collision itself. An unreadable folder reads as an empty one, which is the
 *  answer that lets the first export into a folder that is not there yet. */
async function namesIn(folder: string): Promise<Set<string>> {
  interface Entry {
    name: string
    children: Entry[]
  }

  const tree = await invoke<Entry>('read_tree', { root: folder }).catch(() => null)
  return new Set((tree?.children ?? []).map((child) => child.name))
}

/** Writes into the app's own documents folder, which is the only place a phone
 *  build can put a file the system will still show afterwards. */
async function saveOnPhone(file: string, payload: Payload): Promise<string> {
  const root = await invoke<string>('spaces_root')
  const folder = joinPath(root, EXPORTS)
  const target = joinPath(folder, freeName(file, await namesIn(folder)))

  await writePayload(target, payload)
  return target
}

/** Hands the finished export over, and answers where it went - or null when the
 *  reader closed the dialog.
 *
 *  `label` is what the dialog calls the kind of file, and is already translated
 *  where it needs to be. */
export async function deliver(
  name: string,
  extension: string,
  label: string,
  payload: Payload,
): Promise<string | null> {
  const file = fileNameFor(name, extension)

  if (!isNative) {
    download(file, payload)
    return file
  }

  if (isMobile) return saveOnPhone(file, payload)

  const target = await chooseTarget(name, extension, label)
  if (!target) return null

  await writePayload(target, payload)
  remember(target)
  await reveal(target)

  return target
}
