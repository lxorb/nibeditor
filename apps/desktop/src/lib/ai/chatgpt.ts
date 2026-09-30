/** The ChatGPT plan's half of a request: the access token, asked of the crate for each
 *  request the way a key is read for each, and a refusal said in nib's words.
 *
 *  The crate holds the refresh token in the keychain and the access token of the hour in
 *  memory; the page never holds more than the hour's. See src-tauri/src/chatgpt.rs, and
 *  https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery for
 *  the codes read here. */

import { t } from '../i18n.svelte'
import { invoke } from '../tauri'
import { limitSentence } from './local/trouble'
import { plans } from './local/status.svelte'

/** Where the reader sees and manages what their plan has used. */
export const USAGE = 'https://chatgpt.com/codex/settings/usage'

const NAME = 'ChatGPT'

/** An access token for one request, or a thrown sentence. */
export async function planToken(): Promise<string> {
  try {
    return await invoke<string>('chatgpt_token')
  } catch (error) {
    const said = error instanceof Error ? error.message : String(error)
    if (said === 'signed out') {
      plans.chatgpt = null
      throw new Error(t('Sign in to {name} first.', { name: NAME }), { cause: error })
    }
    throw new Error(said, { cause: error })
  }
}

/** The code a refusal carries, where it carries one. */
function codeIn(body: unknown): string {
  if (typeof body !== 'object' || body === null) return ''
  const error = (body as { error?: unknown }).error
  if (typeof error !== 'object' || error === null) return ''
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : ''
}

/** What a refused request is said as, or null to let the provider's own words stand. */
export function planRefusal(status: number, body: unknown): string | null {
  const code = codeIn(body)
  if (code === 'subscription_sharing_usage_limit_exceeded' || status === 429) {
    const limit = { state: 'reached', until: null, untilWords: null } as const
    plans.chatgptLimit = limit
    return limitSentence(NAME, limit)
  }
  if (code === 'subscription_sharing_invalid_user' || status === 401) {
    plans.chatgpt = null
    return t('Sign in to {name} first.', { name: NAME })
  }
  if (code === 'subscription_sharing_user_not_eligible') {
    return t('This ChatGPT plan cannot be used here.')
  }
  if (
    code === 'subscription_sharing_usage_unavailable' ||
    code === 'subscription_sharing_user_unavailable'
  ) {
    return t('ChatGPT is not answering right now. Try again in a moment.')
  }
  return null
}
