import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { MOST_IMAGE } from '@nib/online/wire'
import { Images } from './images'

const homes: string[] = []
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

function images(now = () => Date.now()) {
  const home = mkdtempSync(join(tmpdir(), 'nibd-home-'))
  homes.push(home)
  return { home, pictures: new Images(home, null, now) }
}

const ID = '0123456789abcdef0123'
const bytes = (...values: number[]) => new Uint8Array(values)

test('a picture in parts is one file in the cache once its last part is here', () => {
  const { home, pictures } = images()
  expect(pictures.part(ID, 'png', bytes(137, 80), false)).toBeUndefined()
  const path = pictures.part(ID, 'png', bytes(78, 71), true) ?? ''

  expect(path).toBe(join(home, '.cache', 'nib', 'images', `${ID}.png`))
  expect([...readFileSync(path)]).toEqual([137, 80, 78, 71])
  expect(statSync(path).mode & 0o777).toBe(0o600)
  expect(statSync(join(home, '.cache', 'nib', 'images')).mode & 0o777).toBe(0o700)
})

test('a jpeg is named the way a jpeg is', () => {
  const { pictures } = images()
  expect(pictures.part(ID, 'jpeg', bytes(255, 216), true)).toMatch(/\.jpg$/)
})

test('a picture larger than a paste may carry is refused, and nothing is written', () => {
  const { home, pictures } = images()
  const half = new Uint8Array(MOST_IMAGE / 2 + 1)
  expect(pictures.part(ID, 'png', half, false)).toBeUndefined()
  expect(pictures.part(ID, 'png', half, false)).toBeNull()
  expect(existsSync(join(home, '.cache', 'nib', 'images'))).toBe(false)
})

test('a picture already there is never written through', () => {
  const { pictures } = images()
  expect(pictures.part(ID, 'png', bytes(1), true)).not.toBeNull()
  expect(pictures.part(ID, 'png', bytes(2), true)).toBeNull()
})

test('a picture that stops arriving is forgotten', () => {
  let now = 1_000_000
  const { pictures } = images(() => now)
  pictures.part(ID, 'png', bytes(1), false)
  now += 61_000
  const path = pictures.part(ID, 'png', bytes(2), true) ?? ''
  expect([...readFileSync(path)]).toEqual([2])
})

test('pictures older than a day go as the next one is written', () => {
  const { pictures } = images()
  const old = pictures.part(ID, 'png', bytes(1), true) ?? ''
  const day = (Date.now() - 25 * 60 * 60_000) / 1000
  utimesSync(old, day, day)
  pictures.part('fedcba9876543210fedc', 'png', bytes(2), true)
  expect(existsSync(old)).toBe(false)
})
