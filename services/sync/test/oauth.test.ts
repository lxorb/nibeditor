import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { expireClients } from '../src/oauth/clients'
import { call, type RpcView, signIn, testEnv, type TestEnv } from './harness'

let env: TestEnv

beforeEach(() => {
  env = testEnv()
})

afterEach(() => {
  env.close()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const ORIGIN = 'https://nibeditor.com'
const CHATGPT = 'https://chatgpt.com/connector/oauth/abc123'

/** PKCE, as a client does it: a random verifier and its S256 challenge. */
async function pkce() {
  const verifier = 'v'.repeat(20) + Math.random().toString(36).slice(2).padEnd(30, 'x')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return { verifier, challenge }
}

/** Registers a public client the way Claude and ChatGPT do. */
async function register(redirectUris = [CHATGPT], extra: Record<string, unknown> = {}) {
  const response = await call(env, '/oauth/register', {
    body: {
      client_name: 'ChatGPT',
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none',
      ...extra,
    },
  })
  return response
}

function authorizeUrl(params: Record<string, string>) {
  const query = new URLSearchParams({
    response_type: 'code',
    redirect_uri: CHATGPT,
    state: 'xyz',
    code_challenge_method: 'S256',
    resource: `${ORIGIN}/mcp`,
    ...params,
  })
  return `/oauth/authorize?${query.toString()}`
}

/** Submits one of the consent page's forms. */
async function submit(fields: Record<string, string>) {
  return call(env, '/oauth/authorize', {
    raw: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  })
}

/** Reads the emailed code out of the logging mailer. */
async function codeSentTo(action: () => Promise<unknown>): Promise<string> {
  const logged: string[] = []
  const spy = vi.spyOn(console, 'log').mockImplementation((message) => {
    logged.push(String(message))
  })
  await action()
  spy.mockRestore()

  const match = /(\d{3}) (\d{3})/.exec(logged.join('\n'))
  if (!match) throw new Error('no code was sent')
  return `${match[1]}${match[2]}`
}

async function exchange(fields: Record<string, string>) {
  return call(env, '/oauth/token', {
    raw: new URLSearchParams({ grant_type: 'authorization_code', ...fields }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  })
}

/** The whole dance, as a client and a person would do it, ending in tokens. */
async function connect(
  options: { write?: boolean; email?: string; clientId?: string; redirect?: string } = {},
) {
  const email = options.email ?? 'a@b.dev'
  const clientId = options.clientId ?? (await register()).json.client_id
  const redirect = options.redirect ?? CHATGPT
  const { verifier, challenge } = await pkce()

  const ask = {
    client_id: clientId,
    redirect_uri: redirect,
    state: 'xyz',
    code_challenge: challenge,
    resource: `${ORIGIN}/mcp`,
  }

  const code = await codeSentTo(() => submit({ ...ask, action: 'send', email }))
  const allowed = await submit({
    ...ask,
    action: 'allow',
    email,
    code,
    ...(options.write ? { write: '1' } : {}),
  })

  expect(allowed.status).toBe(302)
  const sentTo = new URL(allowed.headers.get('location')!)
  const grant = sentTo.searchParams.get('code')!

  const tokens = await exchange({
    code: grant,
    code_verifier: verifier,
    client_id: clientId,
    redirect_uri: redirect,
    resource: `${ORIGIN}/mcp`,
  })

  return { tokens, sentTo, clientId, verifier }
}

async function rpc(token: string, method: string, params?: Record<string, unknown>) {
  return call<RpcView>(env, '/mcp', { token, body: { jsonrpc: '2.0', id: 1, method, params } })
}

describe('what a client can find out on its own', () => {
  test('the authorization server describes itself', async () => {
    const response = await call(env, '/.well-known/oauth-authorization-server')

    expect(response.status).toBe(200)
    expect(response.json.issuer).toBe(ORIGIN)
    expect(response.json.authorization_endpoint).toBe(`${ORIGIN}/oauth/authorize`)
    expect(response.json.token_endpoint).toBe(`${ORIGIN}/oauth/token`)
    expect(response.json.registration_endpoint).toBe(`${ORIGIN}/oauth/register`)
    expect(response.json.code_challenge_methods_supported).toEqual(['S256'])
    expect(response.json.token_endpoint_auth_methods_supported).toContain('none')
    expect(response.json.client_id_metadata_document_supported).toBe(true)
    expect(response.json.authorization_response_iss_parameter_supported).toBe(true)
  })

  test('the connector says which server signs people in, at both well-known paths', async () => {
    for (const path of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp',
    ]) {
      const response = await call(env, path)

      expect(response.status, path).toBe(200)
      expect(response.json.resource).toBe(`${ORIGIN}/mcp`)
      expect(response.json.authorization_servers).toEqual([ORIGIN])
      expect(response.json.scopes_supported).toContain('notes:read')
      expect(response.json.resource_name).toBe('nibeditor')
    }
  })

  test('the metadata may be read from a browser', async () => {
    const response = await call(env, '/.well-known/oauth-authorization-server', {
      headers: { origin: 'http://localhost:6274' },
    })
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  test('a refused connector request points at the metadata', async () => {
    const response = await call(env, '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'ping' } })

    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    )
    expect(response.headers.get('www-authenticate')).not.toContain('invalid_token')
  })

  test('a bad token is called that', async () => {
    const response = await rpc('nib_nonsense', 'ping')
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain('error="invalid_token"')
  })

  test('there is no stream to open', async () => {
    const response = await call(env, '/mcp')
    expect(response.status).toBe(405)
  })
})

describe('registering', () => {
  test('hands a public client an id and no secret', async () => {
    const response = await register()

    expect(response.status).toBe(201)
    expect(response.json.client_id).toBeTruthy()
    expect(response.json.client_secret).toBeUndefined()
    expect(response.json.token_endpoint_auth_method).toBe('none')
    expect(response.json.redirect_uris).toEqual([CHATGPT])
  })

  test('takes the callbacks Claude, ChatGPT, Claude Code and the editors use', async () => {
    const response = await register([
      'https://claude.ai/api/mcp/auth_callback',
      'https://claude.com/api/mcp/auth_callback',
      'https://chatgpt.com/connector_platform_oauth_redirect',
      'http://localhost:3118/callback',
      'http://127.0.0.1:33418',
      'https://vscode.dev/redirect',
      'cursor://anysphere.cursor-mcp/oauth/callback',
    ])
    expect(response.status).toBe(201)
  })

  test('refuses a callback that is neither https nor local', async () => {
    const response = await register(['http://example.com/callback'])

    expect(response.status).toBe(400)
    expect(response.json.error).toBe('invalid_redirect_uri')
  })

  test('refuses a registration with nowhere to send the person', async () => {
    const response = await call(env, '/oauth/register', { body: { client_name: 'X' } })
    expect(response.status).toBe(400)
  })

  test('gives a client that registers again the same id', async () => {
    const first = await register()
    const second = await register()

    expect(second.json.client_id).toBe(first.json.client_id)
  })

  test('mints a secret for a client that wants one, and then insists on it', async () => {
    const response = await register([CHATGPT], { token_endpoint_auth_method: 'client_secret_post' })

    expect(response.json.client_secret).toMatch(/^[0-9a-f]{64}$/)
    expect(response.json.token_endpoint_auth_method).toBe('client_secret_post')

    const without = await exchange({
      client_id: response.json.client_id,
      code: 'x',
      code_verifier: 'y'.repeat(43),
    })
    expect(without.status).toBe(401)
    expect(without.json.error).toBe('invalid_client')

    const wrong = await exchange({
      client_id: response.json.client_id,
      client_secret: 'nope',
      code: 'x',
      code_verifier: 'y'.repeat(43),
    })
    expect(wrong.status).toBe(401)
  })
})

describe('asking for consent', () => {
  test('shows the client by name and says where the person goes afterwards', async () => {
    const { client_id } = (await register()).json
    const { challenge } = await pkce()
    const response = await call(env, authorizeUrl({ client_id, code_challenge: challenge }))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(response.text).toContain('Connect ChatGPT')
    expect(response.text).toContain('chatgpt.com')
    expect(response.headers.get('x-frame-options')).toBe('DENY')
  })

  test('refuses an unknown client on a page rather than by redirecting', async () => {
    const { challenge } = await pkce()
    const response = await call(
      env,
      authorizeUrl({ client_id: 'nobody', code_challenge: challenge }),
    )

    expect(response.status).toBe(400)
    expect(response.headers.get('location')).toBeNull()
  })

  test('refuses a callback the client never registered, on a page', async () => {
    const { client_id } = (await register()).json
    const { challenge } = await pkce()
    const response = await call(
      env,
      authorizeUrl({
        client_id,
        code_challenge: challenge,
        redirect_uri: 'https://evil.example/cb',
      }),
    )

    expect(response.status).toBe(400)
    expect(response.headers.get('location')).toBeNull()
  })

  test('sends the client an error when PKCE is missing', async () => {
    const { client_id } = (await register()).json
    const response = await call(env, authorizeUrl({ client_id }))

    expect(response.status).toBe(302)
    const sentTo = new URL(response.headers.get('location')!)
    expect(sentTo.origin + sentTo.pathname).toBe(CHATGPT)
    expect(sentTo.searchParams.get('error')).toBe('invalid_request')
    expect(sentTo.searchParams.get('state')).toBe('xyz')
    expect(sentTo.searchParams.get('iss')).toBe(ORIGIN)
  })

  test('sends the client an error when the token is meant for somewhere else', async () => {
    const { client_id } = (await register()).json
    const { challenge } = await pkce()
    const response = await call(
      env,
      authorizeUrl({ client_id, code_challenge: challenge, resource: 'https://other.example/mcp' }),
    )

    expect(new URL(response.headers.get('location')!).searchParams.get('error')).toBe(
      'invalid_target',
    )
  })

  test('lets a local app answer on whichever port it has', async () => {
    const { client_id } = (await register(['http://localhost/callback'])).json
    const { challenge } = await pkce()
    const response = await call(
      env,
      authorizeUrl({
        client_id,
        code_challenge: challenge,
        redirect_uri: 'http://localhost:3118/callback',
      }),
    )

    expect(response.status).toBe(200)
    expect(response.text).toContain('an app on this computer')
  })

  test('offers writing only when the client asked for it', async () => {
    const { client_id } = (await register()).json
    const { challenge } = await pkce()
    const ask = { client_id, redirect_uri: CHATGPT, code_challenge: challenge }

    await codeSentTo(() =>
      submit({ ...ask, scope: 'notes:read', action: 'send', email: 'a@b.dev' }),
    )
    const readOnly = await submit({ ...ask, scope: 'notes:read', action: 'send', email: 'a@b.dev' })
    expect(readOnly.text).not.toContain('change my notes')

    const both = await submit({
      ...ask,
      scope: 'notes:read notes:write',
      action: 'send',
      email: 'a@b.dev',
    })
    expect(both.text).toContain('change my notes')
  })

  test('says no to the client when the person does', async () => {
    const { client_id } = (await register()).json
    const { challenge } = await pkce()
    const response = await submit({
      client_id,
      redirect_uri: CHATGPT,
      state: 'xyz',
      code_challenge: challenge,
      action: 'deny',
    })

    expect(response.status).toBe(302)
    const sentTo = new URL(response.headers.get('location')!)
    expect(sentTo.searchParams.get('error')).toBe('access_denied')
    expect(sentTo.searchParams.get('state')).toBe('xyz')
  })

  test('keeps a wrong code on the page', async () => {
    const { client_id } = (await register()).json
    const { challenge } = await pkce()
    const ask = { client_id, redirect_uri: CHATGPT, code_challenge: challenge, email: 'a@b.dev' }

    await codeSentTo(() => submit({ ...ask, action: 'send' }))
    const response = await submit({ ...ask, action: 'allow', code: '000000' })

    expect(response.status).toBe(200)
    expect(response.text).toContain('not right')
  })
})

/** Everything in an authorization request arrives from a stranger's query
 *  string or from a hand-made form post. What may be sent anywhere is settled
 *  before anything is, and each field is what it says it is or the request
 *  stops on a page. */
describe('what an authorization request may carry', () => {
  test('a challenge that is not an S256 digest is turned down', async () => {
    const { client_id } = (await register()).json

    for (const code_challenge of ['short', 'x'.repeat(42), 'x'.repeat(44), 'not+base64url/=']) {
      const response = await call(env, authorizeUrl({ client_id, code_challenge }))

      expect(response.status, code_challenge).toBe(302)
      const sentTo = new URL(response.headers.get('location')!)
      expect(sentTo.searchParams.get('error'), code_challenge).toBe('invalid_request')
    }
  })

  test('a field longer than that field ever is stays on a page', async () => {
    const { client_id } = (await register()).json
    const { challenge } = await pkce()

    const response = await call(
      env,
      authorizeUrl({ client_id, code_challenge: challenge, state: 'x'.repeat(2000) }),
    )

    expect(response.status).toBe(400)
    expect(response.headers.get('location')).toBeNull()
  })

  test('a consent post cannot smuggle a scope past the first step', async () => {
    const { client_id } = (await register()).json
    const { challenge } = await pkce()

    const response = await submit({
      client_id,
      redirect_uri: CHATGPT,
      code_challenge: challenge,
      scope: 'notes:read notes:everything',
      action: 'send',
      email: 'a@b.dev',
    })

    expect(response.status).toBe(400)
    expect(response.text).toContain('not complete')
  })

  test('a consent post cannot bring a challenge the first step would refuse', async () => {
    const { client_id } = (await register()).json

    const response = await submit({
      client_id,
      redirect_uri: CHATGPT,
      code_challenge: 'short',
      action: 'send',
      email: 'a@b.dev',
    })

    expect(response.status).toBe(400)
  })
})

describe('a client id that is a URL', () => {
  test('is not fetched when it names this machine or an address', async () => {
    const reached = vi.fn(() => Promise.resolve(new Response('{}')))
    vi.stubGlobal('fetch', reached)

    const { challenge } = await pkce()
    for (const client_id of [
      'https://127.0.0.1/metadata',
      'https://localhost/metadata',
      'https://[::1]/metadata',
      'https://10.0.0.1/metadata',
    ]) {
      const response = await call(env, authorizeUrl({ client_id, code_challenge: challenge }))
      expect(response.status, client_id).toBe(400)
    }

    expect(reached).not.toHaveBeenCalled()
  })
})

describe('registering more than a client has', () => {
  test('is refused rather than written into the row', async () => {
    const many = Array.from({ length: 21 }, (_, index) => `https://claude.ai/cb/${index}`)
    const response = await register(many)

    expect(response.status).toBe(400)
    expect(response.json.error).toBe('invalid_redirect_uri')
  })

  test('twenty is still taken', async () => {
    const many = Array.from({ length: 20 }, (_, index) => `https://claude.ai/cb/${index}`)
    expect((await register(many)).status).toBe(201)
  })
})

describe('connecting', () => {
  test('ends with a token that reaches the notes', async () => {
    const { tokens, sentTo } = await connect()

    expect(sentTo.searchParams.get('state')).toBe('xyz')
    expect(sentTo.searchParams.get('iss')).toBe(ORIGIN)

    expect(tokens.status).toBe(200)
    expect(tokens.json.token_type).toBe('Bearer')
    expect(tokens.json.access_token).toMatch(/^nib_/)
    expect(tokens.json.refresh_token).toBeTruthy()
    expect(tokens.json.scope).toBe('notes:read')
    expect(tokens.headers.get('cache-control')).toBe('no-store')

    const listed = await rpc(tokens.json.access_token, 'tools/list')
    expect(listed.status).toBe(200)
  })

  test('reads and writes only what the person allowed', async () => {
    const session = await signIn(env, 'a@b.dev')
    await call(env, '/v1/spaces', { token: session, body: { name: 'Work' } })

    const readOnly = (await connect()).tokens.json.access_token
    const writing = (await connect({ write: true })).tokens.json.access_token

    const refused = await rpc(readOnly, 'tools/call', {
      name: 'write_note',
      arguments: { space: 'Work', path: 'a.md', content: 'x' },
    })
    expect(refused.json.result.content[0]!.text).toContain('only read')

    const saved = await rpc(writing, 'tools/call', {
      name: 'write_note',
      arguments: { space: 'Work', path: 'a.md', content: 'x' },
    })
    expect(saved.json.result.content[0]!.text).toContain('Saved')
  })

  test('signs up an address it has never seen', async () => {
    const { tokens } = await connect({ email: 'new@b.dev' })
    const spaces = await rpc(tokens.json.access_token, 'tools/call', {
      name: 'list_spaces',
      arguments: {},
    })

    // The account was made by the consent page, so it holds the space every new
    // account is given and the connector has somewhere to write from the start.
    expect(spaces.json.result.content[0]!.text).toBe('Notes')
  })

  test('takes the token request as JSON too', async () => {
    const { client_id } = (await register()).json
    const { verifier, challenge } = await pkce()
    const ask = { client_id, redirect_uri: CHATGPT, code_challenge: challenge }

    const code = await codeSentTo(() => submit({ ...ask, action: 'send', email: 'a@b.dev' }))
    const allowed = await submit({ ...ask, action: 'allow', email: 'a@b.dev', code })
    const grant = new URL(allowed.headers.get('location')!).searchParams.get('code')!

    const tokens = await call(env, '/oauth/token', {
      body: {
        grant_type: 'authorization_code',
        code: grant,
        code_verifier: verifier,
        client_id,
        redirect_uri: CHATGPT,
      },
    })
    expect(tokens.status).toBe(200)
  })

  test('refuses the wrong verifier', async () => {
    const { client_id } = (await register()).json
    const { challenge } = await pkce()
    const ask = { client_id, redirect_uri: CHATGPT, code_challenge: challenge }

    const code = await codeSentTo(() => submit({ ...ask, action: 'send', email: 'a@b.dev' }))
    const allowed = await submit({ ...ask, action: 'allow', email: 'a@b.dev', code })
    const grant = new URL(allowed.headers.get('location')!).searchParams.get('code')!

    const tokens = await exchange({
      code: grant,
      code_verifier: (await pkce()).verifier,
      client_id,
      redirect_uri: CHATGPT,
    })
    expect(tokens.status).toBe(400)
    expect(tokens.json.error).toBe('invalid_grant')
  })

  test('spends a code on the first try, right or wrong', async () => {
    const { client_id } = (await register()).json
    const { verifier, challenge } = await pkce()
    const ask = { client_id, redirect_uri: CHATGPT, code_challenge: challenge }

    const code = await codeSentTo(() => submit({ ...ask, action: 'send', email: 'a@b.dev' }))
    const allowed = await submit({ ...ask, action: 'allow', email: 'a@b.dev', code })
    const grant = new URL(allowed.headers.get('location')!).searchParams.get('code')!

    expect((await exchange({ code: grant, code_verifier: verifier, client_id })).status).toBe(200)
    expect((await exchange({ code: grant, code_verifier: verifier, client_id })).json.error).toBe(
      'invalid_grant',
    )
  })

  test('refuses a code presented by another client', async () => {
    const { client_id } = (await register()).json
    const other = (await register([CHATGPT], { client_name: 'Other' })).json.client_id
    const { verifier, challenge } = await pkce()
    const ask = { client_id, redirect_uri: CHATGPT, code_challenge: challenge }

    const code = await codeSentTo(() => submit({ ...ask, action: 'send', email: 'a@b.dev' }))
    const allowed = await submit({ ...ask, action: 'allow', email: 'a@b.dev', code })
    const grant = new URL(allowed.headers.get('location')!).searchParams.get('code')!

    const tokens = await exchange({ code: grant, code_verifier: verifier, client_id: other })
    expect(tokens.json.error).toBe('invalid_grant')
  })

  test('refuses a token for somewhere else', async () => {
    const { client_id } = (await register()).json
    const tokens = await exchange({
      client_id,
      code: 'x',
      code_verifier: 'y'.repeat(43),
      resource: 'https://other.example',
    })
    expect(tokens.json.error).toBe('invalid_target')
  })
})

describe('codes nobody redeemed', () => {
  test('are cleared away as the next one is written', async () => {
    await signIn(env, 'a@b.dev')
    const owner = env.db.prepare('select id from users limit 1').get() as { id: string }
    env.db
      .prepare(
        `insert into oauth_codes (code_hash, client_id, user_id, redirect_uri, challenge, read_only, expires_at)
         values ('stale', 'someone', ?, 'https://chatgpt.com/cb', 'x', 1, 1)`,
      )
      .run(owner.id)

    await connect()

    const left = env.db.prepare('select count(*) as held from oauth_codes').get() as {
      held: number
    }
    expect(left.held).toBe(0)
  })
})

describe('refreshing', () => {
  async function refresh(clientId: string, token: string) {
    return call(env, '/oauth/token', {
      raw: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: token,
        client_id: clientId,
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })
  }

  test('hands out new tokens and retires the old access token', async () => {
    const { tokens, clientId } = await connect()
    const refreshed = await refresh(clientId, tokens.json.refresh_token)

    expect(refreshed.status).toBe(200)
    expect(refreshed.json.access_token).not.toBe(tokens.json.access_token)
    expect(refreshed.json.refresh_token).not.toBe(tokens.json.refresh_token)

    expect((await rpc(tokens.json.access_token, 'ping')).status).toBe(401)
    expect((await rpc(refreshed.json.access_token, 'ping')).status).toBe(200)
  })

  test('revokes the whole grant when a token that was rotated comes back', async () => {
    const { tokens, clientId } = await connect()
    const first = await refresh(clientId, tokens.json.refresh_token)
    expect(first.status).toBe(200)

    // Two parties have held this one and only one of them got what replaced it.
    const again = await refresh(clientId, tokens.json.refresh_token)
    expect(again.status).toBe(401)
    expect(again.json.error).toBe('invalid_grant')

    // Everything the grant held went with it: the token that was current, the
    // access token beside it, and the row itself.
    expect((await refresh(clientId, first.json.refresh_token)).status).toBe(400)
    expect((await rpc(first.json.access_token, 'ping')).status).toBe(401)

    const left = env.db.prepare('select count(*) as held from oauth_grants').get() as {
      held: number
    }
    expect(left.held).toBe(0)
  })

  test('revokes it whichever client brings the spent token back', async () => {
    const { tokens, clientId } = await connect()
    await refresh(clientId, tokens.json.refresh_token)
    const other = (await register([CHATGPT], { client_name: 'Other' })).json.client_id

    expect((await refresh(other, tokens.json.refresh_token)).status).toBe(401)

    const left = env.db.prepare('select count(*) as held from oauth_grants').get() as {
      held: number
    }
    expect(left.held).toBe(0)
  })

  test('leaves the grant alone when the token it is shown is the current one', async () => {
    const { tokens, clientId } = await connect()
    const first = await refresh(clientId, tokens.json.refresh_token)
    const second = await refresh(clientId, first.json.refresh_token)

    expect(second.status).toBe(200)
    expect((await rpc(second.json.access_token, 'ping')).status).toBe(200)
  })

  test('refuses another client', async () => {
    const { tokens } = await connect()
    const other = (await register([CHATGPT], { client_name: 'Other' })).json.client_id

    expect((await refresh(other, tokens.json.refresh_token)).json.error).toBe('invalid_grant')
  })

  test('says invalid_grant for a token it never issued', async () => {
    const { clientId } = await connect()
    expect((await refresh(clientId, 'nibr_made_up')).json.error).toBe('invalid_grant')
  })
})

describe('a client that describes itself at a URL', () => {
  const CLAUDE_CODE = 'https://claude.ai/oauth/claude-code-client-metadata'

  function hosting(document: Record<string, unknown>) {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          url === CLAUDE_CODE
            ? new Response(JSON.stringify(document), {
                headers: { 'content-type': 'application/json' },
              })
            : new Response('not found', { status: 404 }),
        ),
      ),
    )
  }

  test('is taken at its word, port and all', async () => {
    hosting({
      client_id: CLAUDE_CODE,
      client_name: 'Claude Code',
      redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
      token_endpoint_auth_method: 'none',
    })

    const { tokens, sentTo } = await connect({
      clientId: CLAUDE_CODE,
      redirect: 'http://localhost:3118/callback',
    })

    expect(sentTo.origin).toBe('http://localhost:3118')
    expect(tokens.status).toBe(200)

    const listed = await call(env, '/v1/mcp/token', { token: await signIn(env, 'a@b.dev') })
    expect(listed.json.clients[0]!.name).toBe('Claude Code')
  })

  test('is refused when the document does not name itself', async () => {
    hosting({
      client_id: 'https://elsewhere.example/x',
      client_name: 'X',
      redirect_uris: [CHATGPT],
    })

    const { challenge } = await pkce()
    const response = await call(
      env,
      authorizeUrl({ client_id: CLAUDE_CODE, code_challenge: challenge }),
    )
    expect(response.status).toBe(400)
  })

  test('is refused when there is no document', async () => {
    hosting({})

    const { challenge } = await pkce()
    const response = await call(
      env,
      authorizeUrl({ client_id: 'https://claude.ai/nothing-here', code_challenge: challenge }),
    )
    expect(response.status).toBe(400)
  })

  /** Anybody at all names the URL this fetches - it comes off a query string - so
   *  a host answering with something enormous must not be able to spend the
   *  Worker's memory on it. It was read whole and measured afterwards. */
  test('is refused, unread, when it declares itself larger than a document', async () => {
    const asked = vi.fn(() =>
      Promise.resolve(
        new Response('{}', {
          headers: {
            'content-type': 'application/json',
            'content-length': String(64 * 1024 * 1024),
          },
        }),
      ),
    )
    vi.stubGlobal('fetch', asked)

    const { challenge } = await pkce()
    const response = await call(
      env,
      authorizeUrl({ client_id: CLAUDE_CODE, code_challenge: challenge }),
    )

    expect(response.status).toBe(400)
    expect(asked).toHaveBeenCalledOnce()
  })

  test('is refused when it turns out to be larger than a document', async () => {
    // No content-length, so the only bound is the one applied while reading.
    const long = JSON.stringify({
      client_id: CLAUDE_CODE,
      client_name: 'x'.repeat(80_000),
      redirect_uris: [CHATGPT],
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(long))
                controller.close()
              },
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
        ),
      ),
    )

    const { challenge } = await pkce()
    const response = await call(
      env,
      authorizeUrl({ client_id: CLAUDE_CODE, code_challenge: challenge }),
    )
    expect(response.status).toBe(400)
  })
})

