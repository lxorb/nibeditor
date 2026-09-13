import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { frontOf } from '../src/blog/front'
import { publishes } from '../src/blog/site'
import { call, type ShareView, signIn, testEnv, type TestEnv } from './harness'

/** A site of a few notes, published on a name, so that everything below can ask
 *  the hostname what it serves. */
let env: TestEnv
let token: string
let space: string

const HOST = 'field.nibeditor.com'

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')

  const created = await call(env, '/v1/spaces', { token, body: { name: 'Field notes' } })
  space = created.json.space.id
})

afterEach(() => env.close())

async function note(path: string, content: string) {
  const made = await call(env, `/v1/spaces/${space}/notes`, { token, body: { path, content } })
  return made.json.note as { id: string; version: number }
}

async function publish(body: Record<string, unknown> = { subdomain: 'field' }) {
  return call(env, `/v1/spaces/${space}/blog`, { method: 'PUT', token, body })
}

async function setSite(body: Record<string, unknown>) {
  return call(env, `/v1/spaces/${space}/site`, { method: 'PUT', token, body })
}

function page(path: string, options: Record<string, unknown> = {}) {
  return call(env, path, { host: HOST, ...options })
}

describe('what a note says about its page', () => {
  test('reads the keys Obsidian Publish writes', () => {
    const front = frontOf(
      [
        '---',
        'publish: true',
        'permalink: notes/the-plan',
        'aliases:',
        '  - old-plan',
        '  - The Older Plan',
        'description: What we decided in March.',
        'image: cover.png',
        'date: 2026-03-04',
        '---',
        '',
        '# The plan',
        '',
        'We decided to ship it.',
      ].join('\n'),
    )

    expect(front).toEqual({
      publish: true,
      permalink: 'notes/the-plan',
      aliases: ['old-plan', 'the-older-plan'],
      description: 'What we decided in March.',
      image: 'cover.png',
      date: '2026-03-04',
      heading: 'The plan',
      summary: 'We decided to ship it.',
    })
  })

  test('takes `cover` for the same picture, since half the themes write that', () => {
    expect(frontOf('---\ncover: shot.png\n---\n')?.image).toBe('shot.png')
  })

  test('says nothing about a note that says nothing', () => {
    expect(frontOf('Just some words.\n')).toEqual({ summary: 'Just some words.' })
  })

  test('reads a word it does not understand as silence', () => {
    expect(frontOf('---\npublish: maybe\n---\n')?.publish).toBeUndefined()
  })

  test('takes the first prose for a summary, not the heading or the fence', () => {
    const front = frontOf('# Title\n\n```js\nconst a = 1\n```\n\nThe actual sentence.\n')
    expect(front?.summary).toBe('The actual sentence.')
    expect(front?.heading).toBe('Title')
  })

  test('and strips the marks out of it', () => {
    expect(frontOf('A **bold** [link](x) and [[a note|that note]].\n')?.summary).toBe(
      'A bold link and that note.',
    )
  })
})

describe('which notes a site publishes', () => {
  const rules = { include: [], exclude: [], otherwise: 'all' as const }

  test('publishes everything, as it always did', () => {
    expect(publishes(rules, 'Work/One.md', {})).toBe(true)
  })

  test('the note wins over every rule', () => {
    expect(publishes({ ...rules, exclude: ['Work'] }, 'Work/One.md', { publish: true })).toBe(true)
    expect(publishes({ ...rules, include: ['Work'] }, 'Work/One.md', { publish: false })).toBe(
      false,
    )
  })

  test('an excluded folder takes everything under it', () => {
    const held = { ...rules, exclude: ['Work/Private'] }
    expect(publishes(held, 'Work/Private/One.md', {})).toBe(false)
    expect(publishes(held, 'Work/One.md', {})).toBe(true)
  })

  test('and the deeper rule is the one that counts', () => {
    const held = { include: ['Work/Notes'], exclude: ['Work'], otherwise: 'none' as const }
    expect(publishes(held, 'Work/Notes/One.md', {})).toBe(true)
    expect(publishes(held, 'Work/One.md', {})).toBe(false)
  })

  test('nothing is published where that is the default', () => {
    const held = { include: ['Public'], exclude: [], otherwise: 'none' as const }
    expect(publishes(held, 'Public/One.md', {})).toBe(true)
    expect(publishes(held, 'Drafts/One.md', {})).toBe(false)
  })
})

