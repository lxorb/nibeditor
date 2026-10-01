/** Typed client for the sync service. Every call carries the session token;
 *  nothing here touches cookies, so it works the same in the app and the web.
 *
 *  Two halves. This one is what the shell needs whatever happens: where the service
 *  is, what a refusal looks like - which the launch's own stores check for - and the
 *  one function every call goes through. The other half is the table of calls and
 *  the shapes they answer with, which is api/routes.ts: nothing asks for it before
 *  somebody is signed in and something is sent, so it is fetched with the first call
 *  and warmed at the launch's last turn. `api` keeps its name and its types either
 *  way, so no caller knows which half it reached. */

import { door } from '@nib/markdown/door'
import { deviceName } from './device'
import { isRecord, isString, parsed } from './stored'

export type {
  Account,
  SpaceRole,
  GivenRole,
  Guest,
  Member,
  Sharing,
  SharedItem,
  Invitation,
  Joined,
  RemoteSpace,
  FormAnswer,
  SiteSettings,
  SiteChanges,
  RemoteNote,
  SecondState,
  RemoteSession,
  SpaceFile,
  AccountSettings,
  KeyState,
  DnsRecord,
  DomainStatus,
} from './api/routes'

export const BASE: string = import.meta.env.VITE_NIB_API ?? 'https://nibeditor.com'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown = null,
  ) {
    super(message)
  }
}

export async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string; device?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.token) headers.authorization = `Bearer ${options.token}`
  // Only where it is the answer to something: a version the account keeps says
  // which device wrote those words. See device.ts and services/sync/versions.ts.
  if (options.device) headers['x-nib-device'] = deviceName()

  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })

  const body = parsed(await response.text())

  if (!response.ok) {
    // The server says why in `error`, and it says so for everything it answers,
    // a fault of its own included. When there is no sentence to read - an edge
    // between here and there answering with a page of its own - the status is all
    // there is to go on, and a five hundred of that kind is something to try
    // again rather than a number to show somebody.
    const said = isRecord(body) && isString(body.error) ? body.error : null
    const otherwise =
      response.status >= 500
        ? 'could not reach the server - try again'
        : `request failed (${response.status})`

    throw new ApiError(response.status, said ?? otherwise, body)
  }

  // The service is the other half of this repo and answers the shapes above;
  // checking each one field by field here would be a second copy of its types.
  return body as T
}

type Routes = (typeof import('./api/routes'))['routes']

/** The table of calls, once it is here. */
let table: Routes | null = null

/** The table, fetched once: by the launch's last turn (see `warmCalls`), or by
 *  whichever call comes before it. */
const routes = door(async () => (table = (await import('./api/routes')).routes))

/** Fetches the table ahead of the first call; see `warmDoors` in surfaces.svelte.ts. */
export function warmCalls(): Promise<unknown> {
  return routes()
}

/** A call that answers later, as every one of them does: each is a request to the
 *  service, so the moment the table arrives in is part of the same wait. A member
 *  that answered at once could not be behind a door, and says so by being `never`. */
type Later<T> = {
  readonly [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R>
    ? (...args: A) => Promise<R>
    : never
}

/** One call: made there and then once the table is here, which after the launch it
 *  always is, and once it arrives before that. */
function calling(name: keyof Routes) {
  return (...args: never[]): Promise<unknown> => {
    const call = (all: Routes) => (all[name] as (...args: never[]) => Promise<unknown>)(...args)
    return table ? call(table) : routes().then(call)
  }
}

/** Every call, by the name the table gives it. What a caller holds is a stand-in
 *  that waits for the table and then makes the call, with the same arguments and the
 *  same answer; see api/routes.ts. Nothing answers to `then`, so the object is never
 *  taken for a promise by something that awaits whatever it is handed. */
export const api = new Proxy({} as Later<Routes>, {
  get: (_nothing, name) =>
    typeof name === 'string' && name !== 'then' ? calling(name as keyof Routes) : undefined,
})

/** Where an LLM client points to reach these notes. */
export const MCP_URL = `${BASE}/mcp`