describe('what the settings show', () => {
  test('lists the connected clients and lets one go', async () => {
    const session = await signIn(env, 'a@b.dev')
    const { tokens } = await connect({ write: true })

    const before = await call(env, '/v1/mcp/token', { token: session })
    expect(before.json.clients).toHaveLength(1)
    expect(before.json.clients[0]!.name).toBe('ChatGPT')
    expect(before.json.clients[0]!.readOnly).toBe(false)

    const gone = await call(env, `/v1/mcp/clients/${before.json.clients[0]!.id}`, {
      token: session,
      method: 'DELETE',
    })
    expect(gone.status).toBe(200)

    expect((await call(env, '/v1/mcp/token', { token: session })).json.clients).toHaveLength(0)
    expect((await rpc(tokens.json.access_token, 'ping')).status).toBe(401)
  })

  test('keeps one account from disconnecting another', async () => {
    const owner = await signIn(env, 'a@b.dev')
    const other = await signIn(env, 'other@b.dev')
    const { tokens } = await connect()

    const listed = await call(env, '/v1/mcp/token', { token: owner })
    await call(env, `/v1/mcp/clients/${listed.json.clients[0]!.id}`, {
      token: other,
      method: 'DELETE',
    })

    expect((await rpc(tokens.json.access_token, 'ping')).status).toBe(200)
  })
})

