import { describe, expect, test } from 'vitest'
import { escape, escapeAll } from './html'

describe('words the app writes on its own behalf', () => {
  test('lose every character that could end an attribute or open a tag', () => {
    expect(escapeAll(`a <b> & "c" 'd'`)).toBe('a &lt;b&gt; &amp; &quot;c&quot; &#39;d&#39;')
  })

  test('escape an ampersand that already opens an entity, which prose would keep', () => {
    expect(escapeAll('Tom &amp; Jerry')).toBe('Tom &amp;amp; Jerry')
    expect(escape('Tom &amp; Jerry')).toBe('Tom &amp; Jerry')
  })
})
