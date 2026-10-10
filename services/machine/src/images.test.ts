import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { MOST_IMAGE } from '@nib/online/wire'
import { AS_USER_SCRIPT, Images, NAMED, type Run, runChild } from './images'
import type { User } from './limits'

const homes: string[] = []
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

function aHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'nibd-home-'))
  homes.push(home)
  return home
}

const ID = '0123456789abcdef0123'
const OTHER = 'fedcba9876543210fedc'
const bytes = (...values: number[]) => new Uint8Array(values)
const folderIn = (home: string) => join(home, '.cache', 'nib', 'images')
const aDayAgo = () => (Date.now() - 25 * 60 * 60_000) / 1000

/** An old file at `path`, made a day and more ago. */
function old(path: string) {
  writeFileSync(path, 'x')
  utimesSync(path, aDayAgo(), aDayAgo())
}

describe('where nibd is the user already', () => {
  const images = (now = () => Date.now()) => {
    const home = aHome()
    return { home, pictures: new Images(home, null, { now }) }
  }

  test('a picture in parts is one file in the cache once its last part is here', async () => {
    const { home, pictures } = images()
    expect(await pictures.part(ID, 'png', bytes(137, 80), false)).toBeUndefined()
    const path = (await pictures.part(ID, 'png', bytes(78, 71), true)) ?? ''

    expect(path).toBe(join(folderIn(home), `${ID}.png`))
    expect([...readFileSync(path)]).toEqual([137, 80, 78, 71])
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  test('a jpeg is named the way a jpeg is', async () => {
    const { pictures } = images()
    expect(await pictures.part(ID, 'jpeg', bytes(255, 216), true)).toMatch(/\.jpg$/)
  })

  test('an id that could be a path is never a file', async () => {
    const { pictures } = images()
    expect(await pictures.part('../../etc/passwd', 'png', bytes(1), true)).toBeNull()
  })

  test('a picture larger than a paste may carry is refused, and nothing is written', async () => {
    const { home, pictures } = images()
    const half = new Uint8Array(MOST_IMAGE / 2 + 1)
    expect(await pictures.part(ID, 'png', half, false)).toBeUndefined()
    expect(await pictures.part(ID, 'png', half, false)).toBeNull()
    expect(existsSync(folderIn(home))).toBe(false)
  })

  test('a picture already there is never written through', async () => {
    const { pictures } = images()
    expect(await pictures.part(ID, 'png', bytes(1), true)).not.toBeNull()
    expect(await pictures.part(ID, 'png', bytes(2), true)).toBeNull()
  })

  test('a picture that stops arriving is forgotten', async () => {
    let now = 1_000_000
    const { pictures } = images(() => now)
    await pictures.part(ID, 'png', bytes(1), false)
    now += 61_000
    const path = (await pictures.part(ID, 'png', bytes(2), true)) ?? ''
    expect([...readFileSync(path)]).toEqual([2])
  })

  test('the clearing takes only old pictures of nib’s naming, and nothing else there', async () => {
    const { home, pictures } = images()
    mkdirSync(folderIn(home), { recursive: true })
    const mine = join(folderIn(home), `${OTHER}.png`)
    const theirs = join(folderIn(home), 'holiday.png')
    const notes = join(folderIn(home), 'notes.txt')
    for (const path of [mine, theirs, notes]) old(path)

    await pictures.part(ID, 'png', bytes(1), true)
    expect(existsSync(mine)).toBe(false)
    expect(existsSync(theirs)).toBe(true)
    expect(existsSync(notes)).toBe(true)
  })

  test('names a picture the way the clearing knows it', () => {
    expect(NAMED.test(`${ID}.png`)).toBe(true)
    expect(NAMED.test(`${ID}.jpg`)).toBe(true)
    expect(NAMED.test('passwd')).toBe(false)
    expect(NAMED.test(`${ID}.png.bak`)).toBe(false)
    expect(NAMED.test(`short.png`)).toBe(false)
  })
})

describe('where nibd is root', () => {
  const NIB: User = { name: 'nib', uid: 1000, gid: 1000, home: '', shell: '/bin/bash' }

  test('the write is a process of the user’s, and root touches nothing in the home', async () => {
    const home = aHome()
    const user = { ...NIB, home }
    const asked: { file: string; args: string[]; env: Record<string, string>; input: number[] }[] =
      []
    const run: Run = (file, args, env, input) => {
      asked.push({ file, args, env, input: [...input] })
      return Promise.resolve({ code: 0, out: join(folderIn(home), `${ID}.png`) })
    }
    const pictures = new Images(home, user, { run, has: () => true })

    expect(await pictures.part(ID, 'png', bytes(1, 2), true)).toBe(
      join(folderIn(home), `${ID}.png`),
    )
    expect(asked).toEqual([
      {
        file: '/usr/bin/setpriv',
        args: [
          '--reuid=1000',
          '--regid=1000',
          '--init-groups',
          '--',
          '/bin/sh',
          '-c',
          AS_USER_SCRIPT,
          'nib-image',
          `${ID}.png`,
        ],
        env: { HOME: home, PATH: '/usr/local/bin:/usr/bin:/bin' },
        input: [1, 2],
      },
    ])
    expect(existsSync(join(home, '.cache'))).toBe(false)
  })

  test('with no way to be the user, nothing is written at all', async () => {
    const home = aHome()
    let ran = false
    const run: Run = () => {
      ran = true
      return Promise.resolve({ code: 0, out: '' })
    }
    const pictures = new Images(home, { ...NIB, home }, { run, has: () => false })
    expect(await pictures.part(ID, 'png', bytes(1), true)).toBeNull()
    expect(ran).toBe(false)
    expect(existsSync(join(home, '.cache'))).toBe(false)
  })

  test('a write the user’s process refused, or one that said another path, is no path', async () => {
    const home = aHome()
    const said =
      (code: number, out: string): Run =>
      () =>
        Promise.resolve({ code, out })
    const user = { ...NIB, home }
    const refused = new Images(home, user, { run: said(1, ''), has: () => true })
    expect(await refused.part(ID, 'png', bytes(1), true)).toBeNull()
    const elsewhere = new Images(home, user, { run: said(0, '/etc/passwd'), has: () => true })
    expect(await elsewhere.part(ID, 'png', bytes(1), true)).toBeNull()
  })

  /** The script itself, run by this test's own user in place of `setpriv`'s. */
  describe('the script the user runs', () => {
    const asThisUser = (home: string): Run => {
      return (_file, args, _env, input) => {
        const after = args.indexOf('--') + 1
        return runChild(
          args[after] ?? '',
          args.slice(after + 1),
          { HOME: home, PATH: '/usr/bin:/bin' },
          input,
        )
      }
    }
    const pictures = (home: string) =>
      new Images(home, { ...NIB, home }, { run: asThisUser(home), has: () => true })

    test('writes the picture, private, and says where', async () => {
      const home = aHome()
      const path = (await pictures(home).part(ID, 'png', bytes(7, 8), true)) ?? ''
      expect(path).toBe(join(folderIn(home), `${ID}.png`))
      expect([...readFileSync(path)]).toEqual([7, 8])
      expect(statSync(path).mode & 0o777).toBe(0o600)
      expect(statSync(folderIn(home)).mode & 0o777).toBe(0o700)
    })

    test('never writes through a file already there', async () => {
      const home = aHome()
      mkdirSync(folderIn(home), { recursive: true })
      const target = join(home, 'kept')
      writeFileSync(target, 'kept')
      symlinkSync(target, join(folderIn(home), `${ID}.png`))
      expect(await pictures(home).part(ID, 'png', bytes(1), true)).toBeNull()
      expect(readFileSync(target, 'utf8')).toBe('kept')
    })

    test('clears only old pictures of nib’s naming', async () => {
      const home = aHome()
      mkdirSync(folderIn(home), { recursive: true })
      const mine = join(folderIn(home), `${OTHER}.webp`)
      const theirs = join(folderIn(home), 'holiday.png')
      for (const path of [mine, theirs]) old(path)

      await pictures(home).part(ID, 'png', bytes(1), true)
      expect(existsSync(mine)).toBe(false)
      expect(existsSync(theirs)).toBe(true)
    })
  })
})