describe('a site with rules', () => {
  beforeEach(async () => {
    await note('Public/One.md', '# One\n\nFirst.\n')
    await note('Drafts/Two.md', '# Two\n\nNot ready.\n')
    await note('Three.md', '---\npublish: false\n---\n\n# Three\n')
    await publish()
  })

  test('says what a publish would change before it changes it', async () => {
    const asked = await call(env, `/v1/spaces/${space}/site/preview`, {
      token,
      body: { rules: { exclude: ['Drafts'], otherwise: 'all' } },
    })

    // Three notes, one of which says no for itself, so two pages now and one
    // once the drafts are out.
    expect(asked.json.before).toBe(2)
    expect(asked.json.pages).toBe(1)
    expect(asked.json.removes).toEqual(['Drafts/Two.md'])
    expect(asked.json.adds).toEqual([])
  })

  test('and counts everything as new while the space is private', async () => {
    await call(env, `/v1/spaces/${space}/blog`, { method: 'DELETE', token })

    const asked = await call(env, `/v1/spaces/${space}/site/preview`, {
      token,
      body: { rules: { otherwise: 'all' } },
    })

    expect(asked.json.before).toBe(0)
    expect(asked.json.adds).toEqual(['Drafts/Two.md', 'Public/One.md'])
  })

  test('leaves out the folders it is told to', async () => {
    await setSite({ rules: { exclude: ['Drafts'], otherwise: 'all' } })

    const index = await page('/')
    expect(index.text).toContain('One')
    expect(index.text).not.toContain('Two')

    expect((await page('/drafts/two')).status).toBe(404)
    expect((await page('/public/one')).status).toBe(200)
  })

  /** A file keeps the same rules a note does. It carries no front matter to settle
   *  its own case, so where it sits is the whole of the answer - and where it sits is
   *  a path somebody can guess, which the hash it redirects to is not. */
  test('and the papers in them, which are asked for by their own path', async () => {
    const hash = 'd'.repeat(64)
    await call(env, `/v1/blobs/${hash}`, {
      method: 'PUT',
      token,
      raw: new Uint8Array(64),
      headers: { 'content-type': 'application/pdf' },
    })
    await call(env, `/v1/spaces/${space}/files`, {
      method: 'PUT',
      token,
      body: {
        files: [
          { path: 'Public/paper.pdf', hash },
          { path: 'Drafts/salary.pdf', hash },
        ],
      },
    })

    await setSite({ rules: { exclude: ['Drafts'], otherwise: 'all' } })

    expect((await page('/Public/paper.pdf')).status).toBe(302)
    expect((await page('/Drafts/salary.pdf')).status).toBe(404)
  })

  test('or publishes only what is named', async () => {
    await setSite({ rules: { include: ['Public'], otherwise: 'none' } })

    expect((await page('/public/one')).status).toBe(200)
    expect((await page('/drafts/two')).status).toBe(404)
  })

  test('and a note that says no is never on the site', async () => {
    await setSite({ rules: { otherwise: 'all' } })
    expect((await page('/three')).status).toBe(404)
  })

  test('the rules are the owner’s to set', async () => {
    const other = await signIn(env, 'c@d.dev')
    const refused = await call(env, `/v1/spaces/${space}/site`, {
      method: 'PUT',
      token: other,
      body: { rules: { otherwise: 'none' } },
    })

    expect(refused.status).toBe(404)
  })
})

