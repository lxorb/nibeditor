/** A terminal dressed in nib's own tokens, so it reads as part of the window and not as
 *  a black box dropped into it.
 *
 *  The ground and the ink are the note's, the cursor is the accent, a selection is the
 *  selection every other surface draws, and the sixteen colours a program asks for are
 *  the six the canvas already offers - red, orange, yellow, green, cyan and violet - with
 *  the syntax blue, in whichever scheme the app is in. The bright half of each is the
 *  same colour lifted towards the ink. A program that asks for white on a light ground,
 *  or black on a dark one, is rescued by xterm.js's own minimum contrast, which is 4.5
 *  to one here, WCAG's AA - VS Code's default for the same reason.
 *
 *  xterm.js wants colours it can read without a stylesheet, so every token is resolved to
 *  a plain `#rrggbb` or `rgba()` by a canvas: a theme file may write `color-mix()` or a
 *  name, and a canvas reads whatever CSS can. */

import type { ITheme } from '@xterm/xterm'

/** The tokens, in xterm.js's order of the sixteen: the six canvas colours stand in for
 *  red, green, yellow, magenta and cyan, and the syntax blue for blue. */
const ANSI = {
  red: '--canvas-1',
  green: '--canvas-4',
  yellow: '--canvas-3',
  blue: '--syntax-function',
  magenta: '--canvas-6',
  cyan: '--canvas-5',
} as const

/** A colour CSS can read, as one xterm.js can. */
function resolver(): (value: string, fallback: string) => string {
  const context = document.createElement('canvas').getContext('2d')

  return (value, fallback) => {
    if (!context || !value.trim()) return fallback
    context.fillStyle = fallback
    context.fillStyle = value.trim()
    return context.fillStyle
  }
}

/** Two colours mixed, by what CSS itself makes of it. */
function mix(
  resolve: (value: string, fallback: string) => string,
  a: string,
  b: string,
  part: number,
) {
  return resolve(`color-mix(in srgb, ${a} ${part}%, ${b})`, a)
}

/** The terminal's colours, off the page as it is painted right now. */
export function terminalTheme(root: Element = document.documentElement): ITheme {
  const style = getComputedStyle(root)
  const resolve = resolver()
  const token = (name: string, fallback: string) => resolve(style.getPropertyValue(name), fallback)
  const light = root.getAttribute('data-theme') === 'light'

  const background = token('--bg', light ? '#ffffff' : '#0e1013')
  const foreground = token('--text', light ? '#1b1f24' : '#dde2ea')
  const strong = token('--text-strong', foreground)
  const muted = token('--muted', '#878f9d')
  const accent = token('--accent', '#7c6bf5')
  const ground = token('--surface-3', background)

  const colours = Object.fromEntries(
    Object.entries(ANSI).flatMap(([name, variable]) => {
      const colour = token(variable, foreground)
      const bright = `bright${name[0]?.toUpperCase() ?? ''}${name.slice(1)}`
      return [
        [name, colour],
        [bright, mix(resolve, colour, strong, 75)],
      ]
    }),
  )

  return {
    background,
    foreground,
    cursor: accent,
    cursorAccent: background,
    selectionBackground: token('--selection', 'rgba(124, 107, 245, 0.28)'),
    selectionInactiveBackground: mix(resolve, token('--selection', accent), background, 60),
    scrollbarSliderBackground: token('--scrollbar', muted),
    scrollbarSliderHoverBackground: token('--scrollbar-hover', muted),
    scrollbarSliderActiveBackground: token('--scrollbar-hover', muted),
    // The two ends of the scale are the scheme's own: on a dark ground black is the
    // raised surface and white the ink, and on a light one the other way round.
    black: light ? foreground : ground,
    brightBlack: muted,
    white: light ? ground : foreground,
    brightWhite: light ? token('--surface-2', background) : strong,
    ...colours,
  }
}

/** The colours find paints its matches in: the accent, softly, and the accent itself for
 *  the one that stands - what the find bar paints in a note - as `#rrggbb`, which is the
 *  only form the search addon takes. */
export function findColours(root: Element = document.documentElement): {
  match: string
  here: string
} {
  const style = getComputedStyle(root)
  const resolve = resolver()
  const background = resolve(style.getPropertyValue('--bg'), '#0e1013')
  const accent = resolve(style.getPropertyValue('--accent'), '#7c6bf5')

  return { match: opaque(mix(resolve, accent, background, 30)), here: opaque(accent) }
}

/** A colour with any transparency taken out, as `#rrggbb`. */
function opaque(colour: string): string {
  if (/^#[0-9a-f]{6}$/i.test(colour)) return colour

  const parts = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(colour)
  if (!parts) return '#7c6bf5'
  return `#${parts
    .slice(1, 4)
    .map((one) => Number(one).toString(16).padStart(2, '0'))
    .join('')}`
}

/** The app's monospace stack, which the terminal's type is set in: the one a code block
 *  is set in, so a command copied out of a note looks the same in the shell. */
export function monospace(root: Element = document.documentElement): string {
  return (
    getComputedStyle(root).getPropertyValue('--font-mono').trim() ||
    "ui-monospace, 'Cascadia Code', Consolas, monospace"
  )
}
