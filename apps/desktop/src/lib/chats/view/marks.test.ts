// @vitest-environment jsdom
import { expect, test } from 'vitest'
import { onlyEmoji } from './body'
import { markMentions } from './marks'

function marked(html: string) {
  const root = document.createElement('div')
  root.innerHTML = html
  markMentions(root, [
    { label: 'Lucile Martin', me: false },
    { label: 'Lucile', me: false },
    { label: 'Emil', me: true },
  ])
  return root.innerHTML
}

test('a name called is drawn as a name, the reader’s own stronger', () => {
  expect(marked('<p>hi @Lucile Martin and @Emil!</p>')).toBe(
    '<p>hi <span class="mention">@Lucile Martin</span> and <span class="mention is-me">@Emil</span>!</p>',
  )
})

test('nothing in code, in a link, or inside an address', () => {
  expect(marked('<p><code>@Emil</code> <a href="x">@Emil</a> ana@Emil</p>')).toBe(
    '<p><code>@Emil</code> <a href="x">@Emil</a> ana@Emil</p>',
  )
})

test('here and everyone call the reader too', () => {
  expect(marked('<p>@here look</p>')).toBe('<p><span class="mention is-me">@here</span> look</p>')
})

test('a few emoji alone are drawn large; words or digits are not', () => {
  expect(onlyEmoji('🎉🎉')).toBe(true)
  expect(onlyEmoji('👍🏽')).toBe(true)
  expect(onlyEmoji('nice 🎉')).toBe(false)
  expect(onlyEmoji('42')).toBe(false)
})
