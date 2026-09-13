import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { asIsland, slugFor } from '../src/blog'
import { call, signIn, testEnv, type TestEnv } from './harness'

let env: TestEnv
let token: string
let space: string

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')

  const created = await call(env, '/v1/spaces', { token, body: { name: 'Field notes' } })
  space = created.json.space.id

  await call(env, `/v1/spaces/${space}/notes`, {
    token,
    body: { path: 'Hello world.md', content: '# Hello world\n\nFirst **post**.\n' },
  })
})

afterEach(() => env.close())

async function publish(body: Record<string, unknown>) {
  return call(env, `/v1/spaces/${space}/blog`, { method: 'PUT', token, body })
}

async function addNote(path: string, content: string) {
  return call(env, `/v1/spaces/${space}/notes`, { token, body: { path, content } })
}

/** A domain of one's own, published and proved.
 *
 *  The proof is stamped rather than walked through, because reading a record is
 *  over the network and what this file is about is what a hostname serves. The
 *  record itself, and the fact that an unproved domain serves nothing, are in
 *  test/domains.test.ts. */
async function publishDomain(domain: string) {
  const answer = await publish({ domain })
  env.db
    .prepare('update spaces set blog_domain_verified_at = ? where id = ?')
    .run(Date.now(), space)
  return answer
}

describe('slugs', () => {
  test('lowercases and hyphenates', () => {
    expect(slugFor('Hello world.md')).toBe('hello-world')
  })

  test('keeps folders as path segments', () => {
    expect(slugFor('Notes/First Idea.md')).toBe('notes/first-idea')
  })

  test('drops punctuation', () => {
    expect(slugFor("What's new?.md")).toBe('what-s-new')
  })
})

describe('while a space is private', () => {
  test('its subdomain sends the visitor to the app', async () => {
    const response = await call(env, '/', { host: 'field.nibeditor.com' })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://nibeditor.com')
  })

  test('a disabled blog stops serving', async () => {
    await publish({ subdomain: 'field' })
    await call(env, `/v1/spaces/${space}/blog`, { method: 'DELETE', token })

    expect((await call(env, '/', { host: 'field.nibeditor.com' })).status).toBe(302)
  })
})

describe('a name nobody has taken', () => {
  test('forwards to the app, whatever the path', async () => {
    const response = await call(env, '/some/note', { host: 'unused.nibeditor.com' })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://nibeditor.com')
  })

  test('the root itself is not forwarded', async () => {
    const response = await call(env, '/', { host: 'nibeditor.com' })
    expect(response.status).not.toBe(302)
  })

  test('a domain of someone else is not forwarded', async () => {
    const response = await call(env, '/', { host: 'notes.example.com' })
    expect(response.status).not.toBe(302)
  })
})

describe('publishing', () => {
  test('a subdomain starts serving the index', async () => {
    await publish({ subdomain: 'field' })

    const response = await call(env, '/', { host: 'field.nibeditor.com' })
    expect(response.status).toBe(200)
    expect(response.text).toContain('Field notes')
    expect(response.text).toContain('/hello-world')
  })

  test('a note renders as HTML', async () => {
    await publish({ subdomain: 'field' })

    const response = await call(env, '/hello-world', { host: 'field.nibeditor.com' })
    expect(response.text).toContain('<h1 id="hello-world">Hello world</h1>')
    expect(response.text).toContain('<strong>post</strong>')
  })

  test('an unknown slug is handled', async () => {
    await publish({ subdomain: 'field' })

    const response = await call(env, '/nothing-here', { host: 'field.nibeditor.com' })
    expect(response.text).toContain('Not found')
  })

  test('front matter is not printed', async () => {
    await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'meta.md', content: '---\ntitle: Hi\n---\n\nBody text.\n' },
    })
    await publish({ subdomain: 'field' })

    const response = await call(env, '/meta', { host: 'field.nibeditor.com' })
    expect(response.text).not.toContain('title: Hi')
    expect(response.text).toContain('Body text.')
  })

  test('a custom domain is served once it has been proved', async () => {
    await publishDomain('notes.example.com')

    const response = await call(env, '/', { host: 'notes.example.com' })
    expect(response.status).toBe(200)
    expect(response.text).toContain('Field notes')
  })

  test('a custom domain comes back with the records to add', async () => {
    const response = await publish({ domain: 'notes.example.com' })

    expect(response.json.dns).toHaveLength(2)
    expect(response.json.dns[0]!.type).toBe('CNAME')
    expect(response.json.dns[0]!.value).toMatch(/\.nibeditor\.com$/)
    expect(response.json.dns[1]!.type).toBe('TXT')
  })

  test('an apex domain gets a CNAME too, never a placeholder address', async () => {
    const response = await publish({ domain: 'example.com' })
    expect(response.json.dns[0]!.type).toBe('CNAME')
    expect(response.json.dns[0]!.value).not.toMatch(/^192\.0\.2\./)
  })

  test('the listing carries the records too, for the next time the pane opens', async () => {
    await publish({ domain: 'notes.example.com' })

    const listed = await call(env, '/v1/spaces', { token })
    const mine = listed.json.spaces.find((one) => one.id === space)!
    expect(mine.blog.dns).toHaveLength(2)
    expect(mine.blog.dns[0]!.type).toBe('CNAME')
    expect(mine.blog.dns[1]!.type).toBe('TXT')
  })

  test('a custom title replaces the space name', async () => {
    await publish({ subdomain: 'field', title: 'Notes from the field' })

    const response = await call(env, '/', { host: 'field.nibeditor.com' })
    expect(response.text).toContain('Notes from the field')
  })
})

/** The hostname decides which account's notes are served, so it is taken apart
 *  rather than trusted: the port, the case and the trailing dot of a fully
 *  qualified name are all names for the same host. */
