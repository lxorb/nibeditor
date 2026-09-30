import { describe, expect, test, vi } from 'vitest'
import { skim } from './json-skim'

/** What `JSON.parse` says a key holds, and what the skim says, read the same way. */
function both(text: string, keys: string[]) {
  const whole = JSON.parse(text) as Record<string, unknown>
  const spans = skim(text, keys)
  if (!spans) throw new Error('not skimmed')

  const skimmed: Record<string, unknown> = {}
  for (const [key, at] of spans) skimmed[key] = JSON.parse(text.slice(at.from, at.to)) as unknown

  const parsed: Record<string, unknown> = {}
  for (const key of keys) if (Object.hasOwn(whole, key)) parsed[key] = whole[key]

  return { skimmed, parsed }
}

describe('a few keys of a JSON object', () => {
  test('are found where JSON.parse finds them, whatever is written around them', () => {
    const texts = [
      '{"nodes":[{"id":"a","file":"x.md"}],"nib":{"icon":"rocket","ink":[1,2,3]}}',
      ' { "nib" : { "ink" : [ [1, -2.5e3, 0.5], {"a": "]}"} ] , "icon":"🚀" } ,\n\t"nodes" : [ ] } ',
      '{"text":"a \\"quoted\\" ] and a } brace","nodes":[{"text":"[[link]]"}],"nib":null}',
      '{"nodes":true,"nib":false,"other":{"deep":[[[[{}]]]]}}',
      '{"nodes":1,"nodes":[2]}',
      '{"\\u006eodes":["escaped key"]}',
      '{}',
    ]

    for (const text of texts) {
      const { skimmed, parsed } = both(text, ['nodes', 'nib'])
      expect(skimmed).toEqual(parsed)
    }
  })

  test('look inside a value the same way, given where it is', () => {
    const text =
      '{"nib":{"version":1,"ink":[{"id":"s","points":[1,2,3]}],"icon":"pen","iconColor":"red"}}'
    const nib = skim(text, ['nib'])?.get('nib')
    const inner = nib && skim(text, ['icon', 'iconColor'], nib)

    expect(
      inner && Object.fromEntries([...inner].map(([key, at]) => [key, text.slice(at.from, at.to)])),
    ).toEqual({
      icon: '"pen"',
      iconColor: '"red"',
    })
  })

  test('is nothing at all for text that is not one object', () => {
    for (const text of [
      '',
      'not json',
      '[1,2]',
      '"a string"',
      '{"nodes":[1,2}',
      '{"nodes":"never closes}',
      '{"nodes" [1]}',
      '{"nodes":[1] "nib":{}}',
      '{"nodes":',
      `{"nodes":${'['.repeat(2000)}${']'.repeat(2000)}}`,
    ]) {
      expect(skim(text, ['nodes'])).toBeNull()
    }
  })

  test('walks megabytes of what it skips without parsing any of it', () => {
    // A plane's worth of ink: seven megabytes of numbers, and the one key wanted
    // after it.
    const ink = Array.from({ length: 25_000 }, (_, one) => ({
      id: `s${one}`,
      points: Array.from({ length: 60 }, (_, at) => Math.round((one * 7 + at) * 13.7) / 10),
    }))
    const text = JSON.stringify({ nib: { ink, icon: 'rocket' }, nodes: [{ id: 'a' }] })
    expect(text.length).toBeGreaterThan(7_000_000)

    const parse = vi.spyOn(JSON, 'parse')
    const top = skim(text, ['nodes', 'nib'])
    const nib = top?.get('nib')
    const icon = nib && skim(text, ['icon'], nib)?.get('icon')

    expect(icon && text.slice(icon.from, icon.to)).toBe('"rocket"')
    expect(parse).not.toHaveBeenCalled()
    parse.mockRestore()
  })
})
