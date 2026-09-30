/* The one script a frame of the app's runs, and how anything a frame runs gets
   to run at all.

   The app's content policy has no `'unsafe-inline'` for scripts, and a sandboxed
   `srcdoc` frame inherits the policy of the page that made it - so a frame cannot
   run a line written into its own document. It can run this file: every frame's
   document carries it inline, character for character, and the policy names
   exactly these characters by their SHA-256 (`FRAME_SCRIPT` in
   apps/desktop/src/csp.ts, whose test hashes this file again - change a character
   here and that test says what the hash is now). The frame's document carries what
   it is for as text no browser executes; see `frameDocument` in web-frame.ts,
   which is the one place that writes one. Two things can be carried, and this
   runs them in this order:

   - `nib-block`, a block of a note's own HTML, as a JSON string. Put into the
     page, and its scripts run the way a browser would have run them.
   - `nib-frame`, the frame's own program: the ` ```js ` runner (run/protocol.ts),
     or the few lines that say how tall a block turned out (web-frame.ts).

   Both are evaluated, which is what the policy's `'unsafe-eval'` was already there
   for: running a fence means evaluating it.

   Only inside an opaque origin. A frame sandboxed without `allow-same-origin` has
   one, and nothing it runs can reach the app's DOM, storage or notes. Anywhere
   else - the app's own page, or a frame that shares its origin, which is what
   markup slipped into the app would build - this does nothing at all, so these
   characters can never be the way text becomes code where the code could reach
   the app. That check is the whole of its security, and it is the first thing it
   does. */
;(function () {
  if (self.origin !== 'null') return

  const block = document.getElementById('nib-block')
  if (block && block.getAttribute('type') === 'application/json') {
    runBlock(JSON.parse(block.textContent))
  }

  const program = document.getElementById('nib-frame')
  if (program && program.getAttribute('type') === 'text/plain') {
    // Indirect, so the program runs in the frame's global scope, the way the
    // inline script it replaces did.
    ;(0, eval)(program.textContent)
  }

  /** A block of a note's own HTML, as the page it would have been.
   *
   *  Parsed into a template, where a script is inert, and moved into the page
   *  from there: a script the fragment parser made never runs, so none of them
   *  is refused by the policy on the way in. Then each one runs as the browser
   *  would have run it, as far as a string can be: in the order written, classic
   *  scripts first and modules after them, the way a module is deferred; with
   *  `document.currentScript` saying which; and with one that throws reported and
   *  the next one run regardless. A data block - `type="text/template"`, a
   *  shader - is left as the data it is. One that names a `src` is made afresh so
   *  the browser fetches it, and the policy is what answers.
   *
   *  What a string cannot be is a script's own top level: a `const` in one
   *  `<script>` is not seen by the next, which it would be in a page. A block that
   *  shares a name between its scripts says `var` or `window.` for it. */
  function runBlock(html) {
    const holder = document.createElement('template')
    holder.innerHTML = html
    const scripts = Array.from(holder.content.querySelectorAll('script'))
    document.body.insertBefore(holder.content, document.body.firstChild)

    const modules = []
    for (const script of scripts) {
      const kind = kindOf(script)
      if (kind === null) continue

      if (script.hasAttribute('src')) fetchAfresh(script)
      else if (kind === 'module') modules.push(script)
      else run(script, false)
    }

    for (const script of modules) run(script, true)
  }

  /** What a `<script>` is, by its type: the rules HTML reads it by, short of the
   *  historical spellings nobody writes. */
  function kindOf(script) {
    const type = (script.getAttribute('type') ?? '').trim().toLowerCase()
    if (type === 'module') return 'module'
    // A classic script that asks to be skipped wherever modules are understood.
    if (script.hasAttribute('nomodule')) return null
    if (type === '' || /^(?:text|application)\/(?:x-)?(?:java|ecma)script$/.test(type)) {
      return 'classic'
    }

    return null
  }

  function fetchAfresh(script) {
    const fresh = document.createElement('script')
    for (const { name, value } of Array.from(script.attributes)) fresh.setAttribute(name, value)
    fresh.async = false
    script.replaceWith(fresh)
  }

  function run(script, asModule) {
    // A classic script is told which it is; a module is told null, as it is in a
    // page.
    const current = asModule ? null : script
    Object.defineProperty(document, 'currentScript', { configurable: true, get: () => current })
    try {
      if (asModule) {
        // Strict and able to `await` at its top, as a module is.
        const Async = Object.getPrototypeOf(async () => undefined).constructor
        new Async(`'use strict';\n${script.textContent}`)().catch(failed)
      } else {
        ;(0, eval)(script.textContent)
      }
    } catch (error) {
      failed(error)
    } finally {
      delete document.currentScript
    }
  }

  /** An error out of one of the block's scripts, reported as the browser reports
   *  an uncaught one: on the frame's console and to its `onerror`. */
  function failed(error) {
    if (typeof self.reportError === 'function') self.reportError(error)
    else
      setTimeout(() => {
        throw error
      })
  }
})()
