import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import manifest from './even.app.json'
import { CSP } from './src/csp'

const host = process.env.TAURI_DEV_HOST

/** Which code this is, in one line, baked in where a screenshot can read it.
 *
 *  A build installed on a phone has no other way of saying which build it is,
 *  and "did the new one actually reach the device" is the first question when
 *  nothing appears to have changed. The app puts it on `window.nibBuild`; see
 *  src/main.ts.
 *
 *  `serving` is the difference between a bundle and a dev server, and it is the
 *  whole point of this function rather than a detail of it. A bundle is the
 *  commit it was built from, for as long as it exists. A dev server reads its
 *  config once and then serves whatever is on disk for days, so the commit read
 *  here names the moment the server started and says nothing about the code it is
 *  handing out now. A server two days old was found serving code from an hour
 *  ago, and a stamp that answered with the older sha would have sent whoever
 *  asked looking for a bug in the wrong commit. So it does not answer: it says
 *  what it actually knows, which is when the server started. */
function stamp(serving: boolean): string {
  if (serving) return `${manifest.version} dev server started ${when()}`

  let sha = 'unknown'
  try {
    sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    // A tree with no git in it still builds; it just cannot say which commit.
  }

  return `${manifest.version} ${sha} ${when()}`
}

function when(): string {
  return `${new Date().toISOString().slice(0, 16)}Z`
}

export default defineConfig(({ command }) => ({
  plugins: [svelte()],
  // This build is the editor: on the desktop, on the web, in the presenter's
  // window, and on the `/even/` page the web serves. The package that goes on a
  // phone is built by `vite.even.config.ts`, which sets the second of these true
  // and leaves out what a pair of glasses cannot use.
  define: { __EVEN_BUILD__: JSON.stringify(stamp(command === 'serve')), __EVEN_PLUGIN__: 'false' },
  clearScreen: false,
  // The same policy the installed app is served with. `tauri dev` loads the dev
  // server rather than the bundle, so without this the app being worked on is a
  // looser app than the one that ships - and a policy nobody develops under is a
  // policy that breaks on the day it is turned on. These two send it as a header,
  // so they get the form with `frame-ancestors` in it: the meta in index.html
  // cannot carry that directive and the browser says so out loud when it tries.
  // See src/csp.ts.
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
    headers: { 'Content-Security-Policy': CSP },
  },
  preview: {
    headers: { 'Content-Security-Policy': CSP },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: 'esnext',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    // Three pages out of one bundle: the editor, the window a presenter reads
    // their notes in, and the plugin's page as the web serves it at `/even/`. The
    // presenter's window carries none of the app; see docs/slides.md.
    //
    // `even.html` is here so that opening `/even/` in a phone's browser reaches a
    // page with the bridge in it, which is how the glasses are tried without
    // packing anything. It is *not* what goes on a phone: the package is built by
    // `vite.even.config.ts`, which leaves out what a pair of glasses cannot use,
    // and the browser drive runs that build rather than this page. One bundle
    // cannot leave something out of one of its entries, which is why there are two
    // builds at all. See docs/even.md.
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        even: resolve(import.meta.dirname, 'even.html'),
        presenter: resolve(import.meta.dirname, 'presenter.html'),
      },
    },
  },
}))