describe('the hostname a blog answers on', () => {
  test('is the same host with a trailing dot', async () => {
    await publish({ subdomain: 'field' })

    const response = await call(env, '/', { host: 'field.nibeditor.com.' })
    expect(response.status).toBe(200)
    expect(response.text).toContain('Field notes')
  })

  test('is not read as a domain of someone else when it carries one', async () => {
    // With the dot left on, the name did not end in `.nibeditor.com` and was
    // looked up as a domain somebody had brought.
    await publish({ subdomain: 'field' })
    env.db
      .prepare('update spaces set blog_subdomain = null, blog_domain = ? where id = ?')
      .run('field.nibeditor.com.', space)

    const response = await call(env, '/', { host: 'field.nibeditor.com.' })
    expect(response.status).toBe(302)
  })

  test('is the same host in any case', async () => {
    await publish({ subdomain: 'field' })
    expect((await call(env, '/', { host: 'FIELD.NIBEDITOR.COM' })).status).toBe(200)
  })

  test('is not the apex, however it is written', async () => {
    await publish({ subdomain: 'field' })

    for (const host of ['nibeditor.com', 'nibeditor.com.', 'NIBEDITOR.COM']) {
      expect((await call(env, '/', { host })).status, host).not.toBe(200)
    }
  })
})

describe('what publishing is sent', () => {
  test('has to be text', async () => {
    expect((await publish({ subdomain: 5 })).status).toBe(400)
    expect((await publish({ domain: {} })).status).toBe(400)
    expect((await publish({ subdomain: 'field', title: ['x'] })).status).toBe(400)
    expect((await publish({ subdomain: 'field', note: 7 })).status).toBe(400)
  })

  test('cannot carry a title larger than a title', async () => {
    const response = await publish({ subdomain: 'field', title: 'x'.repeat(201) })

    expect(response.status).toBe(400)
    expect(response.json.error).toContain('title')
  })

  test('takes a title of the length a title has', async () => {
    expect((await publish({ subdomain: 'field', title: 'x'.repeat(200) })).status).toBe(200)
  })

  test('refuses a note path that is not one, rather than publishing everything', async () => {
    const response = await publish({ subdomain: 'field', note: 'not-a-note' })

    expect(response.status).toBe(400)
    expect(response.json.error).toBe('that path is not usable')
  })

  test('still clears the published note with an empty path', async () => {
    await addNote('home.md', '# Hello\n')
    await publish({ subdomain: 'me', note: 'home.md' })

    const cleared = await publish({ note: '' })
    expect(cleared.status).toBe(200)
    expect(cleared.json.space.blog.note).toBeNull()
  })
})

describe('a published note cannot script the reader', () => {
  test('raw HTML in a note is shown, not run', async () => {
    await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'nasty.md', content: '# Nasty\n\n<script>alert(1)</script>\n' },
    })
    await publish({ subdomain: 'field' })

    const response = await call(env, '/nasty', { host: 'field.nibeditor.com' })
    expect(response.text).not.toContain('<script>alert(1)</script>')
    expect(response.text).toContain('&lt;script&gt;')
  })

  test('every page runs the script the site serves and nothing else', async () => {
    await publish({ subdomain: 'field' })

    const response = await call(env, '/', { host: 'field.nibeditor.com' })
    const policy = response.headers.get('content-security-policy') ?? ''

    // The furniture - the search shortcut, the theme button, the hover card, the
    // graph - is a script served from this site, and the one inline line is
    // named by its own hash. Nothing else may run, nothing else may be fetched,
    // and a form may only reach back here. See docs/publishing.md.
    expect(policy).toContain("script-src 'self' 'sha256-")
    // Inline styles are KaTeX laying out an equation; inline scripts are named
    // by hash or not at all.
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(policy).toContain("connect-src 'self'")
    expect(policy).toContain("form-action 'self'")
    expect(policy).toContain("frame-ancestors 'none'")
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  test('a video a note embeds is a card that goes to the video, and loads nothing', async () => {
    await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: {
        path: 'watch.md',
        content: '# Watch\n\n![](https://youtu.be/dQw4w9WgXcQ)\n',
      },
    })
    await publish({ subdomain: 'field' })

    const response = await call(env, '/watch', { host: 'field.nibeditor.com' })

    // The card is here, and it is a link: this page runs no script, so a click
    // takes the reader to the video rather than loading one in place.
    expect(response.text).toContain('class="embed-web embed-wide"')
    expect(response.text).toContain('href="https://youtu.be/dQw4w9WgXcQ"')
    expect(response.text).toContain('YouTube')
    // Nothing a browser fetches from anybody on its way to reading the note.
    expect(response.text).not.toContain('<iframe')
    // Which is why no frame needs letting through, and none is.
    const policy = response.headers.get('content-security-policy') ?? ''
    expect(policy).toContain("default-src 'none'")
    expect(policy).not.toContain('frame-src')
  })

  test('a chart is drawn on a published page, which has no drawing library', async () => {
    await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: {
        path: 'counts.md',
        content:
          '# Counts\n\n```chart\ntitle: Two months\nlabels: [Jan, Feb]\nseries:\n  - data: [3, 5]\n```\n',
      },
    })
    await publish({ subdomain: 'field' })

    const response = await call(env, '/counts', { host: 'field.nibeditor.com' })

    expect(response.text).toContain('<figure class="chart" data-kind="bar">')
    expect(response.text).toContain('<svg class="chart-svg"')
    expect(response.text).toContain('Two months')
    // Drawn, not printed as its own source.
    expect(response.text).not.toContain('series:')
  })

  test('a recording a note embeds is a player the policy allows', async () => {
    await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'listen.md', content: '# Listen\n\n![[take.mp3]]\n' },
    })
    await publish({ subdomain: 'field' })

    const response = await call(env, '/listen', { host: 'field.nibeditor.com' })

    expect(response.text).toContain('<audio class="embed-media" controls preload="metadata"')
    expect(response.headers.get('content-security-policy') ?? '').toContain(
      'media-src https: data:',
    )
  })

  test('markdown still renders fully', async () => {
    await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'rich.md', content: '# Rich\n\n==marked== and $E=mc^2$ and H~2~O\n' },
    })
    await publish({ subdomain: 'field' })

    const response = await call(env, '/rich', { host: 'field.nibeditor.com' })
    expect(response.text).toContain('<mark>marked</mark>')
    expect(response.text).toContain('katex')
    expect(response.text).toContain('<sub>2</sub>')
  })
})

