/** Orden's asset worker: the disk the browser build does not have.
 *
 *  A note writes `![](pictures/x.png)`, and that is the path the note keeps - in
 *  Orden, in Obsidian, in a text editor. On a desktop the webview is handed a URL
 *  for the file; in a browser the picture is a row in IndexedDB and the path is
 *  asked of the page's origin, where nothing answers. So the store gets an address
 *  and this answers it. See src/lib/web/asset-route.ts, which is the page's half
 *  of the same agreement.
 *
 *  It answers `/asset/…` and it touches nothing else. No app shell is cached, on
 *  purpose: a worker that serves the page would serve yesterday's page, and
 *  "nothing I changed reached the device" is the one bug nobody can see.
 *
 *  Plain JavaScript at the root of the site rather than a module built with the
 *  app, because a service worker is fetched before the app exists and runs where
 *  the app does not: `public/` puts this at `/sw.js` in dev and in the build
 *  alike, at the scope it needs, with no build step to keep in step and no
 *  browser left out - module service workers are still not everywhere. The price
 *  is that the three things below are said twice; asset-route.test.ts reads this
 *  file and holds the two copies to each other. */

/** The route, the store, and what the page calls its database. */
const ROUTE = '/asset/'
const DATABASE = 'nib'
const STORE = 'assets'

/** What a file's name says it holds. A browser will draw a JPEG announced as
 *  `image/jpg`; it will draw nothing at all for an SVG that is not
 *  `image/svg+xml`, which is why the name is asked before the row.
 *
 *  The app's own copy is src/lib/mime.ts, and asset-route.test.ts holds this one
 *  to it entry by entry. */
const TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  weba: 'audio/webm',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
}

const UNKNOWN_TYPE = 'application/octet-stream'

/** A picture Orden stored is named by the hash of its own bytes, so that address can
 *  never stand for anything else and is worth keeping for good. A file that came
 *  in under a name somebody chose can be replaced by different bytes tomorrow, so
 *  it is checked every time. */
const HASHED = /^[0-9a-f]{16,}\.[a-z0-9]+$/i
const FOREVER = 'public, max-age=31536000, immutable'
const EVERY_TIME = 'no-cache'

// Straight to work: a reader who has just loaded the page is looking at the note
// with the pictures in it, not waiting for another tab to close.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (event) => {
  if (!isOurs(event.request)) return
  event.respondWith(answer(event.request))
})

/** Whether this is the store being asked, as opposed to anything else the page
 *  fetches - which is left alone entirely, not even passed through. */
function isOurs(request) {
  if (request.method !== 'GET') return false

  const url = new URL(request.url)
  return url.origin === self.location.origin && url.pathname.startsWith(ROUTE)
}

async function answer(request) {
  const path = pathOf(new URL(request.url).pathname)
  if (!path) return missing()

  const row = await rowFor(path).catch(() => null)
  if (!row || typeof row.data !== 'string') return missing()

  const bytes = decode(row.data)
  if (!bytes) return missing()

  return new Response(bytes, {
    headers: {
      'Content-Type': typeOf(path, row.type),
      'Content-Length': String(bytes.length),
      'Cache-Control': HASHED.test(nameOf(path)) ? FOREVER : EVERY_TIME,
    },
  })
}

/** Nothing here. A 404 rather than an empty picture, so the `<img>` fails the way
 *  a missing file on a desktop fails and the same quiet placeholder appears. */
function missing() {
  return new Response(null, {
    status: 404,
    statusText: 'no such file in the space',
    headers: { 'Cache-Control': 'no-store' },
  })
}

/** The store path an address stands for, or null when it is not a path at all.
 *  Decoded a segment at a time, which is how the page encoded it. */
function pathOf(pathname) {
  const written = pathname.slice(ROUTE.length)
  if (!written) return null

  try {
    return `/${written.split('/').map(decodeURIComponent).join('/')}`
  } catch {
    return null
  }
}

function nameOf(path) {
  return path.slice(path.lastIndexOf('/') + 1)
}

function typeOf(path, stored) {
  // The same rule as `assetType` in src/lib/web/asset-route.ts: the name, then
  // what was written down beside the row, then bytes and no claim.
  const extension = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(path)
  const known = extension && TYPES[extension[1].toLowerCase()]
  return known || stored || UNKNOWN_TYPE
}

/** The row's base64 as bytes, or null for a row that is not base64 - which would
 *  be a row nothing this app wrote. */
function decode(base64) {
  try {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at)
    return bytes
  } catch {
    return null
  }
}

let opening = null

/** The page's own database, opened without a version: the page owns the schema,
 *  and a worker that named one would either upgrade it behind the page's back or
 *  block the page from upgrading it. Let go of the moment the page does want to
 *  upgrade, because an open connection is what a version change waits on. */
function database() {
  if (opening) return opening

  opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE)

    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => {
        db.close()
        opening = null
      }
      db.onclose = () => {
        opening = null
      }
      resolve(db)
    }
    request.onerror = () => {
      opening = null
      reject(request.error || new Error('the store would not open'))
    }
    request.onblocked = () => {
      opening = null
      reject(new Error('the store is busy'))
    }
  })

  return opening
}

async function rowFor(path) {
  const db = await database()
  // A browser that has never run the app has the database but not the store: a
  // picture cannot be there, and asking would throw.
  if (!db.objectStoreNames.contains(STORE)) return null

  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(path)
    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => reject(request.error || new Error('the row would not be read'))
  })
}
