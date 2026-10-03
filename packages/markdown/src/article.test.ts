// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from 'vitest'
import {
  absolutise,
  clean,
  extract,
  linkTitle,
  pageTags,
  pageTitle,
  readSnapshot,
  widestOf,
} from './article'
import { SELECTED } from './snapshot'

const PAGE = 'https://site.example/section/page.html'

/** A document holding the given body, as jsdom would hand one over. */
function pageOf(body: string, head = ''): Document {
  document.head.innerHTML = head
  document.body.innerHTML = body
  return document
}

beforeEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

describe('the widest candidate a srcset offers', () => {
  test('takes the largest width', () => {
    expect(widestOf('a.jpg 480w, b.jpg 1600w, c.jpg 800w')).toBe('b.jpg')
  })

  test('takes the largest pixel ratio', () => {
    expect(widestOf('a.jpg, b.jpg 2x')).toBe('b.jpg')
  })

  test('takes the only one when there is only one', () => {
    expect(widestOf('a.jpg')).toBe('a.jpg')
  })

  test('answers nothing for nothing', () => {
    expect(widestOf('')).toBe(null)
    expect(widestOf('  ,  ')).toBe(null)
  })
})

describe('making addresses absolute', () => {
  test('resolves a link beside the page', () => {
    const page = pageOf('<a href="other.html">x</a>')
    absolutise(page.body, PAGE)

    expect(page.querySelector('a')?.getAttribute('href')).toBe(
      'https://site.example/section/other.html',
    )
  })

  test('resolves a link from the root', () => {
    const page = pageOf('<a href="/top">x</a>')
    absolutise(page.body, PAGE)

    expect(page.querySelector('a')?.getAttribute('href')).toBe('https://site.example/top')
  })

  test('resolves a link that climbs', () => {
    const page = pageOf('<a href="../up.html">x</a>')
    absolutise(page.body, PAGE)

    expect(page.querySelector('a')?.getAttribute('href')).toBe('https://site.example/up.html')
  })

  test('points a link within the page back at the page', () => {
    const page = pageOf('<a href="#part">x</a>')
    absolutise(page.body, PAGE)

    expect(page.querySelector('a')?.getAttribute('href')).toBe(`${PAGE}#part`)
  })

  test('leaves an absolute link as it is', () => {
    const page = pageOf('<a href="https://elsewhere.example/x">x</a>')
    absolutise(page.body, PAGE)

    expect(page.querySelector('a')?.getAttribute('href')).toBe('https://elsewhere.example/x')
  })

  test('takes the href off a link the browser would run', () => {
    const page = pageOf('<a href="javascript:alert(1)">x</a>')
    absolutise(page.body, PAGE)

    expect(page.querySelector('a')?.hasAttribute('href')).toBe(false)
  })

  // A browser reads a scheme with tabs and newlines inside it as the scheme, so
  // whether a link runs code is a question about the address it resolves to and
  // not about the characters the markup spelled it with.
  test('sees through a scheme written with something in the middle of it', () => {
    for (const href of [
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      '  JavaScript:alert(1)',
    ]) {
      const page = pageOf(`<a href="${href.replace(/\t/g, '&#9;').replace(/\n/g, '&#10;')}">x</a>`)
      absolutise(page.body, PAGE)

      expect(page.querySelector('a')?.hasAttribute('href'), href).toBe(false)
    }
  })

  test('takes it off a link to a document of the page’s own making too', () => {
    const page = pageOf('<a href="data:text/html,<b>hi</b>">x</a>')
    absolutise(page.body, PAGE)

    expect(page.querySelector('a')?.hasAttribute('href')).toBe(false)
  })

  test('resolves a picture beside the page', () => {
    const page = pageOf('<img src="photo.jpg">')
    absolutise(page.body, PAGE)

    expect(page.querySelector('img')?.getAttribute('src')).toBe(
      'https://site.example/section/photo.jpg',
    )
  })

  test('finds the address a lazy picture was deferring', () => {
    const page = pageOf('<img src="" data-src="/late.jpg">')
    absolutise(page.body, PAGE)

    expect(page.querySelector('img')?.getAttribute('src')).toBe('https://site.example/late.jpg')
  })

  test('prefers a real address to a placeholder pixel', () => {
    const page = pageOf('<img src="data:image/gif;base64,R0lGOD" data-original="/real.png">')
    absolutise(page.body, PAGE)

    expect(page.querySelector('img')?.getAttribute('src')).toBe('https://site.example/real.png')
  })

  test('takes the widest of a picture element and unwraps it', () => {
    const page = pageOf(
      '<picture><source srcset="s.jpg 400w, l.jpg 1200w"><img src="" alt="a"></picture>',
    )
    absolutise(page.body, PAGE)

    expect(page.querySelector('picture')).toBe(null)
    expect(page.querySelector('img')?.getAttribute('src')).toBe(
      'https://site.example/section/l.jpg',
    )
  })

  test('drops a picture with nowhere to point', () => {
    const page = pageOf('<p>before<img>after</p>')
    absolutise(page.body, PAGE)

    expect(page.querySelector('img')).toBe(null)
  })

  test('leaves no lazy attribute behind to disagree with the address', () => {
    const page = pageOf('<img src="a.jpg" srcset="a.jpg 1x" data-src="b.jpg">')
    absolutise(page.body, PAGE)

    const image = page.querySelector('img')
    expect(image?.hasAttribute('srcset')).toBe(false)
    expect(image?.hasAttribute('data-src')).toBe(false)
  })
})

