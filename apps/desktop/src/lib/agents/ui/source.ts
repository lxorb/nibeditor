/** Where the activity UI hears about agents and asks things of them: the crate.
 *
 *  An interface, because two things stand behind it - the crate's own commands (13.1)
 *  in the app, and `fake.ts` in the tests and in the drive of the browser build, which
 *  has no crate - and the UI must not be able to tell them apart. The events are not
 *  here: they arrive through the one listener the shell has (agent-marks.svelte.ts)
 *  and are handed to `start`, or are handed there by the fake. */

import { invoke } from '../../tauri'
import {
  AGENT_FRAME_EVENT,
  type Approval,
  type Frame,
  type Overview,
  type ShellWords,
} from '../verbs'

export interface Source {
  /** Everything at once: `agents_state`. */
  state(): Promise<Overview>
  /** The stop for everyone, or one agent's. Answers whether the tabs were closed. */
  stop(agent?: string): Promise<boolean>
  /** Lifts the stop for everyone, or one agent's own. */
  resume(agent?: string): Promise<void>
  /** The reader's answer to a question. */
  answer(id: string, allow: boolean, always: boolean): Promise<Approval>
  /** One day of the audit log, oldest first. */
  log(day: string): Promise<unknown[]>
  /** An agent's tab made the reader's tab `tab`, without loading it again. */
  adopt(agentTab: string, tab: string): Promise<void>
  /** Which agent tabs to send pictures of; none stops them. */
  watch(tabs: string[]): Promise<void>
  /** The pictures, as they come. Answers how to stop hearing them. */
  frames(on: (frame: Frame) => void): Promise<() => void>
  /** The stop's key from any app, or none, and the words the crate says. */
  shell(key: string | null, words: ShellWords): Promise<void>
  /** Whether closing this window would end the agents' pages: they live in it. */
  holds(): Promise<boolean>
  /** Hides this window instead of closing it, and says so once. False where it was
   *  not kept: nothing is connected any more, or the window holds no agent's pages. */
  hide(): Promise<boolean>
}

/** The crate. */
export const crate: Source = {
  state: () => invoke<Overview>('agents_state'),
  stop: (agent) => invoke<boolean>('agents_stop', agent === undefined ? {} : { agent }),
  resume: (agent) => invoke('agents_resume', agent === undefined ? {} : { agent }),
  answer: (id, allow, always) => invoke<Approval>('agents_answer', { id, allow, always }),
  log: (day) => invoke<unknown[]>('agents_log', { day }),
  adopt: (agentTab, tab) => invoke('agents_adopt', { agentTab, tab }),
  watch: (tabs) => invoke('agents_watch', { tabs }),
  async frames(on) {
    const { listen } = await import('@tauri-apps/api/event')
    return listen<Frame>(AGENT_FRAME_EVENT, ({ payload }) => on(payload))
  },
  shell: (key, words) => invoke('agents_shell', { key, words }),
  holds: () => invoke<boolean>('agents_hold', { hide: false }),
  hide: () => invoke<boolean>('agents_hold', { hide: true }),
}
