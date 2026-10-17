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

  /** snapcraft takes no `on <arch>:` list for the checksum, though it does for the source
   *  (snapcraft 8.11.1: "Input should be a valid string"); the list kept every snap from
   *  building. One line, then, which the workflow sets per architecture and which holds
   *  amd64's as committed. */
  test("checks the .deb with one line snapcraft reads, amd64's as committed", () => {
    const line = /^ *source-checksum: (.*)$/m.exec(snap)?.[1]
    const amd64 = /on amd64: (sha256\/[0-9a-f]{64})/.exec(snap)?.[1]
    expect(line).toBe(amd64)
    expect(snap).not.toMatch(/source-checksum:\s*\n\s*-/)
  })

  test('and names the same version in the URL as it publishes', () => {
    const version = /^version: '([^']+)'$/m.exec(snap)?.[1]
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)

    const urls = [...snap.matchAll(/releases\/download\/v([^/]+)\/(?:Nib|Orden)-([^-]+)-linux-/g)]
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
    join(fileURLToPath(new URL('../../..', import.meta.url)), '.github/workflows/snap.yml'),
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

/** nib opens no note from outside its spaces, so no bundle and no package manager
 *  offers it a note: no double click, no "Open with", no share of a file to open
 *  where it lies. Held here rather than trusted to memory, because a file type is
 *  one line of config away on every platform and each one quietly makes nib a file
 *  opener again. The web's two schemes are the browser's, and stay. And a PDF, which
 *  every bundle offers nib for in "Open with" and none makes nib the default of; it
 *  is brought into a space before it is read (src-tauri/src/handed_pdfs.rs). */
