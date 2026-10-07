import { describe, expect, test } from 'vitest'
import { carriesMetadata } from './encode'

const ascii = (text: string) => Array.from({ length: text.length }, (_, at) => text.charCodeAt(at))
const le32 = (value: number) => [value & 255, (value >> 8) & 255, (value >> 16) & 255, value >>> 24]

/** A WebP with these chunks, each a name and its bytes. */
function webp(chunks: [string, number[]][]): Uint8Array {
  const body = chunks.flatMap(([name, bytes]) => [
    ...ascii(name),
    ...le32(bytes.length),
    ...bytes,
    ...(bytes.length % 2 ? [0] : []),
  ])
  return new Uint8Array([...ascii('RIFF'), ...le32(body.length + 4), ...ascii('WEBP'), ...body])
}

/** EXIF with a position in it, the way a phone writes one: the tag that points at the
 *  GPS directory (0x8825) and a latitude reference. */
const GPS = [
  ...ascii('Exif'),
  0,
  0,
  ...ascii('MM'),
  0,
  42,
  0,
  0,
  0,
  8,
  0,
  1,
  0x88,
  0x25,
  ...ascii('N'),
]

/** A JPEG: the start, these segments, then the start of the picture's scan. */
function jpeg(segments: [number, number[]][]): Uint8Array {
  const body = segments.flatMap(([marker, bytes]) => [
    0xff,
    marker,
    ((bytes.length + 2) >> 8) & 255,
    (bytes.length + 2) & 255,
    ...bytes,
  ])
  return new Uint8Array([0xff, 0xd8, ...body, 0xff, 0xda, 0, 2, 1, 2, 3])
}

describe('a picture about to leave the device', () => {
  test('carries nothing when it is pixels alone', () => {
    expect(carriesMetadata(webp([['VP8 ', [1, 2, 3, 4]]]))).toBe(false)
    expect(carriesMetadata(jpeg([[0xe0, [...ascii('JFIF'), 0]]]))).toBe(false)
  })

  test('is caught carrying where it was taken', () => {
    expect(
      carriesMetadata(
        webp([
          ['VP8X', [8, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
          ['VP8 ', [1, 2, 3]],
          ['EXIF', GPS],
        ]),
      ),
    ).toBe(true)
    expect(carriesMetadata(jpeg([[0xe1, GPS]]))).toBe(true)
  })

  test('is caught carrying XMP', () => {
    expect(carriesMetadata(webp([['XMP ', ascii('<x:xmpmeta/>')]]))).toBe(true)
  })

  test('that is neither format is not one this app made', () => {
    expect(carriesMetadata(new Uint8Array([0x89, ...ascii('PNG')]))).toBe(true)
  })
})
