/** The commands about the account and the program (docs/ai-sidebar.md 3.6): `/status`,
 *  `/usage`, `/doctor`, `/login` and `/logout`.
 *
 *  Each answers the way its provider can: Claude Code and Codex are asked themselves
 *  (`claude auth status`, `codex login status`) and signed in and out by their own
 *  commands in a terminal tab; the ChatGPT plan by its own sign-in; a key by Settings >
 *  AI, where keys are kept. What they report is a line in the thread, a word and a value
 *  a row, never a sentence. */

import { t } from '../../i18n.svelte'
import { invoke } from '../../tauri'
import { isLocal, KIND_NAMES, type Provider } from '../providers'
import type { Thread } from '../chat/types'
import { filled } from '../chat/usage'
import { engineFor } from '../chat/engine'

/** Rows of a report: a word, then what it says, dropped where there is nothing to say. */
function rows(pairs: readonly (readonly [string, string | number | null | undefined])[]): string {
  return pairs
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([word, value]) => `${word} · ${value}`)
    .join('\n')
}

/** A count of tokens as the ring says it: 412K, 1.2M. */
export function tokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1)}M`
  if (count >= 1_000) return `${Math.round(count / 1_000)}K`
  return String(count)
}

async function plansOf() {
  return (await import('../local/status.svelte')).plans
}

export async function status(thread: Thread | null, provider: Provider | null): Promise<string> {
  if (!provider) return t('Add an AI provider in Settings first.')
  let plan: string | null = null
  let account: string | null = null
  if (isLocal(provider.kind)) {
    const now = await (await plansOf()).check(provider.kind)
    plan = now.plan
    account = now.account ?? (now.state === 'out' ? t('Signed out') : null)
  } else if (provider.kind === 'chatgpt') {
    const plans = await plansOf()
    await plans.checkChatgpt()
    account = plans.chatgpt?.email ?? t('Signed out')
  }
  return rows([
    [
      t('Provider'),
      `${KIND_NAMES[provider.kind]}${provider.name !== KIND_NAMES[provider.kind] ? ` · ${provider.name}` : ''}`,
    ],
    [t('Model'), [thread?.model ?? provider.model, thread?.effort].filter(Boolean).join(' · ')],
    [t('Mode'), thread?.mode],
    [t('Account'), [plan, account].filter(Boolean).join(' · ')],
    [t('Agents'), `nib · ${provider.name}`],
    [t('Version'), __APP_VERSION__],
  ])
}

export async function usage(thread: Thread | null, provider: Provider | null): Promise<string> {
  const spent = thread?.spent
  const window = thread?.usage.window ?? null
  let limit = null
  if (provider && isLocal(provider.kind)) limit = (await plansOf()).local[provider.kind].limit
  else if (provider?.kind === 'chatgpt') limit = (await plansOf()).chatgptLimit
  const until = limit?.until ? new Date(limit.until).toLocaleString() : limit?.untilWords
  const standing =
    limit && limit.state !== 'fine'
      ? [limit.state === 'reached' ? t('At its limit') : t('Near its limit'), until]
      : []
  return (
    rows([
      [t('This thread'), spent ? `↑ ${tokens(spent.input)} ↓ ${tokens(spent.output)}` : null],
      [
        t('Window'),
        thread && window ? `${tokens(filled(thread.usage))} / ${tokens(window)}` : null,
      ],
      [t('Cost'), spent?.cost !== undefined ? `$${spent.cost.toFixed(4)}` : null],
      [t('Account'), standing.filter(Boolean).join(' · ')],
    ]) || '∅'
  )
}

/** Where the program is, whether it is signed in, and whether the model list answers. */
export async function doctor(provider: Provider | null): Promise<string> {
  if (!provider) return t('Add an AI provider in Settings first.')
  const out: [string, string | null][] = [[t('Provider'), KIND_NAMES[provider.kind]]]
  if (isLocal(provider.kind)) {
    const now = await (await plansOf()).check(provider.kind)
    out.push([t('Program'), now.program ?? t('Not installed')])
    out.push([t('Signed in'), now.state === 'in' ? '✓' : now.state === 'out' ? '✕' : '?'])
  } else if (provider.baseUrl) {
    out.push([t('Address'), provider.baseUrl])
  }
  const listed = await engineFor(provider.kind, { provider: () => provider })
    .then((engine) => engine.models(provider))
    .then(
      (models) => `✓ ${models.length}`,
      (error: unknown) => `✕ ${error instanceof Error ? error.message : String(error)}`,
    )
  out.push([t('Models'), listed])
  return rows(out)
}

/** `/login` and `/logout`: the provider's own road in or out. */
export async function sign(provider: Provider | null, out: boolean): Promise<void> {
  const { settings } = await import('../../settings.svelte')
  if (!provider || (!isLocal(provider.kind) && provider.kind !== 'chatgpt')) {
    settings.show('ai')
    return
  }
  const plans = await plansOf()
  if (provider.kind === 'chatgpt') {
    await invoke(out ? 'chatgpt_sign_out' : 'chatgpt_sign_in').catch(() => undefined)
    await plans.checkChatgpt()
    return
  }
  const kind = provider.kind
  const program = plans.local[kind].program ?? (await plans.check(kind)).program
  if (!program) {
    settings.show('ai')
    return
  }
  const { signIn, signOut } = await import('../local/signin')
  await (out ? signOut : signIn)(kind, program)
  plans.watch(kind)
}
