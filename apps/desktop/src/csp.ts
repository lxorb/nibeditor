/** The content policy the app runs under, written once, in the two forms its
 *  carriers can actually hold.
 *
 *  Three places need it and none of them can import from another: the Tauri
 *  config, which is JSON and is what the installed app is served with;
 *  `index.html`, which is what a browser and the PWA get, there being no server of
 *  ours to set a header; and the dev server, so that `pnpm dev` and `pnpm app` are
 *  the same app as the one that ships rather than a looser one. So it lives here,
 *  and `test/csp.test.ts` holds the other two to it.
 *
 *  Two forms, because a `<meta http-equiv>` is not a header and the browser will
 *  not pretend otherwise: `frame-ancestors` is about who may frame this page, which
 *  is settled before a byte of it is parsed, so a `<meta>` is too late to say it.
 *  A browser handed it there ignores the directive *and says so on the console*,
 *  once per page load - which is a real error in a build that ships, and it is the
 *  one error every drive in `test/e2e` used to trip over. So the meta form leaves
 *  it out and the header form keeps it. Nothing is lost by that: the two carriers
 *  that take the meta are the installed app and the PWA, and a Tauri window is a
 *  window rather than somebody else's frame. Where the directive can be honoured
 *  it is said - the dev and preview servers here, and the Worker's own headers for
 *  a published page, which is services/sync's policy and not this one.
 *
 *  What the policy is for: a note is a file, and a file can come from anywhere - a
 *  download, a repository, a folder somebody shared. In the app a document of the
 *  reader's own has its HTML rendered as markup, which is what Typora and Obsidian
 *  do and what makes `<u>` and `<details>` work; and the app's own page can reach
 *  the filesystem through Tauri. Those two facts together are why this file
 *  exists: without a policy, one `<img onerror=…>` in a file somebody was handed
 *  is that person's disk.
 *
 *  `script-src` says three things, and what it leaves out is the point. The app's
 *  own files, by `'self'`. The two scripts it writes inline - the lines in
 *  `index.html` that put the remembered theme on before the first paint, and the
 *  frame script below - by the hash of their characters, which is how GitHub names
 *  the one it has. And
 *  `'unsafe-eval'`, because running a fence means evaluating it: the value of its
 *  last expression does not exist otherwise; see packages/editor/src/run.
 *
 *  What it never says is `'unsafe-inline'`, on any engine. So markup that reaches
 *  the page cannot run a script written into it however it arrived - not an
 *  `onerror`, and not an `<iframe srcdoc>` put in by `innerHTML`, which would be a
 *  document of the app's own origin with the app's reach. The price is paid by the
 *  frames the app makes on purpose - the ` ```js ` runner and a block of a note's
 *  own HTML - because a sandboxed `srcdoc` document inherits this policy and
 *  cannot run its own first line either. They run through the frame script
 *  instead: the same characters in every frame, allowed by their hash, which do
 *  nothing outside an opaque origin; see packages/editor/src/frame-script.js.
 *  Inline rather than a file the frame fetches, because on Windows the app is
 *  served by intercepting `http://tauri.localhost`, and a request from an opaque
 *  origin is not intercepted - measured in the packaged app, it goes to the
 *  network and is refused. Measured in Chromium and WebKit both: an inherited
 *  hash still allows its script inside such a frame, and any other inline script
 *  is refused.
 *
 *  `script-src-attr 'none'` says the attribute half out loud: no element on any
 *  page may carry an `onerror`, an `onclick` or any other handler, whoever wrote
 *  it. An engine without the finer directive reads `script-src`, which says the
 *  same by leaving `'unsafe-inline'` out - a hash does not stand for a handler.
 *  There is no `script-src-elem`, deliberately: an element falls back to
 *  `script-src`, which is the directive Tauri adds its nonce and its hashes to
 *  when it serves the page, so one list says it for both and nothing has to be
 *  said twice. */

/** The theme script in `index.html`, by the SHA-256 of its characters. Changing
 *  one character of it without changing this is a page that paints white first
 *  and says why on the console; `test/csp.test.ts` hashes the script and holds
 *  this to it, so the test says so first. */
const THEME_SCRIPT = "'sha256-iR2Aqj1jRJSx35wTBtrVLSatm9gSp55tpjHpCB3GAHs='"

/** The frame script, packages/editor/src/frame-script.js, by the SHA-256 of the
 *  file: every sandboxed frame the app makes carries it inline, and it is the only
 *  way one runs anything. The same test hashes the file and holds this to it. */
