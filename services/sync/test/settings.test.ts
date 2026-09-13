import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { call, signIn, testEnv, type TestEnv } from './harness'

let env: TestEnv
let token: string

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')
})

afterEach(() => env.close())

function patch(body: unknown, as = token) {
  return call(env, '/v1/settings', { method: 'PATCH', token: as, body })
}

describe('account settings', () => {
  test('start empty', async () => {
    const response = await call(env, '/v1/settings', { token })
    expect(response.status).toBe(200)
    expect(response.json.settings).toEqual({})
  })

  test('keep what is chosen', async () => {
    const set = await patch({ ligatures: true })
    expect(set.status).toBe(200)
    expect(set.json.settings).toEqual({ ligatures: true })

    const read = await call(env, '/v1/settings', { token })
    expect(read.json.settings).toEqual({ ligatures: true })
  })

  test('a change leaves the rest as it was', async () => {
    await patch({ ligatures: true })
    expect((await patch({})).json.settings).toEqual({ ligatures: true })
    expect((await patch({ ligatures: false })).json.settings).toEqual({ ligatures: false })
  })

  test('refuse what the app does not know', async () => {
    expect((await patch({ colour: 'red' })).status).toBe(400)
    expect((await patch({ ligatures: 'yes' })).status).toBe(400)
    expect((await patch([true])).status).toBe(400)
    expect((await call(env, '/v1/settings', { token })).json.settings).toEqual({})
  })

  /** The ligature setting was a switch before it was a scope. Both shapes are
   *  kept as they arrive, because one account is read by every version of the
   *  app at once and the older ones only know the switch. */
  test('the ligature scope is one of the three the app offers', async () => {
    for (const scope of ['off', 'code', 'all']) {
      const set = await patch({ ligatures: scope })
      expect(set.status, scope).toBe(200)
      expect(set.json.settings.ligatures).toBe(scope)
    }
  })

  test('and a switch from an older build still reads', async () => {
    expect((await patch({ ligatures: true })).json.settings.ligatures).toBe(true)
    expect((await patch({ ligatures: false })).json.settings.ligatures).toBe(false)
  })

  test('but not a scope nobody has heard of', async () => {
    expect((await patch({ ligatures: 'sometimes' })).status).toBe(400)
    expect((await patch({ ligatures: 2 })).status).toBe(400)
  })

  describe('how long a note keeps its earlier versions', () => {
    test('is one of the intervals the app offers', async () => {
      for (const minutes of [0, 1, 5, 15]) {
        const set = await patch({ recoveryEvery: minutes })
        expect(set.status, String(minutes)).toBe(200)
        expect(set.json.settings.recoveryEvery).toBe(minutes)
      }

      for (const days of [1, 7, 30]) {
        const set = await patch({ recoveryDays: days })
        expect(set.status, String(days)).toBe(200)
        expect(set.json.settings.recoveryDays).toBe(days)
      }
    })

    test('and nothing else', async () => {
      expect((await patch({ recoveryEvery: 3 })).status).toBe(400)
      expect((await patch({ recoveryEvery: '5' })).status).toBe(400)
      expect((await patch({ recoveryDays: 0 })).status).toBe(400)
      expect((await patch({ recoveryDays: 365 })).status).toBe(400)
    })
  })

  test('are the account’s alone', async () => {
    const other = await signIn(env, 'c@d.dev')
    await patch({ ligatures: true })
    expect((await call(env, '/v1/settings', { token: other })).json.settings).toEqual({})
    expect((await call(env, '/v1/settings')).status).toBe(401)
  })
})

describe('where a pasted picture goes', () => {
  test('is one of the three folders the app offers', async () => {
    for (const folder of ['space', 'note', 'named']) {
      const set = await patch({ attachments: folder })
      expect(set.status, folder).toBe(200)
      expect(set.json.settings.attachments).toBe(folder)
    }
  })

  test('is nothing else', async () => {
    expect((await patch({ attachments: 'vault' })).status).toBe(400)
    expect((await patch({ attachments: true })).status).toBe(400)
    expect((await patch({ attachments: null })).status).toBe(400)
    expect((await call(env, '/v1/settings', { token })).json.settings).toEqual({})
  })

  test('says which names it takes', async () => {
    expect((await patch({ attachments: 'vault' })).json.error).toContain('space, note, named')
  })
})

