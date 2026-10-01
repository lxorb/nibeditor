/** The engine's world inside the app: files through the crate's commands (or the
 *  browser build's stand-ins for them), the account through `fetch`, and the workspace
 *  told about every file the engine moves or takes away, so everything kept by path
 *  follows (workspace/file-ops.ts).
 *
 *  A file the engine writes is a note no tab is holding - one a tab holds is written by
 *  autosave - so it is said to the list and the link index as a file written over or a
 *  file come, never as an edit to an open document. */

import { api, BASE } from '../api'
import { sha256 } from '../bytes'
import { deviceName } from '../device'
import { links } from '../link-index.svelte'
import { invoke, joinPath, platform } from '../tauri'
import { accountOver } from './transport'
import type { Disk, FileKind, World } from './world'

/** What the engine's own changes to the disk owe the rest of the app. */
export interface Telling {
  /** A path the engine is about to move or take away: what the folder's watcher will
   *  report next is the engine's own doing. */
  touching(path: string): void
  /** A file or folder the engine moved, for everything kept by path. */
  moved(from: string, to: string, kind: FileKind): Promise<void>
  /** One it took away. */
  gone(path: string, kind: FileKind): Promise<void>
  /** One it wrote: `fresh` when nothing was there before. */
  written(path: string, fresh: boolean): void
}

function parentOf(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at > 0 ? path.slice(0, at) : path
}

async function stamped(path: string): Promise<boolean> {
  return (await invoke<unknown>('file_stamp', { path }).catch(() => null)) !== null
}

function diskOf(telling: Telling): Disk {
  return {
    read: (path) => invoke<string>('read_note', { path }).catch(() => null),
    async write(path, text) {
      const fresh = !(await stamped(path))
      await invoke('create_folder', { path: parentOf(path) }).catch(() => undefined)
      await invoke('write_note', { path, content: text })
      links.noteSaved(path, text)
      telling.written(path, fresh)
    },
    keep: (path, text) =>
      invoke('snapshot_note', { path, content: text }).then(
        () => undefined,
        () => undefined,
      ),
    async move(from, to, kind) {
      telling.touching(from)
      telling.touching(to)
      await invoke('create_folder', { path: parentOf(to) }).catch(() => undefined)
      await invoke('rename_note', { from, to })
      await telling.moved(from, to, kind)
    },
    async remove(path, kind) {
      telling.touching(path)
      // To this device's trash, with a version of the words kept first, the way a
      // delete made here keeps one: a note another device deleted is still a note
      // somebody might want back.
      if (kind === 'file') {
        const words = await invoke<string>('read_note', { path }).catch(() => null)
        if (words?.trim()) await invoke('snapshot_note', { path, content: words }).catch(() => undefined)
      }
      await invoke('trash_item', { path, kind: kind === 'folder' ? 'folder' : 'note' })
      await telling.gone(path, kind)
    },
    mkdir: (path) => invoke('create_folder', { path }).then(() => undefined),
    exists: stamped,
  }
}

/** Every file and folder under a space's root, from the tree the list reads. */
interface Listed {
  path: string
  is_dir: boolean
  children?: Listed[]
}

async function listed(root: string): Promise<{ path: string; dir: boolean }[]> {
  // What the list shows, as v1 sends it: the dotted files are the app's own.
  const tree = await invoke<Listed>('read_tree', { root, options: { showHidden: false } }).catch(
    () => null,
  )
  const out: { path: string; dir: boolean }[] = []
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const walk = (node: Listed) => {
    for (const child of node.children ?? []) {
      const path = child.path.replace(/\\/g, '/')
      if (!path.startsWith(`${base}/`)) continue
      out.push({ path: path.slice(base.length + 1), dir: child.is_dir })
      if (child.is_dir) walk(child)
    }
  }
  if (tree) walk(tree)
  return out
}

/** The app's world for one account's engine. */
export function appWorld(token: () => string | null, telling: Telling): World {
  const os = platform()
  return {
    disk: diskOf(telling),
    account: accountOver({ base: BASE, token, device: deviceName, fetch: (request) => fetch(request) }),
    name: deviceName(),
    now: () => Date.now(),
    random: () => (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) / 0x100000000,
    digest: (text) => sha256(text),
    join: joinPath,
    foldsCase: os === 'windows' || os === 'macos' || os === 'ios' || os === '',
    platform: os === 'windows' ? 'windows' : os === 'macos' || os === 'ios' ? 'mac' : 'other',
    list: listed,
    async ancestor(id, hash) {
      const session = token()
      if (!session) return null
      const { versions } = await api.noteVersions(session, id).catch(() => ({ versions: [] }))
      // Newest first, and only so far back: the words v1 last agreed on are recent.
      for (const version of versions.slice(0, 20)) {
        const body = await api.noteVersion(session, id, version.at).catch(() => null)
        if (body && (await sha256(body.content.replace(/\r\n?/g, '\n'))) === hash) return body.content
        if (body && (await sha256(body.content)) === hash) return body.content
      }
      return null
    },
  }
}
