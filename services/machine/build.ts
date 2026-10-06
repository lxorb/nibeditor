/** `nibd` as one file for the image: everything but node-pty, which is native and is
 *  built inside the image for the image's own system (see Dockerfile). CommonJS, since
 *  xterm.js and ws are, and a CommonJS module inside an ES bundle cannot `require` the
 *  node built-ins they ask for.
 *
 *  And the machine's bundle, dist/machine.bin: nibd and every file install.sh puts in
 *  place, as one gzipped tar that the Worker carries inside itself and hands a Hetzner
 *  server at its first boot and at every start of nibd after (docs/online-terminal.md
 *  4.15). Deterministic - no times, no owners, files in a fixed order - so the same
 *  sources are the same bytes and the same SHA-256 wherever they are built. */

import { readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { build } from 'esbuild'

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/nibd.cjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['node-pty', 'bufferutil', 'utf-8-validate'],
  legalComments: 'none',
  logLevel: 'warning',
})

/** What goes in the bundle: its path inside it, where it is read from, and whether it runs. */
const BUNDLE: readonly [string, string, boolean][] = [
  ['install.sh', 'install.sh', true],
  ['nibd.cjs', 'dist/nibd.cjs', false],
  ['package.json', 'package.json', false],
  ['agents.sh', 'agents.sh', true],
  ['profile.sh', 'profile.sh', false],
  ['nib-open', 'nib-open', true],
  ['nib-update', 'nib-update', true],
  ['server/nibd.service', 'server/nibd.service', false],
  ['server/cloudflared.service', 'server/cloudflared.service', false],
  ['server/nib-agents.service', 'server/nib-agents.service', false],
]

const BLOCK = 512

/** One ustar header: the name, the mode, the size in octal, and its checksum. */
function header(name: string, size: number, mode: number): Uint8Array {
  const block = new Uint8Array(BLOCK)
  const put = (at: number, text: string) => {
    block.set(new TextEncoder().encode(text), at)
  }
  const octal = (value: number, width: number) => value.toString(8).padStart(width - 1, '0')
  put(0, name)
  put(100, octal(mode, 8))
  put(108, octal(0, 8))
  put(116, octal(0, 8))
  put(124, octal(size, 12))
  put(136, octal(0, 12))
  put(156, '0')
  put(257, 'ustar\u000000')
  // The checksum is summed with its own field as spaces.
  put(148, '        ')
  const sum = block.reduce((total, byte) => total + byte, 0)
  put(148, `${octal(sum, 7)}\u0000 `)
  return block
}

function tar(files: readonly { name: string; data: Uint8Array; mode: number }[]): Uint8Array {
  const parts: Uint8Array[] = []
  for (const file of files) {
    parts.push(header(file.name, file.data.length, file.mode), file.data)
    const pad = (BLOCK - (file.data.length % BLOCK)) % BLOCK
    parts.push(new Uint8Array(pad))
  }
  parts.push(new Uint8Array(BLOCK * 2))
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

const files = BUNDLE.map(([name, from, runs]) => ({
  name,
  data: new Uint8Array(readFileSync(from)),
  mode: runs ? 0o755 : 0o644,
}))
writeFileSync('dist/machine.bin', gzipSync(tar(files), { level: 9 }))
