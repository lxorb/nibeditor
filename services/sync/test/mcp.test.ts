import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { QUOTA } from '../src/storage'
import { call, type RpcView, signIn, testEnv, type TestEnv } from './harness'

let env: TestEnv
let token: string
let space: string

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')

  const created = await call(env, '/v1/spaces', { token, body: { name: 'Work' } })
  space = created.json.space.id

  await call(env, `/v1/spaces/${space}/notes`, {
    token,
    body: { path: 'plan.md', content: '# Plan\n\nShip the thing.\n' },
  })
})

afterEach(() => env.close())

/** Issues a connector token, read-only unless told otherwise. */
async function connector(readOnly = true): Promise<string> {
  const made = await call(env, '/v1/mcp/token', { token, body: { readOnly } })
  return made.json.token
}

async function rpc(key: string, method: string, params?: Record<string, unknown>) {
  return call<RpcView>(env, '/mcp', {
    token: key,
    body: { jsonrpc: '2.0', id: 1, method, params },
  })
}

async function tool(key: string, name: string, args: Record<string, unknown> = {}) {
  const response = await rpc(key, 'tools/call', { name, arguments: args })
  return response.json.result.content[0]?.text ?? ''
}

describe('handing out a token', () => {
  test('gives one back exactly once', async () => {
    const made = await call(env, '/v1/mcp/token', { token, body: { readOnly: true } })

    expect(made.status).toBe(200)
    expect(made.json.token).toMatch(/^nib_/)

    // Asking again says one exists, but never repeats the secret.
    const asked = await call(env, '/v1/mcp/token', { token })
    expect(asked.json.exists).toBe(true)
    expect(asked.json.token).toBeUndefined()
  })

  test('replaces the previous one', async () => {
    const first = await connector()
    const second = await connector()

    expect(first).not.toBe(second)
    expect((await rpc(first, 'tools/list')).status).toBe(401)
    expect((await rpc(second, 'tools/list')).status).toBe(200)
  })

  test('can be taken back', async () => {
    const key = await connector()
    await call(env, '/v1/mcp/token', { token, method: 'DELETE' })

    expect((await rpc(key, 'tools/list')).status).toBe(401)
  })

  test('needs a session to ask for', async () => {
    expect((await call(env, '/v1/mcp/token', { body: {} })).status).toBe(401)
  })
})

