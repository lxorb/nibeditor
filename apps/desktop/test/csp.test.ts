import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { CSP, META_CSP } from '../src/csp'

/** One policy, in three files that cannot import from each other: `src/csp.ts` is
 *  the one the dev server reads, `src-tauri/tauri.conf.json` is what the installed
 *  app is served with, and `index.html` is what a browser and the PWA get. A copy
 *  that drifts is an app that is one thing while it is being written and another
 *  once it is installed, which is the failure this file exists to catch.
 *
 *  Each carrier is held to the form it can actually carry. The two that deliver a
 *  `<meta http-equiv>` must not name `frame-ancestors`: a browser cannot honour it
 *  there - who may frame a page is settled before the page is parsed - and it says
 *  so on the console on every page load, which is an error in a shipping build and
 *  the one every drive in `test/e2e` tripped over. The header form keeps it, since
 *  a header is sent before the document. See src/csp.ts. */

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const TAURI = JSON.parse(read('../src-tauri/tauri.conf.json')) as {
  app: {
    security: {
      csp: string | null
      /** The directives the bundler is told not to rewrite; see the last test. */
      dangerousDisableAssetCspModification?: string[]
    }
  }
}

const INDEX = read('../index.html')

/** The dev and preview servers, which are the carriers that send a header. Read as
 *  text: the config runs git and builds a stamp, and which constant it hands the
 *  servers is the whole of what matters here. */
const VITE = read('../vite.config.ts')

/** The policy `index.html` declares, as the browser reads it: the attribute's
 *  value, with the newlines and indentation prettier put in taken back out. */
function metaPolicy(html: string): string {
  const found = /http-equiv="Content-Security-Policy"\s*\n?\s*content="([^"]*)"/.exec(html)
  return (found?.[1] ?? '').replace(/\s+/g, ' ').trim()
}

