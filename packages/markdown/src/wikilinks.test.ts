import { describe, expect, test } from 'vitest'
import type { Wikilink } from './links'
import { renderMarkdown } from './index'

/** A space of three notes, published under `/notes/`. */
const NOTES: Record<string, string> = {
  plan: '/notes/plan',
  spark: '/notes/spark',
  'paper.pdf': '/i/abc.pdf',
}

const resolveLink = (link: Wikilink) => {
  const href = NOTES[link.target.toLowerCase()]
  return href === undefined ? null : { href }
}

const BODIES: Record<string, string> = {
  plan: '# The plan\n\nFirst part.\n\n## Later\n\nSecond part.\n',
  spark: 'A single idea. ^abc123\n\nAnother paragraph.\n',
}

const resolveEmbed = (link: Wikilink) => BODIES[link.target.toLowerCase()] ?? null

describe('a wikilink on a page', () => {
  test('is an anchor when the caller can resolve it', () => {
    expect(renderMarkdown('see [[Plan]] now', { resolveLink })).toContain(
      '<a class="wikilink" href="/notes/plan">Plan</a>',
    )
  })

  test('shows its alias rather than the target', () => {
    expect(renderMarkdown('[[Plan|the plan]]', { resolveLink })).toContain(
      '<a class="wikilink" href="/notes/plan">the plan</a>',
    )
  })

  test('points at the heading it names, by the id the renderer gives it', () => {
    expect(renderMarkdown('[[Plan#Some Heading]]', { resolveLink })).toContain(
      'href="/notes/plan#some-heading"',
    )
  })

  test('carries a PDF page as the fragment a PDF viewer reads', () => {
    expect(renderMarkdown('[[paper.pdf#page=3]]', { resolveLink })).toContain(
      '<a class="wikilink" href="/i/abc.pdf#page=3">paper.pdf#page=3</a>',
    )
  })

  test('is plain text when nothing answers to the name', () => {
    const html = renderMarkdown('see [[Nowhere]] now', { resolveLink })
    expect(html).toContain('see Nowhere now')
    expect(html).not.toContain('<a')
  })

  test('is plain text when there is no resolver at all, as in an export', () => {
    const html = renderMarkdown('see [[Plan|the plan]] now')
    expect(html).toContain('see the plan now')
    expect(html).not.toContain('<a')
  })

  test('is not read inside code', () => {
    expect(renderMarkdown('`[[Plan]]`', { resolveLink })).toContain('<code>[[Plan]]</code>')
    expect(renderMarkdown('```\n[[Plan]]\n```', { resolveLink })).not.toContain('<a')
  })

  test('an escaped bracket is words', () => {
    const html = renderMarkdown('\\[[Plan]]', { resolveLink })
    expect(html).not.toContain('<a')
    expect(html).toContain('[[Plan]]')
  })

  test('is not wrapped in a markdown link as well', () => {
    const html = renderMarkdown('[[Plan]]', { resolveLink })
    expect(html.match(/<a/g)).toHaveLength(1)
  })
})

