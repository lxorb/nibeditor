import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import app from '../src/index'
import type { Env } from '../src/types'

// Read rather than listed: a migration that exists but was never added here
// would leave every test running against yesterday's schema.
const FOLDER = fileURLToPath(new URL('../migrations/', import.meta.url))
const MIGRATIONS = readdirSync(FOLDER)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => FOLDER + name)

/** D1's shape over Node's built-in SQLite, so routes run against real SQL.
 *
 *  The fake is handed to the Worker as a D1Database, which is where the types
 *  come from; here every read is `unknown`, because only the calling route
 *  knows what it selected. Nothing is `async` that has nothing to await - a
 *  resolved promise is the same thing to the caller and says so. */
/** Whether the statement about to run is one a test asked to lose; see `losing`
 *  on the environment. Consumed by the statement it matches and by nothing else. */
type Loses = (sql: string) => boolean

/** What a statement bound, so a test can hold the Worker to what D1 allows. */
type Bound = (sql: string, count: number) => void

/** Something to do just before a statement runs; see `justBefore`. */
type JustBefore = (sql: string) => void

function d1(database: DatabaseSync, loses: Loses, bound: Bound, justBefore: JustBefore) {
  return {
    /** D1 runs a batch in one transaction, so the fake does too: a route that
     *  reaches for one is a route saying that half of it applied is not a state
     *  anything may end up in. */
    async batch(statements: { run(): Promise<unknown> }[]): Promise<unknown[]> {
      database.exec('begin')
      try {
        const answers: unknown[] = []
        for (const statement of statements) answers.push(await statement.run())
        database.exec('commit')
        return answers
      } catch (error) {
        database.exec('rollback')
        throw error
      }
    },

    prepare(sql: string) {
      const lost = loses(sql)
      justBefore(sql)

      const statement = {
        args: [] as never[],
        bind(...args: unknown[]) {
          statement.args = args as never[]
          bound(sql, args.length)
          return statement
        },
        first(): Promise<unknown> {
          return Promise.resolve(database.prepare(sql).get(...statement.args) ?? null)
        },
        all(): Promise<{ results: unknown[] }> {
          return Promise.resolve({ results: database.prepare(sql).all(...statement.args) })
        },
        // `meta.changes` is what a conditional write reads to find out whether
        // it landed; see `saveNote`. Node's driver reports the same number under
        // the same name, so the fake passes it straight through.
        run(): Promise<{ success: true; meta: { changes: number } }> {
          if (lost) return Promise.resolve({ success: true, meta: { changes: 0 } })

          const result = database.prepare(sql).run(...statement.args)
          return Promise.resolve({ success: true, meta: { changes: Number(result.changes) } })
        },
      }
      return statement
    },
  }
}

function bucket() {
  // Notes go in as text and images as bytes, so both are kept as given and
  // handed back the way the Worker asks for them.
  const store = new Map<string, { value: unknown; contentType: string | undefined }>()

  return {
    /** Everything in it, so a test can say that nothing is stored under a name no
     *  row names. Not part of the R2 surface the Worker uses; see `keys` on the
     *  environment. */
    keys: () => [...store.keys()],

    put(key: string, value: unknown, options?: { httpMetadata?: { contentType?: string } }) {
      store.set(key, { value, contentType: options?.httpMetadata?.contentType })
      return Promise.resolve()
    },
    get(key: string) {
      const held = store.get(key)
      if (!held) return Promise.resolve(null)

      return Promise.resolve({
        text: () => Promise.resolve(String(held.value)),
        body: held.value,
        httpMetadata: { contentType: held.contentType },
      })
    },
    delete(key: string) {
      store.delete(key)
      return Promise.resolve()
    },
  }
}

