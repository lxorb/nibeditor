import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

/** The Account pane asks for a six-digit code in three places: turning the second
 *  factor on, changing it once it is on, and deleting the account. With the factor on
 *  and the account being deleted, the second and third are on screen together, and
 *  hunt-7 found both called "Code from the app" - one of them unlocks two presses in
 *  the Signing in card and the other deletes the account, and nothing said which was
 *  which. Each is named for what it does now, and this holds them apart.
 *
 *  Read out of the two components rather than mounted: what is asked is only which
 *  label each code field wears. */

const SOURCES = ['../src/lib/Security.svelte', '../src/lib/DeleteAccount.svelte'].map((one) =>
  readFileSync(fileURLToPath(new URL(one, import.meta.url)), 'utf8'),
)

/** The label of every field that takes a code an app or a mail hands over. */
const labels = SOURCES.flatMap((source) =>
  [...source.matchAll(/<input\b[^>]*?aria-label=\{t\('([^']+)'\)\}[^>]*?one-time-code/g)].map(
    ([, label]) => label,
  ),
)

test('every code field on the Account pane is named for what it does', () => {
  expect(labels.sort()).toEqual([
    'App code to delete',
    'Code',
    'Code from the app',
    'Code to change sign-in',
  ])
})

test('and no two of them are named alike', () => {
  expect(new Set(labels).size).toBe(labels.length)
})