describe('what a wikilink cannot do to the page', () => {
  test('a target that names a script scheme leaves no anchor', () => {
    const html = renderMarkdown('[[x]]', {
      resolveLink: () => ({ href: 'javascript:alert(1)' }),
    })
    expect(html).not.toContain('javascript')
    expect(html).toContain('x')
  })

  test('a quote in a resolved target cannot end the attribute', () => {
    const html = renderMarkdown('[[x]]', {
      resolveLink: () => ({ href: '/notes/a"onmouseover="alert(1)' }),
    })
    expect(html).not.toContain('onmouseover="alert(1)"')
    expect(html).toContain('href="/notes/a%22onmouseover=%22alert(1)"')
  })

  test('an entity in a resolved target cannot grow into a scheme', () => {
    const html = renderMarkdown('[[x]]', {
      resolveLink: () => ({ href: 'javascript&colon;alert(1)' }),
    })
    expect(html).toContain('href="javascript&amp;colon;alert(1)"')
    expect(html).not.toContain('javascript&colon;alert(1)"')
  })

  test('tags in the words a link shows are escaped', () => {
    const html = renderMarkdown('[[Plan|<img src=x onerror=alert(1)>]]', { resolveLink })
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  test('tags in a name the caller hands back are escaped', () => {
    const html = renderMarkdown('[[Plan]]', {
      resolveLink: () => ({ href: '/a', text: '<script>alert(1)</script>' }),
    })
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script')
  })

  test('tags in an embedded note are escaped when the page escapes HTML', () => {
    const html = renderMarkdown('![[bad]]', {
      escapeHtml: true,
      resolveEmbed: () => '<img src=x onerror=alert(1)>',
    })
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  test('an embed of a note whose name carries a tag is escaped in the caption', () => {
    const html = renderMarkdown('![[plan|<b>x</b>]]', { resolveEmbed })
    expect(html).toContain('<figcaption>&lt;b&gt;x&lt;/b&gt;</figcaption>')
  })

  test('a note cannot write the marker an embed is put in place of', () => {
    // Two answers to the same attempt. The marker is stamped with a number the
    // note could not have guessed, and a comment a note writes never reaches the
    // page at all - see comments.ts - so the plausible one written here is simply
    // gone and the real embed is unaffected.
    const html = renderMarkdown('<!--nib:embed:0-->\n\n![[plan]]', { resolveEmbed })
    expect(html).not.toContain('nib:embed:0')
    expect(html).toContain('The plan')
  })
})

describe('an embed on a page', () => {
  test('renders the note inside a frame with its name under it', () => {
    const html = renderMarkdown('![[plan]]', { resolveEmbed })
    expect(html).toContain('<figure class="embed">')
    expect(html).toContain('<h1>The plan</h1>')
    expect(html).toContain('First part.')
    expect(html).toContain('<figcaption>plan</figcaption>')
  })

  test('a heading names the section, and only that section', () => {
    const html = renderMarkdown('![[plan#Later]]', { resolveEmbed })
    expect(html).toContain('Second part.')
    expect(html).not.toContain('First part.')
  })

  test('a block names the paragraph, without the marker itself', () => {
    const html = renderMarkdown('![[spark#^abc123]]', { resolveEmbed })
    expect(html).toContain('<p>A single idea.</p>')
    // The name marks the block; it is not a word of it. The caption still says
    // what the link said, which is where the name belongs.
    expect(html).not.toContain('idea. ^abc123')
    expect(html).toContain('<figcaption>spark#^abc123</figcaption>')
    expect(html).not.toContain('Another paragraph.')
  })

  test('an embed with words beside it is a link, not a frame in a paragraph', () => {
    const html = renderMarkdown('see ![[plan]] now', { resolveEmbed, resolveLink })
    expect(html).not.toContain('<figure')
    expect(html).toContain('see')
  })

  test('a frame is never left inside a paragraph', () => {
    expect(renderMarkdown('![[plan]]', { resolveEmbed })).not.toContain('<p><figure')
  })

  test('a heading the note has not got is a link rather than an empty frame', () => {
    const html = renderMarkdown('![[plan#Nowhere]]', { resolveEmbed, resolveLink })
    expect(html).not.toContain('<figure')
    expect(html).toContain('plan#Nowhere')
  })

  test('a note the space has not got is a link', () => {
    const html = renderMarkdown('![[Nothing]]', { resolveEmbed, resolveLink })
    expect(html).not.toContain('<figure')
  })

  test('an embed is a link when nothing can resolve one, as in a plain export', () => {
    expect(renderMarkdown('![[plan]]')).toContain('plan')
    expect(renderMarkdown('![[plan]]')).not.toContain('<figure')
  })

  test('one level deep: an embed inside an embed is a link', () => {
    const bodies: Record<string, string> = {
      outer: 'Outer says: ![[inner]]\n',
      inner: 'Inner text.\n',
    }
    const html = renderMarkdown('![[outer]]', {
      resolveEmbed: (link) => bodies[link.target] ?? null,
    })

    expect(html).toContain('Outer says:')
    expect(html).not.toContain('Inner text.')
    expect(html.match(/<figure/g)).toHaveLength(1)
  })

  test('a note that embeds itself renders once and stops', () => {
    const html = renderMarkdown('![[self]]', {
      resolveEmbed: () => 'Round and round ![[self]]\n',
    })

    expect(html.match(/Round and round/g)).toHaveLength(1)
    expect(html.match(/<figure/g)).toHaveLength(1)
  })

  test('links inside an embedded note still resolve', () => {
    const html = renderMarkdown('![[plan]]', {
      resolveEmbed: () => 'see [[Spark]]\n',
      resolveLink,
    })
    expect(html).toContain('href="/notes/spark"')
  })

  test('several embeds each get their own note', () => {
    const html = renderMarkdown('![[plan]]\n\n![[spark]]', { resolveEmbed })
    expect(html).toContain('The plan')
    expect(html).toContain('A single idea.')
    expect(html.match(/<figure/g)).toHaveLength(2)
  })

  test('a picture named as an embed is a picture', () => {
    // Pointed at the path the note wrote, which is what every surface already
    // knows how to swap for something it can load; see sources.ts.
    const html = renderMarkdown('![[shot.png]]', { resolveEmbed, resolveLink })
    expect(html).toContain('<img src="shot.png" alt="">')
    expect(html).not.toContain('<figure')
  })
})

describe('a file embedded in a note', () => {
  test('a recording is a player, and nothing plays on its own', () => {
    const html = renderMarkdown('![[clip.mp3]]\n')
    expect(html).toContain('<audio class="embed-media" controls preload="metadata"')
    expect(html).toContain('src="clip.mp3"')
    expect(html).not.toContain('autoplay')
  })

  test('a film is a player too', () => {
    for (const name of ['demo.mp4', 'demo.webm', 'demo.mov']) {
      expect(renderMarkdown(`![[${name}]]\n`), name).toContain(`<video class="embed-media"`)
    }
  })

  test('a container either can be in is read as what it usually holds', () => {
    expect(renderMarkdown('![[a.webm]]\n')).toContain('<video')
    expect(renderMarkdown('![[a.weba]]\n')).toContain('<audio')
  })

  test('a player is what it is inside a sentence as well', () => {
    const html = renderMarkdown('before ![[clip.mp3]] after\n')
    expect(html).toContain('<audio')
    // Inside the paragraph, not in place of it.
    expect(html).toContain('before ')
    expect(html).toContain(' after')
  })

  test('a size after the bar is how wide to draw it', () => {
    expect(renderMarkdown('![[shot.png|300]]\n')).toContain('width="300"')
    expect(renderMarkdown('![[shot.png|300x200]]\n')).toContain('width="300" height="200"')
    expect(renderMarkdown('![[demo.mp4|480]]\n')).toContain('width="480"')
  })

  test('anything else after the bar says what it is', () => {
    expect(renderMarkdown('![[shot.png|the sketch]]\n')).toContain('alt="the sketch"')
    expect(renderMarkdown('![[clip.mp3|the take]]\n')).toContain('title="the take"')
  })

  test('a paper is a card that opens it, with the page the link asked for', () => {
    const html = renderMarkdown('![[paper.pdf#page=3]]\n', { resolveLink })
    expect(html).toContain('<figure class="embed embed-file" data-kind="pdf"')
    expect(html).toContain('href="/i/abc.pdf#page=3"')
    expect(html).toContain('paper.pdf#page=3')
    expect(html).toContain('<svg')
  })

  test('and says which page of which file a surface should draw in it', () => {
    // The card is what a published page keeps, because a published page runs no
    // script; in the app these two are what the drawing is made from, so the one
    // piece of markup serves both readings. See `card`.
    const html = renderMarkdown('![[paper.pdf#page=3]]\n', { resolveLink })
    expect(html).toContain('data-file="paper.pdf"')
    expect(html).toContain('data-page="3"')
  })

  test('a paper whose link names no page carries none', () => {
    // Which page a paper opens at when the link is silent is the business of
    // whatever asks pdf.js for one, and is said once there.
    expect(renderMarkdown('![[paper.pdf]]\n', { resolveLink })).not.toContain('data-page')
  })

  test('a plane is a card as well', () => {
    const html = renderMarkdown('![[board.canvas]]\n')
    expect(html).toContain('data-kind="canvas"')
    expect(html).toContain('board.canvas')
  })

  test('and names the file to draw, with no page, since a plane has none', () => {
    const html = renderMarkdown('![[board.canvas]]\n')
    expect(html).toContain('data-file="board.canvas"')
    expect(html).not.toContain('data-page=')
  })

  test('a file name cannot end the attribute the card names it in', () => {
    const html = renderMarkdown('![[a" onerror="alert(1).pdf]]\n')
    expect(html).not.toContain('onerror="alert(1)"')
  })

  test('a card nobody can open is still the name of the file', () => {
    const html = renderMarkdown('![[missing.pdf]]\n')
    expect(html).toContain('missing.pdf')
    expect(html).not.toContain('<a')
  })

  test('a card is never left inside a paragraph', () => {
    // A `<figure>` closes the `<p>` around it, which would leave the frame in
    // pieces; the same rule an embedded note goes by.
    expect(renderMarkdown('![[paper.pdf]]\n')).not.toContain('<p><figure')
  })

  test('a file is never read as a note', () => {
    // `resolveEmbed` answers for every name here, so a target that reached it
    // would come back as a framed note rather than as what it is.
    const every = () => '# Something else'
    for (const name of ['a.png', 'a.mp3', 'a.mp4', 'a.pdf', 'a.canvas']) {
      expect(renderMarkdown(`![[${name}]]\n`, { resolveEmbed: every }), name).not.toContain(
        'Something else',
      )
    }
  })

  test('a target that could not go into an attribute is not written into one', () => {
    // The name reads as words, which is what an unresolvable embed does anyway.
    const html = renderMarkdown('![[javascript:alert(1)//x.mp3]]\n')
    expect(html).not.toContain('<audio')
    expect(html).not.toContain('src=')
  })

  test('a name with a quote in it cannot end the attribute it is written in', () => {
    const html = renderMarkdown('![[a" onerror="alert(1).mp4]]\n')
    expect(html).not.toContain('onerror="alert(1)"')
  })
})