describe('how many clients this server registers', () => {
  /** Registering from a machine, which is what Cloudflare names on every request
   *  that reaches a Worker. */
  function registerFrom(machine: string, name: string) {
    return call(env, '/oauth/register', {
      body: {
        client_name: name,
        redirect_uris: [CHATGPT],
        token_endpoint_auth_method: 'none',
      },
      headers: { 'cf-connecting-ip': machine },
    })
  }

  test('stops at a number of new ones from one machine in an hour', async () => {
    for (let at = 0; at < 20; at++) {
      expect((await registerFrom('203.0.113.7', `One ${at}`)).status).toBe(201)
    }

    const refused = await registerFrom('203.0.113.7', 'One more')
    expect(refused.status).toBe(429)
    expect(refused.json.error).toBe('temporarily_unavailable')
  })

  test('and lets a client that already has a row ask for it again', async () => {
    for (let at = 0; at < 20; at++) await registerFrom('203.0.113.7', `One ${at}`)

    // The same name and the same callbacks are the same client, so nothing is
    // written and there is nothing for the ceiling to be about.
    expect((await registerFrom('203.0.113.7', 'One 0')).status).toBe(201)
  })

  test('holds one machine to it and leaves the next alone', async () => {
    for (let at = 0; at < 20; at++) await registerFrom('203.0.113.7', `One ${at}`)

    expect((await registerFrom('198.51.100.4', 'Elsewhere')).status).toBe(201)
  })

  test('stops altogether once the table holds as many as it keeps', async () => {
    const insert = env.db.prepare(
      `insert into oauth_clients (id, name, redirect_uris, created_at, used_at)
       values (?, ?, '["https://example.com/cb"]', 1, 1)`,
    )
    for (let at = 0; at < 5000; at++) insert.run(`c-${at}`, `Client ${at}`)

    const refused = await registerFrom('203.0.113.7', 'One more')
    expect(refused.status).toBe(503)
    expect(refused.json.error).toBe('temporarily_unavailable')
  })
})

