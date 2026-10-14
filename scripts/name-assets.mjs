/** Renames built bundles to something a person can read before downloading.
 *
 *  Tauri names them after build triples and packaging conventions, so the same
 *  release carries `Orden_0.14.0_x64-setup.exe`, `Orden_0.14.0_amd64.AppImage`
 *  and `Orden-0.14.0-1.x86_64.rpm` - three spellings of the architecture and no
 *  word saying which operating system any of them is for.
 *
 *    node scripts/name-assets.mjs artifacts 0.1.0
 *
 *  Each artifact directory is named `nib-<platform>-<arch>` by the build
 *  matrix, which is exactly the label the file should carry. Underneath it the
 *  uploader keeps Tauri's own `nsis/`, `msi/`, `dmg/` folders, so the search
 *  goes all the way down rather than one level. Signatures are renamed with
 *  the bundle they belong to, so the update manifest still pairs them up.
 */

import { readdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Longest first: `.app.tar.gz` has to win over `.gz`. */
const KINDS = ['.app.tar.gz', '-setup.exe', '.AppImage', '.msi', '.dmg', '.deb', '.rpm']

const [, , root, given] = process.argv
if (!root || !given) {
  console.error('usage: name-assets.mjs <artifacts-dir> <version>')
  process.exit(1)
}

// A tag carries a `v`; the filenames should not say `Nib-v0.1.0`.
const version = given.replace(/^v/, '')

/** Every file under `dir`, however deep Tauri's own folders go. */
function filesIn(dir) {
  const out = []

  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...filesIn(path))
    else out.push(path)
  }

  return out
}

let renamed = 0

for (const dir of readdirSync(root)) {
  const full = join(root, dir)
  if (!statSync(full).isDirectory()) continue

  // `nib-windows-x64` is the artifact directory the matrix produced. The label
  // says `Nib-` whatever the product is called: every build from before the
  // rename takes an update only from a file whose name starts with it, and one
  // manifest serves them all (`names()` in src-tauri/src/updates.rs). The copies
  // a release's own page carries are called Orden (release.yml, `publish`).
  const label = `Nib-${version}-${dir.replace(/^nib-/, '')}`

  for (const path of filesIn(full)) {
    const name = path.split(/[\\/]/).pop()

    // A signature follows whatever it signs, and is renamed with it.
    const bare = name.endsWith('.sig') ? name.slice(0, -'.sig'.length) : name
    const kind = KINDS.find((one) => bare.endsWith(one))
    if (!kind) continue

    const wanted = label + kind + (name === bare ? '' : '.sig')
    if (wanted === name) continue

    renameSync(path, join(path.slice(0, -name.length), wanted))
    console.error(`${name} -> ${wanted}`)
    renamed++
  }
}

// Silence here used to mean the layout had changed underneath and every file
// kept its old name, which is not something to discover on a release page.
if (!renamed) {
  console.error(`no bundles found under ${root} - has the artifact layout changed?`)
  process.exit(1)
}
