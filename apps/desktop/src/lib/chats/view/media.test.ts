import type { FileRef } from '@nib/chats'
import { describe, expect, test } from 'vitest'
import { barsOf, clock, fitted, gallery, seekAt, sortFiles } from './media'

const file = (type: string, more: Partial<FileRef> = {}): FileRef => ({
  hash: 'a'.repeat(64),
  name: 'x',
  size: 1,
  type,
  ...more,
})

describe('pictures', () => {
  test('one is fitted inside the column and the caps, its shape kept', () => {
    expect(fitted(file('image/webp', { width: 1600, height: 1200 }), 800)).toEqual({
      width: 480,
      height: 360,
    })
    expect(fitted(file('image/webp', { width: 400, height: 2000 }), 800)).toEqual({
      width: 72,
      height: 360,
    })
    expect(fitted(file('image/webp', { width: 200, height: 100 }), 800)).toEqual({
      width: 200,
      height: 100,
    })
    expect(fitted(file('image/webp', { width: 1600, height: 1200 }), 300)).toEqual({
      width: 300,
      height: 225,
    })
  })

  test('one whose size nobody stated is a square', () => {
    expect(fitted(file('image/webp'), 800)).toEqual({ width: 240, height: 240 })
  })

  test('a gallery is two across for two and four, three otherwise, six at most', () => {
    const many = (count: number) => Array.from({ length: count }, () => file('image/webp'))
    expect(gallery(many(2)).across).toBe(2)
    expect(gallery(many(3)).across).toBe(3)
    expect(gallery(many(4)).across).toBe(2)
    expect(gallery(many(5)).across).toBe(3)
    const nine = gallery(many(9))
    expect([nine.shown.length, nine.more]).toEqual([6, 3])
  })

  test('files are sorted into what draws them', () => {
    const sorted = sortFiles([
      file('image/png'),
      file('video/mp4'),
      file('audio/webm'),
      file('application/pdf'),
    ])
    expect(sorted.seen.map((one) => one.type)).toEqual(['image/png', 'video/mp4'])
    expect(sorted.heard.map((one) => one.type)).toEqual(['audio/webm'])
    expect(sorted.other.map((one) => one.type)).toEqual(['application/pdf'])
  })
})

describe('sound', () => {
  test('bars are each stretch’s loudness, the loudest 255', () => {
    const samples = new Float32Array(64 * 10)
    for (let i = 0; i < samples.length; i++) samples[i] = i < 320 ? 0.1 : 0.4
    const bars = barsOf(samples)
    expect(bars).toHaveLength(64)
    expect(bars[0]).toBe(64)
    expect(bars[63]).toBe(255)
  })

  test('silence is flat, and nothing is no bars of nothing', () => {
    expect(barsOf(new Float32Array(100))).toEqual(Array.from({ length: 64 }, () => 0))
    expect(barsOf(new Float32Array(0), 4)).toEqual([0, 0, 0, 0])
  })

  test('a press seeks to where it fell, within the bars', () => {
    expect(seekAt(150, 100, 200)).toBe(0.25)
    expect(seekAt(50, 100, 200)).toBe(0)
    expect(seekAt(500, 100, 200)).toBe(1)
  })

  test('a length reads as a player says it', () => {
    expect([clock(0), clock(42), clock(725.4)]).toEqual(['0:00', '0:42', '12:05'])
  })
})