describe('where a page lives', () => {
  test('a permalink puts it there, and its path no longer answers', async () => {
    await note('Notes/First idea.md', '---\npermalink: ideas/first\n---\n\n# First idea\n')
    await publish()

    expect((await page('/ideas/first')).status).toBe(200)
    expect((await page('/notes/first-idea')).status).toBe(404)
  })

  test('an alias finds it too', async () => {
    await note('Plan.md', '---\naliases:\n  - the-plan\n---\n\n# Plan\n')
    await publish()

    expect((await page('/plan')).status).toBe(200)
    expect((await page('/the-plan')).status).toBe(200)
  })

  test('a rename leaves the old path redirecting', async () => {
    const made = await note('Plan.md', '# Plan\n\nWords.\n')
    await publish()
    expect((await page('/plan')).status).toBe(200)

    await call(env, `/v1/notes/${made.id}`, {
      method: 'PUT',
      token,
      body: { path: 'The plan.md', content: '# Plan\n\nWords.\n', baseVersion: made.version },
    })

    const moved = await page('/plan')
    expect(moved.status).toBe(301)
    expect(moved.headers.get('location')).toBe(`https://${HOST}/the-plan`)
    expect((await page('/the-plan')).status).toBe(200)
  })

  test('and so does a permalink that was reconsidered', async () => {
    const made = await note('Plan.md', '---\npermalink: plans/march\n---\n\n# Plan\n')
    await publish()

    await call(env, `/v1/notes/${made.id}`, {
      method: 'PUT',
      token,
      body: {
        path: 'Plan.md',
        content: '---\npermalink: plans/april\n---\n\n# Plan\n',
        baseVersion: made.version,
      },
    })

    const moved = await page('/plans/march')
    expect(moved.status).toBe(301)
    expect(moved.headers.get('location')).toBe(`https://${HOST}/plans/april`)
  })

  test('a path nothing ever answered on is still not found', async () => {
    await note('Plan.md', '# Plan\n')
    await publish()

    expect((await page('/nothing-here')).status).toBe(404)
  })
})

describe('what the head of a page says', () => {
  beforeEach(async () => {
    await note(
      'Plan.md',
      '---\ndescription: What we decided.\ndate: 2026-03-04\n---\n\n# The plan\n\nWe shipped it.\n',
    )
    await note('Bare.md', '# Bare\n\nThe first sentence of it.\n')
    await publish()
  })

  test('the title, the description and where the page lives', async () => {
    const said = (await page('/plan')).text

    expect(said).toContain('<title>The plan</title>')
    expect(said).toContain('<meta name="description" content="What we decided.">')
    expect(said).toContain(`<link rel="canonical" href="https://${HOST}/plan">`)
  })

  test('the card a shared link shows', async () => {
    const said = (await page('/plan')).text

    expect(said).toContain('<meta property="og:type" content="article">')
    expect(said).toContain('<meta property="og:title" content="The plan">')
    expect(said).toContain('<meta property="og:site_name" content="Field notes">')
    expect(said).toContain('<meta name="twitter:card" content="summary">')
    expect(said).toContain('<meta property="article:published_time" content="2026-03-04">')
  })

  test('a description nobody wrote is the first words of the note', async () => {
    const said = (await page('/bare')).text
    expect(said).toContain('<meta name="description" content="The first sentence of it.">')
  })

  test('the site’s own description stands in where a note has neither', async () => {
    await setSite({ description: 'Notes from the field.' })
    await note('Empty.md', '# Empty\n')

    const said = (await page('/empty')).text
    expect(said).toContain('<meta name="description" content="Notes from the field.">')
  })

  test('the feed and the icon are linked from every page', async () => {
    const said = (await page('/plan')).text

    expect(said).toContain('rel="alternate" type="application/atom+xml"')
    expect(said).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg">')
  })

  test('a picture the note names becomes the card', async () => {
    // `/i/<hash>` is where a picture in a note already lives, so that is what a
    // note names; an address of somebody else's is taken as it was written.
    await note('Shown.md', '---\nimage: /i/abc123.png\n---\n\n# Shown\n')

    const said = (await page('/shown')).text
    expect(said).toContain(`<meta property="og:image" content="https://${HOST}/i/abc123.png">`)
    expect(said).toContain('<meta name="twitter:card" content="summary_large_image">')
  })

  test('and the first picture in it does where it names none', async () => {
    await note('Pictured.md', '# Pictured\n\n![a shot](/i/def456.png)\n')

    const said = (await page('/pictured')).text
    expect(said).toContain(`<meta property="og:image" content="https://${HOST}/i/def456.png">`)
  })
})

