import { describe, expect, test } from 'vitest'
import { parseRunMessage, runnerDocument } from './protocol'

const message = (extra: Record<string, unknown> = {}) => ({
  nib: 'nib-run',
  run: 7,
  lines: [{ level: 'log', text: 'hi' }],
  done: false,
  ...extra,
})

describe('reading a message from the sandbox', () => {
  test('takes the lines and whether the run is over', () => {
    expect(parseRunMessage(message({ done: true }), 7)).toEqual({
      run: 7,
      lines: [{ level: 'log', text: 'hi' }],
      ready: false,
      done: true,
    })
  })

  test('reads the word that says the code is about to start', () => {
    const first = parseRunMessage(message({ lines: [], ready: true }), 7)
    expect(first).toMatchObject({ ready: true, done: false, lines: [] })
  })

  test('ignores a message from a run that has been replaced', () => {
    expect(parseRunMessage(message(), 8)).toBeNull()
  })

  test('ignores anything else on the page that posts messages', () => {
    expect(parseRunMessage({ type: 'webpackHot' }, 7)).toBeNull()
    expect(parseRunMessage(message({ nib: 'something-else' }), 7)).toBeNull()
    expect(parseRunMessage('hello', 7)).toBeNull()
    expect(parseRunMessage(null, 7)).toBeNull()
  })

  test('ignores a message whose lines are not lines', () => {
    expect(parseRunMessage(message({ lines: 'hi' }), 7)).toBeNull()
    expect(parseRunMessage(message({ lines: [{ level: 'log' }] }), 7)).toBeNull()
    expect(parseRunMessage(message({ lines: [{ level: 'shout', text: 'hi' }] }), 7)).toBeNull()
    expect(parseRunMessage(message({ lines: [null] }), 7)).toBeNull()
  })

  test('reads a batch with no lines in it, which is how a run ends quietly', () => {
    expect(parseRunMessage(message({ lines: [], done: true }), 7)?.done).toBe(true)
  })
})

/** A frame script standing in for the real one, which is the frame's business. */
const SCRIPT = 'window.ranTheFrameScript = true'

/** A document for this code, and the program in it the frame script evaluates. */
const made = (code: string, run = 1) => runnerDocument(code, run, SCRIPT)
const programOf = (html: string) =>
  /<script type="text\/plain" id="nib-frame">([\s\S]*?)<\/script>/.exec(html)?.[1]

describe('the document the sandbox runs', () => {
  test('leaves the code nothing to reach', () => {
    const html = made('1 + 1')
    expect(html).toContain("default-src 'none'")
    expect(html).toContain("form-action 'none'")
  })

  test('runs nothing inline but the frame script: the program is text it evaluates', () => {
    const html = made('1 + 1')
    // Every script element is either the program, which no browser executes, or
    // the frame script, which the app's policy - inherited by the frame - allows
    // by its hash and which is the only inline script it allows.
    const scripts = [...html.matchAll(/<script([^>]*)>/g)].map((one) => one[1]?.trim())
    expect(scripts).toEqual(['type="text/plain" id="nib-frame"', ''])
    expect(html).toContain(`<script>${SCRIPT}</script>`)
    expect(html.indexOf('nib-frame')).toBeLessThan(html.indexOf(`<script>${SCRIPT}`))
  })

  test('carries the run number, so its output can be told apart', () => {
    expect(made('1', 42)).toContain('var RUN = 42')
  })

  test('is JavaScript that compiles, embedded formatter and all', () => {
    // The program is written as text, so nothing type checks it. Compiling it
    // here catches a stray backtick or a broken embedding before it ships.
    const body = programOf(made("console.log('hi')"))
    expect(body).toBeDefined()
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- compiling the script is how a stray backtick is caught
    expect(() => new Function(body ?? '')).not.toThrow()
  })

  test('cannot be escaped from by code that closes the script element', () => {
    const html = made('const tag = "</script><script>alert(1)</script>"')
    // Two script elements: the program and the frame script, both this file's.
    expect(html.match(/<\/script>/g)).toHaveLength(2)
    expect(html).not.toContain('alert(1)</script>')
  })

  test('cannot be escaped from by code that opens an HTML comment', () => {
    expect(made('// <!--')).not.toContain('<!--')
  })

  test('hands the code through as itself, quotes and newlines and all', () => {
    const code = 'console.log(\'a\\nb\')\n`back` + "tick"'
    const html = made(code)
    const literal = /var CODE = (".*")\n/.exec(html)?.[1]
    expect(literal).toBeDefined()
    expect(JSON.parse((literal ?? '""').replace(/\\u003c/g, '<'))).toBe(code)
  })
})
