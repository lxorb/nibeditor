import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** What the packaging says about the bytes it ships.
 *
 *  Every path under `packaging/` takes the release's own files and hands them to
 *  somebody's package manager, so each of them is a place where "the bytes this
 *  release made" has to be more than a URL: a tampered asset, or a proxy on the
 *  runner that builds the package, otherwise goes out under the product's name.
 *
 *  Read off the files rather than written down here. What the digest *is* cannot be
 *  checked without the network; that is the `deb` job in
 *  `.github/workflows/validate-linux-packaging.yml`, which downloads both files and
 *  compares. What is checked here is that there is one at all, that it is the shape
 *  a digest is, and that it belongs to the version beside it. */

const ROOT = join(fileURLToPath(new URL('../../..', import.meta.url)), 'packaging')
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8')

describe('the snap', () => {
  const snap = read('snap', 'snapcraft.yaml')

  /** It unpacks the release `.deb` rather than rebuilding the app, so the `.deb` is
   *  what it has to be sure of. This was the one packaging path with no digest at
   *  all: scoop, chocolatey and homebrew pin a sha256, the AUR pins one in its
   *  `.SRCINFO`, nix pins a hash, and Flathub pins a commit. */
  test('pins the bytes of the .deb it unpacks, per architecture', () => {
    const held = [...snap.matchAll(/on (amd64|arm64): sha256\/([0-9a-f]+)/g)]

    expect(held.map((one) => one[1])).toEqual(['amd64', 'arm64'])
    for (const [, arch, digest] of held) expect(digest, arch).toHaveLength(64)
  })

  test('and names the same version in the URL as it publishes', () => {
    const version = /^version: '([^']+)'$/m.exec(snap)?.[1]
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)

    const urls = [...snap.matchAll(/releases\/download\/v([^/]+)\/Nib-([^-]+)-linux-/g)]
    expect(urls).toHaveLength(2)
    for (const [, tag, named] of urls) {
      expect(tag).toBe(version)
      expect(named).toBe(version)
    }
  })
})

/** The two digests and the version are rewritten per release rather than by hand;
 *  see packaging/linux.md. A step that rewrote the URL and left the digest behind
 *  would fail the build, which is the right failure - but it would fail every
 *  release, so the sed that keeps them together is worth holding to. */
describe('the workflow that publishes it', () => {
  const workflow = readFileSync(
    join(
      fileURLToPath(new URL('../../..', import.meta.url)),
      '.github/workflows/publish-linux.yml',
    ),
    'utf8',
  )

  test('rewrites the digests beside the version and the URL', () => {
    expect(workflow).toContain('on amd64: sha256/$amd64')
    expect(workflow).toContain('on arm64: sha256/$arm64')
  })

  test('and refuses to build a snap when the release reports no digest', () => {
    expect(workflow).toContain('reports no sha256 for a linux .deb')
    expect(workflow).toContain('exit 1')
  })
})
