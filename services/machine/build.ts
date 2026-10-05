/** `nibd` as one file for the image: everything but node-pty, which is native and is
 *  built inside the image for the image's own system (see Dockerfile). CommonJS, since
 *  xterm.js and ws are, and a CommonJS module inside an ES bundle cannot `require` the
 *  node built-ins they ask for. */

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