describe('the content policy', () => {
  test('is the same string in all three places, each in the form it can carry', () => {
    expect(TAURI.app.security.csp).toBe(META_CSP)
    expect(metaPolicy(INDEX)).toBe(META_CSP)
    // And the header form is the meta form plus what only a header may say, so the
    // two can never be two policies.
    expect(CSP.startsWith(`${META_CSP}; `)).toBe(true)
  })

  /** The console error this split exists to remove. A `<meta>` that names
   *  `frame-ancestors` is a line the browser rejects out loud on every page load,
   *  and every drive in `test/e2e` fails on any console error. */
  test('never names frame-ancestors where a browser cannot honour it', () => {
    expect(META_CSP).not.toContain('frame-ancestors')
    expect(TAURI.app.security.csp).not.toContain('frame-ancestors')
    expect(metaPolicy(INDEX)).not.toContain('frame-ancestors')
  })

  test('and says it where a browser can, which is a header', () => {
    expect(CSP).toContain("frame-ancestors 'none'")
    expect(VITE).toContain("'Content-Security-Policy': CSP")
    expect(VITE).not.toContain('META_CSP')
  })

  test('is before anything the page loads, so it governs all of it', () => {
    expect(INDEX.indexOf('Content-Security-Policy')).toBeLessThan(INDEX.indexOf('<script'))
    expect(INDEX.indexOf('Content-Security-Policy')).toBeLessThan(INDEX.indexOf('<link'))
  })

  /** The lines that are the whole point. A policy is easy to widen by accident -
   *  one keyword in the wrong directive and the thing it was written for is gone. */
  test('lets no element on any page carry an event handler', () => {
    // The `onerror` in `<img src=x onerror=…>`, which is what a note somebody was
    // handed would use: `<script>` inserted through innerHTML never runs, and a
    // handler on an attribute does.
    expect(CSP).toContain("script-src-attr 'none'")
  })

  test('and loads no code from anywhere but this app', () => {
    for (const directive of ['script-src', 'script-src-elem', 'worker-src']) {
      const line = CSP.split('; ').find((one) => one.startsWith(`${directive} `)) ?? ''
      expect(line, directive).toContain("'self'")
      expect(line, directive).not.toContain('http:')
      expect(line, directive).not.toContain('https:')
      expect(line, directive).not.toContain('data:')
    }
  })

  test('and keeps the styles a running editor writes', () => {
    // A nonce anywhere in `style-src` would make the browser ignore
    // `'unsafe-inline'`, and every cursor CodeMirror places is a style attribute.
    expect(CSP).toContain("style-src 'self' 'unsafe-inline'")
    expect(CSP).not.toContain('nonce-')
  })

  test('and says the four things that fall back to nothing useful', () => {
    for (const said of [
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ]) {
      expect(CSP).toContain(said)
    }

    // Three of the four in a `<meta>` as well; the fourth is the one a parsed
    // document is too late to say. See src/csp.ts.
    for (const said of ["object-src 'none'", "base-uri 'none'", "form-action 'none'"]) {
      expect(META_CSP).toContain(said)
    }
  })

  test('and lets Tauri talk to its own back end', () => {
    // Without these the app cannot read a single file: the commands travel over a
    // protocol of Tauri's, which is a scheme on some platforms and a host on others.
    const connect = CSP.split('; ').find((one) => one.startsWith('connect-src ')) ?? ''
    expect(connect).toContain('ipc:')
    expect(connect).toContain('http://ipc.localhost')
  })

  /** This machine by name and by address, which a policy reads as two different
   *  hosts: it matches what is written rather than what the name resolves to, so a
   *  line that allows only `localhost` refuses a model served on 127.0.0.1 - the
   *  address every local runner prints when it starts - and says nothing a reader
   *  could act on, a blocked request being a failure with no reason attached. */
  test('and reaches this machine by address as well as by name', () => {
    const connect = CSP.split('; ').find((one) => one.startsWith('connect-src ')) ?? ''

    for (const host of ['localhost', '127.0.0.1']) {
      expect(connect, host).toContain(`http://${host}:*`)
      expect(connect, host).toContain(`ws://${host}:*`)
    }

    // And the same line in the two carriers that take a `<meta>`, which is where an
    // installed app and the PWA read it from.
    expect(META_CSP).toContain('http://127.0.0.1:*')
    expect(TAURI.app.security.csp).toContain('http://127.0.0.1:*')
    expect(metaPolicy(INDEX)).toContain('http://127.0.0.1:*')
  })

  /** And never the IPv6 form of it, which cannot be said: a host source in CSP is a
   *  name or a dotted quad, and Chromium answers a bracketed address with "contains
   *  an invalid source ... it will be ignored" on every page load. That is a console
   *  error in a shipping build and a failed drive, which is the same failure the
   *  meta and header split above was made to remove. A server bound to `::1` alone
   *  is still reached as `http://localhost:port`. */
  test('and says nothing a browser will reject out loud', () => {
    for (const policy of [CSP, META_CSP, metaPolicy(INDEX), TAURI.app.security.csp ?? '']) {
      expect(policy).not.toContain('[::1]')
      expect(policy).not.toMatch(/\[[0-9a-f:]*]/i)
    }
  })

  /** Plain http is for this machine and nowhere else: a note that points at a
   *  picture over http on somebody else's host is a note that leaks. */
  test('and lets plain http nowhere but this machine', () => {
    const connect = CSP.split('; ').find((one) => one.startsWith('connect-src ')) ?? ''
    const hosts = connect.split(' ').filter((one) => one.startsWith('http://'))

    expect(hosts).not.toContain('http:')
    for (const host of hosts) {
      expect(host, host).toMatch(/^http:\/\/(localhost|127\.0\.0\.1|[a-z]+\.localhost)(:\*)?$/)
    }
  })

  /** The one directive the bundler must not touch, and the most expensive line in
   *  this file to have got wrong.
   *
   *  Tauri rewrites the policy in `tauri.conf.json` as it builds, and stamps every
   *  inline `<style>` and `<script>` it finds in `index.html` with a nonce it puts
   *  into the matching directive. That is the right thing for scripts. For styles it
   *  is a trap, because CSP says a directive carrying a nonce IGNORES `'unsafe-inline'`
   *  beside it - so the moment index.html gained its first inline style, every
   *  stylesheet the app mounts at RUNTIME was silently blocked.
   *
   *  CodeMirror mounts its theme that way, and two of its rules exist nowhere else:
   *  the editor is `height: 100%` and its scroller is `overflow-y: auto`. Without
   *  them the editor grows to the whole note, the scroller has nothing left to
   *  scroll, and a note cannot be scrolled at all - no bar, and a wheel that does
   *  nothing, while the caret still moves the note because that is the app setting
   *  `scrollTop` on the parent that clips. Reading mode was unaffected throughout,
   *  because it is styled from a real stylesheet.
   *
   *  Measured in the shipped WebView2 app: the theme's `<style>` sat in the head with
   *  its 14 kB of text and no `CSSStyleSheet` attached, five launches out of five.
   *  With this line, 186 rules. Nothing caught it because the dev server sends its
   *  own policy from src/csp.ts, which Tauri never sees, and every drive in the
   *  repository runs against a server rather than against the packaged app.
   *
   *  The inline style that set it off arrived in 3a39445e, so the window could paint
   *  its remembered colour before the webview existed. That is worth keeping; this is
   *  what makes it safe to keep. */
  test('leaves style-src alone, or the editor loses the stylesheet it mounts', () => {
    const untouched = TAURI.app.security.dangerousDisableAssetCspModification
    expect(untouched, 'the bundler must not add a nonce to style-src').toContain('style-src')

    // And the directive it is protecting still has to allow what it allows.
    expect(TAURI.app.security.csp ?? '').toContain("style-src 'self' 'unsafe-inline'")
  })
})