describe('the keyboard an account is on', () => {
  test('is one of the ones the app has', async () => {
    for (const preset of ['default', 'notion', 'obsidian', 'vim', 'custom']) {
      const set = await patch({ preset })
      expect(set.status, preset).toBe(200)
      expect(set.json.settings.preset).toBe(preset)
    }
  })

  /** A preset name is shown as a word in a select, so an account may not carry
   *  a sentence, a number or a name no version of the app has. */
  test('is nothing else', async () => {
    expect((await patch({ preset: 'emacs' })).status).toBe(400)
    expect((await patch({ preset: '' })).status).toBe(400)
    expect((await patch({ preset: 7 })).status).toBe(400)
    expect((await patch({ preset: null })).status).toBe(400)
    expect((await patch({ preset: ['vim'] })).status).toBe(400)
  })

  test('says which names it takes', async () => {
    expect((await patch({ preset: 'emacs' })).json.error).toContain('default, notion, obsidian')
  })

  test('travels beside the map it names', async () => {
    await patch({ preset: 'custom', shortcuts: { 'format.bold': 'Mod-Alt-b' } })

    const read = await call(env, '/v1/settings', { token })
    expect(read.json.settings).toEqual({
      preset: 'custom',
      shortcuts: { 'format.bold': 'Mod-Alt-b' },
    })
  })
})

describe('modal editing on an account', () => {
  test('is on or off', async () => {
    expect((await patch({ vim: true })).json.settings.vim).toBe(true)
    expect((await patch({ vim: false })).json.settings.vim).toBe(false)
  })

  test('is nothing else', async () => {
    expect((await patch({ vim: 'yes' })).status).toBe(400)
    expect((await patch({ vim: 1 })).status).toBe(400)
    expect((await patch({ vim: null })).status).toBe(400)
  })

  /** It is a mode rather than a map: someone on the Obsidian keyboard can have
   *  modal editing too, so the two travel independently. */
  test('sits beside the keyboard rather than inside it', async () => {
    await patch({ preset: 'obsidian' })
    await patch({ vim: true })

    const read = await call(env, '/v1/settings', { token })
    expect(read.json.settings).toEqual({ preset: 'obsidian', vim: true })
  })
})

/** The Glasses section, which only the Even Hub plugin shows.
 *
 *  All of it is on the account rather than on the machine, because the plugin runs
 *  on a phone and is set up on a desktop. That is the whole reason the Worker has
 *  to know these names at all: a key it does not know is a 400, so a setting that
 *  is not here cannot travel. */
