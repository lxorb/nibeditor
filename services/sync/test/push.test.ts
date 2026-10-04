/** Push: where a device is reached, the reminders kept from the notes as they are
 *  saved, and each pushed once at its minute, against recorded answers of the three
 *  services. See src/push. */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { momentOf } from '@nib/markdown/task-reminders'
import { base64url, fromBase64url } from '../src/push/keys'
import { remindersIn, sendDue } from '../src/push/reminders'
import { forgetAccess } from '../src/push/fcm'
import { encrypted } from '../src/push/webpush'
import { call, signIn, testEnv, type TestEnv } from './harness'

let env: TestEnv
let token: string
let space: string

const ZONE = 'Europe/Zurich'
const WALL = { date: '2099-01-05', time: '09:00' }
const AT = momentOf(WALL, ZONE)
const TASK = '- [ ] Call the bank [remind:: 2099-01-05 09:00]\n'

beforeEach(async () => {
  env = testEnv()
  forgetAccess()
  token = await signIn(env, 'a@b.dev')
  const created = await call(env, '/v1/spaces', { token, body: { name: 'Work' } })
  space = (created.json as { space: { id: string } }).space.id
})

afterEach(() => env.close())

/** A fetch that answers from a list of recorded replies, and says what it was asked. */
function recorded(...replies: ((url: string) => Response)[]) {
  const asked: { url: string; init: RequestInit | undefined }[] = []
  const send = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString()
    asked.push({ url, init })
    const reply = replies.shift()
    return Promise.resolve(reply ? reply(url) : new Response('no reply recorded', { status: 500 }))
  }) as typeof fetch
  return { send, asked }
}

function register(body: Record<string, string>) {
  return call<{ id: string; error?: string }>(env, '/v2/push/targets', { token, body })
}

function save(path: string, content: string) {
  return call(env, `/v1/spaces/${space}/notes`, { token, body: { path, content } })
}

function kept() {
  return env.db.prepare('select id, at, title, body, sent_at from push_reminders').all() as {
    id: string
    at: number
    title: string
    body: string
    sent_at: number | null
  }[]
}

describe('Web Push encryption', () => {
  test('is RFC 8291 to the byte, on its own worked example', async () => {
    const asPublic = fromBase64url(
      'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    )
    const privateKey = await crypto.subtle.importKey(
      'jwk',
      {
        kty: 'EC',
        crv: 'P-256',
        x: base64url(asPublic.slice(1, 33)),
        y: base64url(asPublic.slice(33, 65)),
        d: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
      },
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    )
    const body = await encrypted(
      fromBase64url('V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24'),
      {
        p256dh:
          'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
        auth: 'BTBZMqHH6r4Tts7J_aSIgg',
      },
      { publicRaw: asPublic, privateKey, salt: fromBase64url('DGv6ra1nlYgDCS1FRnbzlw') },
    )
    expect(base64url(body)).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    )
  })
})

describe('targets', () => {
  test('a device registers once per token, and takes itself off', async () => {
    const first = await register({ kind: 'fcm', token: 'phone-token', zone: ZONE })
    expect(first.status).toBe(200)
    const again = await register({ kind: 'fcm', token: 'phone-token', zone: 'Asia/Tokyo' })
    expect(again.json.id).toBe(first.json.id)
    expect(env.db.prepare('select zone from push_targets').all()).toEqual([{ zone: 'Asia/Tokyo' }])

    await call(env, `/v2/push/targets/${first.json.id}`, { method: 'DELETE', token })
    expect(env.db.prepare('select id from push_targets').all()).toEqual([])
  })

  test('refuses what is not a target', async () => {
    expect((await register({ kind: 'pigeon', token: 'x' })).status).toBe(400)
    expect(
      (await register({ kind: 'webpush', token: 'http://evil.test/x', p256dh: 'a', auth: 'b' }))
        .status,
    ).toBe(400)
    expect((await register({ kind: 'webpush', token: 'https://push.test/x' })).status).toBe(400)
    expect((await register({ kind: 'fcm', token: 't', zone: 'Mars/Olympus' })).status).toBe(400)
  })

  test('says which services are on', async () => {
    expect((await call(env, '/v2/push/key', { token })).json).toEqual({
      webpush: null,
      fcm: false,
      apns: false,
    })
    env.VAPID_PUBLIC_KEY = 'BPublic'
    env.VAPID_PRIVATE_KEY = 'private'
    expect((await call(env, '/v2/push/key', { token })).json).toMatchObject({ webpush: 'BPublic' })
  })

  test('is closed to anybody signed out', async () => {
    expect(
      (await call(env, '/v2/push/targets', { body: { kind: 'fcm', token: 't' } })).status,
    ).toBe(401)
  })
})

