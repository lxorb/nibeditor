import { createHash } from 'node:crypto'
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

/** nib opens nothing from outside its spaces, so no bundle and no package manager
 *  offers it a file: no double click, no "Open with", no share of a file to open
 *  where it lies. Held here rather than trusted to memory, because a file type is
 *  one line of config away on every platform and each one quietly makes nib a file
 *  opener again. The web's two schemes are the browser's, and stay. */
describe('what nib claims to open', () => {
  const tauri = (...parts: string[]) => repo('apps', 'desktop', 'src-tauri', ...parts)

  test('no file type in any bundle', () => {
    for (const config of ['tauri.conf.json', 'tauri.macos.conf.json']) {
      expect(tauri(config), config).not.toContain('fileAssociations')
    }
    for (const plist of ['Info.plist', 'Info.ios.plist']) {
      expect(tauri(plist), plist).not.toContain('CFBundleDocumentTypes')
      expect(tauri(plist), plist).not.toContain('UTImportedTypeDeclarations')
    }
    expect(tauri('wix', 'browser.wxs')).not.toMatch(/<(ProgId|Extension)\b/)
  })

  /** The installer writes the browser and no file type, and an install over an
   *  older Nib - the updater's included, which never runs the old uninstaller -
   *  takes the older one's file types away. */
  test('an install claims no file type and forgets the ones it used to', () => {
    const script = tauri('installer.nsh')
    const [, install = '', uninstall = ''] = script.split(
      /!macro NSIS_HOOK_POSTINSTALL|!macro NSIS_HOOK_POSTUNINSTALL/,
    )

    const writes = script.split('\n').filter((line) => line.trim().startsWith('WriteRegStr'))
    expect(writes.length).toBeGreaterThan(0)
    for (const line of writes) {
      expect(line).not.toMatch(/Nib\.markdown|FileAssociations|Classes\\\.m/)
    }
    expect(install).toContain('!insertmacro NIB_FORGET_FILES')
    expect(uninstall).toContain('!insertmacro NIB_FORGET_FILES')
    for (const ext of ['md', 'markdown', 'mdown', 'mkd']) {
      expect(script).toContain(`!insertmacro NIB_FORGET_EXTENSION "${ext}"`)
    }
    expect(script).toContain(String.raw`DeleteRegKey SHCTX "Software\Classes\Nib.markdown"`)
  })

  const desktops = {
    'aur/nib-bin/nib.desktop': read('aur', 'nib-bin', 'nib.desktop'),
    'flathub/ch.emilvinu.nib.desktop': read('flathub', 'ch.emilvinu.nib.desktop'),
    'nix/nib.desktop': read('nix', 'nib.desktop'),
    'snap/snapcraft.yaml': read('snap', 'snapcraft.yaml'),
  }

  test('a Linux desktop entry is a browser and no editor of files', () => {
    for (const [name, entry] of Object.entries(desktops)) {
      expect(entry, name).toContain('MimeType=x-scheme-handler/http;x-scheme-handler/https;')
      expect(entry, name).toContain('Exec=nib %U')
      expect(entry, name).not.toContain('text/markdown')
      expect(entry, name).not.toContain('%F')
    }
  })

  /** The AUR fetches the desktop entry beside the PKGBUILD and checks it against the
   *  digest written there, so a change to the entry is a change to that digest. */
  test('and the AUR holds the digest of the entry it ships', () => {
    const digest = createHash('sha256').update(desktops['aur/nib-bin/nib.desktop']).digest('hex')

    expect(read('aur', 'nib-bin', 'PKGBUILD')).toContain(`sha256sums=('${digest}')`)
    expect(read('aur', 'nib-bin', '.SRCINFO')).toContain(`sha256sums = ${digest}`)
  })

  test('no package manager lists a file type', () => {
    for (const version of readdirSync(join(ROOT, 'winget'))) {
      const manifest = read('winget', version, 'lxorb.Nib.installer.yaml')
      expect(manifest, version).not.toContain('FileExtensions')
    }
    expect(read('chocolatey', 'nib.nuspec')).not.toMatch(/file association/i)
  })
})
