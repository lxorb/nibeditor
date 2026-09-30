import { readFileSync } from 'node:fs'
import { type DOMWindow, JSDOM } from 'jsdom'
import { describe, expect, test } from 'vitest'
import { htmlFrameDocument } from '@nib/editor'

/** The frame script, run the way a sandboxed frame runs it: in the document
 *  `htmlFrameDocument` writes, once that document has been read.
 *
 *  Here rather than beside the script because this is the package with a DOM to
 *  run it in. What a browser adds on top - the inherited policy refusing anything
 *  written inline, the opaque origin a sandbox gives - is `test/e2e/frames.py`'s,
 *  in Chrome and in WebKit. What this holds is the part that is ours: which
 *  scripts of a block run, in what order, and where nothing runs at all. See
 *  packages/editor/src/frame-script.js. */

const SCRIPT = readFileSync(
  new URL('../../../packages/editor/src/frame-script.js', import.meta.url),
  'utf8',
)

/** The frame, with the script run in it. `about:blank` is an opaque origin, which
 *  is what a frame sandboxed without `allow-same-origin` has. */
function framed(html: string, url = 'about:blank'): DOMWindow & Record<string, unknown> {
  const dom = new JSDOM(htmlFrameDocument(html, SCRIPT), {
    url,
    runScripts: 'outside-only',
  })
  const window = dom.window as DOMWindow & Record<string, unknown>
  window.reportError = (error: unknown) => {
    ;((window.reported ??= []) as unknown[]).push(error)
  }
  // Run by hand where a browser would run it, as the document's last element: jsdom
  // is told to run nothing of a document's own, so this is the one run.
  window.eval(SCRIPT)

  return window
}

/** A block whose scripts each write down that they ran, in order. */
const said = (word: string, type = '') =>
  `<script${type ? ` type="${type}"` : ''}>(window.said ??= []).push('${word}')</script>`

/** Long enough for a module, which runs as an async function, to have run. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('the frame script', () => {
  test('puts the block into the page and runs its scripts in the order written', async () => {
    const window = framed(`<div id="dial">nothing</div>${said('one')}${said('two')}`)
    await settled()

    expect(window.document.getElementById('dial')?.textContent).toBe('nothing')
    expect(window.said).toEqual(['one', 'two'])
  })

  test('runs a module after the classic scripts, the way a module is deferred', async () => {
    const window = framed(`${said('module', 'module')}${said('classic')}`)
    await settled()

    expect(window.said).toEqual(['classic', 'module'])
  })

  test('leaves a data block as the data it is', async () => {
    const window = framed(`${said('template', 'text/template')}${said('json', 'application/json')}`)
    await settled()

    expect(window.said).toBeUndefined()
    expect(window.document.querySelectorAll('script[type="text/template"]')).toHaveLength(1)
  })

  test('tells a classic script which it is, and a module nothing', async () => {
    const window = framed(
      '<script id="me">window.classic = document.currentScript?.id</script>' +
        '<script type="module">window.module = document.currentScript</script>',
    )
    await settled()

    expect(window.classic).toBe('me')
    expect(window.module).toBeNull()
    // And the page's own answer is back once the block has run.
    expect(Object.getOwnPropertyDescriptor(window.document, 'currentScript')).toBeUndefined()
  })

  test('reports a script that throws, and runs the next one regardless', async () => {
    const window = framed(`<script>throw new Error('broken')</script>${said('after')}`)
    await settled()

    expect((window.reported as Error[] | undefined)?.map((one) => one.message)).toEqual(['broken'])
    expect(window.said).toEqual(['after'])
  })

  test('shares what a script declares with `var` with the next, as a page does', async () => {
    const window = framed('<script>var shared = 6</script><script>window.got = shared * 7</script>')
    await settled()

    expect(window.got).toBe(42)
  })

  test('and then says how tall the block turned out', async () => {
    const window = framed('<p>words</p>')
    const heard: unknown[] = []
    window.addEventListener('message', (event) => heard.push(event.data))
    await settled()
    await settled()

    expect(heard).toContainEqual(expect.objectContaining({ nib: 'nib-html-frame' }))
  })

  /** The whole of its security: on an origin that is not opaque - the app's own,
   *  or a frame that shares it - it does nothing at all, so it is never the way a
   *  string becomes code where the code could reach the app. */
  test('runs nothing anywhere but an opaque origin', async () => {
    const window = framed(`<div id="dial"></div>${said('one')}`, 'https://nibeditor.com/')
    await settled()

    expect(window.document.getElementById('dial')).toBeNull()
    expect(window.said).toBeUndefined()
  })
})