describe('what nib claims to open', () => {
  const tauri = (...parts: string[]) => repo('apps', 'desktop', 'src-tauri', ...parts)

  test('no file type in any bundle but a PDF, and that one only offered', () => {
    // Tauri's own Windows installer makes an association the default.
    for (const config of ['tauri.conf.json', 'tauri.macos.conf.json']) {
      expect(tauri(config), config).not.toContain('fileAssociations')
    }
    expect(tauri('Info.ios.plist')).not.toContain('CFBundleDocumentTypes')
    for (const plist of ['Info.plist', 'Info.ios.plist']) {
      expect(tauri(plist), plist).not.toContain('UTImportedTypeDeclarations')
    }
    const types = /<key>CFBundleDocumentTypes<\/key>[\s\S]*?\n\t<\/array>/.exec(tauri('Info.plist'))
    expect(types?.[0].match(/<string>[^<]*<\/string>/g)).toEqual([
      '<string>PDF document</string>',
      '<string>Viewer</string>',
      '<string>Alternate</string>',
      '<string>com.adobe.pdf</string>',
    ])

    const linux = JSON.parse(tauri('tauri.linux.conf.json')) as {
      bundle: { fileAssociations: { ext: string[]; mimeType: string; rank: string }[] }
    }
    expect(linux.bundle.fileAssociations).toMatchObject([
      { ext: ['pdf'], mimeType: 'application/pdf', rank: 'Alternate' },
    ])

    expect(tauri('wix', 'browser.wxs')).not.toMatch(/<(ProgId|Extension)\b/)
    expect(tauri('wix', 'pdf.wxs')).not.toMatch(/<(ProgId|Extension)\b/)
    expect(tauri('wix', 'pdf.wxs')).not.toContain(String.raw`Key="Software\Classes\.pdf" `)
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
    'flathub/so.orden.Orden.desktop': read('flathub', 'so.orden.Orden.desktop'),
    'nix/orden.desktop': read('nix', 'orden.desktop'),
    'snap/snapcraft.yaml': read('snap', 'snapcraft.yaml'),
  }

  test('a Linux desktop entry is a browser and a reader of PDFs, no editor of files', () => {
    for (const [name, entry] of Object.entries(desktops)) {
      expect(entry, name).toContain(
        'MimeType=x-scheme-handler/http;x-scheme-handler/https;application/pdf;\n',
      )
      // The program is nib everywhere but Nix, whose package is called orden.
      expect(entry, name).toMatch(/^\s*Exec=(?:nib|orden) %U$/m)
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
    expect(read('chocolatey', 'orden.nuspec')).not.toMatch(/file association/i)
  })
})

/** The package managers' names up to 0.15.0, kept as roads to the new ones. Chocolatey
 *  has a way to deprecate a package and Scoop a folder for it; what each asks for is
 *  held here, because a mistake in either is found by everybody who installed the old
 *  name, and only on their next upgrade. See packaging/windows.md. */
describe('the old names', () => {
  const orden = read('chocolatey', 'orden.nuspec')
  const nib = read('chocolatey', 'nib.nuspec')
  const versionOf = (nuspec: string) => /<version>([^<]+)<\/version>/.exec(nuspec)?.[1]

  test('orden is the package Orden is in', () => {
    expect(orden).toContain('<id>orden</id>')
    expect(orden).toContain('<file src="tools\\**" target="tools" />')
  })

  test('nib is deprecated the way Chocolatey asks: a title, a dependency, no files, no icon', () => {
    expect(nib).toContain('<id>nib</id>')
    expect(nib).toMatch(/<title>\[Deprecated\] /)
    expect(nib).toContain('<files />')
    expect(nib).not.toContain('<iconUrl>')
    expect(nib).toContain(`<dependency id="orden" version="${versionOf(orden)}" />`)
  })

  test('and its version is the release the two were bumped to', () => {
    expect(versionOf(nib)).toBe(versionOf(orden))
  })

  test("Scoop's orden takes over what nib kept, once", () => {
    const scoop = JSON.parse(read('scoop', 'orden.json')) as { installer: { script: string[] } }
    expect(scoop.installer.script.join('\n')).toContain("Join-Path (Split-Path $persist_dir) 'nib'")
  })

  test('the publish workflow moves nib to deprecated and pushes both packages', () => {
    const publish = repo('.github', 'workflows', 'publish.yml')
    expect(publish).toContain('git mv bucket/nib.json bucket/deprecated/nib.json')
    expect(publish).toContain("@{ id = 'orden'; version = $env:VERSION }, @{ id = 'nib'")
    expect(publish).toMatch(/409 \\\(Conflict\\\)/)
  })
})

/** The apt repository, lxorb/apt: one key, said the same everywhere it is said, and both
 *  suites written by the one workflow. See packaging/linux.md, "apt". */
describe('the apt repository', () => {
  const workflow = repo('.github', 'workflows', 'apt.yml')
  const fingerprint = /APT_KEY_FINGERPRINT: ([0-9A-F]{40})/.exec(workflow)?.[1] ?? ''

  test('signs with the key whose fingerprint the page and the docs give', () => {
    expect(fingerprint).toHaveLength(40)
    const spaced = (fingerprint.match(/.{4}/g) ?? []).join(' ')
    expect(read('apt', 'README.md')).toContain(spaced)
    expect(read('apt', 'index.html')).toContain(spaced)
    expect(read('linux.md')).toContain(fingerprint)
    expect(read('apt', 'orden-archive-keyring.asc')).toMatch(
      /^-----BEGIN PGP PUBLIC KEY BLOCK-----/,
    )
  })

  /** Called, not dispatched: a dispatch finds only a workflow already on the default
   *  branch, and apt.yml is written on `unstable` first. */
  test('is written for stable by publish.yml and for unstable by release.yml', () => {
    const publish = repo('.github', 'workflows', 'publish.yml')
    const release = repo('.github', 'workflows', 'release.yml')
    for (const [caller, suite] of [
      [publish, 'stable'],
      [release, 'unstable'],
    ] as const) {
      expect(caller).toMatch(
        new RegExp(String.raw`uses: \./\.github/workflows/apt\.yml
\s+with:
\s+suite: ${suite}
`),
      )
      expect(caller).not.toContain('gh workflow run apt.yml')
    }
    expect(repo('.github', 'workflows', 'apt.yml')).toContain('workflow_call:')
  })

  test('says its own address where the workflow writes it in', () => {
    for (const page of ['README.md', 'index.html']) {
      expect(read('apt', page)).toContain('@BASE@/orden-archive-keyring.asc')
    }
  })
})

/** The snap: built and uploaded by snap.yml, called by publish-linux.yml for a release
 *  (`stable`) and by release.yml for edge (`edge`). Called, not dispatched: a dispatch
 *  finds only a workflow already on the default branch. See packaging/linux.md. */
describe('the snap workflow', () => {
  const snapYml = repo('.github', 'workflows', 'snap.yml')

  test('is called for a release and for edge', () => {
    expect(snapYml).toContain('workflow_call:')
    expect(repo('.github', 'workflows', 'publish-linux.yml')).toContain(
      'uses: ./.github/workflows/snap.yml',
    )
    const release = repo('.github', 'workflows', 'release.yml')
    expect(release).toMatch(
      /uses: \.\/\.github\/workflows\/snap\.yml\n\s+with:\n\s+tag: \$\{\{ needs\.version\.outputs\.tag \}\}/,
    )
    expect(release).not.toContain('gh workflow run snap.yml')
  })

  test('puts edge in the edge channel at devel grade and a release in stable', () => {
    expect(snapYml).toContain("echo 'channel=edge'")
    expect(snapYml).toContain("echo 'grade=devel'")
    expect(snapYml).toContain("echo 'channel=stable'")
    expect(snapYml).toContain('release: ${{ steps.channel.outputs.channel }}')
  })

  test("sets the checksum line to its own architecture's digest", () => {
    expect(snapYml).toContain('if [ "$ARCH" = arm64 ]; then own=$arm64; else own=$amd64; fi')
    expect(snapYml).toContain('source-checksum: sha256/).*|\\1$own|')
  })
})

/** The Linux managers for a stable release: called by release.yml, never dispatched and
 *  never started by `release: published`, which a release made on the workflow's own
 *  token does not raise. See packaging/linux.md. */
describe('the Linux publishing workflow', () => {
  const linux = repo('.github', 'workflows', 'publish-linux.yml')
  const release = repo('.github', 'workflows', 'release.yml')

  test('is called by release.yml with the release tag', () => {
    expect(linux).toContain('workflow_call:')
    expect(linux).not.toMatch(/^\s+release:\s*$/m)
    expect(release).toMatch(
      /uses: \.\/\.github\/workflows\/publish-linux\.yml\n\s+with:\n\s+tag: \$\{\{ needs\.version\.outputs\.tag \}\}/,
    )
    expect(release).not.toContain('gh workflow run publish-linux.yml')
  })

  test('publishes a stable tag and nothing else', () => {
    const stable = "if: ${{ startsWith(inputs.tag, 'v') && !contains(inputs.tag, '-') }}"
    expect(linux.split(stable)).toHaveLength(3)
  })
})
