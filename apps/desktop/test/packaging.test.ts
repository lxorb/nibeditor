import { readdirSync, readFileSync } from 'node:fs'
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

const HERE = fileURLToPath(new URL('../../..', import.meta.url))
const ROOT = join(HERE, 'packaging')
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8')
const repo = (...parts: string[]) => readFileSync(join(HERE, ...parts), 'utf8')

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

/** The supply the release is built out of: the tools a workflow runs, the pins that
 *  keep them still, and who has to have read a change to any of it.
 *
 *  A release is signed on a runner, out of whatever that runner fetched. Every pin in
 *  this repository is there because "the version we asked for" and "the bytes we ran"
 *  are two different things - and a pin nobody updates is its own problem, which is
 *  what the schedule is for. */
describe('what a workflow is allowed to fetch', () => {
  const folder = join(HERE, '.github', 'workflows')
  const workflows = readdirSync(folder).filter((name) => name.endsWith('.yml'))

  /** `npx --yes some-tool@1.2.3` names a version and runs whatever the registry
   *  answers with at that moment. A devDependency is a hash in pnpm-lock.yaml, and
   *  `pnpm install --frozen-lockfile` has already refused anything that is not it - so
   *  a tool that decides what goes into a package comes from there. The packer for the
   *  glasses plugin was the last one that did not; see `even:pack`. */
  test('is nothing it fetches while it runs', () => {
    const fetching: string[] = []

    for (const name of workflows) {
      const held = readFileSync(join(folder, name), 'utf8')
      for (const line of held.split(/\r?\n/)) {
        // Comments are prose about this very rule in at least one of them.
        if (/^\s*#/.test(line)) continue
        if (/\b(?:npx|pnpm dlx|npm exec|yarn dlx|uvx|pipx run)\b/.test(line)) {
          fetching.push(`${name}: ${line.trim()}`)
        }
      }
    }

    expect(fetching).toEqual([])
  })

  test('and every ecosystem a release is built out of is kept moving', () => {
    const held = repo('.github', 'dependabot.yml')

    for (const ecosystem of ['github-actions', 'npm', 'cargo', 'gradle']) {
      expect(held, ecosystem).toContain(`package-ecosystem: ${ecosystem}`)
    }

    // Weekly and grouped: one pull request an ecosystem is one thing to read.
    expect([...held.matchAll(/interval: weekly/g)]).toHaveLength(4)
    expect([...held.matchAll(/^ {4}groups:$/gm)]).toHaveLength(4)
  })

  test('and a change to any of it has to have been read', () => {
    const owners = repo('.github', 'CODEOWNERS')

    for (const path of [
      '/.github/workflows/**',
      '/packaging/**',
      '/apps/desktop/src-tauri/tauri.conf.json',
      '/pnpm-lock.yaml',
    ]) {
      expect(owners, path).toContain(`${path} @`)
    }
  })
})
