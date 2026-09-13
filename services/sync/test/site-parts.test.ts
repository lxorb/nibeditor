import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { asked, hasWords } from '../src/blog/find'
import { answersFrom, asCsv, formOf, formHtml } from '../src/blog/form'
import { around, backlinks, inOrder, type Listed, navigation } from '../src/blog/nav'
import { plainWords } from '../src/blog/words'
import { call, signIn, testEnv, type TestEnv } from './harness'

/** The second half of publishing: what a reader of a site is given besides the
 *  note. The pieces on their own here, and the whole site through a hostname in
 *  site.test.ts. */

/** One page of an imaginary site, as the navigation and the backlinks read it. */
function page(path: string, front: Listed['front'] = {}): Listed {
  const title = path.replace(/\.md$/, '').split('/').pop() ?? path
  return { slug: path.replace(/\.md$/, '').toLowerCase(), title, path, front }
}

describe('what a reader typed into the search box', () => {
  test('is words, a phrase, a refusal, a tag and a folder', () => {
    const one = asked('rust "the plan" -draft tag:work path:Notes')

    expect(one.words).toEqual(['rust'])
    expect(one.phrases).toEqual(['the plan'])
    expect(one.without).toEqual(['draft'])
    expect(one.tags).toEqual(['work'])
    expect(one.folders).toEqual(['notes'])
  })

  test('a hash on a tag is the same tag', () => {
    expect(asked('tag:#work').tags).toEqual(['work'])
  })

  test('nothing to ask the index about is said out loud', () => {
    expect(hasWords(asked('tag:work'))).toBe(false)
    expect(hasWords(asked('plan'))).toBe(true)
  })

  test('a word that would steer the query is a word', () => {
    // FTS5 reads `AND`, `NOT` and a bracket as syntax, so every word is quoted
    // before it gets there; what a reader typed is what is searched for.
    expect(asked('AND (NOT)').words).toEqual(['AND', '(NOT)'])
  })
})

describe('the words a note is indexed by', () => {
  test('are its prose, not its markup', () => {
    const said = plainWords(
      [
        '---',
        'title: The plan',
        '---',
        '# The plan',
        '',
        'We **shipped** it, see [the note](notes/one) and [[another]].',
        '',
        '```js',
        'const secret = 1',
        '```',
        '',
        '![a shot](/i/abc.png)',
      ].join('\n'),
    )

    expect(said).toContain('We shipped it')
    expect(said).toContain('the note')
    expect(said).toContain('another')
    expect(said).not.toContain('const secret')
    expect(said).not.toContain('/i/abc.png')
    expect(said).not.toContain('title: The plan')
  })
})

describe('the navigation down the left', () => {
  const pages = [
    page('One.md', { order: 2 }),
    page('Two.md', { order: 1 }),
    page('Work/Deep.md'),
    page('Work/Early.md', { order: 0 }),
  ]

  test('reads a level at a time: its pages in order, then its folders', () => {
    // The pages of a level first, ordered by what they say and then by name,
    // and the folders under it after them - which is the order the column shows
    // and therefore the order previous and next follow.
    expect(inOrder(pages).map((one) => one.path)).toEqual([
      'Two.md',
      'One.md',
      'Work/Early.md',
      'Work/Deep.md',
    ])
  })

  test('draws a folder as a disclosure, open where the reader is inside it', () => {
    const inside = navigation(pages, 'work/deep')
    expect(inside).toContain('<details open><summary>Work</summary>')
    expect(inside).toContain('aria-current="page"')

    expect(navigation(pages, 'one')).toContain('<details><summary>Work</summary>')
  })

  test('and the page before and after, across folders', () => {
    const { before, after } = around(pages, 'one')

    expect(before?.path).toBe('Two.md')
    expect(after?.path).toBe('Work/Early.md')
  })
})

describe('what links to a page', () => {
  test('is read off what each page said about itself', () => {
    const pages = [
      page('Plan.md'),
      page('Notes/One.md', { links: ['plan'] }),
      page('Notes/Two.md', { links: ['notes/one'] }),
    ]

    const said = backlinks(pages, page('Plan.md'))
    expect(said).toContain('Linked from')
    expect(said).toContain('href="/notes/one"')
    expect(said).not.toContain('href="/notes/two"')
    expect(backlinks(pages, page('Notes/Two.md'))).toBe('')
  })

  test('and an alias counts as a name for it', () => {
    const pages = [
      page('Plan.md', { aliases: ['the-plan'] }),
      page('One.md', { links: ['the-plan'] }),
    ]

    expect(backlinks(pages, pages[0]!)).toContain('One')
  })

  test('never a page the site does not publish', () => {
    // The list is the published pages, so a private note that links here is not
    // in it and cannot be named. This is the whole reason backlinks are built
    // from the site's own list rather than from a link index.
    const pages = [page('Plan.md')]
    expect(backlinks(pages, pages[0]!)).toBe('')
  })
})