/** Two notes in one folder, where the first points at the second the way a
 *  markdown link does: a path, relative to where it was written. */
const ONE = '# One\n\nsee [the other](../Public/Two.md)\n'
const TWO = '# Two\n\nthe other one\n'
const DEEP = '# Deep idea\n\n## The middle\n\nText.\n'

describe('links between notes on a published page', () => {
  test('point at where the other note is published', async () => {
    await addNote('Notes/Deep idea.md', '# Deep idea\n\nSomething.\n')
    await addNote('linking.md', '# Linking\n\nsee [[Deep idea]] and [[Hello world|the first]]\n')
    await publish({ subdomain: 'field' })

    const response = await call(env, '/linking', { host: 'field.nibeditor.com' })
    expect(response.text).toContain('<a class="wikilink" href="/notes/deep-idea">Deep idea</a>')
    expect(response.text).toContain('<a class="wikilink" href="/hello-world">the first</a>')
  })

  test('a heading is reached by the id the renderer gave it', async () => {
    await addNote('parts.md', '# Parts\n\n## The middle\n\nText.\n')
    await addNote('linking.md', 'see [[parts#The middle]]\n')
    await publish({ subdomain: 'field' })

    const response = await call(env, '/linking', { host: 'field.nibeditor.com' })
    expect(response.text).toContain('href="/parts#the-middle"')
  })

  test('a path-qualified link finds the note in its folder', async () => {
    await addNote('Notes/Deep idea.md', '# Deep idea\n')
    await addNote('linking.md', 'see [[Notes/Deep idea]]\n')
    await publish({ subdomain: 'field' })

    const response = await call(env, '/linking', { host: 'field.nibeditor.com' })
    expect(response.text).toContain('href="/notes/deep-idea"')
  })

  /** The other half of the same question. A wikilink names a note; a markdown
   *  link names a path, written relative to the note it sits in - and that path
   *  is not where the site serves anything. It used to be published exactly as
   *  written, so `[the other](../Public/Two.md)` on a page at `/public/one`
   *  pointed at `/Public/Two.md`, which answered 404 for every reader who
   *  followed it. In the app there is a click to read the path at; on a page
   *  there is not. */
  test('and so does a plain markdown link that names one', async () => {
    await addNote('Public/One.md', ONE)
    await addNote('Public/Two.md', TWO)
    await publish({ subdomain: 'field' })

    const response = await call(env, '/public/one', { host: 'field.nibeditor.com' })
    expect(response.text).toContain('<a href="/public/two">the other</a>')
    expect(response.text).not.toContain('../Public/Two.md')
  })

  test('a markdown link reaches a heading and a name with a space in it', async () => {
    await addNote('Notes/Deep idea.md', DEEP)
    await addNote('linking.md', 'see [there](Notes/Deep%20idea.md#the-middle)')
    await publish({ subdomain: 'field' })

    const response = await call(env, '/linking', { host: 'field.nibeditor.com' })
    expect(response.text).toContain('href="/notes/deep-idea#the-middle"')
  })

  test('a markdown link to a note nobody published is words too', async () => {
    await addNote('Drafts/Three.md', '# Three')
    await addNote('linking.md', 'see [a draft](Drafts/Three.md) now')
    await publish({ subdomain: 'field', rules: { otherwise: 'all', exclude: ['Drafts'] } })

    const response = await call(env, '/linking', { host: 'field.nibeditor.com' })
    expect(response.text).toContain('see a draft now')
    expect(response.text).not.toContain('Drafts/Three.md')
  })

  test('and a link out at the web is left exactly as it was written', async () => {
    await addNote('linking.md', 'see [out](https://example.org/a.md) and [up](/somewhere)')
    await publish({ subdomain: 'field' })

    const response = await call(env, '/linking', { host: 'field.nibeditor.com' })
    expect(response.text).toContain('href="https://example.org/a.md"')
    expect(response.text).toContain('href="/somewhere"')
  })

  test('a note the space has not got is words, not a link to nowhere', async () => {
    await addNote('linking.md', 'see [[Nothing here]] now\n')
    await publish({ subdomain: 'field' })

    const response = await call(env, '/linking', { host: 'field.nibeditor.com' })
    expect(response.text).toContain('see Nothing here now')
    expect(response.text).not.toContain('wikilink')
  })

  test('a wikilink cannot script the reader through its own words', async () => {
    await addNote('linking.md', 'see [[Hello world|<img src=x onerror=alert(1)>]]\n')
    await publish({ subdomain: 'field' })

    const response = await call(env, '/linking', { host: 'field.nibeditor.com' })
    expect(response.text).not.toContain('<img src=x')
    expect(response.text).toContain('&lt;img')
  })
})