describe('how many apps one account connects', () => {
  const ACCOUNT = 'a@b.dev'

  beforeEach(() => {
    // The account itself, written rather than signed in to: a sign-in sends a
    // code, and the consent page below asks for one of its own inside the gap one
    // address keeps between two messages.
    env.db
      .prepare('insert into users (id, email, created_at) values (?, ?, ?)')
      .run('one', ACCOUNT, Date.now())
  })

  /** Connections the account already holds. The rows are what the ceilings count,
   *  so they are written rather than walked through twenty times. */
  function connected(clients: string[]) {
    const insert = env.db.prepare(
      `insert into oauth_grants
         (id, user_id, client_id, client_name, read_only, access_hash, access_expires_at,
          refresh_hash, created_at)
       values (?1, 'one', ?2, 'Something', 1, ?1, ?3, ?1, ?3)`,
    )

    clients.forEach((client, at) => insert.run(`g-${at}`, client, Date.now()))
  }

  /** Consent, as far as the answer to pressing Allow. */
  async function consent(clientId: string) {
    const { challenge } = await pkce()
    const ask = {
      client_id: clientId,
      redirect_uri: CHATGPT,
      state: 'xyz',
      code_challenge: challenge,
      resource: `${ORIGIN}/mcp`,
    }

    const code = await codeSentTo(() => submit({ ...ask, action: 'send', email: ACCOUNT }))
    return submit({ ...ask, action: 'allow', email: ACCOUNT, code })
  }

  test('stops at a number of them', async () => {
    connected(Array.from({ length: 20 }, (_, at) => `other-${at}`))
    const clientId = (await register()).json.client_id

    const refused = await consent(clientId)
    expect(refused.status).toBe(409)
    expect(refused.text).toContain('as many apps as one account connects')
  })

  test('and still connects an app that is already there', async () => {
    const clientId = (await register()).json.client_id
    connected([clientId, ...Array.from({ length: 19 }, (_, at) => `other-${at}`)])

    // Full of apps, and this one is not a new app: what is refused is one more
    // app, not one more connection to an app somebody already uses.
    expect((await consent(clientId)).status).toBe(302)
  })

  test('stops at as many connections as the settings can list, one app or many', async () => {
    const clientId = (await register()).json.client_id
    connected(Array.from({ length: 200 }, () => clientId))

    expect((await consent(clientId)).status).toBe(409)
  })

  test('lets a first app in', async () => {
    expect((await consent((await register()).json.client_id)).status).toBe(302)
  })
})

