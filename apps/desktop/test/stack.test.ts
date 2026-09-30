import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** What is in front of what, said once.
 *
 *  Sixty-five numbers used to say it, each chosen by whoever wrote a layer against
 *  the numbers they could see at the time: 4 and 5 for two lists, 20 and 21 for the
 *  palette, 57 and 58 for the theme picker, 90 for a row being carried and 1000 for a
 *  tab. Nothing said which of them had to be over which, so nothing stopped the next
 *  layer from being put between two it did not know about. The ladder is in
 *  tokens.css now, a layer takes the rung that says what it is, and this is what
 *  holds every stylesheet to it - the way motion.test.ts holds every duration to
 *  `dur`. See docs/design.md, "The stack". */

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))
const THEMES = fileURLToPath(new URL('../../../packages/themes/src/', import.meta.url))

function files(dir: string, suffix: RegExp): string[] {
  const out: string[] = []

  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...files(path, suffix))
    else if (suffix.test(name) && !name.endsWith('.test.ts')) out.push(path)
  }

  return out
}

interface Sheet {
  name: string
  css: string
}

/** Every stylesheet the app wears, comments out: a component's `<style>` blocks and
 *  the themes package's sheets. */
const sheets: Sheet[] = [
  ...files(SOURCE, /\.svelte$/).map((path) => ({
    name: path.slice(SOURCE.length).replace(/\\/g, '/'),
    css: [...readFileSync(path, 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
      .map((one) => one[1])
      .join('\n'),
  })),
  ...files(THEMES, /\.css$/).map((path) => ({
    name: `themes/${path.slice(THEMES.length).replace(/\\/g, '/')}`,
    css: readFileSync(path, 'utf8'),
  })),
].map((one) => ({ ...one, css: one.css.replace(/\/\*[\s\S]*?\*\//g, '') }))

/** The ladder, in the order tokens.css states it. */
const ladder = [
  ...readFileSync(join(THEMES, 'tokens.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .matchAll(/(--z-[a-z]+):\s*(-?\d+);/g),
].map((one) => ({ name: one[1] ?? '', rung: Number(one[2]) }))

/** Every value a stylesheet hands `z-index` or `--scrim-z`, and where. */
function said(property: string): { where: string; value: string }[] {
  const reading = new RegExp(String.raw`(?<![\w-])${property}\s*:\s*([^;}]+)`, 'g')

  return sheets.flatMap((one) =>
    [...one.css.matchAll(reading)].map((match) => ({
      where: one.name,
      value: (match[1] ?? '').trim(),
    })),
  )
}

/** A rung by name; or the step under one, which is where a scrim or a catch goes
 *  when it has to be under a surface that comes before it in the page. */
const RUNG = /^var\(--z-[a-z]+\)(?: !important)?$/
const UNDER = /^calc\(var\(--z-[a-z]+\) - 1\)$/

describe('the stack', () => {
  test('is one ladder, each rung above the last', () => {
    expect(ladder.length).toBeGreaterThan(10)

    const out = ladder.filter((one, at) => at > 0 && one.rung <= (ladder[at - 1]?.rung ?? 0))
    expect(out, 'these are not above the rung before them').toEqual([])
  })

  test('the scan finds the layers', () => {
    expect(said('z-index').length).toBeGreaterThan(60)
  })

  test('and every layer stands on a rung rather than on a number of its own', () => {
    const own = said('z-index')
      .filter(({ value }) => !RUNG.test(value) && !UNDER.test(value))
      // The scrim's own rule: the step under whichever layer the caller names.
      .filter(({ value }) => value !== 'calc(var(--scrim-z, var(--z-sheet)) - 1)')
      .map(({ where, value }) => `${where}: z-index: ${value}`)

    expect(own, own.join('\n')).toEqual([])
  })

  test('and so does every scrim, which names the layer it is put up under', () => {
    const own = said('--scrim-z')
      .filter(({ value }) => !RUNG.test(value))
      .map(({ where, value }) => `${where}: --scrim-z: ${value}`)

    expect(own, own.join('\n')).toEqual([])
  })

  test('and every rung a stylesheet names is on the ladder', () => {
    const known = new Set(ladder.map((one) => one.name))
    const unknown = sheets.flatMap((one) =>
      [...one.css.matchAll(/var\((--z-[a-z]+)\)/g)]
        .map((match) => match[1] ?? '')
        .filter((name) => !known.has(name))
        .map((name) => `${one.name}: ${name}`),
    )

    expect(unknown).toEqual([])
  })

  test('and no script puts a layer somewhere of its own', () => {
    const scripted = files(SOURCE, /\.(svelte|ts)$/)
      .filter((path) =>
        /\.zIndex\b|style:z-index|style="[^"]*z-index/.test(readFileSync(path, 'utf8')),
      )
      .map((path) => path.slice(SOURCE.length).replace(/\\/g, '/'))

    expect(scripted).toEqual([])
  })
})
