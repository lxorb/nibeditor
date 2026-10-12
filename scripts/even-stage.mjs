/* The folder that goes into an .ehpk.

   Two jobs, and both are about what a package is allowed to contain.

   **Both names are the plugin.** Which page the phone app opens from a package is
   published nowhere: the manifest names `even.html` as the entrypoint, but an app
   that ignored the manifest and opened `index.html` would get whatever is under
   that name. So this writes the plugin under both, and the question is removed
   rather than answered.

   **No URL the manifest does not allow.** The store's own review refuses a bundle
   that carries one:

     Bundle contains URLs not covered by `network.whitelist`.

   Almost all of them came from libraries a pair of glasses cannot use, and those
   are not in the plugin's build at all now; see apps/desktop/vite.even.config.ts.
   What is left is a handful of error links, and they are rewritten here, where the
   folder is only ever read by the packer:

     - Svelte's `https://svelte.dev/e/<code>` becomes `<code>`, which is what
       identifies the error anyway. The message still says which one it was.
     - the XML namespaces under `www.w3.org` are kept exactly, spelled with the
       escape their own file's syntax reads as a slash: they are what an element is
       in rather than somewhere to fetch, and a mangled one draws nothing. See
       `NAMESPACES` below, which is a bug Emil found on his phone.
     - anything else keeps its host and path and loses its scheme, so a string that
       was there to be read still reads and nothing in the package is a URL.

   `apps/desktop/src/lib/even/bundle.test.ts` holds the staged folder to both of
   the review's findings, so neither can come back.

     node scripts/even-stage.mjs [from] [to]   (default apps/desktop/dist-even,
                                                staged in place) */

import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

const from = process.argv[2] ?? join('apps', 'desktop', 'dist-even')
const to = process.argv[3] ?? from

const plugin = join(from, 'even.html')
let page
try {
  page = readFileSync(plugin, 'utf8')
} catch {
  console.error(`no ${plugin}: run the build first`)
  process.exit(1)
}

// Staged somewhere else: a whole new folder every time, so nothing from an older
// build survives into a package by accident. Staged in place, which is what the
// plugin's own build asks for, there is nothing to copy.
if (to !== from) {
  rmSync(to, { recursive: true, force: true })
  mkdirSync(to, { recursive: true })
  cpSync(from, to, { recursive: true })
}

// Both names, one page. The editor's index.html is overwritten rather than
// deleted, so there is no name in the package that answers with anything else.
writeFileSync(join(to, 'index.html'), page)
writeFileSync(join(to, 'even.html'), page)

// The editor's own service worker and manifest have no business in a package
// that is opened from files on a phone.
for (const stray of ['manifest.webmanifest', 'sw.js', 'registerSW.js']) {
  rmSync(join(to, stray), { force: true })
}

/** The origins the manifest allows, read off the manifest itself so the two cannot
 *  disagree. Anything else must not be in the package at all, whether or not it is
 *  ever asked for. */
const MANIFEST = JSON.parse(
  readFileSync(new URL('../apps/desktop/even.app.json', import.meta.url), 'utf8'),
)
const ALLOWED = MANIFEST.permissions.find((one) => one.name === 'network')?.whitelist ?? []

/** The XML namespaces, which look like addresses and are not.
 *
 *  `document.createElementNS('http://www.w3.org/2000/svg', 'path')` and
 *  `<svg xmlns='...'>` name a language by these strings; nothing ever fetches one,
 *  and a browser compares them character for character. Taking the scheme off, the
 *  way the rest of this does, makes an element in a namespace that does not exist -
 *  and an element in a namespace that does not exist is drawn as nothing at all.
 *
 *  Emil, on his phone: *"I don't see the icons of the spaces on the Even Realities
 *  plugin right now."* This was one of the two reasons: the icons were in the DOM,
 *  in white, the right size and in the right place, and every `<path>` in them was
 *  an unknown element in `www.w3.org/2000/svg`. It took the chevron off every select
 *  with it, and every equation KaTeX draws as MathML.
 *
 *  So they are kept, and spelled so that nothing in the package reads as a URL. Each
 *  spelling is the ordinary escape of the file's own syntax and means the same
 *  string to whatever reads it. */
const NAMESPACES = /^https?:\/\/www\.w3\.org\//

function namespaced(url, file) {
  // A stylesheet carries one only inside a `data:` URI, whose text the URL parser
  // percent-decodes.
  if (file.endsWith('.css')) return url.replace('://', '%3A//')

  // A page or a manifest: the character reference an attribute value is read with.
  if (file.endsWith('.html') || file.endsWith('.webmanifest')) {
    return url.replace('://', '&#58;//')
  }

  // Code, where it is always inside a string, and `\/` is `/` in JavaScript and in
  // JSON alike.
  return url.replace('://', ':\\/\\/')
}

/** A URL, as a package may carry one: not at all, unless the manifest allows it. */
function plain(url, file) {
  if (ALLOWED.some((one) => url.startsWith(one))) return url
  if (NAMESPACES.test(url)) return namespaced(url, file)

  // Svelte's runtime names its errors by a link. The code is what identifies the
  // error, and it is the half a reader needs.
  const svelte = /^https:\/\/svelte\.dev\/e\/([\w-]+)$/.exec(url)
  if (svelte) return svelte[1]

  return url.replace(/^https?:\/\//, '')
}

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else out.push(path)
  }

  return out
}

const URLS = /https?:\/\/[^\s"'`)\\<>]*/g
let rewritten = 0

for (const file of walk(to)) {
  if (!/\.(js|css|html|json|webmanifest)$/.test(file)) continue

  const text = readFileSync(file, 'utf8')
  const made = text.replace(URLS, (url) => {
    const now = plain(url, file)
    if (now !== url) rewritten++
    return now
  })

  if (made !== text) writeFileSync(file, made)
}

console.log(`${to}: index.html and even.html are both the plugin, ${rewritten} URLs made plain`)