export interface TestEnv extends Env {
  /** The database underneath, for setting up a state no endpoint can reach -
   *  an account already at its quota, for instance. */
  db: DatabaseSync
  /** Makes the next write matching `sql` report that it changed nothing, the way
   *  a conditional write reads when somebody else claimed the row first. Answers
   *  a function saying how many writes it caught, so a test can say that the
   *  race it meant to arrange actually happened. */
  losing(sql: RegExp): () => number
  /** Runs `work` once, just before the next statement matching `sql` does.
   *
   *  What a check-then-write race actually is: a row that was not there when the
   *  route looked and is there by the time it writes. Two requests in flight
   *  cannot arrange that here - the fake answers a query in one microtask, so the
   *  awaits do not interleave where they would over a network - and a race that
   *  cannot be arranged is a race no test proves. This puts the other writer's row
   *  in at the one moment that matters. */
  justBefore(sql: RegExp, work: () => void): void
  /** Every name the bucket holds something under, so a test can say that nothing
   *  is stored that no row names. */
  keys(): string[]
  /** The widest statement anything has bound since the environment was made: how
   *  many parameters, and which statement. Node's SQLite takes tens of thousands
   *  and D1 takes a hundred, so a query that grows with what an account holds is
   *  a query this fake would run and the real one would refuse. */
  widest(): { count: number; sql: string }
  close(): void
}

export function testEnv(overrides: Partial<Env> = {}): TestEnv {
  const database = new DatabaseSync(':memory:')
  for (const migration of MIGRATIONS) database.exec(readFileSync(migration, 'utf8'))

  let losing: RegExp | null = null
  let caught = 0

  const loses: Loses = (sql) => {
    if (!losing?.test(sql)) return false

    losing = null
    caught++
    return true
  }

  let widest = { count: 0, sql: '' }
  const bound: Bound = (sql, count) => {
    if (count > widest.count) widest = { count, sql }
  }

  const notes = bucket()

  let waiting: { sql: RegExp; work: () => void } | null = null
  const justBefore: JustBefore = (sql) => {
    if (!waiting?.sql.test(sql)) return

    const { work } = waiting
    waiting = null
    work()
  }

  return {
    DB: d1(database, loses, bound, justBefore) as unknown as D1Database,
    NOTES: notes as unknown as R2Bucket,
    BLOG_ROOT: 'nibeditor.com',
    BLOG_CNAME_TARGET: 'cname.nibeditor.com',
    APP_ORIGIN: 'https://nibeditor.com',
    ...overrides,
    db: database,
    losing: (sql) => {
      losing = sql
      const before = caught
      return () => caught - before
    },
    justBefore: (sql, work) => {
      waiting = { sql, work }
    },
    keys: () => notes.keys(),
    widest: () => widest,
    close: () => database.close(),
  }
}

/* ── What the routes answer with ──────────────────────────────────────── */

interface UserView {
  id: string
  email: string
  name: string | null
}

interface DnsRecord {
  type: string
  name: string
  value: string
  note?: string
}

interface BookmarkView {
  kind: string
  path: string
  text: string
}

interface SpaceFileView {
  path: string
  hash: string
}

interface SpaceView {
  id: string
  name: string
  position: number
  icon: string | null
  /** The colour that icon is drawn in; see 0036. */
  tint: string | null
  role: string
  shared: boolean
  /** Which of its files are shared on their own, by note id; see 0026. */
  sharedItems: string[]
  bookmarks: BookmarkView[]
  icons: Record<string, string>
  /** And the colour each of those icons is drawn in, under the same keys. */
  tints: Record<string, string>
  graph: Record<string, unknown>
  excluded: string[]
  /** The order each folder of its tree was arranged into, by the folder's path; see
   *  0037. */
  arranged: Record<string, string[]>
  createdAt: number
  updatedAt: number
  blog: {
    enabled: boolean
    subdomain: string | null
    domain: string | null
    title: string | null
    note: string | null
    dns: DnsRecord[]
    /** What the site itself decides; see spaces/site.ts. The password is only
     *  ever whether there is one. */
    site: {
      rules: { include: string[]; exclude: string[]; otherwise: string }
      description?: string
      image?: string
      icon?: string
      password: boolean
    }
  }
}