describe('reminders kept from the notes', () => {
  test('only for an account with somewhere to push to', async () => {
    await save('Plan.md', TASK)
    expect(kept()).toEqual([])

    await register({ kind: 'fcm', token: 'phone-token', zone: ZONE })
    await save('Other.md', TASK)
    expect(kept()).toMatchObject([{ at: AT, title: 'Call the bank', body: 'Other', sent_at: null }])
  })

  test('a ticked task takes its reminder away', async () => {
    await register({ kind: 'fcm', token: 'phone-token', zone: ZONE })
    const made = await save('Plan.md', TASK)
    const id = (made.json as { note: { id: string; version: number } }).note
    await call(env, `/v1/notes/${id.id}`, {
      method: 'PUT',
      token,
      body: {
        content: '- [x] Call the bank [remind:: 2099-01-05 09:00] ✅ 2099-01-04\n',
        baseVersion: id.version,
      },
    })
    expect(kept()).toEqual([])
  })

  test('read the way the app reads them: no code, no front matter, the same id', () => {
    const content = ['---', 'title: Plan', '---', '```', TASK.trim(), '```', TASK.trim()].join('\n')
    const found = remindersIn(content, 'Work', 'Plan.md', ZONE, null, 0)
    expect(found.map((one) => [one.line, one.at])).toEqual([[6, AT]])
    expect(found[0]?.id).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('sending', () => {
  /** A Google service account with a key of its own. */
  async function serviceAccount() {
    const pair = (await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair
    const der = new Uint8Array(
      (await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer,
    )
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----\n`
    return JSON.stringify({ client_email: 'nib@x.iam', private_key: pem, project_id: 'nib-test' })
  }

  test('a due reminder goes to a phone once, as data the app decides on', async () => {
    env.FCM_SERVICE_ACCOUNT = await serviceAccount()
    await register({ kind: 'fcm', token: 'phone-token', zone: ZONE })
    await save('Plan.md', TASK)

    const fcm = recorded(
      () => Response.json({ access_token: 'access', expires_in: 3600 }),
      () => Response.json({ name: 'projects/nib-test/messages/1' }),
    )
    expect(await sendDue(env, AT - 60_000, fcm.send)).toBe(0)
    expect(await sendDue(env, AT, fcm.send)).toBe(1)
    expect(fcm.asked.map((one) => one.url)).toEqual([
      'https://oauth2.googleapis.com/token',
      'https://fcm.googleapis.com/v1/projects/nib-test/messages:send',
    ])
    const sent = JSON.parse(fcm.asked[1]?.init?.body as string) as {
      message: { token: string; data: Record<string, string> }
    }
    expect(sent.message.token).toBe('phone-token')
    expect(sent.message.data).toMatchObject({
      kind: 'reminder',
      title: 'Call the bank',
      body: 'Plan',
      space: 'Work',
      path: 'Plan.md',
    })
    expect(sent.message.data.id).toBe(kept()[0]?.id)

    // Sent once: the next minute, and a save of the same words, send nothing again.
    expect(await sendDue(env, AT + 60_000, fcm.send)).toBe(0)
    await save('Plan 2.md', '')
    expect(kept().filter((one) => one.sent_at !== null)).toHaveLength(1)
  })

  test('a subscription its service no longer has is dropped', async () => {
    const vapid = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
    ])) as CryptoKeyPair
    const jwk = (await crypto.subtle.exportKey('jwk', vapid.privateKey)) as JsonWebKey
    env.VAPID_PUBLIC_KEY = base64url(
      new Uint8Array((await crypto.subtle.exportKey('raw', vapid.publicKey)) as ArrayBuffer),
    )
    env.VAPID_PRIVATE_KEY = jwk.d ?? ''

    const browser = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair
    const p256dh = base64url(
      new Uint8Array((await crypto.subtle.exportKey('raw', browser.publicKey)) as ArrayBuffer),
    )
    await register({
      kind: 'webpush',
      token: 'https://push.example/send/abc',
      p256dh,
      auth: base64url(crypto.getRandomValues(new Uint8Array(16))),
      zone: ZONE,
    })
    await save('Plan.md', TASK)

    const gone = recorded(() => new Response('', { status: 410 }))
    await sendDue(env, AT, gone.send)
    const asked = gone.asked[0]
    expect(asked?.url).toBe('https://push.example/send/abc')
    const headers = asked?.init?.headers as Record<string, string>
    expect(headers.authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/)
    expect(headers['content-encoding']).toBe('aes128gcm')
    expect(env.db.prepare('select id from push_targets').all()).toEqual([])
  })

  test('a service with no keys is left alone, and its target kept', async () => {
    await register({ kind: 'apns', token: 'iphone-token', zone: ZONE })
    await save('Plan.md', TASK)
    const none = recorded()
    expect(await sendDue(env, AT, none.send)).toBe(0)
    expect(none.asked).toEqual([])
    expect(env.db.prepare('select kind from push_targets').all()).toEqual([{ kind: 'apns' }])
  })

  test('a note deleted since is not pushed', async () => {
    env.FCM_SERVICE_ACCOUNT = await serviceAccount()
    await register({ kind: 'fcm', token: 'phone-token', zone: ZONE })
    await save('Plan.md', TASK)
    env.db.prepare('update notes set deleted = 1').run()
    const none = recorded()
    expect(await sendDue(env, AT, none.send)).toBe(0)
    expect(none.asked).toEqual([])
  })
})

test('the automatic reminder is an account setting, of the choices the app offers', async () => {
  const set = await call(env, '/v1/settings', {
    method: 'PATCH',
    token,
    body: { remindBefore: 15 },
  })
  expect(set.status).toBe(200)
  const wrong = await call(env, '/v1/settings', {
    method: 'PATCH',
    token,
    body: { remindBefore: 7 },
  })
  expect(wrong.status).toBe(400)
})
