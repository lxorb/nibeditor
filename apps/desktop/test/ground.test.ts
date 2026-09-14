import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** The colour the window opens on, before the app has been read.
 *
 *  index.html carries two hex colours and two storage keys that belong to other files:
 *  the two sides of `--bg` in the themes, and the keys `theme.svelte.ts` and `ground.ts`
 *  write. It has to carry them - it is parsed before any custom property is declared and
 *  before any module of ours exists, and a fetch to learn its own background colour
 *  would be the very wait it is there to avoid - so the copies are held to their
 *  originals here instead.
 *
 *  Which is the whole of what a skeleton in this app can be. The shell has no colour of
 *  its own: `main` is `--window-ground` and every panel above it is transparent, so
 *  until the rows arrive the ground is the shell. Grey boxes drawn here would be a look
 *  the app does not have, and a jump when the real thing landed. */

const HTML = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8')
const TOKENS = readFileSync(
  fileURLToPath(new URL('../../../packages/themes/src/tokens.css', import.meta.url)),
  'utf8',
)
const GROUND = readFileSync(fileURLToPath(new URL('../src/lib/ground.ts', import.meta.url)), 'utf8')

/** What `--bg` is on one side of the themes. */
function background(scheme: 'dark' | 'light'): string {
  const block = TOKENS.split(`[data-theme='${scheme}']`).at(1) ?? ''
  return /--bg:\s*([^;]+);/.exec(block)?.[1]?.trim() ?? ''
}

/** Every rule in the page's own `<style>`, as the selector it is on and what it sets.
 *  Read rather than matched by hand so that reformatting the file cannot break it. */
function rules(): { on: string; sets: string }[] {
  const style = HTML.split('<style>').at(1)?.split('</style>').at(0) ?? ''

  return style
    .split('}')
    .map((one) => one.split('{'))
    .filter((parts) => parts.length === 2)
    .map(([on, sets]) => ({
      on: (on ?? '').replace(/\s+/g, ' ').trim(),
      sets: sets ?? '',
    }))
}

/** The colour a rule sets, by the selector it is on. */
function inline(selector: string): string {
  const rule = rules().find((one) => one.on === selector)
  return /background:\s*([^;]+);/.exec(rule?.sets ?? '')?.[1]?.trim() ?? ''
}

describe('the ground a launch paints before it has read anything', () => {
  test('is the dark palette’s own background', () => {
    expect(inline('html')).toBe(background('dark'))
  })

  test('and the light palette’s on the other side', () => {
    expect(inline("html[data-theme='light']")).toBe(background('light'))
  })

  test('and the phone’s status bar is told the same colour', () => {
    expect(HTML).toContain(`<meta name="theme-color" content="${background('dark')}" />`)
  })

  /** Both keys, because a renamed key is a launch that silently paints white again -
   *  nothing throws, nothing is logged, and the only symptom is a flash. */
  test.each([
    ['nib:theme-scheme', 'which side of the theme was chosen'],
    ['nib:ground', 'the colour the window last stood on'],
  ])('reads %s (%s) from the same key the app writes', (key) => {
    expect(HTML).toContain(`localStorage.getItem('${key}')`)
  })

  test('and ground.ts writes the one it does not share with the theme', () => {
    expect(GROUND).toContain("const KEY = 'nib:ground'")
  })

  /** A colour on `body` as well would paint over a transparent `html`, which is what a
   *  translucent window's ground is: the reader would get a solid flash where the
   *  platform's material belongs. See base.css. */
  /** Words in the head, which is what a comment with a stray `-->` in it leaves behind:
   *  a browser moves the text out of the head and into the top of the page, so the app
   *  opens with a sentence of a code comment written across the window. It happened
   *  while this file was being written, and a launch nobody looks at with their eyes is
   *  exactly where it would survive. */
  test('has nothing in the head but tags, comments and the three with bodies', () => {
    const head = HTML.split('<head>').at(1)?.split('</head>').at(0) ?? ''
    const left = head
      .replace(/<(style|script|title)>[\s\S]*?<\/\1>/g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]*>/g, '')

    expect(left.trim()).toBe('')
  })

  test('puts no colour on the body, which is what lets a translucent window through', () => {
    const coloured = rules().filter((one) => one.sets.includes('background:'))

    expect(coloured.map((one) => one.on).filter((on) => /\bbody\b/.test(on))).toEqual([])
  })
})