describe('the glasses an account reads on', () => {
  test('start a page at a heading level, or at none', async () => {
    expect((await patch({ glassesBreak: 2 })).json.settings.glassesBreak).toBe(2)
    expect((await patch({ glassesBreak: 0 })).json.settings.glassesBreak).toBe(0)
    expect((await patch({ glassesBreak: 6 })).json.settings.glassesBreak).toBe(6)
  })

  test('refuse a heading level there is no such thing as', async () => {
    expect((await patch({ glassesBreak: 7 })).status).toBe(400)
    expect((await patch({ glassesBreak: -1 })).status).toBe(400)
    expect((await patch({ glassesBreak: '2' })).status).toBe(400)
  })

  test('carry the three switches', async () => {
    const set = await patch({
      glassesLineNumbers: false,
      glassesPageNumber: true,
      glassesVoice: true,
    })

    expect(set.json.settings).toMatchObject({
      glassesLineNumbers: false,
      glassesPageNumber: true,
      glassesVoice: true,
    })
  })

  test('refuse a switch that is not one', async () => {
    for (const name of ['glassesLineNumbers', 'glassesPageNumber', 'glassesVoice']) {
      expect((await patch({ [name]: 'yes' })).status, name).toBe(400)
    }
  })

  test('carry the model and the effort', async () => {
    const set = await patch({ glassesModel: 'gpt-6-astra', glassesEffort: 'high' })

    expect(set.json.settings).toMatchObject({
      glassesModel: 'gpt-6-astra',
      glassesEffort: 'high',
    })
  })

  test('refuse an effort the model API does not take', async () => {
    // The list is the API's own, read off the error it answers an invalid one with.
    expect((await patch({ glassesEffort: 'max' })).status).toBe(200)
    expect((await patch({ glassesEffort: 'banana' })).status).toBe(400)
  })

  test('carry how much white space reaches the panel, and who scrolls', async () => {
    for (const level of ['none', 'collapse', 'aggressive']) {
      expect((await patch({ glassesCompaction: level })).status, level).toBe(200)
    }
    for (const mode of ['paged', 'native']) {
      expect((await patch({ glassesScroll: mode })).status, mode).toBe(200)
    }

    expect((await patch({ glassesCompaction: 'a bit' })).status).toBe(400)
    expect((await patch({ glassesScroll: 'sideways' })).status).toBe(400)
  })

  /** Which of a note's markers are drawn, by construct. Named rather than accepted
   *  as any object, so an account cannot carry a switch no version of the app has
   *  ever heard of. */
  test('carry the markers a reader turned on, and only the ones there are', async () => {
    const set = await patch({ glassesMarks: { fence: true, bold: true } })
    expect(set.status).toBe(200)
    expect(set.json.settings.glassesMarks).toEqual({ fence: true, bold: true })

    expect((await patch({ glassesMarks: { subheading: true } })).status).toBe(400)
    expect((await patch({ glassesMarks: { bold: 'yes' } })).status).toBe(400)
    expect((await patch({ glassesMarks: [true] })).status).toBe(400)
  })

  /** The phrases a spoken command answers to. The ids are the app's own and are not
   *  listed on the server, for the same reason the shortcut ids are not. */
  test('carry the phrases a reader rebound', async () => {
    const set = await patch({ glassesWords: { next: 'vorwärts', close: 'zu' } })
    expect(set.status).toBe(200)
    expect(set.json.settings.glassesWords).toEqual({ next: 'vorwärts', close: 'zu' })

    expect((await patch({ glassesWords: { next: 'x'.repeat(61) } })).status).toBe(400)
    expect((await patch({ glassesWords: { 'Not An Id': 'no' } })).status).toBe(400)
    expect((await patch({ glassesWords: { next: 12 } })).status).toBe(400)
  })

  /** What the Glasses section on every other device waits for. */
  test('remember that a pair of glasses has answered', async () => {
    expect((await patch({ glassesSeen: true })).status).toBe(200)
    expect((await call(env, '/v1/settings', { token })).json.settings.glassesSeen).toBe(true)
    expect((await patch({ glassesSeen: 'yes' })).status).toBe(400)
  })

  /** Emil, on his desktop: *"I don't see the glasses setting on desktop, even though I
   *  already had the Even plugin open."* One device says it and another reads it, which
   *  is the whole of what the setting is for - so the round trip is the test, not the
   *  one session patching and reading its own answer back. */
  test('and hand that to every other device on the account', async () => {
    const phone = await signIn(env, 'a@b.dev')
    const desktop = await signIn(env, 'a@b.dev')

    const before = await call(env, '/v1/settings', { token: desktop })
    expect(before.json.settings.glassesSeen).toBeUndefined()

    expect((await patch({ glassesSeen: true }, phone)).status).toBe(200)

    const after = await call(env, '/v1/settings', { token: desktop })
    expect(after.json.settings.glassesSeen).toBe(true)
  })

  test('refuse a model long enough to be a novel', async () => {
    expect((await patch({ glassesModel: 'x'.repeat(101) })).status).toBe(400)
    expect((await patch({ glassesModel: 'gpt-6-astra' })).status).toBe(200)
  })

  /** The key used to be a setting here, in the clear, and every read handed it
   *  back. It is not one any more: it is encrypted on the row and set through
   *  `PUT /v1/ask/key`. The settings read says whether there is one and what its
   *  last four characters are, and that is all any read ever says. See ask.test.ts. */
  test('do not carry the key at all, and say only whether there is one', async () => {
    expect((await patch({ glassesKey: 'sk-proj-AbC123-_xyz' })).status).toBe(400)

    const read = await call(env, '/v1/settings', { token })
    expect(read.json.settings.glassesKey).toBeUndefined()
    expect(read.json.key).toEqual({ set: false, tail: '' })
  })
})