describe('an embed on a published page', () => {
  test('shows the note it names, with its name under it', async () => {
    await addNote('quote.md', '# Quote\n\nThe words themselves.\n')
    await addNote('holder.md', '# Holder\n\n![[quote]]\n')
    await publish({ subdomain: 'field' })

    const response = await call(env, '/holder', { host: 'field.nibeditor.com' })
    expect(response.text).toContain('<figure class="embed">')
    expect(response.text).toContain('The words themselves.')
    expect(response.text).toContain('<figcaption>quote</figcaption>')
  })

  test('a heading names the section, and only that one', async () => {
    await addNote('parts.md', '# Parts\n\n## One\n\nFirst.\n\n## Two\n\nSecond.\n')
    await addNote('holder.md', '![[parts#Two]]\n')
    await publish({ subdomain: 'field' })

    const response = await call(env, '/holder', { host: 'field.nibeditor.com' })
    expect(response.text).toContain('Second.')
    expect(response.text).not.toContain('First.')
  })

  test('one level deep: an embed inside an embedded note is a link', async () => {
    await addNote('inner.md', 'The innermost words.\n')
    await addNote('outer.md', 'Outer says ![[inner]]\n')
    await addNote('holder.md', '![[outer]]\n')
    await publish({ subdomain: 'field' })

    const response = await call(env, '/holder', { host: 'field.nibeditor.com' })
    expect(response.text).toContain('Outer says')
    expect(response.text).not.toContain('The innermost words.')
  })

  test('raw HTML inside an embedded note is shown, not run', async () => {
    await addNote('nasty.md', '<script>alert(1)</script>\n')
    await addNote('holder.md', '![[nasty]]\n')
    await publish({ subdomain: 'field' })

    const response = await call(env, '/holder', { host: 'field.nibeditor.com' })
    expect(response.text).not.toContain('<script>alert(1)</script>')
    expect(response.text).toContain('&lt;script&gt;')
  })

  test('a note the space has not got leaves no empty frame', async () => {
    await addNote('holder.md', '![[Nothing here]]\n')
    await publish({ subdomain: 'field' })

    const response = await call(env, '/holder', { host: 'field.nibeditor.com' })
    expect(response.text).not.toContain('<figure class="embed">')
    expect(response.text).toContain('Nothing here')
  })
})

describe('one address, not two', () => {
  test('a domain of your own gives the name up', async () => {
    await publish({ subdomain: 'field' })
    const response = await publish({ domain: 'notes.example.com' })

    expect(response.json.space.blog.subdomain).toBeNull()
    expect(response.json.space.blog.domain).toBe('notes.example.com')
    expect((await call(env, '/', { host: 'field.nibeditor.com' })).status).toBe(302)
  })

  test('the name given up is free for someone else', async () => {
    await publish({ subdomain: 'field' })
    await publish({ domain: 'notes.example.com' })

    expect((await call(env, '/v1/spaces/available/field', { token })).json.available).toBe(true)
  })

  test('choosing a name again lets the domain go', async () => {
    await publish({ domain: 'notes.example.com' })
    const response = await publish({ subdomain: 'field' })

    expect(response.json.space.blog.domain).toBeNull()
    expect(response.json.space.blog.subdomain).toBe('field')
    expect((await call(env, '/', { host: 'notes.example.com' })).status).not.toBe(200)
  })

  test('a domain and a name together keep only the domain', async () => {
    const response = await publish({ subdomain: 'field', domain: 'notes.example.com' })

    expect(response.json.space.blog.subdomain).toBeNull()
    expect(response.json.space.blog.domain).toBe('notes.example.com')
  })

  test('changing only the note keeps the address', async () => {
    await addNote('home.md', '# Hello\n')
    await publish({ subdomain: 'field' })
    const response = await publish({ note: 'home.md' })

    expect(response.status).toBe(200)
    expect(response.json.space.blog.subdomain).toBe('field')
    expect(response.json.space.blog.note).toBe('home.md')
  })

  test('refuses to publish with no address at all', async () => {
    const response = await publish({})

    expect(response.status).toBe(400)
    expect(response.json.error).toBe('choose an address')
  })
})

describe('choosing a subdomain', () => {
  test('reserved names are refused', async () => {
    expect((await publish({ subdomain: 'www' })).status).toBe(409)
    expect((await publish({ subdomain: 'mail' })).status).toBe(409)
  })

  /** A name that reads as the product is refused as well, and `blog` was the
   *  example this used to make of the opposite rule; see `RESERVED` in
   *  spaces/addresses.ts. What is free is somebody's own words. */
  test('and so is one that reads as ours', async () => {
    expect((await publish({ subdomain: 'blog' })).status).toBe(409)
    expect((await publish({ subdomain: 'login' })).status).toBe(409)
  })

  test('while a name of somebody’s own is taken', async () => {
    expect((await publish({ subdomain: 'hedgehogs' })).status).toBe(200)
  })

  test('malformed names are refused', async () => {
    expect((await publish({ subdomain: 'Not Valid' })).status).toBe(400)
    expect((await publish({ subdomain: '-leading' })).status).toBe(400)
  })

  test('a name in use is refused', async () => {
    await publish({ subdomain: 'field' })

    const other = await signIn(env, 'other@b.dev')
    const theirs = await call(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })
    const response = await call(env, `/v1/spaces/${theirs.json.space.id}/blog`, {
      method: 'PUT',
      token: other,
      body: { subdomain: 'field' },
    })

    expect(response.status).toBe(409)
  })

  test('a name the space already holds is free for that space', async () => {
    await publish({ subdomain: 'field' })

    const mine = await call(env, `/v1/spaces/available/field?space=${space}`, { token })
    expect(mine.json.available).toBe(true)

    const bare = await call(env, '/v1/spaces/available/field', { token })
    expect(bare.json.available).toBe(false)
  })

  test('a name held by one space is not free for another', async () => {
    await publish({ subdomain: 'field' })
    const second = await call(env, '/v1/spaces', { token, body: { name: 'Second' } })

    const response = await call(env, `/v1/spaces/available/field?space=${second.json.space.id}`, {
      token,
    })
    expect(response.json.available).toBe(false)
  })

  test('naming a space that is not yours does not free its name', async () => {
    await publish({ subdomain: 'field' })

    const other = await signIn(env, 'other@b.dev')
    const response = await call(env, `/v1/spaces/available/field?space=${space}`, { token: other })
    expect(response.json.available).toBe(false)
  })

  test('availability can be checked before committing', async () => {
    expect((await call(env, '/v1/spaces/available/free-name', { token })).json.available).toBe(true)

    await publish({ subdomain: 'taken-name' })
    expect((await call(env, '/v1/spaces/available/taken-name', { token })).json.available).toBe(
      false,
    )
    expect((await call(env, '/v1/spaces/available/www', { token })).json.available).toBe(false)
  })
})