describe('a form in a note', () => {
  const fence = [
    'title: Say hello',
    'send: Send it',
    'fields:',
    '  - Your name',
    '  - Your email: email',
    '  - * What you want to say: lines',
    '  - Which day: choice Monday | Tuesday',
  ].join('\n')

  test('is read as the questions it asks', () => {
    const form = formOf(fence)

    expect(form?.title).toBe('Say hello')
    expect(form?.send).toBe('Send it')
    expect(form?.fields.map((one) => [one.label, one.kind, one.required])).toEqual([
      ['Your name', 'text', false],
      ['Your email', 'email', false],
      ['What you want to say', 'lines', true],
      ['Which day', 'choice', false],
    ])
    expect(form?.fields[3]?.choices).toEqual(['Monday', 'Tuesday'])
  })

  test('a fence that is not a form stays a fence', () => {
    expect(formOf('const a = 1')).toBeNull()
    expect(formOf('fields:')).toBeNull()
  })

  test('is drawn as a form that posts to the note that asked', () => {
    const html = formHtml(formOf(fence)!, 'note-1', false, null)

    expect(html).toContain('method="post" action="/form/note-1"')
    expect(html).toContain('<textarea name="what-you-want-to-say" rows="4" required>')
    expect(html).toContain('<option>Monday</option>')
    expect(html).toContain('Send it')
  })

  test('and says thank you where the answer landed', () => {
    expect(formHtml(formOf(fence)!, 'note-1', true, null)).toContain('Thank you')
  })

  test('reads an answer against the questions, not as it arrives', () => {
    const form = formOf(fence)!
    const sent = new FormData()
    sent.set('your-name', 'Ada')
    sent.set('what-you-want-to-say', 'Hello')
    sent.set('nothing-asked', 'dropped')

    const read = answersFrom(form, sent)
    expect(read).toEqual({ answers: { 'Your name': 'Ada', 'What you want to say': 'Hello' } })
  })

  test('refuses a question it needs answered', () => {
    const sent = new FormData()
    sent.set('your-name', 'Ada')

    expect(answersFrom(formOf(fence)!, sent)).toEqual({ wrong: 'What you want to say is needed.' })
  })

  test('and an address that is not one', () => {
    const sent = new FormData()
    sent.set('your-email', 'ada')
    sent.set('what-you-want-to-say', 'Hello')

    expect(answersFrom(formOf(fence)!, sent)).toEqual({
      wrong: 'Your email does not look like an address.',
    })
  })

  test('the answers become a spreadsheet, one column per question', () => {
    const csv = asCsv([
      { at: 0, answers: { 'Your name': 'Ada', 'What you want to say': 'Hello' } },
      { at: 1000, answers: { 'Your name': 'Grace' } },
    ])

    expect(csv.split('\n')[0]).toBe('"when","Your name","What you want to say"')
    expect(csv).toContain('"Ada","Hello"')
    expect(csv).toContain('"Grace",""')
  })
})

