/** The palette's rows for switching AI accounts, asked without waking the store that
 *  knows them.
 *
 *  A leaf, for the reason hears.ts is one: the palette's list is built in front of the
 *  first paint and the accounts' store is not, so the store says what there is as it
 *  arrives and the palette reads it from here. Until it has, there is nothing to switch,
 *  which is true at that moment: the store arrives at the last turn of the launch. */

/** One account the palette offers. */
export interface AccountRow {
  id: string
  /** `Claude · Work`: the provider and the account. */
  label: string
  /** Whether it is the one its provider answers with now. */
  active: boolean
}

let listing: (() => AccountRow[]) | null = null
let choosing: ((id: string) => void) | null = null

/** Said by the store as it loads, and by nothing else. */
export function accountsAre(rows: () => AccountRow[], choose: (id: string) => void): void {
  listing = rows
  choosing = choose
}

/** The accounts worth switching between: those of a provider that has more than one. */
export function switchableAccounts(): AccountRow[] {
  return listing?.() ?? []
}

/** Makes an account the one its provider answers with. */
export function switchAccount(id: string): void {
  choosing?.(id)
}
