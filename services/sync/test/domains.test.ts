import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { recheckDomains } from '../src/spaces/proof'
import { fakeCloudflare, TOKEN, ZONE } from './cloudflare'
import { call, signIn, testEnv, type TestEnv } from './harness'

let env: TestEnv
let token: string
let space: string
let cloudflare: ReturnType<typeof fakeCloudflare>

beforeEach(async () => {
  cloudflare = fakeCloudflare()
  cloudflare.install()

  env = testEnv({ CF_API_TOKEN: TOKEN, CF_ZONE_ID: ZONE })
  token = await signIn(env, 'a@b.dev')

  const created = await call(env, '/v1/spaces', { token, body: { name: 'Field notes' } })
  space = created.json.space.id
  await call(env, `/v1/spaces/${space}/notes`, {
    token,
    body: { path: 'Hello.md', content: '# Hello\n' },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  env.close()
})

async function publish(body: Record<string, unknown>, id = space, as = token) {
  return call(env, `/v1/spaces/${id}/blog`, { method: 'PUT', token: as, body })
}

async function status(id = space, as = token) {
  return call(env, `/v1/spaces/${id}/blog/domain`, { token: as })
}

function verify(id = space, as = token) {
  return call(env, `/v1/spaces/${id}/blog/domain/verify`, { method: 'POST', token: as })
}

/** The record the space asks for, which is what the pane shows the owner. */
async function wanted(id = space, as = token) {
  const record = (await status(id, as)).json.dns.find((one) => one.type === 'TXT')
  if (!record) throw new Error('no record was asked for')
  return record
}

/** The owner adding the record at their registrar and pressing Verify, which is
 *  the whole of proving a domain. */
async function prove(id = space, as = token) {
  const record = await wanted(id, as)
  cloudflare.txt(record.name, [record.value])
  return await verify(id, as)
}

/** A domain published and proved, which is where most of the cases below start:
 *  nothing at all happens with Cloudflare until it has been. */
async function published(domain = 'notes.example.com') {
  await publish({ domain })
  return await prove()
}

describe("a domain of one's own", () => {
  test('is asked of Cloudflare, validated over HTTP', async () => {
    await published()

    const hostname = cloudflare.hostnames.get('notes.example.com')
    expect(hostname).toBeDefined()
    expect(hostname!.ssl.method).toBe('http')
    expect(hostname!.ssl.type).toBe('dv')
  })

  test('is pending until the record is in place', async () => {
    await published()

    const response = await status()
    expect(response.status).toBe(200)
    expect(response.json.domain).toBe('notes.example.com')
    expect(response.json.state).toBe('pending')
    expect(response.json.dns).toEqual([
      expect.objectContaining({
        type: 'CNAME',
        name: 'notes.example.com',
        value: 'cname.nibeditor.com',
      }),
      expect.objectContaining({ type: 'TXT', name: '_nib-verify.notes.example.com' }),
    ])
  })

  test('relays what Cloudflare is waiting for, without calling it an error', async () => {
    await published()
    cloudflare.complain('notes.example.com', 'custom hostname does not CNAME to this zone.')

    const response = await status()
    expect(response.json.state).toBe('pending')
    expect(response.json.detail).toBe('custom hostname does not CNAME to this zone.')
  })

  test('is active once the certificate is out', async () => {
    await published()
    cloudflare.activate('notes.example.com')

    expect((await status()).json.state).toBe('active')
  })

  test('is an error once Cloudflare has given up', async () => {
    await published()
    cloudflare.timeOut('notes.example.com')

    const response = await status()
    expect(response.json.state).toBe('error')
    expect(response.json.detail).toBeTruthy()
  })

  test('is an error when the record was taken away again', async () => {
    await published()
    cloudflare.activate('notes.example.com')
    cloudflare.move('notes.example.com')

    expect((await status()).json.state).toBe('error')
  })

  test('is asked for again when Cloudflare has no record of it', async () => {
    // A domain set before certificates were handed out, or while Cloudflare
    // was unreachable, catches up the first time anyone asks after it.
    await published()
    cloudflare.hostnames.clear()

    expect((await status()).json.state).toBe('pending')
    expect(cloudflare.hostnames.has('notes.example.com')).toBe(true)
  })

  test('is not asked for twice', async () => {
    await published()
    await publish({ domain: 'notes.example.com', title: 'Renamed' })
    await status()

    expect(cloudflare.calls.filter((one) => one.startsWith('POST'))).toHaveLength(1)
  })

  test('keeps its proof when something else about the blog changes', async () => {
    await published()
    await publish({ domain: 'notes.example.com', title: 'Renamed' })

    expect((await status()).json.state).not.toBe('unproved')
  })

  test('is released when the space goes back to a shared name', async () => {
    await published()
    await publish({ subdomain: 'field' })

    expect(cloudflare.hostnames.has('notes.example.com')).toBe(false)
  })

  test('is released when publishing stops', async () => {
    await published()
    await call(env, `/v1/spaces/${space}/blog`, { method: 'DELETE', token })

    expect(cloudflare.hostnames.has('notes.example.com')).toBe(false)
    expect((await status()).json.state).toBe('none')
  })

  test('is released when the space is deleted', async () => {
    await published()
    await call(env, `/v1/spaces/${space}`, { method: 'DELETE', token })

    expect(cloudflare.hostnames.has('notes.example.com')).toBe(false)
  })

  test('is swapped when the domain changes, and the new one starts unproved', async () => {
    await published()
    await publish({ domain: 'blog.example.com' })

    expect(cloudflare.hostnames.has('notes.example.com')).toBe(false)
    // Nothing is asked of Cloudflare for a name this account has not shown is
    // theirs, which is the whole point of the record.
    expect(cloudflare.hostnames.has('blog.example.com')).toBe(false)
    expect((await status()).json.state).toBe('unproved')

    await prove()
    expect(cloudflare.hostnames.has('blog.example.com')).toBe(true)
  })

  test('cannot be held by two spaces once one of them has proved it', async () => {
    await published()

    const other = await signIn(env, 'other@b.dev')
    const theirs = await call(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })
    const response = await publish({ domain: 'notes.example.com' }, theirs.json.space.id, other)

    expect(response.status).toBe(409)
    expect(response.json.error).toBe('that domain is taken')
    expect(cloudflare.hostnames.size).toBe(1)
  })

  test('is recorded even when Cloudflare refuses, and the refusal is reported', async () => {
    // Someone else's zone already holds the hostname, say. The row is the
    // truth; the status is where the trouble shows.
    cloudflare.refuse('notes.example.com', 'The hostname is already on Cloudflare in another zone.')

    const response = await publish({ domain: 'notes.example.com' })
    expect(response.status).toBe(200)
    expect(response.json.space.blog.domain).toBe('notes.example.com')

    await prove()
    const reported = await status()
    expect(reported.json.state).toBe('error')
    expect(reported.json.detail).toBe('The hostname is already on Cloudflare in another zone.')
  })

  test('cannot be the shared domain itself, which is the app', async () => {
    const response = await publish({ domain: 'nibeditor.com' })

    expect(response.status).toBe(400)
    expect(response.json.error).toBe('use a domain of your own')
    expect(cloudflare.hostnames.size).toBe(0)
  })

  test('cannot be a name under the shared domain either', async () => {
    expect((await publish({ domain: 'evil.nibeditor.com' })).status).toBe(400)
    expect((await publish({ domain: 'www.nibeditor.com' })).status).toBe(400)
  })

  test('cannot be the shared domain with a trailing dot', async () => {
    // The same host, written the way a resolver writes it. Left as it was, the
    // name got past the check and a certificate was asked for inside the zone.
    expect((await publish({ domain: 'nibeditor.com.' })).status).toBe(400)
    expect((await publish({ domain: 'EVIL.NIBEDITOR.COM.' })).status).toBe(400)
    expect(cloudflare.hostnames.size).toBe(0)
  })

  test('cannot be longer than a domain name may be', async () => {
    // Every label is legal on its own; the whole is past what DNS carries, and
    // a name that can never resolve is not an address.
    const long = `${Array.from({ length: 4 }, () => 'a'.repeat(63)).join('.')}.com`
    expect(long.length).toBeGreaterThan(253)

    const response = await publish({ domain: long })
    expect(response.status).toBe(400)
    expect(response.json.error).toBe('that does not look like a domain')
    expect(cloudflare.hostnames.size).toBe(0)
  })

  test('takes a scheme and a path off what was pasted', async () => {
    const response = await publish({ domain: ' HTTPS://Notes.Example.com/blog ' })

    expect(response.status).toBe(200)
    expect(response.json.space.blog.domain).toBe('notes.example.com')
  })

  test('is not reported to anyone but the owner, and neither is proving it', async () => {
    await publish({ domain: 'notes.example.com' })
    const other = await signIn(env, 'other@b.dev')

    expect((await verify(space, other)).status).toBe(404)
  })

  test('is never served on the shared domain, whatever the row says', async () => {
    // Belt and braces: a row that somehow names the app's own host must not
    // put a blog in front of the app for everyone.
    await publish({ subdomain: 'field' })
    env.db
      .prepare('update spaces set blog_subdomain = null, blog_domain = ? where id = ?')
      .run('nibeditor.com', space)

    const response = await call(env, '/', { host: 'nibeditor.com' })
    expect(response.text).not.toContain('Field notes')
  })

  test('has nothing to report while the space has no domain', async () => {
    await publish({ subdomain: 'field' })

    const response = await status()
    expect(response.json).toEqual({ domain: null, state: 'none', detail: null, dns: [] })
  })

  test('is not reported to anyone but the owner', async () => {
    await publish({ domain: 'notes.example.com' })
    const other = await signIn(env, 'other@b.dev')

    expect((await status(space, other)).status).toBe(404)
  })
})

describe('proving a domain is yours', () => {
  const RECORD = '_nib-verify.notes.example.com'

  test('a claim serves nothing until the record is there', async () => {
    await publish({ domain: 'notes.example.com' })

    const page = await call(env, '/', { host: 'notes.example.com' })
    expect(page.text).not.toContain('Field notes')

    await prove()
    const served = await call(env, '/', { host: 'notes.example.com' })
    expect(served.text).toContain('Hello')
  })

  test('and asks Cloudflare for nothing either', async () => {
    await publish({ domain: 'notes.example.com' })

    expect(cloudflare.calls).toEqual([])
    expect((await status()).json.state).toBe('unproved')
  })

  test('the record to add names the domain and carries a token', async () => {
    await publish({ domain: 'notes.example.com' })
    const record = await wanted()

    expect(record.name).toBe(RECORD)
    expect(record.value).toMatch(/^nib-verify=[a-f0-9]{64}$/)
  })

  test('a token is one space’s own', async () => {
    await publish({ domain: 'notes.example.com' })
    const mine = (await wanted()).value

    const other = await signIn(env, 'other@b.dev')
    const theirs = (await call(env, '/v1/spaces', { token: other, body: { name: 'Theirs' } })).json
      .space.id
    await publish({ domain: 'blog.example.org' }, theirs, other)

    expect((await wanted(theirs, other)).value).not.toBe(mine)
  })

  test('says so in one sentence while the record is not there', async () => {
    await publish({ domain: 'notes.example.com' })

    const refused = await verify()
    expect(refused.status).toBe(409)
    expect(refused.json.state).toBe('unproved')
    expect(refused.json.detail).toBe('that record is not answering yet')
  })

  test('and the same sentence when nobody could be asked', async () => {
    await publish({ domain: 'notes.example.com' })
    cloudflare.txt(RECORD, [(await wanted()).value])
    cloudflare.dnsDown()

    const refused = await verify()
    expect(refused.status).toBe(409)
    expect(refused.json.detail).toBe('that record is not answering yet')
  })

  test('is not proved by somebody else’s token at the right name', async () => {
    await publish({ domain: 'notes.example.com' })
    cloudflare.txt(RECORD, ['nib-verify=' + 'f'.repeat(64), 'v=spf1 -all'])

    expect((await verify()).status).toBe(409)
    expect((await status()).json.state).toBe('unproved')
  })

  test('is proved with the token among the other records at that name', async () => {
    await publish({ domain: 'notes.example.com' })
    cloudflare.txt(RECORD, ['something else', (await wanted()).value])

    expect((await verify()).status).toBe(200)
    expect((await status()).json.state).not.toBe('unproved')
  })

  test('a claim nobody has proved does not stand in the real owner’s way', async () => {
    // Somebody types a domain they do not hold. Nothing serves, and the answer
    // to the person who does hold it used to be "that domain is taken" for ever.
    const squatter = await signIn(env, 'squatter@b.dev')
    const theirs = (await call(env, '/v1/spaces', { token: squatter, body: { name: 'Squatted' } }))
      .json.space.id
    await publish({ domain: 'notes.example.com' }, theirs, squatter)

    const taken = await publish({ domain: 'notes.example.com' })
    expect(taken.status).toBe(200)

    // And the claim it took is gone from the space that could not prove it.
    const left = env.db
      .prepare('select blog_domain, blog_domain_token from spaces where id = ?')
      .get(theirs)
    expect(left).toEqual({ blog_domain: null, blog_domain_token: null })

    await prove()
    const served = await call(env, '/', { host: 'notes.example.com' })
    expect(served.text).toContain('Hello')
  })

  test('a proof stands while nothing has changed', async () => {
    await published()
    expect(await recheckDomains(env, Date.now())).toBe(0)
  })

  test('is read again once it has got old, and stamped afresh', async () => {
    await published()
    const before = proofAge()

    // A week on, with the record still where the owner put it.
    expect(await recheckDomains(env, before + WEEK + 1)).toBe(0)
    expect(proofAge()).toBe(before + WEEK + 1)
    expect(cloudflare.lookups.filter((one) => one === RECORD)).toHaveLength(2)
  })

  test('and the domain stops being served once the record has gone for weeks', async () => {
    await published()
    cloudflare.activate('notes.example.com')
    cloudflare.forgetTxt(RECORD)
    const before = proofAge()

    // A week on the record is missing, and a domain does not stop serving over
    // one bad answer: the proof is left where it was.
    expect(await recheckDomains(env, before + WEEK + 1)).toBe(0)
    expect((await call(env, '/', { host: 'notes.example.com' })).text).toContain('Hello')

    // Three weeks on it has been gone long enough to mean it.
    expect(await recheckDomains(env, before + 3 * WEEK + 1)).toBe(1)
    expect((await call(env, '/', { host: 'notes.example.com' })).text).not.toContain('Hello')
    expect(cloudflare.hostnames.has('notes.example.com')).toBe(false)
  })

  test('and nothing at all happens when the resolver cannot be reached', async () => {
    await published()
    const before = proofAge()
    cloudflare.dnsDown()

    expect(await recheckDomains(env, before + 4 * WEEK)).toBe(0)
    expect((await call(env, '/', { host: 'notes.example.com' })).text).toContain('Hello')
  })

  const WEEK = 7 * 24 * 60 * 60 * 1000

  /** When the proof was last seen, which is the stamp that lets it serve. */
  function proofAge(): number {
    const row = env.db
      .prepare('select blog_domain_verified_at as at from spaces where id = ?')
      .get(space) as { at: number }
    return row.at
  }
})

describe('without Cloudflare access', () => {
  let plain: TestEnv
  let plainToken: string
  let plainSpace: string

  beforeEach(async () => {
    plain = testEnv()
    plainToken = await signIn(plain, 'a@b.dev')
    const created = await call(plain, '/v1/spaces', { token: plainToken, body: { name: 'Local' } })
    plainSpace = created.json.space.id
  })

  afterEach(() => plain.close())

  test('a domain is recorded and nothing goes over the network', async () => {
    const response = await call(plain, `/v1/spaces/${plainSpace}/blog`, {
      method: 'PUT',
      token: plainToken,
      body: { domain: 'notes.example.com' },
    })

    expect(response.status).toBe(200)
    expect(response.json.space.blog.domain).toBe('notes.example.com')
    expect(cloudflare.calls).toEqual([])
  })

  test('the status says so, once the domain has been proved', async () => {
    await call(plain, `/v1/spaces/${plainSpace}/blog`, {
      method: 'PUT',
      token: plainToken,
      body: { domain: 'notes.example.com' },
    })

    const claimed = await call(plain, `/v1/spaces/${plainSpace}/blog/domain`, { token: plainToken })
    expect(claimed.json.state).toBe('unproved')
    expect(claimed.json.dns).toHaveLength(2)

    const record = claimed.json.dns.find((one) => one.type === 'TXT')!
    cloudflare.txt(record.name, [record.value])
    await call(plain, `/v1/spaces/${plainSpace}/blog/domain/verify`, {
      method: 'POST',
      token: plainToken,
    })

    const proved = await call(plain, `/v1/spaces/${plainSpace}/blog/domain`, { token: plainToken })
    expect(proved.json.state).toBe('unconfigured')
    expect(proved.json.dns).toHaveLength(2)
  })
})

describe('what to add at the registrar', () => {
  test('a name under a domain gets a CNAME to the shared target', async () => {
    const response = await publish({ domain: 'notes.example.com' })

    expect(response.json.dns).toEqual([
      expect.objectContaining({
        type: 'CNAME',
        name: 'notes.example.com',
        value: 'cname.nibeditor.com',
      }),
      expect.objectContaining({ type: 'TXT', name: '_nib-verify.notes.example.com' }),
    ])
  })

  test('the root of a domain gets the same target and a word about ALIAS records', async () => {
    const response = await publish({ domain: 'example.com' })

    expect(response.json.dns).toHaveLength(2)
    expect(response.json.dns[0]!.type).toBe('CNAME')
    expect(response.json.dns[0]!.value).toBe('cname.nibeditor.com')
    expect(response.json.dns[0]!.note).toMatch(/ALIAS/)
    expect(response.json.dns[1]!.name).toBe('_nib-verify.example.com')
  })

  test('never names a placeholder address', async () => {
    for (const domain of ['example.com', 'notes.example.com']) {
      const response = await publish({ domain })
      expect(JSON.stringify(response.json.dns)).not.toContain('192.0.2.')
    }
  })

  test('the target itself publishes nothing', async () => {
    await publish({ domain: 'notes.example.com' })

    const response = await call(env, '/', { host: 'cname.nibeditor.com' })
    expect(response.status).toBe(302)
  })

  test('a space id is not an address', async () => {
    // It used to be the CNAME target for a space without a name, which is
    // every space on a domain of its own now that no space has both.
    await publish({ domain: 'notes.example.com' })

    const response = await call(env, '/', { host: `${space}.nibeditor.com` })
    expect(response.status).toBe(302)
  })
})

describe('one address, never two', () => {
  const FOLDER = fileURLToPath(new URL('../migrations/', import.meta.url))
  const MIGRATIONS = readdirSync(FOLDER)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  const GUARD = MIGRATIONS.find((name) => name.startsWith('0009'))!

  test('the database refuses a row with both', () => {
    expect(() =>
      env.db
        .prepare('update spaces set blog_subdomain = ?, blog_domain = ? where id = ?')
        .run('field', 'notes.example.com', space),
    ).toThrow(/one address|CHECK constraint failed/)
  })

  test('the database refuses a new row with both', () => {
    expect(() =>
      env.db
        .prepare(
          `insert into spaces (id, user_id, name, created_at, updated_at, blog_subdomain, blog_domain)
           select 'x', user_id, 'X', 0, 0, 'field', 'notes.example.com' from spaces where id = ?`,
        )
        .run(space),
    ).toThrow(/one address|CHECK constraint failed/)
  })

  test('a row that had both keeps the domain once the guard arrives', () => {
    const database = new DatabaseSync(':memory:')
    for (const name of MIGRATIONS.filter((one) => one < GUARD)) {
      database.exec(readFileSync(FOLDER + name, 'utf8'))
    }

    database.exec(`insert into users (id, email, created_at) values ('u', 'a@b.dev', 0)`)
    database.exec(
      `insert into spaces (id, user_id, name, created_at, updated_at, blog_enabled, blog_subdomain, blog_domain)
       values ('both', 'u', 'Both', 0, 0, 1, 'field', 'notes.example.com'),
              ('name', 'u', 'Name', 0, 0, 1, 'other', null),
              ('domain', 'u', 'Domain', 0, 0, 1, null, 'blog.example.com')`,
    )

    database.exec(readFileSync(FOLDER + GUARD, 'utf8'))

    const rows = database
      .prepare('select id, blog_subdomain, blog_domain from spaces order by id')
      .all() as { id: string; blog_subdomain: string | null; blog_domain: string | null }[]

    expect(rows).toEqual([
      { id: 'both', blog_subdomain: null, blog_domain: 'notes.example.com' },
      { id: 'domain', blog_subdomain: null, blog_domain: 'blog.example.com' },
      { id: 'name', blog_subdomain: 'other', blog_domain: null },
    ])
    database.close()
  })

  test('the guard is written into the table itself', () => {
    // A CHECK rather than a trigger: D1 cannot create triggers, see the
    // migration. Being part of the table, it cannot be forgotten by a later
    // migration the way a trigger could be dropped.
    const row = env.db
      .prepare("select sql from sqlite_master where type = 'table' and name = 'spaces'")
      .get() as { sql: string }
    expect(row.sql).toMatch(/check \(blog_subdomain is null or blog_domain is null\)/i)
  })
})

describe('names kept off the shared domain', () => {
  async function available(name: string) {
    return (await call(env, `/v1/spaces/available/${name}`, { token })).json.available
  }

  test('a name that is somebody’s own words is free', async () => {
    for (const name of ['markdown', 'field', 'notes', 'emil', 'hedgehogs', 'the-lab', 'ideas']) {
      expect(await available(name), name).toBe(true)
    }
  })

  /** The app, the API and the mail are all on this one domain, so a site at
   *  `login.` is a page under the product's own name on the product's own
   *  certificate - which is the whole of what a phishing page wants, for the price
   *  of one signup. "Only what is in use" was the wrong rule. */
  test('a name that reads as the product speaking is not', async () => {
    const theirs = [
      'login',
      'signin',
      'account',
      'accounts',
      'api',
      'app',
      'admin',
      'auth',
      'billing',
      'pay',
      'secure',
      'status',
      'support',
      'help',
      'docs',
      'download',
      'updates',
      'blog',
      'cdn',
      'assets',
      'static',
      'nib',
      'nibeditor',
      'dev',
      'staging',
      'test',
    ]

    for (const name of theirs) expect(await available(name), name).toBe(false)
  })

  /** What a browser or a mail client goes looking for without being told. A site
   *  answering one of these is a site answering for the domain. */
  test('nor one a client fetches by itself', async () => {
    for (const name of ['autoconfig', 'autodiscover', 'mta-sts', 'dmarc', 'wpad']) {
      expect(await available(name), name).toBe(false)
    }
  })

  /** RFC 2142's mailbox names: the addresses a domain is expected to answer at,
   *  which read as official wherever they are written. */
  test('nor one of the names a domain answers mail at', async () => {
    for (const name of ['postmaster', 'abuse', 'security', 'webmaster', 'hostmaster', 'noc']) {
      expect(await available(name), name).toBe(false)
    }
  })

  /** Nobody is losing a name to this: the list is read when an address is chosen. */
  test('and no space on the domain today holds one of them', async () => {
    const held = env.db
      .prepare('select blog_subdomain as name from spaces where blog_subdomain is not null')
      .all() as { name: string }[]

    for (const { name } of held) expect(await available(name), name).toBe(true)
  })

  test("the site's own name is not", async () => {
    expect(await available('www')).toBe(false)
  })

  test('the mail names are not, because mail records exist', async () => {
    for (const name of ['mail', 'smtp', 'imap']) expect(await available(name), name).toBe(false)
  })

  test('the nameserver names are not', async () => {
    for (const name of ['ns', 'ns1', 'ns2']) expect(await available(name), name).toBe(false)
  })

  test("the CNAME target's own label is not", async () => {
    expect(await available('cname')).toBe(false)
    expect((await publish({ subdomain: 'cname' })).status).toBe(409)
  })
})
