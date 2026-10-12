/** Which provider and model a helper runs on, out of the words an agent asked with.
 *
 *  An agent names a model the way it would name one to its own subagent tool: `opus`,
 *  `sonnet`, `gpt-6-astra`, `astra`, or nothing at all for the model it is itself. Each
 *  provider in use is asked what it has (its own list, never a table here), and the
 *  first that has the word answers: a model whose id or name is the word, then one whose
 *  id or name holds it. The asking agent's own provider is asked first, so `opus` from a
 *  Claude stays on Claude even where another provider lists an `opus` too. A word nobody
 *  has is refused with the models there are, so the agent can ask again in one try.
 *  Pure. */

import type { ModelInfo } from '../chat/types'
import type { Provider } from '../providers'

/** One provider in use, and the models it listed. */
export interface Offered {
  provider: Provider
  models: readonly ModelInfo[]
}

export type Routed = { provider: Provider; model: string } | { refused: string }

/** How many models a refusal names, so a long list does not fill the agent's window. */
const NAMED = 24

/** The parent's provider first, the rest as they were. */
function parentFirst(offered: readonly Offered[], parent: Provider | null): Offered[] {
  if (!parent) return [...offered]
  const mine = offered.filter((one) => one.provider.id === parent.id)
  return [...mine, ...offered.filter((one) => one.provider.id !== parent.id)]
}

export function routed(want: string, offered: readonly Offered[], parent: Provider | null): Routed {
  const asked = want.trim().toLowerCase()
  const order = parentFirst(offered, parent)
  if (!asked) {
    const provider = parent ?? order[0]?.provider
    return provider ? { provider, model: '' } : { refused: 'there is no AI provider set up' }
  }

  const is = (one: ModelInfo) => one.id.toLowerCase() === asked || one.name.toLowerCase() === asked
  const holds = (one: ModelInfo) =>
    one.id.toLowerCase().includes(asked) || one.name.toLowerCase().includes(asked)
  for (const test of [is, holds]) {
    for (const { provider, models } of order) {
      const found = models.find(test)
      if (found) return { provider, model: found.id }
    }
  }

  const names = order.flatMap(({ models }) => models.map((one) => one.id)).slice(0, NAMED)
  return {
    refused: names.length
      ? `no model called "${want}" is offered. Models: ${names.join(', ')}`
      : `no model called "${want}" is offered`,
  }
}
