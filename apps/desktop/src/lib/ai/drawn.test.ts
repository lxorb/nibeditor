import { describe, expect, it } from 'vitest'
import { answerHtml, withCodeBars } from './drawn'

describe('withCodeBars', () => {
  it('puts a bar with the language and a copy button over a fenced block', () => {
    const html = answerHtml('```ts\nlet a = 1\n```', undefined, 'Copy code')
    expect(html).toContain('<div class="code"><div class="code-bar"><span>ts</span>')
    expect(html).toContain('aria-label="Copy code"')
    expect(html).toContain('<pre><code class="language-ts">let a = 1\n</code></pre></div>')
  })

  it('leaves the language out where the fence names none', () => {
    const html = answerHtml('```\nplain\n```', undefined, 'Copy code')
    expect(html).toContain('<div class="code-bar"><span></span>')
    expect(html).toContain('<pre><code>plain\n</code></pre></div>')
  })

  it('touches nothing in an answer without code', () => {
    expect(withCodeBars('<p>words</p>', 'Copy code')).toBe('<p>words</p>')
  })

  it('escapes the label it is handed', () => {
    expect(withCodeBars('<pre><code>x</code></pre>', 'a"b')).toContain('title="a&#34;b"')
  })

  it('draws no bar where no label is asked for', () => {
    expect(answerHtml('```\nx\n```')).toBe('<pre><code>x\n</code></pre>\n')
  })
})
