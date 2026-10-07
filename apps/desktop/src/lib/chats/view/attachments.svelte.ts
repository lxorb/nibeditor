/** The files waiting in a composer (docs/chats.md 4.15): dropped anywhere on the chat,
 *  pasted, or picked, each a chip that goes up as a blob the moment it lands, so Send
 *  has nothing left to wait for by the time the words are written. A message carries at
 *  most `MOST_FILES`. */

import type { FileRef } from '@nib/chats'
import { MOST_FILES } from '@nib/chats/limits'
import { prepared } from './prepare'
import { store } from './source.svelte'

/** A file's bytes up to the account; answers its hash, and throws where it could not go. */
export async function put(file: Blob): Promise<string> {
  const hash = await store().upload(new Uint8Array(await file.arrayBuffer()))
  if (!hash) throw new Error('the file did not go up')
  return hash
}

export interface Attachment {
  id: number
  name: string
  type: string
  size: number
  /** A picture of it while it is here, for a picture's chip. */
  thumb: string | null
  ref: FileRef | null
  failed: boolean
}

let made = 0

export class Attachments {
  list = $state<Attachment[]>([])

  get ready(): boolean {
    return this.list.every((one) => one.ref !== null || one.failed)
  }

  get refs(): FileRef[] {
    return this.list.flatMap((one) => (one.ref ? [one.ref] : []))
  }

  add(files: readonly File[]): void {
    for (const file of files.slice(0, MOST_FILES - this.list.length)) {
      const id = (made += 1)
      this.list = [
        ...this.list,
        {
          id,
          name: file.name,
          type: file.type,
          size: file.size,
          thumb: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
          ref: null,
          failed: false,
        },
      ]
      void this.send(id, file)
    }
  }

  /** A file made ready elsewhere, already up: a voice message. */
  addRef(ref: FileRef): void {
    const id = (made += 1)
    this.list = [
      ...this.list,
      { id, name: ref.name, type: ref.type, size: ref.size, thumb: null, ref, failed: false },
    ]
  }

  remove(id: number): void {
    const gone = this.list.find((one) => one.id === id)
    if (gone?.thumb) URL.revokeObjectURL(gone.thumb)
    this.list = this.list.filter((one) => one.id !== id)
  }

  clear(): void {
    for (const one of this.list) if (one.thumb) URL.revokeObjectURL(one.thumb)
    this.list = []
  }

  private async send(id: number, file: File): Promise<void> {
    try {
      const ready = await prepared(file)
      const [hash, preview] = await Promise.all([
        put(ready.blob),
        ready.preview ? put(ready.preview) : Promise.resolve(undefined),
      ])
      const ref: FileRef = {
        hash,
        name: ready.name,
        size: ready.blob.size,
        type: ready.type,
        ...(ready.width ? { width: ready.width } : {}),
        ...(ready.height ? { height: ready.height } : {}),
        ...(preview ? { preview } : {}),
        ...(ready.seconds ? { seconds: ready.seconds } : {}),
        ...(ready.wave ? { wave: ready.wave } : {}),
      }
      this.list = this.list.map((one) => (one.id === id ? { ...one, ref } : one))
    } catch {
      this.list = this.list.map((one) => (one.id === id ? { ...one, failed: true } : one))
    }
  }
}
