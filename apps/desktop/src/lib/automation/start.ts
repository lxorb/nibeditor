/** The two roads in, wired up.
 *
 *  A link arrives three ways and they are all the same string in the end: the
 *  crate hands over the one the app was launched by, it emits every later one, and
 *  a browser that registered `web+nib://` reloads the page with it in `?nib=`. A
 *  request from the `nib` command arrives as an event from the endpoint. Both go
 *  through `dispatch`; see verbs.ts.
 *
 *  What is here rather than in verbs.ts: everything about arriving and answering -
 *  the listeners, the callbacks, and the one sentence the reader is shown when a
 *  link comes to nothing. */

import { busy } from '../busy.svelte'
import { t } from '../i18n.svelte'
import { log } from '../log'
import { invoke, isDesktop, isNative, openExternal } from '../tauri'
import { callbackKind, readUri, withOutcome } from './uri'
import { dispatch, isVerb, linkHearsFrom, verbForAction } from './verbs'

/** What the browser's protocol handler hands the link back in; see
 *  public/manifest.webmanifest. */
const QUERY = 'nib'

/** How many links deep a chain may go. One `x-success` pointing back at the app is
 *  a useful step in a shortcut; two is a loop somebody wrote by accident. */
const MOST_LINKS = 1

/** Starts listening, and answers how to stop.
 *
 *  Called once, from the launch, after the workspace has restored: every verb is
 *  about a space, and a link that arrived before there was one would have nothing
 *  to act on. See the launch order in src/lib/start.ts. */
export async function startAutomation(): Promise<() => void> {
  // A browser has no crate to hear anything from, and the link is in the address.
  // A reload would follow it a second time, so it comes off the address as soon as
  // it has been read.
  if (!isNative) {
    const here = new URL(window.location.href)
    const asked = here.searchParams.get(QUERY)
    if (asked === null) return () => undefined

    here.searchParams.delete(QUERY)
    window.history.replaceState(null, '', `${here.pathname}${here.search}${here.hash}`)
    await follow(asked)

    return () => undefined
  }

  const stopping: (() => void)[] = []
  const { listen } = await import('@tauri-apps/api/event')

  // The link the app was launched by, which arrived before anything was listening.
  for (const uri of await invoke<string[]>('take_startup_uris').catch(() => [])) {
    await follow(uri)
  }

  stopping.push(
    await listen<string[]>('nib://open-url', (event) => {
      void followAll(event.payload)
    }),
  )

  // The command line, which only a desktop has: a phone has no terminal and a
  // browser tab has no socket. The answer goes back through a command rather than
  // an event because it belongs to one request - the crate is holding a socket open
  // for it, and nothing else should hear it. See src-tauri/src/endpoint.rs.
  if (isDesktop) {
    stopping.push(
      await listen<Request>('nib://automation', (event) => {
        const asked = event.payload
        if (typeof asked.id !== 'number') return

        void answer(asked.id, asked)
      }),
    )
  }

  return () => {
    for (const stop of stopping) stop()
  }
}

/** What the endpoint sends, before any of it is trusted. It crosses a boundary, so
 *  every field is unknown until it has been read; see docs/conventions.md. */
interface Request {
  id?: unknown
  verb?: unknown
  args?: unknown
  rest?: unknown
}

/** One request, answered. */
async function answer(id: number, asked: Request) {
  const verb = typeof asked.verb === 'string' ? asked.verb : ''
  const args = isRecord(asked.args) ? asked.args : {}
  const rest = Array.isArray(asked.rest) ? asked.rest.filter(isText) : []

  const result = await dispatch(verb, args, rest)
  await invoke('automation_result', { id, result }).catch(() => undefined)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown): value is string {
  return typeof value === 'string'
}

async function followAll(uris: readonly string[]) {
  for (const uri of uris) await follow(uri)
}

/** Follows one link.
 *
 *  Every way it can come to nothing ends the same way: one sentence on the line
 *  across the top of the document, which is where the app says what did not work,
 *  and the reason in the log. A link that opened nothing and said nothing would be
 *  indistinguishable from an app that is not running.
 *
 *  One sentence rather than one per reason, because none of the reasons is the
 *  reader's to fix from here: a link that does not work is a link to go back and
 *  look at, and the log says which of them it was.
 *
 *  `depth` is how many links deep the chain already is; see `MOST_LINKS`. */
async function follow(uri: string, depth = 0): Promise<void> {
  const link = readUri(uri)
  if (!link) {
    refuse(uri, 'not a nib link')
    return
  }

  const verb = verbForAction(link.action)
  if (!verb) {
    // Two different noes. A name the app knows and will not take from a link is
    // the app declining, which is what x-callback-url calls a cancel. A name it
    // does not know at all is a link that is simply wrong.
    const declined = isVerb(link.action)
    await went(declined ? link.callbacks.cancel : link.callbacks.error, depth, {
      error: declined ? 'not something a link may ask for' : `no action called ${link.action}`,
    })
    refuse(uri, declined ? 'declined' : 'unknown action')
    return
  }

  // Said to be a link, because that is what decides whether a row of the palette
  // may run: see `runCommand`. Never an argument - a link writes its own.
  const result = await dispatch(verb, link.args, [], 'link')

  // Whether this verb says anything back at all, which the table decides; see
  // `byLink` in verbs.ts. A quiet verb is quiet either way round, success and error
  // both: "no answer" and "an answer saying it failed" are two different things to
  // hear, and told apart they are the same question about the space answered more
  // slowly. What the reader sees, and the log, are unchanged - the reader is the
  // person at the keyboard and is allowed to know.
  const heard = linkHearsFrom(verb)

  if (!result.ok) {
    if (heard) await went(link.callbacks.error, depth, { error: result.error })
    refuse(uri, result.error)
    return
  }

  if (heard) await went(link.callbacks.success, depth, plainly(result.value))
  else if (link.callbacks.success ?? link.callbacks.error) {
    log('warn', `automation: ${link.action} tells a link nothing back: ${uri}`)
  }
}

/** What goes onto an `x-success` address: the values a verb answered with, and
 *  nothing deeper. A shortcut reading one wants a path or a count, not a document. */
function plainly(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}

  const out: Record<string, string> = {}
  for (const [name, held] of Object.entries(value)) {
    if (typeof held === 'string' || typeof held === 'number' || typeof held === 'boolean') {
      out[name] = String(held)
    }
  }

  return out
}

/** Goes where the link said to go afterwards, if it said anywhere this app will
 *  go. `http(s)` leaves through the opener; a `nib://` address is followed here,
 *  once. See `callbackKind` in uri.ts for why nothing else is followed at all. */
async function went(url: string | null, depth: number, outcome: Record<string, string>) {
  const kind = callbackKind(url)
  if (url === null || kind === null) return

  if (kind === 'external') {
    await openExternal(withOutcome(url, outcome))
    return
  }

  if (depth >= MOST_LINKS) {
    log('warn', `automation: a chain of links went past ${MOST_LINKS} steps: ${url}`)
    return
  }

  await follow(url, depth + 1)
}

function refuse(uri: string, why: string) {
  log('warn', `automation: ${why}: ${uri}`)
  busy.failed(t('that link could not be followed'))
}