describe('cleaning', () => {
  test('takes out what a note never contains', () => {
    const page = pageOf('<p>keep</p><script>x</script><style>y</style><iframe></iframe>')
    clean(page.body)

    expect(page.body.innerHTML).toBe('<p>keep</p>')
  })

  test('takes out what the page says is decoration', () => {
    const page = pageOf('<p>keep</p><div aria-hidden="true">icon</div>')
    clean(page.body)

    expect(page.body.innerHTML).toBe('<p>keep</p>')
  })

  /** A page writes a formula out of sight and draws a picture of it instead, and
   *  both copies used to go: the extractor drops what a reader cannot see and the
   *  picture says it is decoration, so the sentence around the formula was left
   *  with a hole in it. */
  test('brings a hidden formula back into sight, wrapper and all', () => {
    const page = pageOf(
      '<p>the equality <span class="mathml" style="display: none;">' +
        '<math alttext="e^{i\\pi}+1=0"><mi>e</mi></math></span>' +
        '<img src="f.svg" aria-hidden="true" alt="e^{i\\pi}+1=0"> where</p>',
    )
    clean(page.body)

    expect(page.querySelector('.mathml')?.getAttribute('style')).toBe(null)
    expect(page.querySelectorAll('math')).toHaveLength(1)
    expect(page.querySelectorAll('img')).toHaveLength(0)
  })

  test('leaves a wrapper that holds more than the formula hidden', () => {
    const page = pageOf(
      '<div aria-hidden="true"><p>words</p><math alttext="x"><mi>x</mi></math></div>',
    )
    clean(page.body)

    expect(page.querySelectorAll('math')).toHaveLength(0)
  })

  /** A second lock: nothing downstream keeps an attribute, but the rule that hands
   *  a node back verbatim is a library's, and what it hands back carries every
   *  attribute the page wrote. */
  test('takes the page’s handlers and styles off what it keeps', () => {
    const page = pageOf(
      '<div onmouseover="run()" style="position:fixed" class="prose">' +
        '<p onclick="run()">keep</p><img src="a.png" onerror="run()" alt="a">' +
        '<a href="/b" onfocus="run()">b</a></div>',
    )
    clean(page.body)

    const html = page.body.innerHTML
    expect(html).not.toContain('onmouseover')
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('onfocus')
    expect(html).not.toContain('style=')
    // And keeps what the conversion reads.
    expect(html).toContain('class="prose"')
    expect(html).toContain('src="a.png"')
    expect(html).toContain('alt="a"')
    expect(html).toContain('href="/b"')
  })

  test('and off the element a selection began inside', () => {
    const page = pageOf('<p id="one" onmouseover="run()">keep</p>')
    const one = page.querySelector('#one')
    if (one) clean(one)

    expect(one?.hasAttribute('onmouseover')).toBe(false)
  })

  test('keeps a task list tick, which is the one field that means something', () => {
    const page = pageOf('<li><input type="checkbox"><input type="text"></li>')
    clean(page.body)

    expect(page.querySelectorAll('input')).toHaveLength(1)
    expect(page.querySelector('input')?.getAttribute('type')).toBe('checkbox')
  })
})

