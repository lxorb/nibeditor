/** The app's own copy of the picture somebody chose, which the blur is made from.
 *
 *  A copy, never the file: nib opens nothing outside its spaces and links nothing
 *  either, and a wallpaper that named a file on somebody's disk would be a wallpaper
 *  that went blank the day the file moved - Windows Terminal's `backgroundImage` is a
 *  path, and its own documentation tells people to copy the picture into the app's
 *  folder first. So the picture is drawn into a canvas no larger than any blur needs
 *  and kept here, in the app's storage, and the original can go wherever it likes.
 *
 *  IndexedDB rather than local storage: a launch reads every entry of local storage
 *  before its first answer, and this is the one thing about the wallpaper the first
 *  frame never needs - that is the small blurred picture in held.ts. One database of
 *  its own with one entry, so nothing else's upgrade is ever this one's business.
 *  Every failure is nothing kept: the wallpaper still shows what held.ts has, and the
 *  dial asks for the picture again the next time it is chosen. */

const NAME = 'nib-wallpaper'
const STORE = 'picture'
const KEY = 'source'

let open: Promise<IDBDatabase> | null = null

function database(): Promise<IDBDatabase> {
  open ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('the wallpaper store did not open'))
  })
  // A refusal is not kept: a private window that refused once may be asked again.
  open.catch(() => (open = null))
  return open
}

function settled<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('the wallpaper store refused'))
  })
}

async function asked<T>(mode: IDBTransactionMode, ask: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await database()
  return settled(ask(db.transaction(STORE, mode).objectStore(STORE)))
}

/** Keeps the copy, in place of whatever was kept. Answers whether it was. */
export async function keepSource(picture: Blob): Promise<boolean> {
  try {
    await asked('readwrite', (store) => store.put(picture, KEY))
    return true
  } catch {
    return false
  }
}

/** The copy, or null where there is none or the store will not answer. */
export async function keptSource(): Promise<Blob | null> {
  try {
    const found: unknown = await asked('readonly', (store) => store.get(KEY))
    return found instanceof Blob ? found : null
  } catch {
    return null
  }
}

export async function forgetSource(): Promise<void> {
  try {
    await asked('readwrite', (store) => store.delete(KEY))
  } catch {
    // Nothing kept is what was asked for.
  }
}
