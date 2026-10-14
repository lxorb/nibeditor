#!/usr/bin/env node
// Moves every in-repo package manifest to a released version: the version, the
// URLs and the digests of the files each one ships, read off the release page.
//
//   node scripts/bump-packaging.mjs 0.15.0
//   node scripts/bump-packaging.mjs --edge
//
// The publishers in publish.yml and publish-linux.yml rewrite their copies in
// flight anyway; this keeps the committed files on the release they describe, so
// `nix run github:lxorb/orden?dir=packaging/nix` installs the current release and
// validate-linux-packaging.yml checks what is really shipped. Run by
// .github/workflows/packaging-bump.yml after every stable release.
//
// `--edge` is the rolling build of main instead, for the nix-edge branch
// (.github/workflows/nix-edge.yml): only the flake moves, onto the .debs on the
// `edge` pre-release, as the package orden-edge.
//
// Every rewrite has to match exactly as often as it is written to: a manifest
// whose shape moved fails here, loudly, instead of being left half on the old
// version.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const REPO = process.env.GITHUB_REPOSITORY || 'lxorb/orden'

const edge = process.argv[2] === '--edge'
const asked = process.argv[2]?.replace(/^v/, '')
if (!edge && !/^\d+\.\d+\.\d+$/.test(asked ?? '')) {
  throw new Error('usage: bump-packaging.mjs <version> | --edge')
}
const tag = edge ? 'edge' : `v${asked}`

const newer = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number))
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
const response = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`, {
  headers: {
    accept: 'application/vnd.github+json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  },
})
if (!response.ok) throw new Error(`${tag}: the release page answered ${response.status}`)
const release = await response.json()
if (release.draft || (!edge && release.prerelease)) throw new Error(`${tag} is not a stable release`)

// What the .debs are called there: `Orden-<version>` on a release, and whatever
// the build of main uploaded on edge, which says its own version.
const named = release.assets
  .map((one) => /^([A-Za-z]+)-(.+)-linux-x64\.deb$/.exec(one.name))
  .find(Boolean)
if (!named) throw new Error(`${tag}: the release has no linux-x64 .deb`)
const asset = edge ? named[1] : 'Orden'
const version = edge ? named[2] : asked

// The digest GitHub computed when the file was uploaded, the same one the snap
// is pinned to; nothing is downloaded here.
const digest = (name) => {
  const found = release.assets.find((one) => one.name === name)
  const hex = /^sha256:([0-9a-f]{64})$/.exec(found?.digest ?? '')?.[1]
  if (!hex) throw new Error(`${tag}: the release reports no sha256 for ${name}`)
  return hex
}
const file = (arch, kind) => `${asset}-${version}-${arch}${kind}`
const sri = (hex) => `sha256-${Buffer.from(hex, 'hex').toString('base64')}`
const download = `https://github.com/${REPO}/releases/download/${tag}`

// What a URL naming some earlier release looks like, under either name it had.
const OLD = String.raw`releases/download/v[0-9][^/'"]*/[A-Za-z]+-[0-9][^-]*`