describe('the tags a page publishes about itself', () => {
  test('splits a keywords list', () => {
    const page = pageOf('', '<meta name="keywords" content="one, two , three">')
    expect(pageTags(page)).toEqual(['one', 'two', 'three'])
  })

  test('collects one from each article tag', () => {
    const page = pageOf(
      '',
      '<meta property="article:tag" content="A"><meta property="article:tag" content="B">',
    )

    expect(pageTags(page)).toEqual(['A', 'B'])
  })

  test('says the same tag once', () => {
    const page = pageOf('', '<meta name="keywords" content="one, one, two">')
    expect(pageTags(page)).toEqual(['one', 'two'])
  })

  test('stops at eight, because a page listing forty is describing a site', () => {
    const many = Array.from({ length: 40 }, (_, at) => `tag${at}`).join(',')
    const page = pageOf('', `<meta name="keywords" content="${many}">`)

    expect(pageTags(page)).toHaveLength(8)
  })

  test('answers an empty list when the page says nothing', () => {
    expect(pageTags(pageOf(''))).toEqual([])
  })
})

describe('what a clip is called', () => {
  test('is the page title when it has one', () => {
    const page = pageOf('', '<title>A page</title>')
    expect(pageTitle(page, PAGE)).toBe('A page')
  })

  test('prefers what the page calls itself when something else shows the name', () => {
    const page = pageOf(
      '',
      '<title>Deep work | The Journal</title><meta property="og:title" content="Deep work">',
    )

    expect(pageTitle(page, PAGE)).toBe('Deep work')
  })

  test('falls back to the last part of the address', () => {
    expect(pageTitle(pageOf(''), 'https://site.example/notes/deep-work.html')).toBe('deep-work')
  })

  test('falls back to the host when the address says nothing else', () => {
    expect(pageTitle(pageOf(''), 'https://site.example/')).toBe('site.example')
  })
})

describe('what a clipped link is called', () => {
  test('is the words the link shows', () => {
    const page = pageOf('<a href="https://elsewhere.example/x">The long read</a>')
    expect(linkTitle(page, 'https://elsewhere.example/x')).toBe('The long read')
  })

  test('is one line, however the link was laid out', () => {
    const page = pageOf('<a href="https://elsewhere.example/x">The\n  long   read</a>')
    expect(linkTitle(page, 'https://elsewhere.example/x')).toBe('The long read')
  })

  test('falls back to the address when the link shows a picture', () => {
    const page = pageOf('<a href="https://elsewhere.example/deep-work"><img src="a.png"></a>')
    expect(linkTitle(page, 'https://elsewhere.example/deep-work')).toBe('deep-work')
  })
})

