/** A disk of files and folders in memory, for the engine under test: the simulator's
 *  devices and the tests that run the engine against the Worker. Paths compare without
 *  case, as on Windows and a Mac. */

import { nameKey } from '@nib/sync-core/tree'
import { folderOf } from './places'
import type { Disk } from './world'

/** A disk of files and folders in memory. */
export class MemoryDisk implements Disk {
  readonly files = new Map<string, string>()
  /** Files that are not documents, as their bytes (files.ts). */
  readonly bytes = new Map<string, Uint8Array>()
  readonly folders = new Set<string>()

  readBytes(path: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.bytes.get(path) ?? null)
  }

  writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    this.mkdirNow(folderOf(path))
    this.bytes.set(path, bytes)
    return Promise.resolve()
  }

  read(path: string): Promise<string | null> {
    return Promise.resolve(this.files.get(path) ?? null)
  }

  write(path: string, text: string): Promise<void> {
    this.mkdirNow(folderOf(path))
    this.files.set(path, text)
    return Promise.resolve()
  }

  keep(): Promise<void> {
    return Promise.resolve()
  }

  move(from: string, to: string): Promise<void> {
    this.mkdirNow(folderOf(to))
    for (const held of [this.files, this.bytes] as Map<string, unknown>[]) {
      for (const [path, what] of [...held]) {
        if (path !== from && !path.startsWith(`${from}/`)) continue
        held.delete(path)
        held.set(`${to}${path.slice(from.length)}`, what)
      }
    }
    for (const path of [...this.folders]) {
      if (path !== from && !path.startsWith(`${from}/`)) continue
      this.folders.delete(path)
      this.folders.add(`${to}${path.slice(from.length)}`)
    }
    return Promise.resolve()
  }

  remove(path: string): Promise<void> {
    for (const held of [this.files, this.bytes] as Map<string, unknown>[]) {
      for (const one of [...held.keys()]) {
        if (one === path || one.startsWith(`${path}/`)) held.delete(one)
      }
    }
    for (const one of [...this.folders]) {
      if (one === path || one.startsWith(`${path}/`)) this.folders.delete(one)
    }
    return Promise.resolve()
  }

  mkdir(path: string): Promise<void> {
    this.mkdirNow(path)
    return Promise.resolve()
  }

  private mkdirNow(path: string) {
    for (let at = path; at && at !== '/'; at = folderOf(at)) this.folders.add(at)
  }

  exists(path: string): Promise<boolean> {
    const key = nameKey(path)
    for (const one of [...this.files.keys(), ...this.bytes.keys(), ...this.folders]) {
      if (nameKey(one) === key) return Promise.resolve(true)
    }
    return Promise.resolve(false)
  }
}