describe('a site with forms on it', () => {
  let env: TestEnv
  let token: string
  let space: string
  let note: string

  const HOST = 'field.nibeditor.com'
  const FENCE = ['```form', 'title: Say hello', 'fields:', '  - * Your name', '```'].join('\n')

  beforeEach(async () => {
    env = testEnv()
    token = await signIn(env, 'a@b.dev')

    const made = await call(env, '/v1/spaces', { token, body: { name: 'Field notes' } })
    space = made.json.space.id

    const wrote = await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'Hello.md', content: `# Hello\n\n${FENCE}\n` },
    })
    note = wrote.json.note.id

    await call(env, `/v1/spaces/${space}/blog`, {
      method: 'PUT',
      token,
      body: { subdomain: 'field' },
    })
  })

  afterEach(() => env.close())

  test('draws the form on the page', async () => {
    const answer = await call(env, '/hello', { host: HOST })

    expect(answer.text).toContain(`action="/form/${note}"`)
    expect(answer.text).toContain('Your name *')
  })

  test('takes an answer and sends the reader back to the page', async () => {
    const sent = await call(env, `/form/${note}`, {
      host: HOST,
      method: 'POST',
      raw: 'your-name=Ada',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })

    expect(sent.status).toBe(303)
    expect(sent.headers.get('location')).toBe(`/hello?sent=${note}`)

    const held = await call(env, `/v1/spaces/${space}/answers`, { token })
    expect(held.json.answers).toHaveLength(1)
    expect(held.json.answers[0]?.answers).toEqual({ 'Your name': 'Ada' })
  })

  test('and says so on the page it comes back to', async () => {
    const answer = await call(env, `/hello?sent=${note}`, { host: HOST })
    expect(answer.text).toContain('Thank you')
  })

  test('refuses an answer the form did not ask for', async () => {
    const sent = await call(env, `/form/${note}`, {
      host: HOST,
      method: 'POST',
      raw: 'nothing=asked',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })

    expect(sent.headers.get('location')).toContain('wrong=')

    const held = await call(env, `/v1/spaces/${space}/answers`, { token })
    expect(held.json.answers).toEqual([])
  })

  test('never takes one for a note the site does not publish', async () => {
    await call(env, `/v1/spaces/${space}/site`, {
      method: 'PUT',
      token,
      body: { rules: { exclude: ['Hello.md'], otherwise: 'all' } },
    })

    const sent = await call(env, `/form/${note}`, {
      host: HOST,
      method: 'POST',
      raw: 'your-name=Ada',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })

    expect(sent.status).toBe(404)
  })

  test('the answers are the owner’s alone', async () => {
    const other = await signIn(env, 'c@d.dev')
    const refused = await call(env, `/v1/spaces/${space}/answers`, { token: other })

    expect(refused.status).toBe(404)
  })

  test('and come back as a spreadsheet as well', async () => {
    await call(env, `/form/${note}`, {
      host: HOST,
      method: 'POST',
      raw: 'your-name=Ada',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })

    const csv = await call(env, `/v1/spaces/${space}/answers.csv`, { token })
    expect(csv.headers.get('content-type')).toContain('text/csv')
    expect(csv.text).toContain('"Your name"')
    expect(csv.text).toContain('"Ada"')
  })

  test('and the theme the author chose is linked after the site’s own sheet', async () => {
    // The app has the themes installed, so the app sends the stylesheet up as a
    // blob and the site keeps its name and hash; the page links it from where
    // every other blob is served, and after its own sheet so it wins.
    const hash = 'a'.repeat(64)
    await call(env, `/v1/spaces/${space}/site`, {
      method: 'PUT',
      token,
      body: { theme: { name: 'Paper', hash } },
    })

    const answer = await call(env, '/hello', { host: HOST })
    expect(answer.text).toContain(`/i/${hash}.css`)
    expect(answer.text.indexOf(`/i/${hash}.css`)).toBeGreaterThan(answer.text.indexOf('/s/'))
  })
})

/** A form on a site behind a password. The answer is taken before the gate, so
 *  that a reader who is through it can send one - and a reader who is not never
 *  spends one of their tries at the password by sending it. */
describe('a form on a site behind a password', () => {
  let env: TestEnv
  let token: string
  let space: string
  let note: string

  const HOST = 'field.nibeditor.com'
  const PASSWORD = 'the quiet part'
  const FENCE = ['```form', 'title: Say hello', 'fields:', '  - * Your name', '```'].join('\n')

  const sending = (headers: Record<string, string> = {}) =>
    call(env, `/form/${note}`, {
      host: HOST,
      method: 'POST',
      raw: 'your-name=Ada',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    })

  /** The ticket a reader who typed the password carries. */
  async function letIn(headers: Record<string, string> = {}) {
    return call(env, '/hello', {
      host: HOST,
      method: 'POST',
      raw: `password=${encodeURIComponent(PASSWORD)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    })
  }

  const answers = async () =>
    (await call(env, `/v1/spaces/${space}/answers`, { token })).json.answers

  beforeEach(async () => {
    env = testEnv()
    token = await signIn(env, 'a@b.dev')

    const made = await call(env, '/v1/spaces', { token, body: { name: 'Field notes' } })
    space = made.json.space.id

    const wrote = await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'Hello.md', content: `# Hello\n\n${FENCE}\n` },
    })
    note = wrote.json.note.id

    await call(env, `/v1/spaces/${space}/blog`, {
      method: 'PUT',
      token,
      body: { subdomain: 'field' },
    })

    await call(env, `/v1/spaces/${space}/site`, {
      method: 'PUT',
      token,
      body: { password: PASSWORD },
    })
  })

  afterEach(() => env.close())

  test('is taken from a reader who is through the gate', async () => {
    const ticket = ((await letIn()).headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    const sent = await sending({ cookie: ticket })

    expect(sent.status).toBe(303)
    expect(sent.headers.get('location')).toBe(`/hello?sent=${note}`)
    expect(await answers()).toHaveLength(1)
  })

  test('and a reader who is not lands back on the form', async () => {
    const sent = await sending()

    expect(sent.status).toBe(303)
    expect(sent.headers.get('location')).toBe('/')
    expect(await answers()).toEqual([])
  })

  test('and sending one is never a guess at the password', async () => {
    const machine = { 'cf-connecting-ip': '198.51.100.9' }
    for (let at = 0; at < 20; at++) expect((await sending(machine)).status).toBe(303)

    // Every try at the password is still there: the answers spent none of them.
    const said = await letIn(machine)

    expect(said.status).toBe(303)
    expect(said.headers.get('set-cookie')).toContain('nib_site=')
  })
})
