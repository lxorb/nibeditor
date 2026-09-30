import { describe, expect, test } from 'vitest'
import tokens from '@nib/themes/tokens.css?raw'
import { contrastCss } from '@nib/themes/contrast'
import { accentTokens } from '../accents'
import { lookOf } from './looks'

/** A card in the theme picker is painted from the text of the sheets rather than by
 *  the page, so these ask what it would be painted in: the colours the app itself
 *  would take for the window, the list, the title bar and the words, in each scheme.
 *
 *  Read against the app's real tokens, so a token that moves moves here too. */

describe('the built-in theme', () => {
  test('is the dark palette on the dark side', () => {
    const look = lookOf([tokens], 'dark')

    expect(look.ground).toBe('#0e1013')
    // The list reads the Typora name, which the tokens point at their own surface.
    expect(look.side).toBe('#14171c')
    // And the title bar is the second surface.
    expect(look.frame).toBe('#1a1e25')
    expect(look.text).toBe('#dde2ea')
    expect(look.accent).toBe('#7c6bf5')
  })

  /** The dark block is also the root's, so it is under the light one on a light
   *  page and the light one has to win: the order a browser reads them in. */
  test('and the light palette on the light side', () => {
    const look = lookOf([tokens], 'light')

    expect(look.ground).toBe('#fbfcfd')
    expect(look.side).toBe('#f3f5f8')
    expect(look.text).toBe('#1a1d23')
  })

  test('wears the reader’s accent, and the open row is a wash of it', () => {
    const look = lookOf([tokens], 'dark', accentTokens('teal', 'dark'))

    expect(look.accent).toBe('#33c7ba')
    expect(look.open).toBe('color-mix(in srgb, #33c7ba 16%, transparent)')
  })
})

describe('a theme on top of the tokens', () => {
  test('states a side of its own, and the other side is untouched', () => {
    const pair = `[data-theme='light'] { --bg: #fdf6e3; } [data-theme="dark"] { --bg: #002b36; }`

    expect(lookOf([tokens, pair], 'light').ground).toBe('#fdf6e3')
    expect(lookOf([tokens, pair], 'dark').ground).toBe('#002b36')
    expect(lookOf([tokens, pair], 'dark').text).toBe('#dde2ea')
  })

  /** A token a theme restates moves everything the tokens build on it, because a
   *  custom property is substituted where it is declared: the list is the surface. */
  test('moves what is built on a token it restates', () => {
    const surface = `:root { --surface: #222222; }`

    expect(lookOf([tokens, surface], 'dark').side).toBe('#222222')
  })

  test('as a Typora theme says it, under the names Typora uses', () => {
    const typora = `:root { --side-bar-bg-color: #eeeeee; --text-color: #333; }`

    expect(lookOf([tokens, typora], 'light').side).toBe('#eeeeee')
  })

  test('outranks the reader’s accent only where the app lets it, which is never inline', () => {
    const own = `:root { --accent: #ff0000; }`

    // The app writes no accent onto the page for a theme that brings its own, so
    // what the card is handed is nothing, and the theme's colour stands.
    expect(lookOf([tokens, own], 'dark').accent).toBe('#ff0000')
    // Handed one, the inline colour wins over any sheet, as a style attribute does.
    expect(lookOf([tokens, own], 'dark', { '--accent': '#00ff00' }).accent).toBe('#00ff00')
    // Short of a sheet that says it is important.
    const loud = `:root { --accent: #ff0000 !important; }`
    expect(lookOf([tokens, loud], 'dark', { '--accent': '#00ff00' }).accent).toBe('#ff0000')
  })

  test('loses to the tokens where its selector is weaker, as it would on the page', () => {
    const weak = `html { --bg: #123456; }`

    expect(lookOf([tokens, weak], 'dark').ground).toBe('#0e1013')
  })

  test('and wins from the body, which the whole window is inside', () => {
    const body = `body { --bg: #123456; }`

    expect(lookOf([tokens, body], 'dark').ground).toBe('#123456')
  })

  test('and says nothing from a rule about the words of a note', () => {
    const prose = `#write h1 { --bg: #123456; color: red; }`

    expect(lookOf([tokens, prose], 'dark').ground).toBe('#0e1013')
  })
})

describe('the high contrast theme', () => {
  test('is black and white, in its own accent', () => {
    expect(lookOf([tokens, contrastCss], 'dark').ground).toBe('#000000')
    expect(lookOf([tokens, contrastCss], 'light').ground).toBe('#ffffff')
    expect(lookOf([tokens, contrastCss], 'light').accent).toBe('#3a25c9')
  })
})

describe('custom.css', () => {
  test('is on top of the theme, as it is on the page', () => {
    const custom = `:root { --bg: #abcdef; }`

    // As strong as the theme's `[data-theme]` block and later than it, so it wins.
    expect(lookOf([tokens, contrastCss, custom], 'dark').ground).toBe('#abcdef')
    // And where it is weaker, it does not.
    const weak = `html { --bg: #abcdef; }`
    expect(lookOf([tokens, contrastCss, weak], 'dark').ground).toBe('#000000')
  })
})

describe('a value that cannot be worked out', () => {
  test('is nothing rather than a guess', () => {
    const broken = `:root { --bg: var(--nowhere); }`

    expect(lookOf([tokens, broken], 'dark').ground).toBe('')
  })

  test('takes its fallback where it has one', () => {
    const fallback = `:root { --bg: var(--nowhere, #010203); }`

    expect(lookOf([tokens, fallback], 'dark').ground).toBe('#010203')
  })

  test('and a cycle ends rather than running for ever', () => {
    const cycle = `:root { --bg: var(--line); --line: var(--bg); }`

    expect(lookOf([tokens, cycle], 'dark').ground).toBe('')
  })
})