describe('a name that is not a setting', () => {
  /** `KNOWN[name]` reaches Object's own properties for these, and what came
   *  back was called as though it were a check: a 500 from a body a client is
   *  free to send. Asked of the map itself, they are simply unknown. */
  test('is refused even when Object has one of its own', async () => {
    for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      const response = await call(env, '/v1/settings', {
        method: 'PATCH',
        token,
        raw: JSON.stringify({ [name]: true }),
        headers: { 'content-type': 'application/json' },
      })

      expect(response.status, name).toBe(400)
      expect(response.json.error, name).toContain('unknown setting')
    }
  })

  /** The name goes back out in the answer, and an answer is shown, logged and kept.
   *  A field name is a word, so there is no honest reason for one to be a kilobyte of
   *  somebody else's text - and every reason not to carry one back. */
  test('says back as much of it as is worth saying and no more', async () => {
    const long = `weather${'A'.repeat(5000)}`
    const response = await call(env, '/v1/settings', {
      method: 'PATCH',
      token,
      raw: JSON.stringify({ [long]: true }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(400)
    // Enough to recognise the typo that caused it.
    expect(response.json.error).toContain('unknown setting weather')
    expect(response.json.error.length).toBeLessThanOrEqual('unknown setting '.length + 64)
  })

  test('leaves the settings as they were', async () => {
    await patch({ ligatures: true })
    await call(env, '/v1/settings', {
      method: 'PATCH',
      token,
      raw: '{"__proto__":{"ligatures":false}}',
      headers: { 'content-type': 'application/json' },
    })

    expect((await call(env, '/v1/settings', { token })).json.settings).toEqual({ ligatures: true })
  })
})

describe('the phone bar an account carries', () => {
  test('keeps the commands on it, in order', async () => {
    const set = await patch({ toolbar: ['format.bold', 'paragraph.quote'] })
    expect(set.status).toBe(200)
    expect(set.json.settings.toolbar).toEqual(['format.bold', 'paragraph.quote'])

    const read = await call(env, '/v1/settings', { token })
    expect(read.json.settings.toolbar).toEqual(['format.bold', 'paragraph.quote'])
  })

  test('takes null, which is the default bar', async () => {
    // A choice like any other: without it a device could never learn that
    // another one went back to the default.
    expect((await patch({ toolbar: null })).status).toBe(200)
    expect((await call(env, '/v1/settings', { token })).json.settings.toolbar).toBeNull()
  })

  test('takes a bar with nothing on it', async () => {
    expect((await patch({ toolbar: [] })).status).toBe(200)
  })

  test('keeps a command this version has never heard of', async () => {
    // Read for its shape rather than against a list, for the reason a shortcut
    // id is: the commands are the app's.
    expect((await patch({ toolbar: ['something.new'] })).status).toBe(200)
  })

  test('refuses what is not a command id', async () => {
    expect((await patch({ toolbar: ['Format Bold'] })).status).toBe(400)
    expect((await patch({ toolbar: ['../etc'] })).status).toBe(400)
    expect((await patch({ toolbar: [7] })).status).toBe(400)
    expect((await patch({ toolbar: 'format.bold' })).status).toBe(400)
  })

  test('refuses the same command twice', async () => {
    expect((await patch({ toolbar: ['format.bold', 'format.bold'] })).status).toBe(400)
  })

  test('refuses more than a bar holds', async () => {
    const many = Array.from({ length: 25 }, (_unused, index) => `app.thing-${index}`)
    expect((await patch({ toolbar: many })).status).toBe(400)
  })
})

describe('the shortcuts an account carries', () => {
  test('keep a map of keys', async () => {
    const set = await patch({ shortcuts: { 'format.bold': 'Mod-Alt-b', 'app.save': 'F2' } })
    expect(set.status).toBe(200)
    expect(set.json.settings.shortcuts).toEqual({ 'format.bold': 'Mod-Alt-b', 'app.save': 'F2' })

    const read = await call(env, '/v1/settings', { token })
    expect(read.json.settings.shortcuts).toEqual({ 'format.bold': 'Mod-Alt-b', 'app.save': 'F2' })
  })

  test('take a key that was taken away', async () => {
    const set = await patch({ shortcuts: { 'format.bold': null } })
    expect(set.status).toBe(200)
    expect(set.json.settings.shortcuts).toEqual({ 'format.bold': null })
  })

  test('take the awkward combinations the app really writes', async () => {
    const keys = {
      'paragraph.heading-down': 'Mod--',
      'paragraph.ordered-list': 'Mod-Shift-[',
      'format.clear': 'Mod-\\',
      'format.code': 'Mod-Shift-`',
      'app.zoom-in': 'Mod-Shift-=',
      'table.below': 'ArrowDown',
      'edit.redo.alt': 'Ctrl-Shift-z',
    }

    expect((await patch({ shortcuts: keys })).status).toBe(200)
  })

  test('keep an id this version has never heard of', async () => {
    // A newer app may bind something this server knows nothing about. The id
    // is checked for shape, not against a list, so it survives.
    expect((await patch({ shortcuts: { 'something.new': 'Mod-9' } })).status).toBe(200)
  })

  test('refuse an id that is not one', async () => {
    expect((await patch({ shortcuts: { 'Format Bold': 'Mod-b' } })).status).toBe(400)
    expect((await patch({ shortcuts: { '../etc': 'Mod-b' } })).status).toBe(400)
    expect((await patch({ shortcuts: { ['a'.repeat(65)]: 'Mod-b' } })).status).toBe(400)
  })

  test('refuse a value that is not a key', async () => {
    expect((await patch({ shortcuts: { 'format.bold': 'Hyper-b' } })).status).toBe(400)
    expect((await patch({ shortcuts: { 'format.bold': 'Mod b' } })).status).toBe(400)
    expect((await patch({ shortcuts: { 'format.bold': '' } })).status).toBe(400)
    expect((await patch({ shortcuts: { 'format.bold': 7 } })).status).toBe(400)
    expect((await patch({ shortcuts: { 'format.bold': { key: 'Mod-b' } } })).status).toBe(400)
  })

  test('refuse anything but a map', async () => {
    expect((await patch({ shortcuts: [] })).status).toBe(400)
    expect((await patch({ shortcuts: 'Mod-b' })).status).toBe(400)
    expect((await patch({ shortcuts: null })).status).toBe(400)
  })

  test('refuse more than an account holds', async () => {
    const many = Object.fromEntries(
      Array.from({ length: 201 }, (_, index) => [`app.thing-${index}`, 'Mod-b']),
    )

    expect((await patch({ shortcuts: many })).status).toBe(400)
  })

  test('refuse a body too big for the column', async () => {
    // Every entry is legal on its own; together they are more than the row
    // will carry, which is the other end of the same guard.
    const big = Object.fromEntries(
      Array.from({ length: 199 }, (_, index) => [
        `app.${'thing'.repeat(10)}-${index}`,
        'Mod-Alt-Shift-ArrowDown',
      ]),
    )

    expect((await patch({ shortcuts: big })).status).toBe(413)
  })

  test('leave nothing behind when they are refused', async () => {
    await patch({ shortcuts: { 'format.bold': 'Mod-Alt-b' } })
    await patch({ shortcuts: { 'format.bold': 'nonsense key' } })

    const read = await call(env, '/v1/settings', { token })
    expect(read.json.settings.shortcuts).toEqual({ 'format.bold': 'Mod-Alt-b' })
  })

  test('sit beside the other settings rather than replacing them', async () => {
    await patch({ ligatures: true })
    await patch({ shortcuts: { 'app.save': 'F2' } })

    const read = await call(env, '/v1/settings', { token })
    expect(read.json.settings).toEqual({ ligatures: true, shortcuts: { 'app.save': 'F2' } })
  })
})
