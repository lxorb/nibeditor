/** Which commands a provider can run, and why not where it cannot.
 *
 *  The menu is the same for every provider (docs/ai-sidebar.md 3): a command that cannot
 *  run here is listed dimmed with its reason rather than left out, so a reader who moves
 *  between Claude Code and a key finds every name where they left it. Nearly every row
 *  runs everywhere, because where a provider has no road of its own nib does it; what is
 *  left is the provider's own tier, and the rows waiting on another lane's half. */

import { t } from '../../i18n.svelte'
import type { ProviderKind } from '../providers'

/** The kinds with a faster tier: a Claude key's fast mode, an OpenAI key's priority tier,
 *  Codex's fast service tier. Claude Code has no headless `/fast` (6.4), and a ChatGPT
 *  plan or a compatible server has no tier to ask for. */
const FAST: readonly ProviderKind[] = ['anthropic', 'openai', 'codex']

/** Whether a row can run for a kind of provider: true, or the reason it is dimmed.
 *  `ready` says which of the other lanes' halves are on main (the review's rewind and
 *  changes list). */
export function availability(
  name: string,
  kind: ProviderKind,
  ready: { review: boolean },
): true | string {
  if (name === 'fast' && !FAST.includes(kind)) return t('No faster tier here')
  if ((name === 'rewind' || name === 'diff') && !ready.review) return t('Not here yet')
  return true
}
