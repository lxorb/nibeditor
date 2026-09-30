import { Hono, type MiddlewareHandler } from 'hono'
import { SIGN_IN, SIGN_IN_TO_DO_THAT } from './refused'
import { cors } from 'hono/cors'
import { account } from './account'
import { ask } from './ask'
import { accountById, auth, presentUser, requireWhoever, sessions } from './auth'
import { readBody } from './body'
import { blobs, publicBlobs } from './blobs'
import { hostnameOf, serveBlog, spaceForHost } from './blog'
import { cleanPersonName, NAME_LIMIT } from './crypto'
import { failed } from './failed'
import { bearer } from './mcp/tokens'
import { programMayReach } from './programs'
import { fillFronts } from './blog/fill'
import { sweepLeftovers } from './leftovers'
import { forgetHalfDone, second } from './second'
import { sweepVersions } from './versions'
import { expireGuests, guestMayReach, presentGuest, renameGuest } from './guests'
import { mcp, mcpAdmin } from './mcp'
import { notes } from './notes'
import { oauth, oauthMetadata } from './oauth'
import { expireClients } from './oauth/clients'
import { rooms } from './rooms'
import { devices } from './hub/devices'
import { hubDoor } from './hub/door'
import { web } from './hub/web'
import { webStore } from './spaces/web-store'
import { settings } from './settings'
import { spaces } from './spaces'
import { join } from './spaces/join'
import { recheckDomains } from './spaces/proof'
import { expireRequests, sharedWithMe } from './spaces/share'
import { themes } from './themes'
import { purgeExpired, trash } from './trash'
import { QUOTA, usedBytes } from './storage'
import type { Env, Variables, Whoever } from './types'

const app = new Hono<{ Bindings: Env; Variables: Variables }>()

/** Anything a route threw rather than answered: written to the log with the
 *  route that threw it, and answered as JSON like every other refusal here. See
 *  failed.ts, which says what is written and what is deliberately not. */
app.onError(failed)

/** The desktop app is not served from the API's origin, so it needs to be let in
 *  by name. Auth rides on a bearer token, never on cookies. */
const appOrigins = cors({
  origin: (origin) =>
    /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|tauri:\/\/localhost|https?:\/\/tauri\.localhost|https:\/\/nibeditor\.com)$/.test(
      origin,
    )
      ? origin
      : '',
  // `x-nib-device` is what a version the account keeps says it came from; a
  // header that is not named here is dropped by the browser before the request
  // leaves, which is a thing that only shows up on the builds whose origin is
  // not the service's own. See versions.ts and apps/desktop/src/lib/device.ts.
  // The other three are what a web state is uploaded under; see hub/web.ts.
  allowHeaders: [
    'authorization',
    'content-type',
    'x-nib-device',
    'x-nib-fence',
    'x-nib-generation',
    'x-nib-chunks',
  ],
  // And what a downloaded web state says about itself, which a page may only read
  // when it is named.
  exposeHeaders: ['x-nib-version', 'x-nib-fence', 'x-nib-generation'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  maxAge: 86400,
})
app.use('/v1/*', appOrigins)
app.use('/v2/*', appOrigins)

app.route('/v1/auth', auth)

// Images are served by hash, with no session: a note is read wherever it was
// shared, and a published blog has no reader to authenticate. Registered ahead
// of the guard below for that reason.
app.route('/i', publicBlobs)

// The theme store's catalogue. Public, read-only, and asked for by the app
// before anybody has signed in, so it sits ahead of the guard like the images.
app.route('/themes', themes)

// The connector carries its own token, so it sits outside the session guard.
// Open to every origin: LLM clients run anywhere, some of them in a browser.
const anyOrigin = cors({
  origin: '*',
  allowHeaders: ['authorization', 'content-type', 'mcp-protocol-version', 'mcp-session-id'],
  exposeHeaders: ['www-authenticate', 'mcp-protocol-version', 'mcp-session-id'],
})
app.use('/mcp', anyOrigin)
app.route('/mcp', mcp)

// A note several devices are writing in at once. A socket rather than a request,
// and a socket carries no `Authorization` header, so it names its token in the
// subprotocol and is let in ahead of the guard below; see rooms/index.ts.
app.route('/rooms', rooms)

// The account's hub, the one socket every signed-in device keeps: pokes, web leases
// and the web key's relay. A socket for the same reason as a room's, so it is let
// in ahead of the guard as well; see hub/door.ts.
app.route('/v2/hub', hubDoor)

// A link somebody was sent to a shared space. Both halves sit outside the guard
// below, because a link is its own proof: what it is about is answered to
// anybody, and walking through it is what hands out the session. See
// spaces/join.ts.
app.route('/v1/join', join)

