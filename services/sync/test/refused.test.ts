import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import * as refused from '../src/refused'

/** The sentences the service refuses with, and the rule that keeps them one each.
 *
 *  Every one of these is wire text: the app puts what `error` says into a line of
 *  its own, so the bytes are the contract and an older client shows whatever this
 *  sends. They are written out again here on purpose - a test that read them off the
 *  module would pass whatever the module said, and what needs holding is that the
 *  words have not moved.
 *
 *  Then the guard: a sentence that two modules both send is a sentence that drifts,
 *  because somebody improves one of the two. Ten of them were two copies of a
 *  literal, and the list of what is left is read off the source rather than written
 *  down, so it gets shorter rather than older. */

describe('what the service refuses with', () => {
  test('is these words, in these bytes', () => {
    expect(refused.NOT_AN_OBJECT).toBe('send an object')
    expect(refused.NO_SUCH_NOTE).toBe('no such note')
    expect(refused.SIGN_IN).toBe('sign in first')
    expect(refused.WRONG_CODE).toBe('that code is not right')
    expect(refused.TRY_IN_AN_HOUR).toBe('too many tries - try again in an hour')
    expect(refused.TOOK_TOO_LONG).toBe('start again - that took too long')
    expect(refused.NOT_A_PATH).toBe('that path is not usable')
    expect(refused.OUT_OF_SPACE).toBe('out of space')
    expect(refused.SPACE_IS_FULL).toBe('that is as many people as one space holds')
    expect(refused.NOT_AN_EMAIL).toBe('enter a valid email address')
    expect(refused.NO_ADDRESS).toBe('choose an address')
    expect(refused.SIGN_IN_TO_DO_THAT).toBe('sign in to do that')
    expect(refused.FENCED).toBe('another device is using this site now')
    expect(refused.ROOM_AWAY).toBe('this room is not answering - try again')
    expect(refused.TOO_MANY_CHANGES).toBe('too many changes at once - try again in a minute')
  })

  test('and every one of them is lowercase, so it drops into a line of text', () => {
    for (const [name, sentence] of Object.entries(refused)) {
      expect(typeof sentence, name).toBe('string')
      expect(sentence, name).toBe(
        (sentence as string).replace(/^[A-Z]/, (one) => one.toLowerCase()),
      )
    }
  })
})

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))

/** The three files the build writes, which are minified bundles rather than code
 *  anybody edits; see scripts/blog-css.ts and scripts/site-js.ts. */
const GENERATED = new Set(['style.ts', 'math.ts', 'script.ts'])

function sources(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) sources(path, found)
    else if (name.endsWith('.ts') && !GENERATED.has(name)) found.push(path)
  }

  return found
}

/** Every sentence written out as a literal beside `error:`, and which files write
 *  it. A named constant does not appear here, which is the point. */
function literals(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>()

  for (const path of sources(SOURCE)) {
    const name = path.slice(SOURCE.length).replace(/\\/g, '/')
    for (const match of readFileSync(path, 'utf8').matchAll(/error:\s*'([^']{4,})'/g)) {
      const sentence = match[1] ?? ''
      const where = found.get(sentence) ?? new Set<string>()
      where.add(name)
      found.set(sentence, where)
    }
  }

  return found
}

describe('a sentence two modules both send', () => {
  test('is named once rather than written twice', () => {
    const shared = [...literals()]
      .filter(([, where]) => where.size > 1)
      .map(([sentence, where]) => `${sentence} - ${[...where].sort().join(', ')}`)
      .sort()

    expect(shared, shared.join('\n')).toEqual([])
  })

  /** The scan is worth nothing if it finds nothing: the service refuses in a great
   *  many words, and most of them belong to one route. */
  test('and the scan is looking at something', () => {
    expect(literals().size).toBeGreaterThan(40)
  })
})
