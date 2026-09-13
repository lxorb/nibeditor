import { describe, expect, test } from 'vitest'
import { providers, webEmbed } from './providers'
import { iframeCard, webCard } from './web-embed'

const frame = (address: string) => webEmbed(address)?.frame ?? null
const named = (address: string) => webEmbed(address)?.provider.id ?? null

describe('the addresses a note can show rather than link to', () => {
  test('a YouTube video, however it was written', () => {
    const wanted = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'
    for (const address of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/watch?v=dQw4w9WgXcQ&list=x',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    ]) {
      expect(frame(address), address).toBe(wanted)
    }
  })

  test('and never youtube.com itself, which sets a cookie to be watched', () => {
    expect(frame('https://youtu.be/dQw4w9WgXcQ')).toContain('youtube-nocookie.com')
  })

  test('a timestamp is where it starts', () => {
    expect(frame('https://youtu.be/abc?t=90')).toBe(
      'https://www.youtube-nocookie.com/embed/abc?start=90',
    )
    expect(frame('https://youtu.be/abc?t=1m30s')).toContain('start=90')
    expect(frame('https://youtu.be/abc?t=1h')).toContain('start=3600')
  })

  test('a page of a provider that is not a thing to show is a link', () => {
    expect(webEmbed('https://www.youtube.com/@somebody')).toBe(null)
    expect(webEmbed('https://www.youtube.com/')).toBe(null)
    expect(webEmbed('https://vimeo.com/somebody/likes')).toBe(null)
    expect(webEmbed('https://x.com/somebody')).toBe(null)
    expect(webEmbed('https://open.spotify.com/user/x')).toBe(null)
  })

  test('everything else on the web is a link like any other', () => {
    expect(webEmbed('https://example.test/a')).toBe(null)
    expect(webEmbed('https://gist.github.com/a/b')).toBe(null)
    expect(webEmbed('shot.png')).toBe(null)
    expect(webEmbed('')).toBe(null)
  })

  test('and so is anything not asked for over https', () => {
    expect(webEmbed('http://www.youtube.com/watch?v=abc')).toBe(null)
    expect(webEmbed('javascript:alert(1)')).toBe(null)
  })

  test('the other rows', () => {
    expect(frame('https://vimeo.com/123456')).toBe('https://player.vimeo.com/video/123456')
    expect(frame('https://x.com/nib/status/1234567890')).toBe(
      'https://platform.twitter.com/embed/Tweet.html?id=1234567890',
    )
    expect(frame('https://twitter.com/nib/status/1234567890')).toContain('id=1234567890')
    expect(frame('https://open.spotify.com/track/abc123')).toBe(
      'https://open.spotify.com/embed/track/abc123',
    )
    expect(frame('https://open.spotify.com/intl-de/album/abc123')).toBe(
      'https://open.spotify.com/embed/album/abc123',
    )
    expect(frame('https://soundcloud.com/artist/track')).toContain('w.soundcloud.com/player/?url=')
    expect(frame('https://www.figma.com/design/abc/Name')).toContain(
      'figma.com/embed?embed_host=nib',
    )
    expect(frame('https://codepen.io/someone/pen/abcDEF')).toBe(
      'https://codepen.io/someone/embed/abcDEF?default-tab=result',
    )
    expect(frame('https://www.loom.com/share/abc123')).toBe('https://www.loom.com/embed/abc123')
    expect(frame('https://www.google.com/maps?q=Bern')).toContain('maps?q=Bern&output=embed')
    expect(frame('https://www.google.com/maps/place/Bern/@46.9,7.4,12z')).toContain('q=Bern')
    expect(frame('https://www.google.com/maps/@46.9,7.4,12z')).toContain('q=46.9%2C7.4')
    expect(named('https://maps.app.goo.gl/abc')).toBe(null)
  })

  test('nothing a link wrote reaches a frame address unchecked', () => {
    // A piece of somebody else's path carrying a `?`, a `/` or a `#` would be a
    // frame pointed somewhere the table never named.
    expect(frame('https://youtu.be/abc?x=1/../../evil')).toBe(
      'https://www.youtube-nocookie.com/embed/abc',
    )
    expect(webEmbed('https://www.loom.com/share/abc%2f..%2fevil')).toBe(null)
    expect(webEmbed('https://codepen.io/a/pen/b?c=d#e')).not.toBe(null)
    expect(frame('https://codepen.io/a/pen/b?c=d#e')).toBe(
      'https://codepen.io/a/embed/b?default-tab=result',
    )
  })

  test('every row asks for a sandbox, and none for more than it needs', () => {
    for (const provider of providers()) {
      expect(provider.sandbox, provider.id).toContain('allow-scripts')
      expect(provider.sandbox, provider.id).not.toContain('allow-top-navigation')
      expect(provider.sandbox, provider.id).not.toContain('allow-downloads')
      expect(provider.sandbox, provider.id).not.toContain('allow-modals')
    }
  })

  test('and every row has a name, a mark and a shape', () => {
    const rows = providers()
    expect(rows.length).toBeGreaterThan(5)
    for (const provider of rows) {
      expect(provider.name, provider.id).not.toBe('')
      expect(['play', 'open'], provider.id).toContain(provider.mark)
      expect(provider.shape === 'video' || provider.shape > 0, provider.id).toBe(true)
    }
    expect(new Set(rows.map((one) => one.id)).size).toBe(rows.length)
  })
})

