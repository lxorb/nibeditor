/** One push to one device, whichever service it goes through: the one module chats and
 *  reminders both send by (docs/chats.md 4.11, docs/tasks.md 5.10).
 *
 *  A device registered a target (targets.ts): a Web Push subscription for the browser
 *  build, an FCM token for Android, an APNs token for an iPhone. A target whose service
 *  says it is gone is dropped here, so the next push does not try it again. A service
 *  the Worker has no keys for answers `off` and is left alone: the keys are Emil's to
 *  make (docs/mobile.md, "Push"). */

import type { Env } from '../types'
import { sendApns } from './apns'
import { sendFcm } from './fcm'
import { sendWebPush, type SubscriptionKeys } from './webpush'

/** What a push came to. */
export type Delivery = 'sent' | 'gone' | 'failed' | 'off'

export type TargetKind = 'webpush' | 'fcm' | 'apns'

/** A target as `push_targets` holds it. */
export interface Target {
  id: string
  user_id: string
  kind: TargetKind
  token: string
  keys: string | null
  zone: string | null
}

/** What a push says: what it is about, words to show, and fields for the app. */
export interface Message {
  kind: 'reminder' | 'chat'
  id: string
  title: string
  body: string
  fields: Record<string, string>
}

function keysOf(target: Target): SubscriptionKeys | null {
  try {
    const keys = JSON.parse(target.keys ?? '') as Partial<SubscriptionKeys>
    return typeof keys.p256dh === 'string' && typeof keys.auth === 'string'
      ? { p256dh: keys.p256dh, auth: keys.auth }
      : null
  } catch {
    // A subscription written without its keys cannot be encrypted to.
    return null
  }
}

/** Which services this Worker has the keys for. */
export function configured(env: Env) {
  return {
    webpush: env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY ? env.VAPID_PUBLIC_KEY : null,
    fcm: !!env.FCM_SERVICE_ACCOUNT,
    apns: !!(env.APNS_KEY && env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_TOPIC),
  }
}

/** One message to one target, and a gone one dropped. */
export async function push(
  env: Env,
  target: Target,
  message: Message,
  now: number,
  send: typeof fetch = fetch,
): Promise<Delivery> {
  const data = {
    kind: message.kind,
    id: message.id,
    title: message.title,
    body: message.body,
    ...message.fields,
  }
  let delivery: Delivery = 'off'
  try {
    if (target.kind === 'webpush') {
      const keys = keysOf(target)
      if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && keys) {
        delivery = await sendWebPush(
          target.token,
          keys,
          data,
          {
            publicKey: env.VAPID_PUBLIC_KEY,
            privateKey: env.VAPID_PRIVATE_KEY,
            subject: env.VAPID_SUBJECT ?? `mailto:${env.MAIL_FROM ?? 'nib@nibeditor.com'}`,
          },
          { now, topic: message.id, fetch: send },
        )
      }
    } else if (target.kind === 'fcm') {
      if (env.FCM_SERVICE_ACCOUNT) {
        delivery = await sendFcm(target.token, data, env.FCM_SERVICE_ACCOUNT, { now, fetch: send })
      }
    } else if (env.APNS_KEY && env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_TOPIC) {
      delivery = await sendApns(
        target.token,
        { title: message.title, body: message.body, id: message.id },
        {
          key: env.APNS_KEY,
          keyId: env.APNS_KEY_ID,
          teamId: env.APNS_TEAM_ID,
          topic: env.APNS_TOPIC,
          sandbox: env.APNS_SANDBOX === 'true',
        },
        { now, fetch: send },
      )
    }
  } catch {
    // A service that could not be reached, or a key it could not be signed with: this
    // push failed, and the next one tries again.
    delivery = 'failed'
  }

  if (delivery === 'gone') {
    await env.DB.prepare('delete from push_targets where id = ?').bind(target.id).run()
  } else if (delivery === 'failed') {
    await env.DB.prepare('update push_targets set failed_at = ? where id = ?')
      .bind(now, target.id)
      .run()
  }
  return delivery
}
