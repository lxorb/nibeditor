/** How hard the model is asked to think.
 *
 *  The list is the API's own, read off the error it answers an invalid one with on
 *  2026-09-09, so it is the API's and not a guess.
 *
 *  Which models may be chosen is not here any more, and neither is any way of
 *  reaching OpenAI. The account's key is written and never read back, so the request
 *  that lists the models is made by the Worker, which is the only thing that can
 *  open the key; the pane asks Orden for the list. See services/sync/src/ask and
 *  offered.svelte.ts. */

export const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

export function isEffort(value: unknown): value is Effort {
  return typeof value === 'string' && (EFFORTS as readonly string[]).includes(value)
}