describe('the broad list, for the places nobody wrote a row for by hand', () => {
  /** One address apiece on the seven Notion shows where nib used to show a link.
   *  Four of them - Drive, Twitch, the gist and the form - are in no oEmbed
   *  registry at all, which is the reason the list cannot simply be the registry
   *  and has to be a table of embed addresses instead. */
  const listed = [
    ['https://drive.google.com/file/d/1A2b3C4d5E6f7G8hI9j/view?usp=sharing', 'drive'],
    ['https://miro.com/app/board/uXjVNZvHEJI=/', 'miro'],
    ['https://www.twitch.tv/videos/1234567890', 'twitch'],
    ['https://www.tiktok.com/@nib/video/7212345678901234567', 'tiktok'],
    ['https://gist.github.com/someone/4060606e8f4a4d3c9b1a', 'gist'],
    ['https://form.typeform.com/to/u6nXL7', 'typeform'],
    ['https://sketchfab.com/3d-models/a-thing-0d8e5c1e0f7f4a0a9e5b2a7b0e3c1d2f', 'sketchfab'],
  ] as const

  test('each of them is a card saying whose page it stands for', () => {
    for (const [address, id] of listed) {
      expect(named(address), address).toBe(id)
      expect(webCard(address), address).toContain(`data-provider="${id}"`)
    }
  })

  test('and what it frames is an address of that provider’s, over https', () => {
    for (const [address] of listed) {
      expect(frame(address) ?? '', address).toMatch(/^https:\/\/[\w.-]+\//)
    }
  })

  test('a row nobody measured gets scripts and nothing more', () => {
    // The nine rows above may ask for a narrower sandbox and a player's
    // permissions, because somebody drove each of those frames both ways round.
    // A row off the list has promised only that this address turns into that
    // frame, so it gets the same bargain an `<iframe>` a note wrote by hand gets.
    for (const [address] of listed) {
      const card = webCard(address) ?? ''
      expect(card, address).toContain('data-sandbox="allow-scripts"')
      expect(card, address).not.toContain('allow-same-origin')
      expect(card, address).not.toContain('data-allow=')
      // Nothing a provider said, and nothing a browser would fetch on its own.
      expect(card, address).not.toContain('<iframe')
      expect(card, address).not.toContain('src=')
    }
  })

  test('a page of a listed provider that is not a thing to show is a link', () => {
    expect(webEmbed('https://miro.com/pricing')).toBe(null)
    expect(webEmbed('https://drive.google.com/drive/folders/1A2b3C')).toBe(null)
    expect(webEmbed('https://www.tiktok.com/@nib')).toBe(null)
    expect(webEmbed('https://form.typeform.com/')).toBe(null)
  })

  test('and a domain the list never named stays the link it was', () => {
    expect(webEmbed('https://embed.example.test/a/b/c')).toBe(null)
    expect(webEmbed('https://notion.test/page/abc123')).toBe(null)
    expect(webCard('https://example.test/a')).toBe(null)
    expect(webCard('https://drive.google.example/file/d/abc/view')).toBe(null)
  })

  test('nothing a link wrote reaches a listed frame address unchecked', () => {
    for (const address of [
      'https://miro.com/app/board/a%2f..%2fevil/',
      'https://form.typeform.com/to/a%26b',
      'https://www.tiktok.com/@nib/video/1?a=b#c',
    ]) {
      const framed = frame(address)
      if (framed === null) continue
      expect(framed, address).not.toContain('..')
      expect(framed, address).not.toContain('%2f')
      expect(new URL(framed).hostname, address).not.toBe('example.test')
    }
    expect(frame('https://www.tiktok.com/@nib/video/1?a=b#c')).toBe(
      'https://www.tiktok.com/embed/v2/1',
    )
  })
})

describe('the card an address is shown as', () => {
  test('says whose page it is, and holds the frame without loading it', () => {
    const card = webCard('https://youtu.be/dQw4w9WgXcQ')
    expect(card).toContain('class="embed-web embed-wide"')
    expect(card).toContain('data-provider="youtube"')
    expect(card).toContain('data-frame="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"')
    expect(card).toContain('data-sandbox="allow-scripts allow-same-origin allow-presentation"')
    expect(card).toContain('YouTube')
    // Nothing that a browser would fetch on its own.
    expect(card).not.toContain('<iframe')
    expect(card).not.toContain('src=')
  })

  test('is a link, so a page with no script still goes somewhere', () => {
    const card = webCard('https://youtu.be/abc') ?? ''
    expect(card).toContain('href="https://youtu.be/abc"')
    expect(card).toContain('rel="noopener noreferrer nofollow"')
    expect(card).toContain('referrerpolicy="no-referrer"')
  })

  test('takes the room the frame will take, so nothing moves when it loads', () => {
    expect(webCard('https://x.com/a/status/1')).toContain('--embed-height: 520px')
    expect(webCard('https://youtu.be/abc')).toContain('embed-wide')
  })

  test('and nothing else gets one', () => {
    expect(webCard('https://example.test/a')).toBe(null)
    expect(webCard('shot.png')).toBe(null)
  })
})

describe('the card an <iframe> a note wrote becomes', () => {
  test('says the domain, and holds the page without loading it', () => {
    const card = iframeCard('<iframe src="https://maps.example.test/plan?a=1&amp;b=2"></iframe>')
    expect(card).toContain('class="embed-web embed-wide embed-page"')
    expect(card).toContain('>maps.example.test<')
    expect(card).toContain('data-frame="https://maps.example.test/plan?a=1&amp;b=2"')
    expect(card).not.toContain('<iframe')
    expect(card).not.toContain(' src=')
  })

  test('and gets scripts and nothing else, having promised nothing', () => {
    // A provider's row may ask for more, because the table says what that frame
    // needs. An address a note wrote by hand has said nothing about itself.
    const card = iframeCard('<iframe src="https://x.test/a"></iframe>') ?? ''
    expect(card).toContain('data-sandbox="allow-scripts"')
    expect(card).not.toContain('allow-same-origin')
    expect(card).not.toContain('data-allow=')
  })

  test('is a link, so a page with no script still goes somewhere', () => {
    const card = iframeCard("<iframe src='https://x.test/a' width=560></iframe>") ?? ''
    expect(card).toContain('href="https://x.test/a"')
    expect(card).toContain('rel="noopener noreferrer nofollow"')
  })

  test('takes the room the tag asked for, when it asked for a sane amount', () => {
    expect(iframeCard('<iframe src="https://x.test/a" height="240"></iframe>')).toContain(
      '--embed-height: 240px',
    )
    // Nothing, too little and far too much all mean sixteen by nine instead.
    for (const height of ['', ' height="4"', ' height="99999"', ' height="50%"']) {
      expect(iframeCard(`<iframe src="https://x.test/a"${height}></iframe>`), height).toContain(
        'embed-wide',
      )
    }
  })

  test('a host the table knows gets the table’s card, not this one', () => {
    const card = iframeCard('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>')
    expect(card).toContain('data-provider="youtube"')
    expect(card).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(card).toContain('YouTube')
  })

  test('and an address a browser would not frame gets no card at all', () => {
    for (const tag of [
      '<iframe src="http://x.test/a"></iframe>',
      '<iframe src="javascript:alert(1)"></iframe>',
      '<iframe src="data:text/html,<script>alert(1)</script>"></iframe>',
      '<iframe src="/local/page.html"></iframe>',
      '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
      '<iframe></iframe>',
      '<div>not a frame</div>',
      '',
    ]) {
      expect(iframeCard(tag), tag).toBe(null)
    }
  })

  test('and nothing the tag carried besides the address comes with it', () => {
    // A handler on the tag is the whole reason the tag is not passed through.
    const card = iframeCard('<iframe src="https://x.test/a" onload="alert(1)"></iframe>') ?? ''
    expect(card).not.toContain('onload')
    expect(card).not.toContain('alert')
  })
})
