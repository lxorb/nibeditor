/** Gives a Chromium runtime the size of the copy already on `updates`.
 *
 *  `updates` keeps the first runtime a release uploaded (release.yml, the step that
 *  finds them), so a later release names that file in its manifest rather than the
 *  one it packed itself: its signature replaces this build's beside the archive, and
 *  this puts its size into every row that names it (`chromium-<platform>.json`,
 *  apps/desktop/src-tauri/cef/pack.py), which is what the progress counts against.
 *
 *    node scripts/runtime-size.mjs artifacts chromium-runtime-152.0.6-windows-x86_64.tar.gz 182659068
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [, , root, name, given] = process.argv
const size = Number(given)
if (!root || !name || !Number.isSafeInteger(size) || size <= 0) {
  console.error('usage: runtime-size.mjs <artifacts-dir> <runtime-name> <size>')
  process.exit(1)
}

function walk(dir) {
  const out = []
  for (const one of readdirSync(dir)) {
    const path = join(dir, one)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else out.push(path)
  }
  return out
}

let rows = 0
for (const path of walk(root).filter((one) => /chromium-[a-z0-9_-]+\.json$/.test(one))) {
  const row = JSON.parse(readFileSync(path, 'utf8'))
  if (row.runtime?.name !== name) continue
  row.runtime.size = size
  writeFileSync(path, `${JSON.stringify(row, null, 2)}\n`)
  rows++
}

// A runtime no row names would be one this build never packed.
if (!rows) {
  console.error(`no row names ${name}`)
  process.exit(1)
}