const FRAME_SCRIPT = "'sha256-v841QeTG55+uEpzDrS3ofxcdk/VIgYtt2NynJyqxXik='"

const POLICY: readonly string[] = [
  "default-src 'self'",

  `script-src 'self' 'unsafe-eval' ${THEME_SCRIPT} ${FRAME_SCRIPT}`,
  "script-src-attr 'none'",

  // CodeMirror places a cursor, Svelte writes a transition and KaTeX lays out an
  // equation, all in `style` attributes on elements they build as they go. There
  // is no nonce anywhere in this policy on purpose: one in `style-src` would make
  // the browser ignore `'unsafe-inline'` and take every one of those away.
  "style-src 'self' 'unsafe-inline'",

  // A picture in a note is a file on the disk, which the webview reaches through
  // Tauri's asset protocol - a scheme of its own where the platform allows one and
  // a host under http where it does not; see `assetUrl` in src/lib/tauri.ts. `data:`
  // and `blob:` are how a picture travels inside a document and out of a canvas,
  // and `https:` is a note that points at a picture on the web.
  "img-src 'self' data: blob: https: asset: http://asset.localhost",
  "media-src 'self' data: blob: https: asset: http://asset.localhost",

  // The faces are in the bundle. `data:` is for the export frames: a document that
  // has to stand on its own carries its type as base64, and a PDF is made by
  // printing exactly such a document in a frame of this page's own.
  "font-src 'self' data:",

  // Sync, rooms and the theme store are all one origin, and naming it here would
  // still leave the line as wide as it is: a note may point at a picture anywhere
  // on the web, and an export has to fetch the ones it is going to embed. So this
  // names the schemes instead, and what it forbids is plain http to anywhere but
  // this machine, and every other scheme there is. The localhost ports are the dev
  // server and its hot-reload socket; Tauri's own IPC is the two `ipc` entries.
  //
  // This machine by name and by address, which are two different things to a policy:
  // it matches the host as it is written rather than what the name resolves to, so a
  // line that allows only `localhost` refuses `http://127.0.0.1:11434` - which is the
  // address a local model prints when it starts, and the address a drive serves the
  // built app from. Measured: a page served from localhost under the old line was
  // refused with "violates the following Content Security Policy directive" on the
  // console and nothing a reader could act on in the app; with the address named, it
  // connects.
  //
  // There is no IPv6 form of this. A host source in CSP is a name or a dotted quad,
  // and Chromium answers `http://[::1]:*` with "contains an invalid source ... it
  // will be ignored" on every page load - a console error in a shipping build, which
  // is the one thing the split below this file exists to avoid. Nothing is lost: a
  // server bound to `::1` alone is still reached as `http://localhost:port`, because
  // the name is what the policy sees and the resolver does the rest.
  "connect-src 'self' https: wss: ws://localhost:* ws://127.0.0.1:*" +
    ' http://localhost:* http://127.0.0.1:*' +
    ' ipc: http://ipc.localhost asset: http://asset.localhost blob: data:',

  // A card standing in for a page somewhere else frames that page once the reader
  // asks - any of them, because a note may write the `<iframe>` itself and not only
  // name one of the providers, and never the app's own origin, which `https:` would
  // otherwise include on the web; see `framedPage` in packages/editor/src/web-frame.ts.
  // A `srcdoc` frame needs nothing here.
  "frame-src 'self' https:",

  // The search index and pdf.js, both built from the app's own files.
  "worker-src 'self' blob:",

  "object-src 'none'",
  // Neither of these falls back to `default-src`, which is why both are said out
  // loud: a `<base>` element could repoint every relative address on the page, and
  // a form could post what is on it somewhere else.
  "base-uri 'none'",
  "form-action 'none'",
]

/** The one directive a `<meta>` cannot carry: who may frame this page, which the
 *  browser has to know before it parses the page that would say it. The app is a
 *  window of its own and is never somebody else's frame. */
const ONLY_AS_HEADER: readonly string[] = ["frame-ancestors 'none'"]

/** The policy as a `<meta http-equiv>` takes it: everything a parsed document can
 *  still be held to. What `index.html` declares and what the installed app is
 *  served with. */
export const META_CSP: string = POLICY.join('; ')

/** The policy as a header takes it: the same, and the directive only a header can
 *  say. What the dev and preview servers send. */
export const CSP: string = [...POLICY, ...ONLY_AS_HEADER].join('; ')
