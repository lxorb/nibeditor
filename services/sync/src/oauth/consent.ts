/** The page a person actually sees: who is asking, what it would be allowed to
 *  do, and the emailed code that signs them in - the same code as the app, on
 *  a page rendered here rather than in the editor.
 *
 *  Everything written into the HTML goes through `escape`, including the fields
 *  carried from one step to the next: they arrive from a stranger's query
 *  string and are handed straight back into a form. */

import type { Env } from '../types'
import type { Client } from './clients'
import { type Ask, FIELDS, wantsWrite } from './protocol'
import { describeDestination } from './redirects'

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character)
}

/** The app's own palette, both ways round, so the page reads as Nib's. */
const STYLE = `
:root{--bg:#fbfcfd;--fg:#1a1d23;--strong:#0e1013;--muted:#6b7482;--line:#e1e6ed;--line-strong:#ccd4de;--surface:#f3f5f8;--accent:#5b4be0;--accent-hover:#4e3ed6;--danger:#d92b34}
@media(prefers-color-scheme:dark){:root{--bg:#0e1013;--fg:#c9cfd8;--strong:#eef1f5;--muted:#8a93a2;--line:#232830;--line-strong:#2f3641;--surface:#14171c;--accent:#7c6bf5;--accent-hover:#8d7ef7;--danger:#f2555a}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.6 ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{width:min(100% - 2rem,24rem);padding:2rem 0 3rem}
.brand{font-weight:700;letter-spacing:-.02em;color:var(--accent);margin-bottom:2rem}
h1{font-size:1.45em;line-height:1.25;letter-spacing:-.015em;margin:0 0 .5rem;color:var(--strong)}
p{margin:0 0 1.25rem}
label{display:block;font-size:.9em;color:var(--muted);margin-bottom:.35rem}
input[type=email],input[type=text]{width:100%;padding:.7rem .85rem;border:1px solid var(--line-strong);border-radius:9px;background:var(--surface);color:var(--strong);font:inherit;outline:none}
input:focus{border-color:var(--accent)}
input.code{font-size:1.5em;letter-spacing:.35em;text-align:center;font-family:ui-monospace,monospace}
.field{margin-bottom:1.25rem}
.check{display:flex;gap:.6rem;align-items:flex-start;color:var(--fg);font-size:1em;margin:0 0 1.5rem}
.check input{margin:.3em 0 0;accent-color:var(--accent)}
.check small{display:block;color:var(--muted);font-size:.86em}
.actions{display:flex;gap:.75rem;align-items:center}
button{padding:.65rem 1.1rem;border:0;border-radius:9px;font:inherit;font-weight:550;background:var(--accent);color:#fff;cursor:pointer}
button:hover{background:var(--accent-hover)}
button.quiet{background:none;color:var(--muted)}
button.quiet:hover{background:none;color:var(--fg)}
.where{margin-top:2rem;font-size:.86em;color:var(--muted)}
.error{color:var(--danger);font-size:.9em;margin:-.75rem 0 1rem}
`

export function page(env: Env, body: string, status: 200 | 400 | 409 = 200): Response {
  const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>nibeditor</title>
<style>${STYLE}</style>
<main>
<div class="brand"><a href="${escape(env.APP_ORIGIN)}" style="color:inherit;text-decoration:none">nibeditor</a></div>
${body}
</main>
</html>`

  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      // Consent must not be collectable through a frame on someone else's page.
      'x-frame-options': 'DENY',
      'content-security-policy': "frame-ancestors 'none'",
    },
  })
}

export function refusal(problem: string): string {
  return `<h1>That did not work</h1><p>${escape(problem)}</p>`
}

/** Server messages are lowercase so the app can drop them into a sentence;
 *  here they stand alone. */
function sentence(text: string): string {
  return `<p class="error">${escape(text.charAt(0).toUpperCase() + text.slice(1))}.</p>`
}

function hidden(ask: Ask, extra: Record<string, string> = {}): string {
  return [...FIELDS.map((field) => [field, ask[field]] as const), ...Object.entries(extra)]
    .filter(([, value]) => value)
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${escape(value)}">`)
    .join('')
}

const wants = (client: Client, ask: Ask) =>
  wantsWrite(ask)
    ? `${escape(client.name)} would like to read your notes, and to change them if you let it.`
    : `${escape(client.name)} would like to read your notes.`

export function emailStep(
  client: Client,
  ask: Ask,
  given: { email?: string; error?: string },
): string {
  return `<h1>Connect ${escape(client.name)}</h1>
<p>${wants(client, ask)} Sign in to allow it.</p>
<form method="post" action="/oauth/authorize">
${hidden(ask)}
<div class="field"><label for="email">Email</label>
<input type="email" id="email" name="email" value="${escape(given.email ?? '')}" required autofocus autocomplete="email" spellcheck="false"></div>
${given.error ? sentence(given.error) : ''}
<div class="actions"><button name="action" value="send">Continue</button><button class="quiet" name="action" value="deny" formnovalidate>Cancel</button></div>
</form>
<p class="where">Afterwards you go back to ${escape(describeDestination(ask.redirect_uri))}.</p>`
}

export function codeStep(
  client: Client,
  ask: Ask,
  given: { email: string; error?: string },
): string {
  const write = wantsWrite(ask)
    ? `<label class="check"><input type="checkbox" name="write" value="1">
<span>Let ${escape(client.name)} change my notes as well<small>Without this it can only read them.</small></span></label>`
    : ''

  return `<h1>Check your email</h1>
<p>We sent a six-digit code to <b>${escape(given.email)}</b>.</p>
<form method="post" action="/oauth/authorize">
${hidden(ask, { email: given.email })}
<div class="field"><label for="code">Code</label>
<input type="text" class="code" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required autofocus></div>
${given.error ? sentence(given.error) : ''}
${write}
<div class="actions"><button name="action" value="allow">Allow</button><button class="quiet" name="action" value="deny" formnovalidate>Cancel</button></div>
</form>
<p class="where">Afterwards you go back to ${escape(describeDestination(ask.redirect_uri))}.</p>`
}

/** The third step, for an account that asks for a second code: the one out of the
 *  authenticator app, or a recovery code. The emailed code proved the address and
 *  nothing more, which is exactly what a second factor is there to be more than -
 *  a connector's token reads every note, so it is not handed out on less than the
 *  app's own sign-in asks for. See `/v1/auth/second` in auth.ts.
 *
 *  What the page carries between the two is the half a sign-in the app's own flow
 *  holds, never the address, and whether the person said the client may write. */
export function secondStep(
  ask: Ask,
  given: { holding: string; write: boolean; error?: string },
): string {
  return `<h1>Enter the code from your app</h1>
<p>Or one of your recovery codes.</p>
<form method="post" action="/oauth/authorize">
${hidden(ask, { holding: given.holding, ...(given.write ? { write: '1' } : {}) })}
<div class="field"><label for="code">Code</label>
<input type="text" class="code" id="code" name="code" autocomplete="one-time-code" maxlength="32" required autofocus spellcheck="false"></div>
${given.error ? sentence(given.error) : ''}
<div class="actions"><button name="action" value="second">Allow</button><button class="quiet" name="action" value="deny" formnovalidate>Cancel</button></div>
</form>
<p class="where">Afterwards you go back to ${escape(describeDestination(ask.redirect_uri))}.</p>`
}