// How a client finds the sign-in, and the sign-in itself. Registered ahead of
// the catch-all, which would otherwise answer with the web app's HTML.
app.use('/.well-known/*', anyOrigin)
app.route('/.well-known', oauthMetadata)
app.use('/oauth/*', anyOrigin)
app.route('/oauth', oauth)

/** Everything past this point needs a session, of one of the two kinds there
 *  are. A guest's reaches the handful of routes `guestMayReach` names and
 *  nothing else: the spaces its links granted, and who it is. The same for both
 *  versions of the API, so a route under `/v2` is closed to a guest and to a
 *  program until somebody says otherwise. */
const guard: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (context, next) => {
  const header = context.req.header('authorization')
  const who: Asking | null =
    (await requireWhoever(context.env, header)) ?? (await asProgram(context.env, header))
  if (!who) return context.json({ error: SIGN_IN }, 401)

  context.set('who', who)

  if (who.kind === 'guest') {
    const path = new URL(context.req.url).pathname
    if (!guestMayReach(context.req.method, path)) {
      return context.json({ error: SIGN_IN_TO_DO_THAT }, 403)
    }
    context.set('guest', who.guest)
  } else {
    // A program acting for somebody reaches the sync routes and nothing else,
    // and a read-only one reaches none that write. Checked here rather than in
    // each route, so a route added tomorrow is closed to it until somebody says
    // otherwise; see programs.ts.
    if (who.program) {
      const path = new URL(context.req.url).pathname
      if (!programMayReach(context.req.method, path, who.readOnly === true)) {
        return context.json({ error: 'that is not something a token can do' }, 403)
      }
    }

    context.set('user', who.user)
  }

  await next()
}
app.use('/v1/*', guard)
app.use('/v2/*', guard)

/** Whoever is asking, and whether it is a program rather than somebody at a
 *  keyboard. A program is the account for the routes it may reach, so nothing
 *  downstream has a third kind to know about; see programs.ts. */
type Asking = Whoever & { program?: true; readOnly?: boolean }

/** Whoever a `nib_` token acts for: the connector's token, or one an LLM client
 *  was granted. It becomes the account for the handful of routes programs may
 *  reach, which is what lets a CI job speak the same sync API the app does with
 *  no second surface to keep in step. */
async function asProgram(env: Env, header: string | undefined): Promise<Asking | null> {
  const token = await bearer(env, header)
  if (!token) return null

  const user = await accountById(env, token.user_id)
  if (!user) return null

  return { kind: 'user', user, program: true, readOnly: !!token.read_only }
}

app.get('/v1/me', (context) => {
  const who = context.get('who')
  // A guest is not an account and is not answered as one: what comes back is a
  // name, which is all a guest has and all the other people in a note need.
  return who.kind === 'guest'
    ? context.json({ guest: presentGuest(who.guest) })
    : context.json({ user: presentUser(who.user) })
})

/** The one thing about whoever is here that can be changed: what to call them.
 *  One route for both, because a guest renaming itself so that a caret carries
 *  something real is the same act as an account choosing a name. */
app.patch('/v1/me', async (context) => {
  const who = context.get('who')
  const body = await readBody(context)
  // Read with room to spare, because what is measured is the name that comes
  // out of the cleaning below rather than what arrived.
  const given = body.text('name', NAME_LIMIT * 8)
  if (body.problem) return context.json({ error: body.problem }, 400)

  const name = cleanPersonName(given ?? '')
  if (name.length > NAME_LIMIT) {
    return context.json({ error: `use at most ${NAME_LIMIT} characters` }, 400)
  }

  if (who.kind === 'guest') {
    // A guest keeps the name it arrived with rather than losing it to an empty
    // field: a caret with nothing over it is worse than one with a made-up word.
    const named = name || who.guest.name
    await renameGuest(context.env, who.guest.id, named)
    return context.json({ guest: presentGuest({ ...who.guest, name: named }) })
  }

  await context.env.DB.prepare('update users set name = ? where id = ?')
    .bind(name || null, who.user.id)
    .run()

  return context.json({ user: presentUser({ ...who.user, name: name || null }) })
})

app.get('/v1/usage', async (context) => {
  const user = context.get('user')
  return context.json({ used: await usedBytes(context.env, user.id), limit: QUOTA })
})

// The glasses' question flow, and the account's OpenAI key: written here, read by
// nothing. Registered ahead of `/v1` so `/v1/ask` is not read as a note id. See
// ask/index.ts.
app.route('/v1/ask', ask)

