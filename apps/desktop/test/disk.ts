/** A disk in memory, answering the crate's commands a store test needs: notes and
 *  folders, a listing, renames, deletes, a trash and a stamp.
 *
 *  `folds` makes it the disk Windows and a Mac have, which looks `plan.md` up as
 *  `Plan.md` and keeps a file under the spelling it was made with - the one thing a
 *  test about two spellings of one file needs a disk to do. */

export interface Entry {
  name: string
  path: string
  is_dir: boolean
  modified: number
  created: number
  children: Entry[]
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')

export class Disk {
  /** Every file, under the spelling it was made with. */
  readonly files = new Map<string, string>()
  readonly folders = new Set<string>()
  /** Every command asked, with the path it named. */
  readonly sent: string[] = []
  private readonly trash = new Map<string, { path: string; text: string }>()

  constructor(public folds = false) {}

  /** The spelling a path is kept under, or null for a path nothing answers to. */
  spelled(path: string): string | null {
    if (this.files.has(path) || this.folders.has(path)) return path
    if (!this.folds) return null

    const wanted = path.toLowerCase()
    for (const one of [...this.files.keys(), ...this.folders]) {
      if (one.toLowerCase() === wanted) return one
    }
    return null
  }

  private under(one: string, root: string): boolean {
    const a = this.folds ? one.toLowerCase() : one
    const b = this.folds ? root.toLowerCase() : root
    return a === b || a.startsWith(`${b}/`)
  }

  reset() {
    this.files.clear()
    this.folders.clear()
    this.trash.clear()
    this.sent.length = 0
  }

  invoke = (command: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    const path = text(args.path)
    this.sent.push(`${command} ${path || text(args.from) || text(args.root)}`)

    try {
      return Promise.resolve(this.answer(command, args, path))
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private answer(command: string, args: Record<string, unknown>, path: string): unknown {
    switch (command) {
      case 'read_note': {
        const at = this.spelled(path)
        const held = at === null ? undefined : this.files.get(at)
        if (held === undefined) throw new Error(`no such note: ${path}`)
        return held
      }
      case 'write_note':
        this.files.set(this.spelled(path) ?? path, text(args.content))
        return undefined
      case 'rename_note': {
        const from = this.spelled(text(args.from))
        const to = text(args.to)
        if (from === null) throw new Error('nothing to rename')
        const taken = this.spelled(to)
        if (taken !== null && taken !== from) throw new Error('something already lives there')

        for (const [one, words] of [...this.files]) {
          if (!this.under(one, from)) continue
          this.files.delete(one)
          this.files.set(to + one.slice(from.length), words)
        }
        for (const one of [...this.folders]) {
          if (!this.under(one, from)) continue
          this.folders.delete(one)
          this.folders.add(to + one.slice(from.length))
        }
        return undefined
      }
      case 'delete_note':
      case 'delete_folder':
      case 'remove_empty_folder': {
        const at = this.spelled(path) ?? path
        for (const one of [...this.files.keys()]) if (this.under(one, at)) this.files.delete(one)
        for (const one of [...this.folders]) if (this.under(one, at)) this.folders.delete(one)
        return undefined
      }
      case 'trash_item': {
        const at = this.spelled(path) ?? path
        const id = `trash-${this.trash.size + 1}`
        this.trash.set(id, { path: at, text: this.files.get(at) ?? '' })
        this.files.delete(at)
        return { id }
      }
      case 'restore_trash': {
        const kept = this.trash.get(text(args.id))
        if (!kept) throw new Error('not in the trash')
        this.files.set(kept.path, kept.text)
        this.trash.delete(text(args.id))
        return kept.path
      }
      case 'read_tree':
        return this.listing(text(args.root))
      case 'file_stamp':
        return this.spelled(path) === null ? null : { modified: 1, len: 1 }
      default:
        return undefined
    }
  }

  /** The listing of a space, folders first and names in order, as the crate reads one. */
  listing(root: string): Entry {
    const entry = (at: string, folder: boolean): Entry => ({
      name: at.slice(at.lastIndexOf('/') + 1),
      path: at,
      is_dir: folder,
      modified: 0,
      created: 0,
      children: [],
    })
    const tree = entry(root, true)
    const at = new Map<string, Entry>([[root, tree]])
    const folderFor = (path: string): Entry => {
      const found = at.get(path)
      if (found) return found

      const made = entry(path, true)
      at.set(path, made)
      folderFor(path.slice(0, path.lastIndexOf('/'))).children.push(made)
      return made
    }

    for (const path of [...this.folders].sort()) if (path.startsWith(`${root}/`)) folderFor(path)
    for (const path of [...this.files.keys()].sort()) {
      if (!path.startsWith(`${root}/`)) continue
      folderFor(path.slice(0, path.lastIndexOf('/'))).children.push(entry(path, false))
    }

    const order = (one: Entry): Entry => ({
      ...one,
      children: [...one.children]
        .sort((a, b) => (a.is_dir === b.is_dir ? 0 : a.is_dir ? -1 : 1))
        .map(order),
    })
    return order(tree)
  }
}

/** A storage in memory, for a store that reads its own the moment it is made. */
export function memoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}
