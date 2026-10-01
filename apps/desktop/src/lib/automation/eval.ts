/** Running JavaScript inside the window, which is the one thing in the app that
 *  turns a string into code.
 *
 *  Why it exists: a drive, a one-off fix across a space, a question about a store
 *  that no verb answers. Everything else the command line does is a verb precisely
 *  so that this is not needed for it.
 *
 *  Why it is off by default, and why turning it on costs opening a file: whatever
 *  is sent runs with everything the window can reach, which is every note on this
 *  machine and the session that reaches the account. The check is in the crate,
 *  before a request gets this far, so the answer does not depend on any code in the
 *  page being right; see src-tauri/src/endpoint.rs.
 *
 *  Why it is a module of its own: the Even Realities plugin must not carry
 *  `new Function` at all - the store's review reads the bundle for it and has
 *  refused a build over it - and a module reached only from behind
 *  `__EVEN_PLUGIN__` is a module the bundler leaves out of that build entirely.
 *  See verbs.ts, vite.even.config.ts and src/lib/even/bundle.test.ts. */

import { links } from '../link-index.svelte'
import { search } from '../search.svelte'
import { settings } from '../settings.svelte'
import { workspace } from '../workspace.svelte'
import { pages } from '../web-tab/pages.svelte'

/** What a script is handed, as `nib`. The stores a question about the app is
 *  actually about; everything else a page can reach is reachable anyway. `pages` is what
 *  each web tab's page is doing, which a drive asks about rather than the crate. */
function surface(): Record<string, unknown> {
  return { workspace, links, search, settings, pages }
}

/** Runs `code` and answers what it came to.
 *
 *  Either shape works. An expression answers itself, so `nib eval "1 + 1"` says
 *  two; a body of statements answers whatever it returns. Tried in that order,
 *  because an expression is what somebody types first and the parser is the thing
 *  that knows which of the two they wrote. */
export async function evaluate(code: string): Promise<unknown> {
  const answer = await compiled(code)(surface())
  return plain(answer)
}

/** What a script is, once. */
type Script = (nib: Record<string, unknown>) => Promise<unknown>

/** The code as something to call. `await` works in both shapes, because both are
 *  wrapped in an async function of their own. */
function compiled(code: string): Script {
  try {
    return made(`return (async () => (${code}))()`)
  } catch {
    // Not an expression, so it is statements, and the parser said so rather than
    // this guessing from the text.
    return made(`return (async () => { ${code} })()`)
  }
}

function made(body: string): Script {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- turning a string into code is the whole verb
  return new Function('nib', body) as Script
}

/** The answer as something that survives being written down.
 *
 *  A store, a DOM node or a function cannot cross the wire, and a script that
 *  ended on one should hear what it was rather than an error about JSON. */
function plain(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value ?? null)) as unknown
  } catch {
    return String(value)
  }
}