describe('the author', () => {
  test('is named on the index and in the footer once they have a name', async () => {
    await call(env, '/v1/me', { method: 'PATCH', token, body: { name: 'Ada Lovelace' } })
    await publish({ subdomain: 'field' })

    const index = await call(env, '/', { host: 'field.nibeditor.com' })
    expect(index.text).toContain('by Ada Lovelace')
    expect(index.text).toContain('<meta name="author" content="Ada Lovelace">')

    const note = await call(env, '/hello-world', { host: 'field.nibeditor.com' })
    expect(note.text).toContain('Ada Lovelace')
  })

  test('is left out until there is a name', async () => {
    await publish({ subdomain: 'field' })

    const index = await call(env, '/', { host: 'field.nibeditor.com' })
    expect(index.text).not.toContain('by ')
    expect(index.text).not.toContain('name="author"')
  })

  test('cannot smuggle markup through the name', async () => {
    await call(env, '/v1/me', { method: 'PATCH', token, body: { name: '<b>Ada</b>' } })
    await publish({ subdomain: 'field' })

    const index = await call(env, '/', { host: 'field.nibeditor.com' })
    expect(index.text).not.toContain('<b>Ada</b>')
    expect(index.text).toContain('&lt;b&gt;Ada&lt;/b&gt;')
  })

  test('has a byline right under the title of a note', async () => {
    await call(env, '/v1/me', { method: 'PATCH', token, body: { name: 'Ada Lovelace' } })
    await publish({ subdomain: 'field' })

    const note = await call(env, '/hello-world', { host: 'field.nibeditor.com' })
    const title = note.text.indexOf('<h1 id="hello-world">Hello world</h1>')
    const byline = note.text.indexOf('<p class="by">by Ada Lovelace</p>')

    expect(title).toBeGreaterThan(-1)
    expect(byline).toBeGreaterThan(title)
    expect(note.text.slice(title, byline)).toBe('<h1 id="hello-world">Hello world</h1>')
    expect(note.text).toContain('<meta name="author" content="Ada Lovelace">')
  })

  test('puts the byline first when a note does not start with a heading', async () => {
    await call(env, '/v1/me', { method: 'PATCH', token, body: { name: 'Ada' } })
    await addNote('plain.md', 'Just a paragraph.\n\n# Later\n')
    await publish({ subdomain: 'field' })

    const note = await call(env, '/plain', { host: 'field.nibeditor.com' })
    const byline = note.text.indexOf('<p class="by">by Ada</p>')

    expect(byline).toBeGreaterThan(-1)
    // The paragraph as it is rendered, not the description in the head: the
    // first words of a note are what stands in for one it never wrote.
    expect(byline).toBeLessThan(note.text.indexOf('<p>Just a paragraph.'))
    expect(byline).toBeLessThan(note.text.indexOf('<h1 id="later">Later</h1>'))
  })

  test('is named under the title of a note published on its own', async () => {
    await call(env, '/v1/me', { method: 'PATCH', token, body: { name: 'Ada' } })
    await addNote('home.md', '# Home\n\nMy page.\n')
    await publish({ subdomain: 'me', note: 'home.md' })

    const root = await call(env, '/', { host: 'me.nibeditor.com' })
    expect(root.text.indexOf('<h1 id="home">Home</h1>')).toBeLessThan(root.text.indexOf('by Ada'))
  })

  test('leaves a note without a byline until there is a name', async () => {
    await publish({ subdomain: 'field' })

    const note = await call(env, '/hello-world', { host: 'field.nibeditor.com' })
    expect(note.text).not.toContain('class="by"')
    expect(note.text).not.toContain('name="author"')
  })

  test('is escaped in the byline of a note too', async () => {
    await call(env, '/v1/me', { method: 'PATCH', token, body: { name: '<b>Ada</b>' } })
    await publish({ subdomain: 'field' })

    const note = await call(env, '/hello-world', { host: 'field.nibeditor.com' })
    expect(note.text).not.toContain('<b>Ada</b>')
    expect(note.text).toContain('by &lt;b&gt;Ada&lt;/b&gt;')
  })
})

/** Every public surface, rendered for an account whose address is known, and
 *  searched for it. The blog is one, but so is anything that answers without
 *  a session; a new public route belongs in this list. */