describe('what to clip', () => {
  test('a link clip is the address and nothing else', () => {
    const page = pageOf('<p>a paragraph</p>', '<title>A page</title>')
    const source = extract(page, 'link', PAGE)

    expect(source).toEqual({ kind: 'link', url: PAGE, title: 'A page', html: '', tags: [] })
  })

  test('a selection clip with nothing selected has nothing in it', () => {
    const page = pageOf('<p>a paragraph</p>', '<title>A page</title>')
    expect(extract(page, 'selection', PAGE).html).toBe('')
  })

  test('a page too short to be an article falls back to its body', () => {
    const page = pageOf('<p>Three words only.</p>', '<title>A page</title>')
    const source = extract(page, 'page', PAGE)

    expect(source.title).toBe('A page')
    expect(source.html).toContain('Three words only.')
  })

  // Readability keeps an ordinary `img` and throws a `<picture>` away, so the
  // candidates have to be on the image before it runs. Without that the article
  // arrives with its photographs missing, which is how the publications that
  // serve them this way would all have come out.
  test('an article keeps the photograph a picture element held', () => {
    const page = pageOf(
      `<article><p>${'An ordinary sentence of an ordinary article. '.repeat(12)}</p>
       <p><picture><source srcset="s.jpg 400w, l.jpg 1200w"><img alt="a"></picture></p>
       <p>${'And a second paragraph of the same, so the extractor has weight. '.repeat(8)}</p>
       </article>`,
      `<base href="${PAGE}" />`,
    )

    const source = extract(page, 'page', PAGE)

    expect(source.html).toContain('https://site.example/section/l.jpg')
    expect(source.html).not.toContain('<picture')
  })

  // The browser resolves the page's own relative addresses against its base, so
  // a clip that resolved them against the address instead would point every one
  // of them somewhere the reader never was.
  test('resolves against the base a page named rather than its own address', () => {
    const page = pageOf(
      `<article><p>${'An ordinary sentence of an ordinary article. '.repeat(12)}</p>
       <p><img src="photo.jpg" alt="a"></p>
       <p>${'And a second paragraph of the same, so the extractor has weight. '.repeat(8)}</p>
       </article>`,
      '<base href="https://cdn.example/assets/" />',
    )

    expect(extract(page, 'page', PAGE).html).toContain('https://cdn.example/assets/photo.jpg')
  })
})

describe('a page a web tab wrote down', () => {
  const ARTICLE = `<article><h1>Heading</h1>${'<p>Words worth keeping, said at length. </p>'.repeat(12)}</article>`

  test('is read for its article, like a live page', () => {
    const read = readSnapshot(
      `<!DOCTYPE html><html><head><title>Tab title</title><meta name="keywords" content="one, two"></head><body><nav>Menu</nav>${ARTICLE}</body></html>`,
      PAGE,
    )

    expect(read.kind).toBe('page')
    expect(read.html).toContain('Words worth keeping')
    expect(read.html).not.toContain('Menu')
    expect(read.tags).toEqual(['one', 'two'])
  })

  test('is the selection when the page marked one, with the page’s own title and tags', () => {
    const read = readSnapshot(
      `<!DOCTYPE html><html ${SELECTED}><head><title>Tab title</title><meta property="article:tag" content="Kept"></head><body><p>Only <a href="x.html">this</a>.</p></body></html>`,
      PAGE,
    )

    expect(read).toMatchObject({ kind: 'selection', title: 'Tab title', tags: ['Kept'] })
    expect(read.html).toBe('<p>Only <a href="https://site.example/section/x.html">this</a>.</p>')
  })

  test('resolves against the base the page wrote, or its address where it wrote none', () => {
    const named = readSnapshot(
      `<!DOCTYPE html><html ${SELECTED}><head><base href="https://cdn.example/docs/"></head><body><a href="a.html">a</a></body></html>`,
      PAGE,
    )
    expect(named.html).toContain('https://cdn.example/docs/a.html')

    const none = readSnapshot(
      `<!DOCTYPE html><html ${SELECTED}><head></head><body><a href="a.html">a</a></body></html>`,
      PAGE,
    )
    expect(none.html).toContain('https://site.example/section/a.html')
  })

  test('runs nothing the page wrote', () => {
    const marked = window as unknown as { ran?: boolean }
    readSnapshot(
      `<!DOCTYPE html><html><head><script>window.ran = true</script></head><body><img src="x" onerror="window.ran = true">${ARTICLE}</body></html>`,
      PAGE,
    )

    expect(marked.ran).toBeUndefined()
  })
})
