/** Builds the `chromium.json` a release carries for nib's own Chromium.
 *
 *  The Browser setting fetches the engine from the release the app came from (see
 *  apps/desktop/src-tauri/src/engine_switch/fetch.rs), and this is what it reads first:
 *  which two archives each platform needs, how big they are, and the signature the
 *  updater's key gave each. Every platform's job wrote its own row
 *  (`chromium-<platform>.json`, apps/desktop/src-tauri/cef/pack.py) and signed its
 *  archives, leaving a `.sig` beside each; this puts the rows together.
 *
 *    node scripts/chromium-manifest.mjs 0.9.2 artifacts > chromium.json
 *
 *  Exits non-zero, and writes nothing, where there is no row at all - a release whose
 *  engine jobs all failed carries no manifest, and the setting then says this release
 *  has no Chromium rather than offering one it cannot fetch. A row whose archive has no
 *  signature is left out the same way: an unsigned archive is one the app refuses. */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const [, , version, root] = process.argv
if (!version || !root) {
  console.error('usage: chromium-manifest.mjs <version> <artifacts-dir>')
  process.exit(1)
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

const files = walk(root)
const signature = (name) => {
  const found = files.find((path) => path.endsWith(`${name}.sig`))
  return found ? readFileSync(found, 'utf8').trim() : null
}

const platforms = {}
for (const path of files.filter((one) => /chromium-[a-z0-9_-]+\.json$/.test(one))) {
  const row = JSON.parse(readFileSync(path, 'utf8'))
  const runtime = signature(row.runtime.name)
  const app = signature(row.app.name)
  if (!runtime || !app) {
    console.error(`${row.platform}: an archive has no signature, left out`)
    continue
  }
  platforms[row.platform] = {
    runtime: { ...row.runtime, signature: runtime },
    app: { ...row.app, signature: app },
  }
}

if (Object.keys(platforms).length === 0) {
  console.error('no platform has a signed Chromium')
  process.exit(1)
}

process.stdout.write(`${JSON.stringify({ version, platforms }, null, 2)}\n`)