// Every file is rewritten in memory first and written only once all of them
// matched, so a failure leaves the tree as it was.
const pending = new Map()
const edit = (path, rewrites) => {
  let text = pending.get(path) ?? readFileSync(join(ROOT, 'packaging', path), 'utf8')
  for (const [pattern, replacement, times = 1] of rewrites) {
    const every = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`)
    const found = text.match(every)?.length ?? 0
    if (found !== times) throw new Error(`${path}: ${pattern} matched ${found} times, not ${times}`)
    text = text.replace(every, replacement)
  }
  pending.set(path, text)
}

const flake = readFileSync(join(ROOT, 'packaging/nix/flake.nix'), 'utf8')
const current = /^\s*version = "([^"]+)";$/m.exec(flake)?.[1]
if (!edge && current && /^\d+\.\d+\.\d+$/.test(current) && newer(current, version)) {
  throw new Error(`the packaging is on ${current} already, which is newer than ${version}`)
}

const debX64 = digest(file('linux-x64', '.deb'))
const debArm64 = digest(file('linux-arm64', '.deb'))

edit('nix/flake.nix', [
  [/^(\s*pname = )"[^"]*";$/m, `$1"${edge ? 'orden-edge' : 'orden'}";`],
  [/^(\s*version = )"[^"]*";$/m, `$1"${version}";`],
  [/^(\s*tag = )"[^"]*";$/m, `$1"${tag}";`],
  [/^(\s*asset = )"[^"]*";$/m, `$1"${asset}";`],
  [/(suffix = "x64";\s*hash = )"[^"]*";/, `$1"${sri(debX64)}";`],
  [/(suffix = "arm64";\s*hash = )"[^"]*";/, `$1"${sri(debArm64)}";`],
])

if (!edge) {
  edit('aur/nib-bin/PKGBUILD', [
    [/^pkgver=.*$/m, `pkgver=${version}`],
    [/^pkgrel=.*$/m, 'pkgrel=1'],
    [/^sha256sums_x86_64=.*$/m, `sha256sums_x86_64=('${debX64}')`],
    [/^sha256sums_aarch64=.*$/m, `sha256sums_aarch64=('${debArm64}')`],
  ])
  edit('aur/nib-bin/.SRCINFO', [
    [/^(\tpkgver = ).*$/m, `$1${version}`],
    [/^(\tpkgrel = ).*$/m, (_, key) => `${key}1`],
    [/^(\tprovides = (?:orden|nib)=).*$/m, `$1${version}`, 2],
    [/^(\tsource_x86_64 = nib\.deb::).*$/m, `$1${download}/${file('linux-x64', '.deb')}`],
    [/^(\tsha256sums_x86_64 = ).*$/m, `$1${debX64}`],
    [/^(\tsource_aarch64 = nib\.deb::).*$/m, `$1${download}/${file('linux-arm64', '.deb')}`],
    [/^(\tsha256sums_aarch64 = ).*$/m, `$1${debArm64}`],
  ])

  edit('snap/snapcraft.yaml', [
    [/^version: .*$/m, `version: '${version}'`],
    [/(orden_)[0-9][^_]*(_amd64\.snap)/, `$1${version}$2`],
    [/^(\s*- on amd64: )https:\/\/.*\.deb$/m, `$1${download}/${file('linux-x64', '.deb')}`],
    [/^(\s*- on arm64: )https:\/\/.*\.deb$/m, `$1${download}/${file('linux-arm64', '.deb')}`],
    [/(on amd64: sha256\/)[0-9a-f]{64}/, `$1${debX64}`],
    [/(on arm64: sha256\/)[0-9a-f]{64}/, `$1${debArm64}`],
  ])

  edit('scoop/nib.json', [
    [/^(    "version": )"[^"]*",$/m, `$1"${version}",`],
    ...['x64', 'arm64'].map((arch) => [
      new RegExp(
        String.raw`(            "url": "https://github\.com/[^/]+/[^/]+/)${OLD}(-windows-${arch}-setup\.exe#/dl\.7z",\n            "hash": )"[0-9a-f]{64}"`,
      ),
      `$1releases/download/${tag}/Orden-${version}$2"${digest(file(`windows-${arch}`, '-setup.exe'))}"`,
    ]),
  ])

  edit('chocolatey/nib.nuspec', [
    [/<version>[^<]*<\/version>/, `<version>${version}</version>`],
    [/(orden@v)[0-9][^/]*/, `$1${version}`],
    [/(releases\/tag\/v)[0-9][^<]*</, `$1${version}<`],
  ])
  // Each digest is the first one below the url it belongs to.
  edit('chocolatey/tools/chocolateyinstall.ps1', [
    ...['x64', 'arm64'].map((arch) => [
      new RegExp(
        String.raw`'https://github\.com/[^/]+/[^/]+/${OLD}(-windows-${arch}\.msi'[^]*?')[0-9A-Fa-f]{64}'`,
      ),
      `'${download}/Orden-${version}$1${digest(file(`windows-${arch}`, '.msi')).toUpperCase()}'`,
    ]),
  ])

  edit('homebrew/orden.rb', [
    [/^(  version )"[^"]*"$/m, `$1"${version}"`],
    [/^(  sha256 )"[0-9a-f]{64}"$/m, `$1"${digest(file('macos-universal', '.dmg'))}"`],
  ])
}

for (const [path, text] of pending) writeFileSync(join(ROOT, 'packaging', path), text)
console.log(`packaging on ${edge ? `edge ${version}` : version}${current && current !== version ? `, from ${current}` : ''}`)