interface NoteView {
  id: string
  path: string
  seq: number
  version: number
  updatedAt: number
  deleted: boolean
  size: number
  hash: string
}

interface ClientView {
  id: string
  name: string
  readOnly: boolean
  createdAt: number
  lastUsedAt: number | null
}

/** Every field any route answers with, in one shape rather than one per route.
 *
 *  Each is declared as present: a test reads the field belonging to the route
 *  it called and gets `undefined` from any other, which is what an `any` body
 *  gave before - except that now the names and the types are checked, so a
 *  test cannot quietly assert on a field no route sends. Where two routes
 *  disagree about a name, the odd one out gets its own shape and the test asks
 *  for it: `call<TrashView>(...)`. */
export interface Reply {
  error: string
  error_description: string
  ok: boolean

  // Signing in and the account.
  token: string
  user: UserView
  resendIn: number
  settings: Record<string, unknown>

  // The glasses' question flow. `key` is what the settings read says about the
  // account's OpenAI key, which is the whole of what any read can say about it;
  // `set` and `tail` are the same two fields as the key's own routes answer them.
  key: { set: boolean; tail: string }
  set: boolean
  tail: string
  models: string[]
  answer: string
  said: string | null
  /** The language tag the speech model settled on, or empty where it did not say.
   *  A spoken command has no use for one; a transcript in a note is headed with it. */
  language: string
  /** A meeting's transcript, as takeaways and open tasks. */
  summary: string

  // Storage.
  used: number
  limit: number
  hash: string
  stored: boolean

  // What the forms on a site have collected; see spaces/answers.ts.
  answers: { id: string; note: string; path: string; at: number; answers: Record<string, string> }[]

  // What a publish would change, which is which pages appear and disappear.
  // `more` is further down, where the change feed already asks for it.
  pages: number
  before: number
  adds: string[]
  removes: string[]

  // Spaces, what they keep above their file list, and their published address.
  space: SpaceView
  spaces: SpaceView[]
  bookmarks: BookmarkView[]
  icons: Record<string, string>
  tints: Record<string, string>
  graph: Record<string, unknown>
  excluded: string[]
  arranged: Record<string, string[]>
  files: SpaceFileView[]
  missing: string[]
  deleted: string[]
  available: boolean
  reason: string
  domain: string | null
  state: string
  detail: string | null
  dns: DnsRecord[]

  // Following a link into a space somebody shared, and the guest a link that
  // asks nothing hands out.
  waiting: boolean
  declined: boolean
  guest: { id: string; name: string }

  // Notes and the change feed.
  note: NoteView
  notes: NoteView[]
  content: string
  cursor: number
  more: boolean

  // The connector, as the settings pane sees it.
  exists: boolean
  readOnly: boolean
  createdAt: number | null
  lastUsedAt: number | null
  clients: ClientView[]

  // What a client discovers about the OAuth server.
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint: string
  response_types_supported: string[]
  grant_types_supported: string[]
  token_endpoint_auth_methods_supported: string[]
  code_challenge_methods_supported: string[]
  scopes_supported: string[]
  client_id_metadata_document_supported: boolean
  authorization_response_iss_parameter_supported: boolean
  resource: string
  authorization_servers: string[]

  // Registering, and the tokens that follow.
  client_id: string
  client_secret: string
  client_name: string
  redirect_uris: string[]
  token_endpoint_auth_method: string
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  scope: string
}

/** Who else may reach a space, as the Share sheet reads it. Exactly one of
 *  `email` and `guest` names each person: a member is an address, a guest is an
 *  id the space's own link handed out. */