describe('nothing public carries the email address', () => {
  const EMAIL = 'a@b.dev'
  const PUBLIC = [
    '/',
    '/hello-world',
    '/no-such-note',
    '/feed.xml',
    '/rss.xml',
    '/atom.xml',
    '/sitemap.xml',
    '/robots.txt',
  ]

  async function everywhere(host: string) {
    const seen: string[] = []
    for (const path of PUBLIC) {
      const response = await call(env, path, { host })
      seen.push(
        `${path}: ${[...response.headers.entries()].map(([k, v]) => `${k}=${v}`).join(' ')}`,
      )
      seen.push(`${path}: ${response.text}`)
    }

    // Pages really were rendered, or the search below would prove nothing.
    const text = seen.join('\n')
    expect(text).toContain('Published with')
    return text
  }

  test('not a published space, with a name or without', async () => {
    await publish({ subdomain: 'field' })
    expect(await everywhere('field.nibeditor.com')).not.toContain(EMAIL)

    await call(env, '/v1/me', { method: 'PATCH', token, body: { name: 'Ada' } })
    expect(await everywhere('field.nibeditor.com')).not.toContain(EMAIL)
  })

  test('not a note published on its own', async () => {
    await addNote('home.md', '# Home\n')
    await publish({ subdomain: 'me', note: 'home.md' })
    expect(await everywhere('me.nibeditor.com')).not.toContain(EMAIL)
  })

  test('not a domain of their own', async () => {
    await publishDomain('notes.example.com')
    expect(await everywhere('notes.example.com')).not.toContain(EMAIL)
  })

  test('not the unauthenticated endpoints of the app itself', async () => {
    await publish({ subdomain: 'field' })

    for (const path of [
      '/health',
      '/.well-known/oauth-authorization-server',
      '/.well-known/oauth-protected-resource/mcp',
      '/mcp',
      '/oauth/authorize',
      '/v1/me',
      '/v1/spaces',
      '/v1/spaces/available/field',
    ]) {
      const response = await call(env, path)
      expect(response.text, path).not.toContain(EMAIL)
    }
  })
})

describe('the way back to the index', () => {
  test('sits above the title of a note', async () => {
    await publish({ subdomain: 'field' })

    const note = await call(env, '/hello-world', { host: 'field.nibeditor.com' })
    const back = note.text.indexOf('<a href="/">← Field notes</a>')

    expect(back).toBeGreaterThan(-1)
    expect(back).toBeLessThan(note.text.indexOf('<h1 id="hello-world">Hello world</h1>'))
  })

  test('comes before the byline as well', async () => {
    await call(env, '/v1/me', { method: 'PATCH', token, body: { name: 'Ada' } })
    await publish({ subdomain: 'field' })

    const note = await call(env, '/hello-world', { host: 'field.nibeditor.com' })
    expect(note.text.indexOf('← Field notes')).toBeLessThan(note.text.indexOf('by Ada'))
  })

  test('names the blog, escaped', async () => {
    await publish({ subdomain: 'field', title: 'Notes <3' })

    const note = await call(env, '/hello-world', { host: 'field.nibeditor.com' })
    expect(note.text).toContain('← Notes &lt;3')
  })

  test('is not offered on a note published on its own, which has no index', async () => {
    await addNote('home.md', '# Home\n')
    await publish({ subdomain: 'me', note: 'home.md' })

    const root = await call(env, '/', { host: 'me.nibeditor.com' })
    expect(root.text).not.toContain('<a href="/">')
  })
})

describe('publishing one note instead of the space', () => {
  test('serves that note at the root, with no index', async () => {
    await addNote('home.md', '# Hello\n\nMy personal page.\n')
    await addNote('secret.md', '# Secret\n\nNot for the web.\n')

    await publish({ subdomain: 'me', note: 'home.md' })

    const root = await call(env, '/', { host: 'me.nibeditor.com' })

    expect(root.status).toBe(200)
    expect(root.text).toContain('My personal page.')
    expect(root.text).not.toContain('class="index"')
  })

  test('hides every other note in the space', async () => {
    await addNote('home.md', '# Hello\n')
    await addNote('secret.md', '# Secret\n\nNot for the web.\n')

    await publish({ subdomain: 'me', note: 'home.md' })

    const other = await call(env, '/secret', { host: 'me.nibeditor.com' })
    expect(other.text).not.toContain('Not for the web.')
  })

  test('refuses a note that is not in the space', async () => {
    const response = await publish({ subdomain: 'me', note: 'nowhere.md' })

    expect(response.status).toBe(404)
  })

  test('goes back to the whole space when the note is cleared', async () => {
    await addNote('home.md', '# Hello\n')
    await addNote('other.md', '# Other\n')

    await publish({ subdomain: 'me', note: 'home.md' })
    await publish({ subdomain: 'me', note: null })

    const root = await call(env, '/', { host: 'me.nibeditor.com' })
    expect(root.text).toContain('class="index"')
  })

  test('reports which note is published', async () => {
    await addNote('home.md', '# Hello\n')
    const published = await publish({ subdomain: 'me', note: 'home.md' })

    expect(published.json.space.blog.note).toBe('home.md')
  })
})

