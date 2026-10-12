/** Which ways in Settings > AI > Access offers, under Connect: one chooser for everything
 *  that can reach the notes, whichever road it takes.
 *
 *  Two roads, and the chooser does not make the reader learn which is which. An agent on
 *  this computer (Claude Code, Codex, or any client that starts a program) is given
 *  `nib mcp`, the installed app's own server; an assistant somewhere else (Claude,
 *  ChatGPT, any client that speaks MCP over the web) signs in to the account's connector.
 *  A desktop has the first, an account the second; `Other` is both, the entry a client
 *  takes from a file and the connector's address and token. Pure, so the choice is tested
 *  apart from the pane. */

/** One way in. */
export type Choice = 'claude-code' | 'codex' | 'claude' | 'chatgpt' | 'other'

/** What is offered here: the local ways where this is a desktop, the account's where
 *  somebody is signed in, and Other wherever either is. */
export function choices(local: boolean, account: boolean): Choice[] {
  const offered: Choice[] = [
    ...(local ? (['claude-code', 'codex'] as const) : []),
    ...(account ? (['claude', 'chatgpt'] as const) : []),
  ]
  return local || account ? [...offered, 'other'] : []
}

/** The way shown first: the one chosen last if it is still offered, else the first. */
export function shownFirst(offered: readonly Choice[], last: string | null): Choice | null {
  return offered.find((one) => one === last) ?? offered[0] ?? null
}

/** Whether a way is the account connector's. */
export function viaAccount(choice: Choice): choice is 'claude' | 'chatgpt' {
  return choice === 'claude' || choice === 'chatgpt'
}