describe('what the machines read', () => {
  beforeEach(async () => {
    await note('One.md', '---\ndate: 2026-01-02\ndescription: The first.\n---\n\n# One\n')
    await note('Two.md', '---\ndate: 2026-05-06\n---\n\n# Two\n\nThe second one.\n')
    await publish()
  })

  test('the sitemap lists every page and the site itself', async () => {
    const said = (await page('/sitemap.xml')).text

    expect(said).toContain(`<loc>https://${HOST}/</loc>`)
    expect(said).toContain(`<loc>https://${HOST}/one</loc>`)
    expect(said).toContain(`<loc>https://${HOST}/two</loc>`)
  })

  test('the feed is newest first, with what each page says of itself', async () => {
    const answer = await page('/feed.xml')

    expect(answer.headers.get('content-type')).toContain('application/atom+xml')
    expect(answer.text.indexOf('<title>Two</title>')).toBeLessThan(
      answer.text.indexOf('<title>One</title>'),
    )
    expect(answer.text).toContain('<summary>The first.</summary>')
    expect(answer.text).toContain('<summary>The second one.</summary>')
  })

  test('a note the rules leave out is in neither', async () => {
    await setSite({ rules: { exclude: ['One.md'], otherwise: 'all' } })

    expect((await page('/sitemap.xml')).text).not.toContain('/one<')
    expect((await page('/feed.xml')).text).not.toContain('<title>One</title>')
  })

  test('robots points at the sitemap', async () => {
    const said = (await page('/robots.txt')).text

    expect(said).toContain('Allow: /')
    expect(said).toContain(`Sitemap: https://${HOST}/sitemap.xml`)
  })

  test('and says no to everything on a site behind a password', async () => {
    await setSite({ password: 'open sesame' })

    expect((await page('/robots.txt')).text).toContain('Disallow: /')
  })
})

