/** Firebase Cloud Messaging, HTTP v1: a message to an Android phone's token.
 *
 *  Sent as data rather than as a notification, so the app decides what to show: a phone
 *  that already set the alarm for this reminder itself (Reminders.kt) knows its id and
 *  stays quiet, and one that has not opened nib since the task was written rings it.
 *  Signed in as the project's service account, whose key is the Worker's secret
 *  `FCM_SERVICE_ACCOUNT` (the JSON Google hands out); the hour's access token is kept
 *  for the isolate's life and asked again a minute before it runs out. */

import { pemKey, signedToken } from './keys'
import type { Delivery } from './send'

/** The fields of a service account key this reads. */
interface ServiceAccount {
  client_email: string
  private_key: string
  project_id: string
}

function account(json: string): ServiceAccount | null {
  try {
    const read = JSON.parse(json) as Partial<ServiceAccount>
    return read.client_email && read.private_key && read.project_id
      ? (read as ServiceAccount)
      : null
  } catch {
    // A secret that is not the key Google hands out: FCM is off, as if unset.
    return null
  }
}

let held: { token: string; until: number; for: string } | null = null

async function accessToken(
  service: ServiceAccount,
  now: number,
  send: typeof fetch,
): Promise<string | null> {
  if (held?.for === service.client_email && held.until > now + 60_000) return held.token

  const iat = Math.floor(now / 1000)
  const assertion = await signedToken(
    { alg: 'RS256', typ: 'JWT' },
    {
      iss: service.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat,
      exp: iat + 3600,
    },
    await pemKey(service.private_key, 'rsa'),
  )
  const answer = await send('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  })
  if (!answer.ok) return null
  const said: { access_token?: string; expires_in?: number } = await answer.json()
  if (!said.access_token) return null
  held = {
    token: said.access_token,
    until: now + (said.expires_in ?? 3600) * 1000,
    for: service.client_email,
  }
  return said.access_token
}

/** One message to one token. A token FCM no longer knows is gone. */
export async function sendFcm(
  token: string,
  message: Record<string, string>,
  serviceJson: string,
  options: { now: number; fetch?: typeof fetch },
): Promise<Delivery> {
  const send = options.fetch ?? fetch
  const service = account(serviceJson)
  if (!service) return 'off'
  const access = await accessToken(service, options.now, send)
  if (!access) return 'failed'

  const answer = await send(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(service.project_id)}/messages:send`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: { token, data: message, android: { priority: 'high', ttl: '86400s' } },
      }),
    },
  )
  if (answer.ok) return 'sent'
  if (answer.status === 404) return 'gone'
  const said = await answer.text()
  // A token that was never one, or one for another app: as gone as one unregistered.
  return answer.status === 400 && /registration token|UNREGISTERED/i.test(said) ? 'gone' : 'failed'
}

/** Forgets the access token held, for a test that starts from nothing. */
export function forgetAccess() {
  held = null
}