describe('a client that registered and never came back', () => {
  const MONTH = 30 * 24 * 60 * 60 * 1000

  /** A client that has sat there since before the sweep's cutoff. */
  function longAgo() {
    env.db.prepare('update oauth_clients set used_at = ?').run(Date.now() - MONTH - 1000)
  }

  test('is let go once a month has passed', async () => {
    const clientId = (await register()).json.client_id
    longAgo()

    expect(await expireClients(env, Date.now())).toBe(1)

    // And it is nobody's client to ask for consent as any more.
    const asked = await call(
      env,
      authorizeUrl({ client_id: clientId, code_challenge: 'c'.repeat(43) }),
    )
    expect(asked.text).toContain('not known here')
  })

  test('stays while it was used lately', async () => {
    await register()
    expect(await expireClients(env, Date.now())).toBe(0)
  })

  test('stays while somebody is connected through it', async () => {
    await connect()
    longAgo()

    expect(await expireClients(env, Date.now())).toBe(0)
  })

  test('stays while a connection is halfway through being made', async () => {
    const clientId = (await register()).json.client_id
    longAgo()

    env.db
      .prepare('insert into users (id, email, created_at) values (?, ?, ?)')
      .run('one', 'a@b.dev', Date.now())
    env.db
      .prepare(
        `insert into oauth_codes (code_hash, client_id, user_id, redirect_uri, challenge, expires_at)
         values ('h', ?, 'one', 'https://example.com/cb', 'x', ?)`,
      )
      .run(clientId, Date.now() + 60_000)

    expect(await expireClients(env, Date.now())).toBe(0)
  })

  test('is stamped again by a consent, so signing in keeps it', async () => {
    const clientId = (await register()).json.client_id
    longAgo()

    // The whole dance, which ends in a grant as well; the point is the stamp, so
    // the grant goes and the client should still be here.
    await connect({ clientId })
    env.db.prepare('delete from oauth_grants').run()

    expect(await expireClients(env, Date.now())).toBe(0)
  })
})
