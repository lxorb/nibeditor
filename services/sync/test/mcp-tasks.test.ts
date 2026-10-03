/** The connector's to-dos and bases, with nib closed: a list read off the account's
 *  notes, a task added to the inbox, one ticked and moved, a base queried and a row
 *  added where it looks, and every write refused to a token that may only read and in
 *  a space shared to read (docs/tasks.md 5.15). */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { call, type RpcView, signIn, testEnv, type TestEnv } from './harness'

let env: TestEnv
let token: string
let space: string

const today = new Date().toISOString().slice(0, 10)

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')
  const created = await call(env, '/v1/spaces', { token, body: { name: 'Work' } })
  space = created.json.space.id

  const notes: [string, string][] = [
    [
      'Thesis.md',
      `# Thesis\n- [ ] Write the intro #writing ⏫ 📅 ${today}\n  - [ ] Outline\n- [ ] Read 🔁 every day 📅 ${today}\n`,
    ],
    ['Shop.md', '# Shop\n- [ ] Milk\n'],
    ['Books/Dune.md', '---\nstatus: reading\n---\n'],
  ]
  for (const [path, content] of notes) {
    await call(env, `/v1/spaces/${space}/notes`, { token, body: { path, content } })
  }
})

afterEach(() => env.close())

/** A `.base` file, which syncs as a file: its bytes kept by their hash. */
async function baseFile(path: string, yaml: string) {
  const hash = 'b'.repeat(64)
  await env.NOTES.put(`blobs/${hash}`, yaml)
  env.db
    .prepare(
      `insert into notes (id, space_id, path, seq, version, updated_at, deleted, size, hash, kind)
       values ('base-1', ?, ?, 99, 1, 1, 0, ?, ?, 'file')`,
    )
    .run(space, path, yaml.length, hash)
}

async function connector(readOnly = false): Promise<string> {
  const made = await call(env, '/v1/mcp/token', { token, body: { readOnly } })
  return made.json.token
}

async function tool(key: string, name: string, args: Record<string, unknown> = {}) {
  const response = await call<RpcView>(env, '/mcp', {
    token: key,
    body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
  })
  return response.json.result.content[0]?.text ?? ''
}

async function json(key: string, name: string, args: Record<string, unknown> = {}) {
  return JSON.parse(await tool(key, name, args)) as Record<string, unknown> & {
    tasks: { at: string; text: string }[]
  }
}

const read = async (key: string, path: string) => tool(key, 'read_note', { space: 'Work', path })

