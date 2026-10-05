/** Typed client for the sync service, over the same routes the app uses.
 *
 *  A client of its own rather than the app's: `apps/desktop/src/lib/api.ts`
 *  reaches for the app's bookmark types and its `stored` helpers, and importing
 *  it here would pull the whole desktop package in behind them. What the
 *  clipper needs is seven calls, so it keeps seven, in the same shape and
 *  against the same paths.
 *
 *  It signs in the way the app does, with a code sent by email. The OAuth flow
 *  in `services/sync/src/oauth/` was the other candidate and does not fit: the
 *  token it issues authenticates `/mcp` alone, whose six tools can write a note
 *  but cannot upload a blob, and a clip without its pictures is a note that
 *  breaks the day the article moves. */

import { isRecord, listOf, parsed, readSpace, text } from './stored'

export const BASE: string = import.meta.env.VITE_NIB_API ?? 'https://nibeditor.com'

export interface Account {
  email: string
}

export interface Space {
  id: string
  name: string
  /** Where it sits in the app's rail; the picker shows the same order. */
  position: number
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** The service says why in `error` when it can. When it cannot - a proxy
 *  between here and there, say - the status is all there is to go on. */
function refusal(status: number, body: unknown): ApiError {
  return new ApiError(status, text(body, 'error') ?? `request failed (${status})`)
}

async function request(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
): Promise<unknown> {
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.token) headers.authorization = `Bearer ${options.token}`

  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })

  const body = parsed(await response.text())
  if (!response.ok) throw refusal(response.status, body)

  return body
}

function readAccount(value: unknown): Account | null {
  const email = text(isRecord(value) ? value.user : null, 'email')
  return email === null ? null : { email }
}

/** What the service answered, or a refusal saying it made no sense. A reply the
 *  code cannot read is a failure like any other, and it belongs to the call
 *  that made it rather than to whatever touches the value next. */
function must<T>(value: T | null): T {
  if (value === null) throw new ApiError(0, 'could not reach the server')
  return value
}

export const api = {
  requestCode: async (email: string): Promise<number> => {
    const body = await request('/v1/auth/code', { body: { email } })
    const seconds = isRecord(body) ? body.resendIn : null
    return typeof seconds === 'number' ? seconds : 0
  },

  verifyCode: async (email: string, code: string): Promise<{ token: string; user: Account }> => {
    const body = await request('/v1/auth/verify', { body: { email, code } })
    const token = text(body, 'token')
    return { token: must(token), user: must(readAccount(body)) }
  },

  signOut: (token: string) => request('/v1/auth/signout', { method: 'POST', token }),

  me: async (token: string): Promise<Account> =>
    must(readAccount(await request('/v1/me', { token }))),

  listSpaces: async (token: string): Promise<Space[]> => {
    const body = await request('/v1/spaces', { token })
    const spaces = listOf(isRecord(body) ? body.spaces : null, readSpace)
    return spaces.sort((one, other) => one.position - other.position)
  },

  /** 409 when a note already lives at that path; the caller steps the name.
   *
   *  The id is encoded rather than pasted in: it comes back from `/v1/spaces`
   *  or out of storage written by an older version, and a path is not the place
   *  to find out that one of them was not what it claimed to be. */
  createNote: async (token: string, spaceId: string, path: string, content: string) => {
    const where = `/v1/spaces/${encodeURIComponent(spaceId)}/notes`
    const body = await request(where, { token, body: { path, content } })
    const note = isRecord(body) ? body.note : null
    return { path: text(note, 'path') ?? path }
  },

  /** A line in the space's inbox (docs/tasks.md 3, row 16); answers the note it went
   *  into. */
  addTask: async (token: string, spaceId: string, words: string) => {
    const where = `/v1/spaces/${encodeURIComponent(spaceId)}/tasks`
    const body = await request(where, { token, body: { text: words } })
    return { path: text(body, 'path') ?? 'Inbox.md' }
  },

  /** Named by its own hash, so a picture two articles share is stored once and
   *  a repeat costs one request and no storage. */
  putBlob: async (token: string, hash: string, type: string, bytes: ArrayBuffer) => {
    const response = await fetch(`${BASE}/v1/blobs/${hash}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': type },
      body: bytes,
    })

    const body = parsed(await response.text())
    if (!response.ok) throw refusal(response.status, body)

    const stored = isRecord(body) ? body.stored : null
    return { hash, stored: stored === true }
  },
}

/** Whether a thrown value is the service saying the account is full. Both the
 *  note route and the blob route answer 507 for it. */
export function outOfSpace(error: unknown): boolean {
  return error instanceof ApiError && error.status === 507
}

/** Whether a path is taken. The note route answers 409 and hands back the note
 *  that is in the way. */
export function pathTaken(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409
}
