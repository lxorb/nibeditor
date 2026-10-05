/** Apple Push Notification service: a reminder to an iPhone, shown by the system.
 *
 *  Ready and off: it needs the Apple developer account `docs/mobile.md` already waits
 *  on, its key (`APNS_KEY`, the `.p8`), the key's id, the team's id and the app's bundle
 *  id, and the iPhone app's registration, which is not built yet. Until all four are set
 *  every APNs target answers `off` and nothing is sent. Signed with a token of the key,
 *  ES256, which Apple accepts for an hour. */

import { pemKey, signedToken } from './keys'
import type { Delivery } from './send'

export interface ApnsConfig {
  key: string
  keyId: string
  teamId: string
  topic: string
  sandbox: boolean
}

/** One message to one device token. */
export async function sendApns(
  token: string,
  alert: { title: string; body: string; id: string },
  config: ApnsConfig,
  options: { now: number; fetch?: typeof fetch },
): Promise<Delivery> {
  const bearer = await signedToken(
    { alg: 'ES256', kid: config.keyId },
    { iss: config.teamId, iat: Math.floor(options.now / 1000) },
    await pemKey(config.key, 'ec'),
  )
  const host = config.sandbox ? 'api.sandbox.push.apple.com' : 'api.push.apple.com'
  const answer = await (options.fetch ?? fetch)(
    `https://${host}/3/device/${encodeURIComponent(token)}`,
    {
      method: 'POST',
      headers: {
        authorization: `bearer ${bearer}`,
        'apns-topic': config.topic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-collapse-id': alert.id,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        aps: {
          alert: { title: alert.title, body: alert.body },
          sound: 'default',
          category: 'nib.reminder',
        },
        id: alert.id,
      }),
    },
  )
  if (answer.status === 410) return 'gone'
  if (answer.ok) return 'sent'
  const said = await answer.text()
  return /BadDeviceToken|Unregistered/.test(said) ? 'gone' : 'failed'
}