describe('the to-dos, with nib closed', () => {
  test('are listed with the tools', async () => {
    const response = await call<RpcView>(env, '/mcp', {
      token: await connector(),
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    })
    const names = response.json.result.tools.map((one: { name: string }) => one.name)
    expect(names).toEqual(
      expect.arrayContaining(['list_tasks', 'add_task', 'update_task', 'query_base', 'add_row']),
    )
  })

  test('Today, and a Todoist filter', async () => {
    const key = await connector(true)
    const listed = await json(key, 'list_tasks', { view: 'today' })
    expect(listed.tasks.map((one) => one.text)).toEqual(['Write the intro', 'Read'])
    const writing = await json(key, 'list_tasks', { filter: '#writing' })
    expect(writing.tasks).toMatchObject([{ text: 'Write the intro', space: 'Work', priority: 2 }])
  })

  test("a task added to the space's inbox, made the first time", async () => {
    const key = await connector()
    const added = await json(key, 'add_task', {
      space: 'Work',
      text: 'Call the bank 📅 2026-10-06',
    })
    expect(added.at).toMatch(/^Inbox\.md#0:/)
    expect(await read(key, 'Inbox.md')).toBe('- [ ] Call the bank 📅 2026-10-06\n')

    await json(key, 'add_task', {
      space: 'Work',
      text: 'Eggs',
      note: 'Shop',
      fields: { priority: 1 },
    })
    expect(await read(key, 'Shop.md')).toBe('# Shop\n- [ ] Milk\n- [ ] Eggs 🔺\n')
  })

  test('a recurring task ticked writes its next line, a task moved takes its sub-task', async () => {
    const key = await connector()
    const { tasks } = await json(key, 'list_tasks', { space: 'Work' })
    const recurring = tasks.find((one) => one.text === 'Read')
    const ticked = await json(key, 'update_task', { space: 'Work', at: recurring?.at, done: true })
    expect(ticked.next).toMatch(/^Thesis\.md#3:/)
    const after = (await read(key, 'Thesis.md')).split('\n')
    expect(after[3]).toMatch(/^- \[ \] Read 🔁 every day 📅 /)
    expect(after[4]).toBe(`- [x] Read 🔁 every day 📅 ${today} ✅ ${today}`)

    const intro = tasks.find((one) => one.text === 'Write the intro')
    await json(key, 'update_task', { space: 'Work', at: intro?.at, move_to: { note: 'Shop' } })
    expect(await read(key, 'Shop.md')).toBe(
      `# Shop\n- [ ] Milk\n- [ ] Write the intro #writing ⏫ 📅 ${today}\n  - [ ] Outline\n`,
    )
    expect(await read(key, 'Thesis.md')).not.toContain('Outline')
  })

  test('refused in sentences: a token that only reads, an anchor that is gone, a bad date', async () => {
    expect(await tool(await connector(true), 'add_task', { space: 'Work', text: 'x' })).toContain(
      'only read',
    )
    const key = await connector()
    expect(
      await tool(key, 'update_task', { space: 'Work', at: 'Thesis.md#1:zzz', done: true }),
    ).toContain('not in the note any more')
    const { tasks } = await json(key, 'list_tasks', { space: 'Work' })
    expect(
      await tool(key, 'update_task', { space: 'Work', at: tasks[0]?.at, due: 'soon' }),
    ).toContain('YYYY-MM-DD')
    expect(await tool(key, 'list_tasks', { space: 'Nowhere' })).toContain('No space')
  })

  test('a space shared to read is listed and never written', async () => {
    const owner = await signIn(env, 'x@y.dev')
    const theirs = await call(env, '/v1/spaces', { token: owner, body: { name: 'Club' } })
    const id = theirs.json.space.id
    await call(env, `/v1/spaces/${id}/notes`, {
      token: owner,
      body: { path: 'Club.md', content: '- [ ] Meet\n' },
    })
    await call(env, `/v1/spaces/${id}/share/invite`, {
      token: owner,
      body: { email: 'a@b.dev', role: 'read' },
    })

    const key = await connector()
    expect((await json(key, 'list_tasks', { space: 'Club' })).tasks).toMatchObject([
      { text: 'Meet' },
    ])
    expect(await tool(key, 'add_task', { space: 'Club', text: 'Sneak' })).toContain(
      'shared with you to read',
    )
  })
})

const BOOKS = [
  'filters: file.inFolder("Books")',
  'views:',
  '  - type: table',
  '    name: All',
  '',
].join('\n')

describe('bases, with nib closed', () => {
  test('a view queried, and a row added in the folder it looks in', async () => {
    await baseFile('Books.base', BOOKS)
    const key = await connector()
    expect(await json(key, 'query_base', { space: 'Work', path: 'Books.base' })).toMatchObject({
      total: 1,
      groups: [{ rows: [{ path: 'Books/Dune.md', status: 'reading' }] }],
    })
    expect(
      await json(key, 'add_row', {
        space: 'Work',
        base: 'Books.base',
        title: 'Emma',
        properties: { status: 'next' },
      }),
    ).toMatchObject({ path: 'Books/Emma.md', created: true })
    expect(await read(key, 'Books/Emma.md')).toBe('---\nstatus: next\n---\n')
  })

  test('a base said as yaml', async () => {
    const yaml = BOOKS.replace('file.inFolder("Books")', 'status == "reading"')
    expect(await json(await connector(true), 'query_base', { space: 'Work', yaml })).toMatchObject({
      total: 1,
    })
  })
})
