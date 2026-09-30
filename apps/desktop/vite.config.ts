import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { everySurface } from '@nib/themes/write'
import manifest from './even.app.json'
import tauri from './src-tauri/tauri.conf.json'
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

/** Every rule about `#write` reaching every page a note is on, in the app's own
 *  stylesheets and in each component's: the app has several of those pages at once and
 *  only one of them can be the id. The sheets say `#write`, as Typora and every theme
 *  do, and an exported or a published note keeps its one; see @nib/themes/write. */
const everyPage = {
  postcssPlugin: 'nib-every-page',
  Rule(rule: { selector: string }) {
    // Only when it changes: a rule that changed is visited again.
    const wide = everySurface(rule.selector)
    if (wide !== rule.selector) rule.selector = wide
  },
}

export default defineConfig(({ command, mode }) => ({
  plugins: [svelte()],
  // This build is the editor: on the desktop, on the web, in the presenter's
  // window, and on the `/even/` page the web serves. The package that goes on a
  // phone is built by `vite.even.config.ts`, which sets the second of these true
  // and leaves out what a pair of glasses cannot use.
  // `__DRIVEABLE__` is on while a dev server serves, in `--mode drive` and in a
  // development build, and off in a release. See env.d.ts for what it guards and why
  // a release must not.
  //
  // Development is in the list because that is what the eighty-nine drives beside
  // smoke.py build for themselves, and `command` is `build` for every one of them:
  // with only `serve` and `drive` on the list the handles were stripped out of the
  // very build those drives then waited for, and each of them sat there until it
  // gave up waiting for the app. `drive` is still the one that matters - it is the
  // shipping shape - and this only says that a build nobody ships may be steered.
  define: {
    __EVEN_BUILD__: JSON.stringify(stamp(command === 'serve')),
    __EVEN_PLUGIN__: 'false',
    // The version the installer carries, for the one place the app says it: under
    // the name on the space chooser, where Obsidian's vault chooser says its own.
    __APP_VERSION__: JSON.stringify(tauri.version),
    __DRIVEABLE__: JSON.stringify(
      command === 'serve' || mode === 'drive' || mode === 'development',
    ),
  },
  css: { postcss: { plugins: [everyPage] } },
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