app.route('/v1/blobs', blobs)
// The files somebody else shared on their own, which belong to no space this
// account can reach: its own route rather than a corner of the space listing,
// because that is exactly what they are not part of. See spaces/share.ts.
app.route('/v1/shared', sharedWithMe)
app.route('/v1/spaces', spaces)
app.route('/v1/trash', trash)
app.route('/v1/settings', settings)
app.route('/v1/mcp', mcpAdmin)
// Which devices are signed in, and the second factor. Behind the guard, where
// everything about the account is; see auth.ts and second.ts.
app.route('/v1/sessions', sessions)
app.route('/v1/second', second)
// Deleting the account, which takes fresh codes and not only the session; see
// account.ts.
app.route('/v1/account', account)
app.route('/v1', notes)

// Sync v2, the hub's half: a site's web state and its chunks, the account's
// devices, and which web store a space's pages live in. See hub/web.ts,
// hub/devices.ts and spaces/web-store.ts.
app.route('/v2/web', web)
app.route('/v2/devices', devices)
app.route('/v2/spaces', webStore)

app.get('/health', (context) => context.json({ ok: true }))

/** The Even Realities plugin, which is the same web app with a bridge to a pair
 *  of glasses in it. The build writes it as `even.html` beside `index.html`, and
 *  the assets router's not-found handling would answer `/even/` with the
 *  editor's own page, so the path is named here and asked for by file name.
 *  Registered ahead of the catch-all for that reason. See docs/even.md. */
app.get('/even', (context) => servePlugin(context.env, context.req.url))
app.get('/even/', (context) => servePlugin(context.env, context.req.url))

function servePlugin(env: Env, from: string): Promise<Response> | Response {
  if (!env.ASSETS) return new Response('Not found', { status: 404 })

  const url = new URL(from)
  url.pathname = '/even.html'
  return env.ASSETS.fetch(new Request(url, { headers: { accept: 'text/html' } }))
}

/** Anything that is not the API is either a published space, looked up by
 *  hostname, or the app itself. */
app.all('*', async (context) => {
  const url = new URL(context.req.url)
  const space = await spaceForHost(context.env, url.host)

  if (space) return serveBlog(context.env, space, url, context.req.raw)

  // A name on the shared domain that nobody publishes under has nothing to
  // show, and the editor does not live there either. Temporary, because the
  // name may be taken tomorrow. Read through the same normalising as above, so
  // one spelling of a host cannot be a blog and another the app.
  if (hostnameOf(url.host).endsWith(`.${context.env.BLOG_ROOT}`)) {
    return context.redirect(context.env.APP_ORIGIN, 302)
  }

  // The web build of the editor. It stores notes in the browser until someone
  // signs in, so it is served to anyone who asks.
  const assets = context.env.ASSETS
  if (assets) return unframed(await assets.fetch(context.req.raw))

  return context.text('Not found', 404)
})

/** The editor's page, which no other site may put in a frame.
 *
 *  Said here because nowhere else can say it: the page carries its content policy
 *  in a `<meta>`, and `frame-ancestors` is the one directive a `<meta>` cannot hold
 *  (see apps/desktop/src/csp.ts). Without it any page could lay the editor under a
 *  button of its own and have a click land on Share or Delete. The policy here is
 *  that one directive and nothing else, so it narrows nothing the page's own says. */
function unframed(response: Response): Response {
  if (!response.headers.get('content-type')?.includes('text/html')) return response

  const headers = new Headers(response.headers)
  headers.set('content-security-policy', "frame-ancestors 'none'")
  headers.set('x-frame-options', 'DENY')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/** The daily job: everything that has run out of time.
 *
 *  What has waited its 14 days in Recently deleted goes, and so does everything
 *  else here that nothing else would ever take away - a guest nobody let in, a
 *  request nobody answered, a client that registered and never came back, an
 *  enrolment nobody finished, the bytes a deleted account left behind - and the
 *  proof on every domain of somebody's own is read again. Each is its own statement in its own module and none of them can
 *  fail another, which is why they are a call each rather than one. */
function scheduled(_event: ScheduledEvent, env: Env, context: ExecutionContext) {
  const at = Date.now()

  context.waitUntil(purgeExpired(env, at))
  context.waitUntil(expireGuests(env, at))
  context.waitUntil(expireRequests(env, at))
  context.waitUntil(expireClients(env, at))
  context.waitUntil(recheckDomains(env, at))
  context.waitUntil(sweepVersions(env, at))
  context.waitUntil(forgetHalfDone(env, at))
  // And what a deleted account left in the bucket and the rooms that the request
  // deleting it did not get to; see leftovers.ts.
  context.waitUntil(sweepLeftovers(env))
  // And what the notes written before publishing could read them say about
  // themselves, two hundred at a time; see blog/fill.ts.
  context.waitUntil(fillFronts(env, null))
}

export default { fetch: app.fetch, scheduled }

// Named at the top level because a Durable Object class is looked up on the
// module, not through a binding.
export { NoteRoom } from './rooms/room'
export { AccountHub } from './hub/hub'
