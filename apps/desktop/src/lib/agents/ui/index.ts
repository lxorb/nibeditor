/** Everything the reader sees of agents (docs/agent-native.md 6.6, 6.7, 7.1, 7.3, 9.3,
 *  9.5): the frame round a page an agent acts in, its mark on the tab, the activity
 *  panel, its questions, Show, the stop and the pairing bubble.
 *
 *  Never in the first paint. The shell reads `agent-marks.svelte.ts`, and this arrives
 *  with the first agent event, the activity panel or the stop key, whichever asks first.
 *
 *  | file | what it owns |
 *  | --- | --- |
 *  | `seen` | what the window knows, and what each event changes |
 *  | `marks` | which tab wears which mark: acting, paused, none |
 *  | `activity` | the store, and every press about agents |
 *  | `live` | the store started, and the shell kept up to date |
 *  | `session`, `words` | the audit log as a list, and a verb as a word |
 *  | `source`, `fake` | the crate, and a crate in memory for tests and drives |
 *  | `read`, `accelerator` | the crate's events read, the stop key as the system's |
 *  | `ActivityPanel`, `AgentCard`, `Question`, `Thumb` | the panel |
 *  | `PairingBubble`, `TakeoverBar` | the two things asked outside it | */

export { ended, start, started, stopAgents, wrote } from './live.svelte'