describe('a published note that links a PDF', () => {
  /** A hash is 64 hex characters; the bytes behind it never matter here. */
  const PAPER = 'c'.repeat(64)

  /** The paper goes up as a blob, and the space records where in it the file
   *  sits: the same two steps a sync pass takes. */
  async function keepPaper(path = 'reading/paper.pdf') {
    await call(env, `/v1/blobs/${PAPER}`, {
      method: 'PUT',
      token,
      raw: new Uint8Array(2048),
      headers: { 'content-type': 'application/pdf' },
    })
    await call(env, `/v1/spaces/${space}/files`, {
      method: 'PUT',
      token,
      body: { files: [{ path, hash: PAPER }] },
    })
  }

  test('links it at the page the link named', async () => {
    await keepPaper()
    await addNote('cites.md', '# Cites\n\nSee [[paper.pdf#page=3]].\n')
    await publish({ subdomain: 'field' })

    const page = await call(env, '/cites', { host: 'field.nibeditor.com' })
    expect(page.text).toContain(`href="/i/${PAPER}.pdf#page=3"`)
  })

  test('and with no page when the link named none', async () => {
    await keepPaper()
    await addNote('cites.md', '# Cites\n\nSee [[reading/paper.pdf]].\n')
    await publish({ subdomain: 'field' })

    const page = await call(env, '/cites', { host: 'field.nibeditor.com' })
    expect(page.text).toContain(`href="/i/${PAPER}.pdf"`)
  })

  test('serves the paper itself under the path the note wrote', async () => {
    await keepPaper()
    await publish({ subdomain: 'field' })

    const response = await call(env, '/reading/paper.pdf', { host: 'field.nibeditor.com' })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain(`/i/${PAPER}.pdf`)
  })

  test('under a path with a space in its name, as a browser asks for it', async () => {
    await keepPaper('reading/a long paper.pdf')
    await publish({ subdomain: 'field' })

    const response = await call(env, '/reading/a%20long%20paper.pdf', {
      host: 'field.nibeditor.com',
    })
    expect(response.status).toBe(302)
  })

  test('and leaves a link to a paper the space does not keep as plain words', async () => {
    await addNote('cites.md', '# Cites\n\nSee [[missing.pdf#page=3]].\n')
    await publish({ subdomain: 'field' })

    const page = await call(env, '/cites', { host: 'field.nibeditor.com' })
    expect(page.text).toContain('See missing.pdf#page=3.')
    expect(page.text).not.toContain('/i/')
  })

  test('serves it from a space published as one note as well', async () => {
    await keepPaper()
    await addNote('home.md', '# Home\n\nSee [[paper.pdf#page=2]].\n')
    await publish({ subdomain: 'field', note: 'home.md' })

    const page = await call(env, '/', { host: 'field.nibeditor.com' })
    expect(page.text).toContain(`href="/i/${PAPER}.pdf#page=2"`)

    const paper = await call(env, '/reading/paper.pdf', { host: 'field.nibeditor.com' })
    expect(paper.status).toBe(302)
  })

  test('while a path that is nobody’s file is still not found', async () => {
    await keepPaper()
    await publish({ subdomain: 'field' })

    const response = await call(env, '/reading/other.pdf', { host: 'field.nibeditor.com' })
    expect(response.text).toContain('Not found')
  })
})

describe('subdomain lengths', () => {
  test('takes the shortest the message promises', async () => {
    expect((await publish({ subdomain: 'me' })).status).toBe(200)
  })

  test('takes the longest', async () => {
    expect((await publish({ subdomain: 'x'.repeat(32) })).status).toBe(200)
  })

  test('refuses one character', async () => {
    expect((await publish({ subdomain: 'x' })).status).toBe(400)
  })

  test('refuses more than thirty-two', async () => {
    expect((await publish({ subdomain: 'x'.repeat(33) })).status).toBe(400)
  })

  test('refuses a leading or trailing hyphen', async () => {
    expect((await publish({ subdomain: '-me' })).status).toBe(400)
    expect((await publish({ subdomain: 'me-' })).status).toBe(400)
  })
})

