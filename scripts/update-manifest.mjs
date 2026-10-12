/** Builds the `latest.json` the Tauri updater polls.
 *
 *  Every bundle the release workflow produced has a `.sig` beside it; the
 *  manifest pairs each platform with its download URL and that signature.
 *
 *    node scripts/update-manifest.mjs v0.2.0 0.2.0 artifacts > latest.json
 *    node scripts/update-manifest.mjs main 0.2.1-57 artifacts > latest.json
 *
 *  The tag is where the files are downloaded from; the version is what the
 *  updater compares against the one installed. For a tagged release they say
 *  the same thing. For the rolling build of main the tag is always `main`
 *  and the version counts up on its own.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** The repository is lxorb/orden now, and GitHub forwards this, its old name, to
 *  it. It stays: every build from before the rename takes a bundle only from a URL
 *  under this prefix (`offered()` in src-tauri/src/updates.rs), and one manifest
 *  serves them all. So nobody may create a repository called lxorb/nibeditor
 *  again: it would end the forwarding for every one of those installs. */
const REPO = 'lxorb/nibeditor'

/** Which Tauri platform key a built file belongs to. Each match names the
 *  architecture as well as the kind of file: two Linux builds each carry an
 *  AppImage, and the wrong one would install and refuse to start. */
const PLATFORMS = [
  { key: 'windows-x86_64', match: (path) => /windows-x64/.test(path) && path.endsWith('.exe.sig') },
  {
    key: 'windows-aarch64',
    match: (path) => /windows-arm64/.test(path) && path.endsWith('.exe.sig'),
  },
  {
    key: 'linux-x86_64',
    match: (path) => /linux-x64/.test(path) && path.endsWith('.AppImage.sig'),
  },
  {
    key: 'linux-aarch64',
    match: (path) => /linux-arm64/.test(path) && path.endsWith('.AppImage.sig'),
  },
]

/** The macOS bundle is universal, so every Mac is offered the same file. Tauri
 *  looks itself up by architecture, and `darwin-universal` is only consulted by
 *  newer clients, so all three keys point at it. */
const MAC_KEYS = ['darwin-universal', 'darwin-aarch64', 'darwin-x86_64']

const [, , tag, version, root] = process.argv
if (!tag || !version || !root) {
  console.error('usage: update-manifest.mjs <tag> <version> <artifacts-dir>')
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

const files = walk(root).map((path) => path.split('\\').join('/'))
const platforms = {}

for (const { key, match } of PLATFORMS) {
  const signature = files.find(match)
  if (!signature) continue

  // The bundle is the signature's name without `.sig`.
  const bundle = signature.slice(0, -'.sig'.length)

  platforms[key] = {
    signature: readFileSync(signature, 'utf8').trim(),
    url: `https://github.com/${REPO}/releases/download/${tag}/${bundle.split('/').pop()}`,
  }
}

const mac = files.find((path) => path.endsWith('.app.tar.gz.sig'))
if (mac) {
  const bundle = mac.slice(0, -'.sig'.length)
  const entry = {
    signature: readFileSync(mac, 'utf8').trim(),
    url: `https://github.com/${REPO}/releases/download/${tag}/${bundle.split('/').pop()}`,
  }

  for (const key of MAC_KEYS) platforms[key] = entry
}

if (!Object.keys(platforms).length) {
  console.error('no signed bundles found - is TAURI_SIGNING_PRIVATE_KEY set?')
  process.exit(1)
}

process.stdout.write(
  `${JSON.stringify(
    {
      version,
      pub_date: new Date().toISOString(),
      platforms,
    },
    null,
    2,
  )}\n`,
)