export interface ShareView {
  owner: { email: string; name: string | null }
  /** Which file the sheet is about, or null for the whole space. */
  item: { id: string; path: string } | null
  members: {
    email: string | null
    guest: string | null
    name: string | null
    role: string
    pending: boolean
  }[]
  requests: {
    email: string | null
    guest: string | null
    name: string | null
    role: string
    at: number
  }[]
  link: { url: string; role: string; mode: string } | null
  mailed: boolean
  error: string
}

/** What a link somebody was sent is about, which names its space by name
 *  rather than by the shape the sync routes use. */
export interface JoinView {
  kind: string
  space: string
  /** The one file the link is about, by name, or null for the space. */
  note: string | null
  role: string
  email: string | null
  asks: boolean
  from: string | null
  error: string
}

/** Recently deleted, which names its lists after what they hold rather than
 *  after the shapes the sync routes use. */
export interface TrashView {
  spaces: { id: string; name: string; deletedAt: number; purgeAt: number; notes: number }[]
  notes: {
    id: string
    spaceId: string
    spaceName: string
    path: string
    deletedAt: number
    purgeAt: number
  }[]
}

/** JSON-RPC, as the connector speaks it. */
export interface RpcView {
  jsonrpc: string
  id: number | string | null
  result: {
    protocolVersion: string
    capabilities: { tools: Record<string, unknown> }
    serverInfo: { name: string; version: string }
    tools: { name: string; description: string; inputSchema: Record<string, unknown> }[]
    content: { type: string; text: string }[]
    isError?: boolean
  }
  error: { code: number; message: string }
}

interface CallOptions {
  method?: string
  body?: unknown
  /** Sent as-is instead of JSON, for uploads that are not JSON. */
  raw?: BodyInit
  headers?: Record<string, string>
  token?: string
  host?: string
}

export interface Answer<T> {
  status: number
  /** The parsed body. Null when the answer was not JSON, which the shape does
   *  not say: a test that asks for a page reads `text` instead. */
  json: T
  text: string
  headers: Headers
}

/** Calls the Worker the way the network would. */
export async function call<T = Reply>(
  env: Env,
  path: string,
  options: CallOptions = {},
): Promise<Answer<T>> {
  const host = options.host ?? 'nibeditor.com'
  const headers: Record<string, string> = {}

  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.token) headers.authorization = `Bearer ${options.token}`
  Object.assign(headers, options.headers ?? {})

  const method =
    options.method ?? (options.body === undefined && options.raw === undefined ? 'GET' : 'POST')
  const body = options.raw ?? (options.body === undefined ? null : JSON.stringify(options.body))

  const response = await app.fetch(
    new Request(`https://${host}${path}`, { method, headers, body }),
    env,
  )

  const text = await response.text()
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    // Blog responses are HTML.
  }

  return { status: response.status, json: json as T, text, headers: response.headers }
}

/** What the mailer printed while something ran. Without the binding it writes
 *  to the log instead of sending, so this is the test's mailbox; see email.ts. */
export async function mail(work: () => Promise<unknown>): Promise<string> {
  const logged: string[] = []
  const original = console.log
  console.log = (message: string) => {
    logged.push(message)
  }

  try {
    await work()
  } finally {
    console.log = original
  }

  return logged.join('\n')
}

/** Runs the sign-in flow and returns a usable session token. `guest` is the
 *  guest session this device was holding, if it was holding one: the app hands
 *  it over so that whatever a link let the device into follows it in. */
export async function signIn(env: Env, email: string, guest?: string): Promise<string> {
  const logged = await mail(() => call(env, '/v1/auth/code', { body: { email } }))

  const code = /(\d{3}) (\d{3})/.exec(logged)
  if (!code) throw new Error(`no code was sent:\n${logged}`)

  const verified = await call(env, '/v1/auth/verify', {
    body: { email, code: `${code[1]}${code[2]}`, ...(guest ? { guest } : {}) },
  })

  if (verified.status !== 200) throw new Error(`sign-in failed: ${verified.text}`)
  return verified.json.token
}