describe('a published note read as slides', () => {
  const DECK = [
    '# The talk',
    '',
    '---',
    '',
    '## Where it goes',
    '',
    '+ first',
    '+ second',
    '',
    'Note: only the presenter reads this',
    '',
    '***',
    '',
    '### A detail',
  ].join('\n')

  async function publishDeck() {
    await addNote('talk.md', DECK)
    await publish({ subdomain: 'field' })
  }

  test('the note itself offers it', async () => {
    await publishDeck()

    const response = await call(env, '/talk', { host: 'field.nibeditor.com' })
    expect(response.text).toContain('href="?slides"')
  })

  test('a note that is not a deck offers nothing', async () => {
    await publish({ subdomain: 'field' })

    const response = await call(env, '/hello-world', { host: 'field.nibeditor.com' })
    expect(response.text).not.toContain('href="?slides"')
  })

  test('asking for it serves one page per slide', async () => {
    await publishDeck()

    const response = await call(env, '/talk?slides', { host: 'field.nibeditor.com' })
    expect(response.status).toBe(200)
    expect(response.text.match(/<div class="stage">/g)).toHaveLength(3)
    expect(response.text).toContain('<h1>The talk</h1>')
    expect(response.text).toContain('<h3>A detail</h3>')
  })

  test('wears the app’s own stage, and shows one slide of it at a time', async () => {
    await publishDeck()

    const response = await call(env, '/talk?slides', { host: 'field.nibeditor.com' })
    // The prose sheet and the stage, both served from here; see blog/style.ts.
    expect(response.text.match(/<link rel="stylesheet" href="\/s\//g)).toHaveLength(2)
    expect(response.text).toContain('--stage-width:1280px')
    // Without this every slide is drawn on top of the one before it.
    expect(response.text).toContain('.deck .stage.away { display: none; }')
  })

  test('the presenter’s notes are not served with the deck', async () => {
    await publishDeck()

    const response = await call(env, '/talk?slides', { host: 'field.nibeditor.com' })
    expect(response.text).not.toContain('only the presenter reads this')
  })

  test('a slide of headings alone is a title, and one below is a continuation', async () => {
    await publishDeck()

    const response = await call(env, '/talk?slides', { host: 'field.nibeditor.com' })
    expect(response.text).toContain('data-shape="title"')
    expect(response.text.match(/data-vertical="yes"/g)).toHaveLength(1)
  })

  test('a slide keeps the line breaks the author typed', async () => {
    // A slide is a poster: three placed lines stay three lines. The page the
    // same note is published as keeps CommonMark's space; see docs/slides.md.
    await addNote('poster.md', '# One\n\n---\n\nShip it\nRead it\n')
    await publish({ subdomain: 'field' })

    const deck = await call(env, '/poster?slides', { host: 'field.nibeditor.com' })
    expect(deck.text).toContain('Ship it<br>Read it')

    const page = await call(env, '/poster', { host: 'field.nibeditor.com' })
    expect(page.text).not.toContain('Ship it<br>Read it')
  })

  test('the items that wait for a click are named', async () => {
    await publishDeck()

    const response = await call(env, '/talk?slides', { host: 'field.nibeditor.com' })
    expect(response.text).toContain('data-fragments="0,1"')
  })

  test('only the script written here may run', async () => {
    await publishDeck()

    const response = await call(env, '/talk?slides', { host: 'field.nibeditor.com' })
    const policy = response.headers.get('content-security-policy') ?? ''
    const nonce = /script-src 'nonce-([a-f0-9]+)'/.exec(policy)?.[1]

    expect(nonce).toBeTruthy()
    expect(response.text).toContain(`<script nonce="${nonce}">`)
    // One script tag on the page, and it is that one.
    expect(response.text.match(/<script/g)).toHaveLength(1)
  })

  test('the page itself runs the furniture rather than the deck', async () => {
    await publishDeck()

    const response = await call(env, '/talk', { host: 'field.nibeditor.com' })
    const policy = response.headers.get('content-security-policy') ?? ''

    // A page is a page: the site's own furniture, and no nonce - the one script
    // a deck needs runs on the deck's own page, which is `?slides`.
    expect(policy).toContain("script-src 'self' 'sha256-")
    expect(policy).not.toContain('nonce-')
  })

  test('a note that is not a deck cannot be asked for as one', async () => {
    await publish({ subdomain: 'field' })

    const response = await call(env, '/hello-world?slides', { host: 'field.nibeditor.com' })
    expect(response.text).not.toContain('<div class="stage">')
    expect(response.headers.get('content-security-policy')).not.toContain('nonce-')
  })

  test('the markup rules still hold: a note’s own HTML is shown, never run', async () => {
    await addNote('sneaky.md', '# One\n\n---\n\n<script>alert(1)</script>\n')
    await publish({ subdomain: 'field' })

    const response = await call(env, '/sneaky?slides', { host: 'field.nibeditor.com' })
    expect(response.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(response.text.match(/<script/g)).toHaveLength(1)
  })

  test('a single note published as the whole site can be a deck too', async () => {
    await addNote('home.md', DECK)
    await publish({ subdomain: 'me', note: 'home.md' })

    const page = await call(env, '/', { host: 'me.nibeditor.com' })
    expect(page.text).toContain('href="?slides"')

    const deck = await call(env, '/?slides', { host: 'me.nibeditor.com' })
    expect(deck.text.match(/<div class="stage">/g)).toHaveLength(3)
  })
})

/** A canvas and a page note are the same bytes under two extensions: JSON Canvas,
 *  which is a drawing rather than a page. Published, one would say its ink's
 *  coordinates and its cards' words to anybody who guessed the slug. */
describe('a drawing in a published space', () => {
  const DRAWING = '{"nodes":[{"id":"a","type":"text","text":"the private bit"}],"edges":[]}'

  test('is not a page, whichever of its two extensions it carries', async () => {
    await addNote('Board.canvas', DRAWING)
    await addNote('Lecture 4.pages', DRAWING)
    await publish({ subdomain: 'field' })

    for (const slug of ['/board', '/lecture-4']) {
      const response = await call(env, slug, { host: 'field.nibeditor.com' })
      expect(response.status, slug).toBe(404)
      expect(response.text, slug).not.toContain('the private bit')
    }

    // Nor in the index, the feed or the sitemap.
    for (const path of ['/', '/feed.xml', '/sitemap.xml']) {
      const listing = await call(env, path, { host: 'field.nibeditor.com' })
      expect(listing.text, path).not.toContain('lecture-4')
      expect(listing.text, path).not.toContain('board')
    }
  })
})

/** A snippet is the note's own prose with the index's marks in it, and the words
 *  were indexed with the markup stripped rather than escaped. */
describe('searching a site', () => {
  test('marks what matched and says the rest as words', async () => {
    await addNote('found.md', '# Found\n\nA paragraph about hedgehogs.\n')
    await publish({ subdomain: 'field' })

    const response = await call(env, '/search?q=hedgehogs', { host: 'field.nibeditor.com' })

    expect(response.text).toContain('<mark>hedgehogs</mark>')
    expect(response.text).toContain('href="/found"')
  })

  test('and a tag a note only half wrote is still words', async () => {
    // Half a tag, because the index strips whole ones: the page's own `</span>`
    // after it was what used to close this one.
    await addNote('sneaky.md', '# Sneaky\n\nhedgehogs <script src=/i/x.js\n')
    await publish({ subdomain: 'field' })

    const response = await call(env, '/search?q=hedgehogs', { host: 'field.nibeditor.com' })

    expect(response.text).toContain('&lt;script')
    expect(response.text).not.toContain('<script src')
    // The site's own script and the one inline line, and nothing the note added.
    expect(response.text.match(/<script/g)).toHaveLength(2)
  })
})

/** The graph's data travels as a JSON island, and a title is somebody's words:
 *  nothing inside a `<script>` element is escaped by the parser, so the island's
 *  own escaping is the whole of what keeps a title from closing it. */
describe('the graph the site draws', () => {
  test('writes a title that would close the island as JSON rather than as a tag', async () => {
    await addNote(
      'sneaky.md',
      '---\ntitle: \'</script><script src="/i/x.js"></script>\'\n---\n\n# One\n\n[[Hello world]]\n',
    )
    await publish({ subdomain: 'field' })

    const response = await call(env, '/graph', { host: 'field.nibeditor.com' })
    const island = /<script type="application\/json">([\s\S]*?)<\/script>/.exec(response.text)

    expect(island?.[1]).toContain('\\u003c/script')
    expect(island?.[1]).not.toContain('</script')
  })

  test('and says the same data once it is read back', () => {
    const read: unknown = JSON.parse(asIsland(JSON.stringify({ name: '</script><b>' })))
    expect(read).toEqual({ name: '</script><b>' })
  })
})
