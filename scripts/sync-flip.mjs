#!/usr/bin/env node
/** One account moved to sync v2, or back, through the admin's route
 *  (`/v2/admin/sync-version`, services/sync/src/sync2/admin.ts).
 *
 *  Usage:
 *
 *    node scripts/sync-flip.mjs status someone@example.com [--min 0.14.0]
 *    node scripts/sync-flip.mjs to2 someone@example.com --min 0.14.0 [--allow <id>]... [--dry]
 *    node scripts/sync-flip.mjs to1 someone@example.com [--min 0.14.0]
 *
 *  `to2` is refused while a device of the account whose session is live runs an app
 *  older than `--min`, or a live session has no device behind it (an app from before
 *  the hub, or the Even plugin, which stays on v1). The refusal names each one; look at
 *  it, and name the ones that may stay behind with `--allow`. `to1` is the rollback and
 *  is never refused; it names the devices too old to roll back cleanly.
 *
 *  The token is the admin's session: `NIB_TOKEN=...`, or `--sign-in you@example.com`,
 *  which asks for the mailed code here, and signs that session out again at the end.
 *  A program token cannot reach the route. `NIB_API` points somewhere else for a test
 *  (`http://127.0.0.1:8787` for `wrangler dev`); it defaults to the service.
 *
 *  A device notices at its next launch: the app reads the version from `/v1/me` as it
 *  starts. See docs/sync-v2.md section 11. */

import { createInterface } from 'node:readline/promises'

const API = (process.env.NIB_API || 'https://nibeditor.com').replace(/\/$/, '')

function say(words = '') {
  process.stdout.write(`${words}\n`)
}

async function ask(path, token, body) {
  const response = await fetch(`${API}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      'x-nib-device': 'sync-flip',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  let json
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = { error: `${response.status} ${text.slice(0, 200)}` }
  }
  return { status: response.status, json }
}

/** A session for the admin, by the mailed code (and the second factor, if the account
 *  has one). */
async function signIn(email) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const sent = await ask('/v1/auth/code', null, { email })
    if (sent.status !== 200) throw new Error(`sign-in: ${sent.json.error ?? sent.status}`)
    const code = (await prompt.question(`code mailed to ${email}: `)).replace(/\s/g, '')
    const verified = await ask('/v1/auth/verify', null, { email, code })
    if (verified.status !== 200) throw new Error(`sign-in: ${verified.json.error}`)
    if (verified.json.token) return verified.json.token

    const second = (await prompt.question('authenticator code: ')).replace(/\s/g, '')
    const done = await ask('/v1/auth/second', null, {
      holding: verified.json.holding,
      code: second,
    })
    if (done.status !== 200 || !done.json.token) throw new Error(`sign-in: ${done.json.error}`)
    return done.json.token
  } finally {
    prompt.close()
  }
}

function when(at) {
  return at ? new Date(at).toISOString().slice(0, 16).replace('T', ' ') : 'never'
}

function show(answer, what) {
  const { json } = answer
  if (json.email) say(`${json.email}: sync v${json.version} (min ${json.min})`)
  for (const one of json.devices ?? []) {
    const state = one.live ? 'live' : 'signed out'
    say(
      `  device  ${one.id}  ${one.name} (${one.platform})  app ${one.app || '?'}  seen ${when(one.lastSeenAt)}  ${state}`,
    )
  }
  for (const one of json.sessions ?? []) {
    say(
      `  session ${one.id}  ${one.name || '(no name)'}  used ${when(one.lastUsedAt)}  no device${one.allowed ? '  allowed' : ''}`,
    )
  }
  const blockers = json.blockers ?? []
  if (blockers.length) {
    say(
      what === 'to1'
        ? `  too old to roll back cleanly, ${blockers.length}:`
        : `  held back by ${blockers.length}:`,
    )
    for (const one of blockers)
      say(
        `    ${one.kind} ${one.id}  ${one.name || ''}  ${one.why}${one.app ? ` (${one.app})` : ''}`,
      )
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const words = []
  const allow = []
  const flags = {}
  for (let at = 0; at < argv.length; at++) {
    const one = argv[at]
    if (one === '--allow') allow.push(argv[++at])
    else if (one === '--min' || one === '--sign-in') flags[one.slice(2)] = argv[++at]
    else if (one === '--dry') flags.dry = true
    else words.push(one)
  }
  const [what, email] = words
  if (!['status', 'to1', 'to2'].includes(what) || !email) {
    throw new Error(
      'usage: sync-flip.mjs status|to1|to2 <email> [--min X] [--allow id]... [--dry] [--sign-in admin@email]',
    )
  }

  const signedIn = flags['sign-in'] ? await signIn(flags['sign-in']) : null
  const token = signedIn ?? process.env.NIB_TOKEN ?? ''
  if (!token) throw new Error('NIB_TOKEN is not set (or pass --sign-in)')

  try {
    let answer
    if (what === 'status') {
      const query = new URLSearchParams({ email })
      if (flags.min) query.set('min', flags.min)
      for (const id of allow) query.append('allow', id)
      answer = await ask(`/v2/admin/sync-version?${query}`, token)
    } else {
      answer = await ask('/v2/admin/sync-version', token, {
        email,
        to: what === 'to2' ? 2 : 1,
        ...(flags.min ? { min: flags.min } : {}),
        ...(allow.length ? { allow } : {}),
        ...(flags.dry ? { dry: true } : {}),
      })
    }

    show(answer, what)
    if (answer.status === 409 && answer.json.blockers?.length) {
      say('update those apps, or name what may stay on v1 with --allow <id>')
    }
    if (answer.status !== 200) throw new Error(answer.json.error ?? String(answer.status))
    if (what !== 'status') {
      say(
        answer.json.changed
          ? `now sync v${answer.json.version}`
          : `unchanged (sync v${answer.json.version})`,
      )
    }
  } finally {
    if (signedIn) await ask('/v1/auth/signout', signedIn, {}).catch(() => undefined)
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
