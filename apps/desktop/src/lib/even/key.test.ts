import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The key field's four states, which are the whole of what the pane can show.
 *
 *  Emil's rule is "it stays in the account, but after you set it you can't read it
 *  anymore", so the field is not a field with a value in it. It is: nothing set,
 *  saving, set and ending in four characters, or a sentence about what went wrong.
 *  Nothing in this file ever has a key in its hand, because nothing in the app
 *  does. */

const server = vi.hoisted(() => ({
  /** Whether there is an account behind this machine. */
  signedIn: true,
  /** What the account holds, as the routes answer it. */
  set: false,
  tail: '',
  /** Set to make the key routes refuse, in the server's own words. */
  refuse: '',
  /** What the models route answers. */
  models: ['gpt-6-astra', 'gpt-5.6-sol'] as string[],
  /** Every call, in order, so a test can say what was and was not asked for. */
  asked: [] as string[],
}))

vi.mock('../api', () => ({
  api: {
    setAskKey: (_token: string, key: string) => {
      server.asked.push(`put ${key}`)
      if (server.refuse) return Promise.reject(new Error(server.refuse))

      server.set = true
      server.tail = key.slice(-4)
      return Promise.resolve({ set: server.set, tail: server.tail })
    },
    removeAskKey: () => {
      server.asked.push('remove')
      if (server.refuse) return Promise.reject(new Error(server.refuse))

      server.set = false
      server.tail = ''
      return Promise.resolve({ set: false, tail: '' })
    },
    askModels: () => {
      server.asked.push('models')
      return Promise.resolve({ models: server.models })
    },
  },
}))

vi.mock('../account.svelte', () => ({
  account: {
    get accountToken() {
      return server.signedIn ? 'session' : null
    },
  },
}))

vi.mock('../i18n.svelte', () => ({
  t: (text: string) => text,
  key: (text: string) => text,
}))

/** The model select, which is the one thing the key store's neighbour writes to. */
const chosen = vi.hoisted(() => ({ model: '' }))

vi.mock('../modes.svelte', () => ({
  modes: {
    get glassesModel() {
      return chosen.model
    },
    setGlassesModel: (model: string) => {
      chosen.model = model
    },
  },
}))

let glassesKey: typeof import('./key.svelte').glassesKey
let Offered: typeof import('./offered.svelte').Offered

beforeEach(async () => {
  server.signedIn = true
  server.set = false
  server.tail = ''
  server.refuse = ''
  server.models = ['gpt-6-astra', 'gpt-5.6-sol']
  server.asked = []
  chosen.model = ''

  vi.resetModules()
  glassesKey = (await import('./key.svelte')).glassesKey
  Offered = (await import('./offered.svelte')).Offered
})

describe('what this machine knows about the account’s key', () => {
  test('is nothing at all until the account has answered', () => {
    expect(glassesKey.set).toBe(false)
    expect(glassesKey.tail).toBe('')
  })

  test('is whether there is one and its last four characters, and never more', () => {
    glassesKey.took({ set: true, tail: '4f2a' })

    expect(glassesKey.set).toBe(true)
    expect(glassesKey.tail).toBe('4f2a')
    // There is nowhere on this store to put a key, which is the point.
    expect(Object.values(glassesKey).join(' ')).not.toContain('sk-')
  })

  test('stays as it was when the account answered nothing', () => {
    glassesKey.took({ set: true, tail: '4f2a' })
    glassesKey.took(undefined)
    expect(glassesKey.tail).toBe('4f2a')
  })
})

describe('setting a key', () => {
  test('sends it once and keeps only what came back', async () => {
    expect(await glassesKey.put('sk-proj-example-4f2a')).toBe('')

    expect(server.asked).toEqual(['put sk-proj-example-4f2a'])
    expect(glassesKey.set).toBe(true)
    expect(glassesKey.tail).toBe('4f2a')
  })

  test('trims what was pasted, because a key off a web page brings a newline', async () => {
    await glassesKey.put('  sk-proj-example-9999\n')
    expect(server.asked).toEqual(['put sk-proj-example-9999'])
  })

  test('answers what the server refused with, and changes nothing', async () => {
    server.refuse = 'this server cannot keep a key yet'
    expect(await glassesKey.put('sk-proj-example-4f2a')).toBe('this server cannot keep a key yet')
    expect(glassesKey.set).toBe(false)
  })

  test('asks for nothing at all with no account behind the machine', async () => {
    server.signedIn = false
    expect(await glassesKey.put('sk-proj-example-4f2a')).toBe('sign in first')
    expect(server.asked).toEqual([])
  })

  test('replaces on a second write, because there is no editing what cannot be read', async () => {
    await glassesKey.put('sk-proj-example-4f2a')
    await glassesKey.put('sk-proj-another-9999')

    expect(glassesKey.tail).toBe('9999')
    expect(server.asked).toEqual(['put sk-proj-example-4f2a', 'put sk-proj-another-9999'])
  })

  test('takes it away, and says so', async () => {
    await glassesKey.put('sk-proj-example-4f2a')
    await glassesKey.remove()

    expect(glassesKey.set).toBe(false)
    expect(glassesKey.tail).toBe('')
  })

  test('leaves the field saying "set" where taking it away was refused', async () => {
    await glassesKey.put('sk-proj-example-4f2a')
    server.refuse = 'no'
    await glassesKey.remove()

    expect(glassesKey.set).toBe(true)
  })
})

describe('the line under the field', () => {
  test('says nothing before a key is typed', () => {
    const offered = new Offered()
    expect(offered.said).toBe('')
    expect(offered.models).toEqual([])
  })

  test('asks for the models the moment a key goes in, and then says nothing', async () => {
    const offered = new Offered()
    await offered.take('sk-proj-example-4f2a')

    expect(server.asked).toEqual(['put sk-proj-example-4f2a', 'models'])
    expect(offered.models).toEqual(['gpt-6-astra', 'gpt-5.6-sol'])
    expect(offered.said).toBe('')
    // Nothing chosen yet, so the newest family is taken: a select with nothing in
    // it is a question the reader cannot answer.
    expect(chosen.model).toBe('gpt-6-astra')
  })

  test('says why where the key was refused, and offers no models', async () => {
    server.refuse = 'that does not look like a key'
    const offered = new Offered()
    await offered.take('nonsense')

    expect(offered.said).toBe('that does not look like a key')
    expect(offered.models).toEqual([])
    expect(server.asked).toEqual(['put nonsense'])
  })

  test('says so where the key can use nothing Nib asks for', async () => {
    server.models = []
    const offered = new Offered()
    await offered.take('sk-proj-example-4f2a')

    expect(offered.said).toBe('That key cannot use any of the models nibeditor asks for.')
  })

  test('sends nothing at all for an empty field', async () => {
    const offered = new Offered()
    await offered.take('   ')

    expect(server.asked).toEqual([])
    expect(offered.said).toBe('')
  })

  test('asks at once when the pane is opened with a key already set', async () => {
    glassesKey.took({ set: true, tail: '4f2a' })
    new Offered()
    await Promise.resolve()

    expect(server.asked).toEqual(['models'])
  })

  test('drops the models with the key, because they were that key’s', async () => {
    const offered = new Offered()
    await offered.take('sk-proj-example-4f2a')
    await offered.remove()

    expect(glassesKey.set).toBe(false)
    expect(offered.models).toEqual([])
    expect(offered.said).toBe('')
  })
})