describe('the connector', () => {
  test('refuses a caller with no token', async () => {
    expect(
      (await call(env, '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'ping' } })).status,
    ).toBe(401)
  })

  test('refuses a token that was never issued', async () => {
    expect((await rpc('nib_madeup', 'ping')).status).toBe(401)
  })

  test('introduces itself', async () => {
    const response = await rpc(await connector(), 'initialize')

    expect(response.json.result.serverInfo.name).toBe('nib')
    expect(response.json.result.capabilities.tools).toBeDefined()
  })

  test('lists its tools', async () => {
    const response = await rpc(await connector(), 'tools/list')
    const names = response.json.result.tools.map((entry: { name: string }) => entry.name)

    expect(names).toContain('list_spaces')
    expect(names).toContain('read_note')
    expect(names).toContain('write_note')
  })

  test('answers a notification with no body', async () => {
    const response = await rpc(await connector(), 'notifications/initialized')
    expect(response.status).toBe(202)
  })

  test('says so for a method it does not have', async () => {
    const response = await rpc(await connector(), 'tools/nonsense')
    expect(response.json.error.code).toBe(-32601)
  })
})

describe('reading notes through it', () => {
  test('lists the spaces', async () => {
    expect(await tool(await connector(), 'list_spaces')).toContain('Work')
  })

  test('lists the notes in one', async () => {
    expect(await tool(await connector(), 'list_notes', { space: 'Work' })).toContain('plan.md')
  })

  test('takes a space id as readily as a name', async () => {
    expect(await tool(await connector(), 'list_notes', { space })).toContain('plan.md')
  })

  test('reads a note', async () => {
    expect(
      await tool(await connector(), 'read_note', { space: 'Work', path: 'plan.md' }),
    ).toContain('Ship the thing.')
  })

  test('searches across the account', async () => {
    expect(await tool(await connector(), 'search_notes', { query: 'ship' })).toContain('plan.md')
  })

  test('says plainly when a space is not there', async () => {
    expect(await tool(await connector(), 'list_notes', { space: 'Nowhere' })).toContain('No space')
  })

  test('refuses a path that climbs out of the space', async () => {
    const text = await tool(await connector(), 'read_note', {
      space: 'Work',
      path: '../../etc/passwd',
    })
    expect(text).toContain('not a note path')
  })
})

describe('the notes that link to one note', () => {
  async function addNote(path: string, content: string) {
    await call(env, `/v1/spaces/${space}/notes`, { token, body: { path, content } })
  }

  test('are found by name, by path and in either spelling', async () => {
    await addNote('one.md', 'see [[plan]] now\n')
    await addNote('two.md', 'and [the plan](plan.md)\n')
    await addNote('three.md', 'nothing to do with it\n')

    const text = await tool(await connector(), 'list_backlinks', {
      space: 'Work',
      path: 'plan.md',
    })

    expect(text).toContain('one.md:1')
    expect(text).toContain('two.md:1')
    expect(text).not.toContain('three.md')
  })

  test('say which line each one is on', async () => {
    await addNote('one.md', '# One\n\nsome words\n\nsee [[plan]]\n')

    const text = await tool(await connector(), 'list_backlinks', {
      space: 'Work',
      path: 'plan.md',
    })
    expect(text).toContain('one.md:5')
  })

  test('a note nothing links to says so', async () => {
    const text = await tool(await connector(), 'list_backlinks', {
      space: 'Work',
      path: 'plan.md',
    })
    expect(text).toContain('Nothing links to plan.md')
  })

  test('a link inside code is not a link', async () => {
    await addNote('one.md', 'write `[[plan]]` to link\n')

    const text = await tool(await connector(), 'list_backlinks', {
      space: 'Work',
      path: 'plan.md',
    })
    expect(text).toContain('Nothing links to')
  })

  test('a path nobody could have is refused rather than searched for', async () => {
    const text = await tool(await connector(), 'list_backlinks', {
      space: 'Work',
      path: '../../etc/passwd',
    })
    expect(text).toContain('not a note path')
  })

  test('it is offered to the model like every other tool', async () => {
    const listed = await rpc(await connector(), 'tools/list')
    expect(listed.json.result.tools.map((one) => one.name)).toContain('list_backlinks')
  })
})

/** A model sends what it likes. Every one of these used to reach a `null.id` or
 *  a `String({})` and come back as a message about a property of undefined. */
describe('what a tool is given', () => {
  test('a space nobody named is asked for in words', async () => {
    const key = await connector()

    expect(await tool(key, 'list_notes')).toContain('Which space')
    expect(await tool(key, 'read_note', { path: 'plan.md' })).toContain('Which space')
    expect(await tool(key, 'list_notes', { space: '  ' })).toContain('Which space')
  })

  test('an argument of the wrong kind is said to be one', async () => {
    const key = await connector()

    expect(await tool(key, 'list_notes', { space: 5 })).toContain('name or an id')
    expect(await tool(key, 'read_note', { space: 'Work', path: { a: 1 } })).toContain(
      'not a note path',
    )
    expect(await tool(key, 'search_notes', { query: [] })).toContain('has to be text')
  })

  test('a tool nobody has is named back', async () => {
    expect(await tool(await connector(), 'drop_everything')).toContain('No tool called')
  })

  test('a request that is not one is refused', async () => {
    const key = await connector()

    expect((await call(env, '/mcp', { token: key, body: [] })).status).toBe(400)
    expect((await call(env, '/mcp', { token: key, body: null })).status).toBe(400)
    expect((await call(env, '/mcp', { token: key, body: { jsonrpc: '2.0', id: 1 } })).status).toBe(
      400,
    )
  })

  test('an id that is not one is answered as none', async () => {
    const response = await rpc(await connector(), 'ping')
    expect(response.json.id).toBe(1)

    const odd = await call<RpcView>(env, '/mcp', {
      token: await connector(),
      body: { jsonrpc: '2.0', id: { nested: true }, method: 'ping' },
    })
    expect(odd.json.id).toBeNull()
  })
})

describe('writing through it', () => {
  test('is refused while the token is read-only', async () => {
    const text = await tool(await connector(true), 'write_note', {
      space: 'Work',
      path: 'new.md',
      content: 'hello',
    })

    expect(text).toContain('only read')
  })

  test('creates a note when the token allows it', async () => {
    const key = await connector(false)
    expect(
      await tool(key, 'write_note', { space: 'Work', path: 'new.md', content: 'hello' }),
    ).toContain('Saved')

    expect(await tool(key, 'read_note', { space: 'Work', path: 'new.md' })).toBe('hello')
  })

  test('replaces one that is already there', async () => {
    const key = await connector(false)
    await tool(key, 'write_note', { space: 'Work', path: 'plan.md', content: 'replaced' })

    expect(await tool(key, 'read_note', { space: 'Work', path: 'plan.md' })).toBe('replaced')
  })

  test('goes to the account’s own space when somebody else’s has the same name', async () => {
    // Being invited is enough to have a space in the list, so a stranger who knows
    // the address can put a Work beside this account's Work - spelled to sort first,
    // which is what the first of two equal names used to be.
    const stranger = await signIn(env, 'x@y.dev')
    const theirs = await call(env, '/v1/spaces', { token: stranger, body: { name: 'WORK' } })
    await call(env, `/v1/spaces/${theirs.json.space.id}/share/invite`, {
      token: stranger,
      body: { email: 'a@b.dev', role: 'write' },
    })

    const key = await connector(false)
    await tool(key, 'write_note', { space: 'Work', path: 'secret.md', content: 'mine' })

    const own = await call(env, `/v1/spaces/${space}/changes?since=0`, { token })
    expect(own.json.notes.map((note: { path: string }) => note.path)).toContain('secret.md')

    const leaked = await call(env, `/v1/spaces/${theirs.json.space.id}/changes?since=0`, {
      token: stranger,
    })
    expect(leaked.json.notes).toEqual([])
  })

  test('and asks which, where two spaces it does not own share a name', async () => {
    for (const email of ['x@y.dev', 'z@y.dev']) {
      const stranger = await signIn(env, email)
      const theirs = await call(env, '/v1/spaces', { token: stranger, body: { name: 'Club' } })
      await call(env, `/v1/spaces/${theirs.json.space.id}/share/invite`, {
        token: stranger,
        body: { email: 'a@b.dev', role: 'write' },
      })
    }

    const text = await tool(await connector(false), 'write_note', {
      space: 'Club',
      path: 'note.md',
      content: 'hello',
    })
    expect(text).toContain('Name one by its id')
  })

  test('a written note reaches the syncing clients', async () => {
    const key = await connector(false)
    await tool(key, 'write_note', { space: 'Work', path: 'fresh.md', content: 'from the llm' })

    const changes = await call(env, `/v1/spaces/${space}/changes?since=0`, { token })
    const paths = changes.json.notes.map((note: { path: string }) => note.path)

    expect(paths).toContain('fresh.md')
  })

  /** The connector is a second door onto the same notes, so it has to hold the
   *  same limits. It used to hold neither: a model could write past the quota
   *  and past the size a note may be. */
  test('is refused once the account is full', async () => {
    const key = await connector(false)
    const owner = env.db.prepare('select id from users limit 1').get() as { id: string }
    env.db
      .prepare('insert into blobs (hash, user_id, size, type, created_at) values (?, ?, ?, ?, ?)')
      .run('a'.repeat(64), owner.id, QUOTA, 'image/png', 1)

    const text = await tool(key, 'write_note', {
      space: 'Work',
      path: 'big.md',
      content: 'x'.repeat(100),
    })

    expect(text).toContain('out of space')
    expect(await tool(key, 'list_notes', { space: 'Work' })).not.toContain('big.md')
  })

  test('counts what it writes in bytes', async () => {
    const key = await connector(false)
    await tool(key, 'write_note', { space: 'Work', path: 'emoji.md', content: '🙂' })

    const row = env.db.prepare('select size from notes where path = ?').get('emoji.md') as {
      size: number
    }
    expect(row.size).toBe(4)
  })

  test('one account cannot reach another', async () => {
    const otherToken = await signIn(env, 'other@b.dev')
    const otherKey = await call(env, '/v1/mcp/token', {
      token: otherToken,
      body: { readOnly: false },
    })

    // Their own account's space, and nothing of this one's.
    expect(await tool(otherKey.json.token, 'list_spaces')).toBe('Notes')
    expect(
      await tool(otherKey.json.token, 'read_note', { space: 'Work', path: 'plan.md' }),
    ).toContain('No space')
  })
})