describe('the icon a tab shows', () => {
  test('is the letter of the site until one is chosen', async () => {
    await publish()

    const answer = await page('/favicon.svg')
    expect(answer.headers.get('content-type')).toContain('image/svg+xml')
    expect(answer.text).toContain('>F<')
  })

  test('and the drawing the app sent once there is one', async () => {
    await publish()
    await setSite({ icon: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="8"/></svg>' })

    expect((await page('/favicon.svg')).text).toContain('<circle r="8"/>')
  })

  test('anything that is not a drawing is not kept', async () => {
    await publish()
    await setSite({ icon: 'javascript:alert(1)' })

    expect((await page('/favicon.svg')).text).toContain('>F<')
  })

  /** An SVG is a document, and this one is the author's own markup on a host under
   *  the shared domain: opened on its own it is a page there. The same policy a
   *  diagram gets from /i/; see `SVG_POLICY`. */
  test('and is sandboxed, because a drawing opened on its own is a document', async () => {
    await publish()
    await setSite({ icon: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="8"/></svg>' })

    const answer = await page('/favicon.svg')
    expect(answer.headers.get('content-security-policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    )
    expect(answer.headers.get('x-content-type-options')).toBe('nosniff')
  })
})

describe('a site behind a password', () => {
  const PASSWORD = 'the quiet part'

  beforeEach(async () => {
    await note('Plan.md', '# Plan\n\nWords.\n')
    await publish()
    await setSite({ password: PASSWORD })
  })

  test('shows one form and none of the notes', async () => {
    const answer = await page('/plan')

    expect(answer.status).toBe(200)
    expect(answer.text).toContain('type="password"')
    expect(answer.text).not.toContain('Words.')
    expect(answer.text).toContain('name="robots" content="noindex, nofollow"')
    expect(answer.headers.get('cache-control')).toContain('no-store')
  })

  test('the form is the one thing on the page that may run or reach anywhere', async () => {
    const answer = await page('/plan')
    const policy = answer.headers.get('content-security-policy') ?? ''

    // A form that posts to this site and nowhere else, and not one script: the
    // page behind the password has the furniture, the form does not.
    expect(policy).toContain("form-action 'self'")
    expect(policy).toContain("script-src 'none'")
    expect(policy).toContain("connect-src 'none'")
  })

  /** A guess costs the reader nothing and costs the service a hundred thousand
   *  rounds of PBKDF2. Counted per machine at this site, and answered the way a
   *  wrong password is: saying "too many tries" would tell a guesser that the tries
   *  are being counted. */
  test('and a machine that keeps guessing stops being answered', async () => {
    const guess = (password: string) =>
      page('/plan', {
        method: 'POST',
        raw: `password=${encodeURIComponent(password)}`,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'cf-connecting-ip': '198.51.100.7',
        },
      })

    for (let at = 0; at < 20; at++) expect((await guess('wrong')).status).toBe(401)

    // The right one, from the machine that has spent its tries.
    const refused = await guess(PASSWORD)
    expect(refused.status).toBe(401)
    expect(refused.headers.get('set-cookie')).toBeNull()

    // And somebody else at the same site is unaffected: the ceiling is theirs.
    const other = await page('/plan', {
      method: 'POST',
      raw: `password=${encodeURIComponent(PASSWORD)}`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'cf-connecting-ip': '198.51.100.8',
      },
    })
    expect(other.status).toBe(303)
  })

  test('a wrong password says so and lets nobody in', async () => {
    const answer = await page('/plan', {
      method: 'POST',
      raw: 'password=wrong',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })

    expect(answer.status).toBe(401)
    expect(answer.text).toContain('not the password')
    expect(answer.headers.get('set-cookie')).toBeNull()
  })

  test('the right one hands over a ticket that opens the site', async () => {
    const answer = await page('/plan', {
      method: 'POST',
      raw: `password=${encodeURIComponent(PASSWORD)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })

    expect(answer.status).toBe(303)
    expect(answer.headers.get('location')).toBe('/plan')

    const cookie = answer.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('HttpOnly')

    const ticket = cookie.split(';')[0] ?? ''
    const read = await page('/plan', { headers: { cookie: ticket } })
    expect(read.status).toBe(200)
    expect(read.text).toContain('Words.')

    // And the page behind the password is that reader's own to hold: a shared
    // cache that kept it would hand it to the next reader with no password at all.
    expect(read.headers.get('cache-control')).toBe('private, no-store')
  })

  /** Every answer on a site behind a password, not only the gate: the feed and the
   *  sitemap are the site's words too. */
  test('and nothing a site behind a password answers is a shared cache’s', async () => {
    const answer = await page('/plan', {
      method: 'POST',
      raw: `password=${encodeURIComponent(PASSWORD)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })
    const ticket = (answer.headers.get('set-cookie') ?? '').split(';')[0] ?? ''

    for (const path of ['/', '/plan', '/feed.xml', '/sitemap.xml', '/search?q=words']) {
      const read = await page(path, { headers: { cookie: ticket } })
      expect(read.headers.get('cache-control'), path).toBe('private, no-store')
    }
  })

  test('a ticket somebody made up opens nothing', async () => {
    const read = await page('/plan', {
      headers: { cookie: `nib_site=${Date.now() + 1000}.${'0'.repeat(64)}` },
    })

    expect(read.text).toContain('type="password"')
  })

  test('a new password ends every ticket the old one gave out', async () => {
    const answer = await page('/plan', {
      method: 'POST',
      raw: `password=${encodeURIComponent(PASSWORD)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })
    const ticket = (answer.headers.get('set-cookie') ?? '').split(';')[0] ?? ''

    await setSite({ password: 'something else' })

    const read = await page('/plan', { headers: { cookie: ticket } })
    expect(read.text).toContain('type="password"')
  })

  test('and taking it off opens the site again', async () => {
    await setSite({ password: null })

    const read = await page('/plan')
    expect(read.status).toBe(200)
    expect(read.text).toContain('Words.')
  })

  test('the account is never told what the password is', async () => {
    const listed = await call(env, '/v1/spaces', { token })
    const held = listed.json.spaces.find((one) => one.id === space)

    expect(held?.blog.site.password).toBe(true)
    expect(JSON.stringify(held)).not.toContain(PASSWORD)
  })
})

describe('the notes that came before', () => {
  /** A row as it would have been written before there was anywhere to keep what
   *  a note says about itself. */
  async function unread(path: string, content: string) {
    const made = await note(path, content)
    env.db.prepare('update notes set front = null where id = ?').run(made.id)
    return made
  }

  test('are read before the space is published', async () => {
    await unread('Old.md', '---\npublish: false\n---\n\n# Old\n')
    await publish()

    expect((await page('/old')).status).toBe(404)
  })

  test('and before the rules that ask about them take effect', async () => {
    await publish()
    await unread('Later.md', '---\npublish: false\n---\n\n# Later\n')

    await setSite({ rules: { otherwise: 'all' } })
    expect((await page('/later')).status).toBe(404)
  })

  test('and before a preview says what will happen', async () => {
    await publish()
    await unread('Quiet.md', '---\npublish: false\n---\n\n# Quiet\n')

    const asked = await call(env, `/v1/spaces/${space}/site/preview`, {
      token,
      body: { rules: { otherwise: 'all' } },
    })

    expect(asked.json.pages).toBe(0)
  })
})

describe('what somebody who is not the owner is told about the site', () => {
  beforeEach(async () => {
    await note('One.md', '# One\n')
    // A domain of one's own, because one of the records it wants is the TXT
    // token that proves the domain is this account's.
    await publish({ domain: 'notes.example.com' })
    await setSite({ password: 'the quiet part', description: 'Notes from the field.' })
  })

  test('the owner is told what to add at the registrar', async () => {
    const listed = await call(env, '/v1/spaces', { token })
    const held = listed.json.spaces.find((one) => one.id === space)

    expect(held?.blog.dns.some((one) => one.type === 'TXT')).toBe(true)
    expect(held?.blog.site.password).toBe(true)
  })

  test('a guest is told neither the proof nor the site', async () => {
    const made = await call<ShareView>(env, `/v1/spaces/${space}/share/link`, {
      method: 'PUT',
      token,
      body: { role: 'read', mode: 'open' },
    })
    const link = /\/join\/([a-f0-9]+)/.exec(made.json.link?.url ?? '')?.[1] ?? ''
    const guest = (await call(env, `/v1/join/${link}`, { method: 'POST' })).json.token

    const listed = await call(env, '/v1/spaces', { token: guest })
    const held = listed.json.spaces.find((one) => one.id === space)

    expect(held?.id).toBe(space)
    expect(held?.blog.dns).toEqual([])
    expect(JSON.stringify(held)).not.toContain('_nib-verify')
    expect(held?.blog.site.password).toBe(false)
    expect(held?.blog.site.description).toBeUndefined()
  })

  test('and neither is a program acting for the owner', async () => {
    const minted = await call(env, '/v1/mcp/token', { token, body: {} })
    const program = minted.json.token

    const listed = await call(env, '/v1/spaces', { token: program })
    const held = listed.json.spaces.find((one) => one.id === space)

    expect(held?.blog.dns).toEqual([])
    expect(JSON.stringify(held)).not.toContain('_nib-verify')
  })
})
