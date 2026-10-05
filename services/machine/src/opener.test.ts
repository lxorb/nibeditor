import type { AddressInfo } from 'node:net'
import { afterEach, expect, test } from 'vitest'
import { askedOf, serveOpener } from './opener'

const servers: { close: () => void }[] = []
afterEach(() => {
  for (const server of servers.splice(0)) server.close()
})

/** The endpoint on a port of this computer's (the image's is a Unix socket), with an
 *  opener that keeps what it was asked and answers `heard`. */
async function started(heard = true, now: () => number = Date.now) {
  const opened: { url: string; session: string }[] = []
  const server = serveOpener(
    {
      open: (url, session) => {
        opened.push({ url, session })
        return heard
      },
    },
    now,
  )
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const post = (body: unknown, path = '/open') =>
    fetch(`http://127.0.0.1:${String(port)}${path}`, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }).then((answer) => answer.status)
  return { opened, post }
}

test('opens a web address for the session that asked', async () => {
  const { opened, post } = await started()
  expect(await post({ url: 'https://github.com/login/device', session: 's_1' })).toBe(202)
  expect(await post({ url: 'http://example.com/' })).toBe(202)
  expect(opened).toEqual([
    { url: 'https://github.com/login/device', session: 's_1' },
    { url: 'http://example.com/', session: '' },
  ])
})

test.each([
  { url: 'file:///etc/passwd' },
  { url: 'javascript:alert(1)' },
  { url: 'ms-settings:' },
  {},
  'not json',
  '[]',
])('opens nothing that is not the web: %j', async (body) => {
  const { opened, post } = await started()
  expect(await post(body)).toBe(400)
  expect(opened).toEqual([])
})

test('answers only its own path', async () => {
  const { opened, post } = await started()
  expect(await post({ url: 'https://a.b/' }, '/link')).toBe(404)
  expect(opened).toEqual([])
})

test('says so when no nib hears it, so the program prints the address instead', async () => {
  const { post } = await started(false)
  expect(await post({ url: 'https://a.b/' })).toBe(503)
})

test('opens ten a minute, and then nothing until the next', async () => {
  let now = 0
  const { opened, post } = await started(true, () => now)
  const answers: number[] = []
  for (let one = 0; one < 12; one++) answers.push(await post({ url: `https://a.b/${String(one)}` }))
  expect(answers.filter((status) => status === 202)).toHaveLength(10)
  expect(answers.slice(10)).toEqual([429, 429])
  now = 60_000
  expect(await post({ url: 'https://a.b/again' })).toBe(202)
  expect(opened).toHaveLength(11)
})

test('reads a request the way the script writes one', () => {
  expect(askedOf('{"url":"https://a.b/","session":"s_1"}')).toEqual({
    url: 'https://a.b/',
    session: 's_1',
  })
  expect(askedOf('{"url":"https://a.b/","session":7}')).toEqual({
    url: 'https://a.b/',
    session: '',
  })
  expect(askedOf(null)).toBeNull()
})
