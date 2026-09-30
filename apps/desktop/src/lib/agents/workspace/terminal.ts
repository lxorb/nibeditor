/** A command in a shell: `run_terminal` (docs/agent-native.md 8.9).
 *
 *  A terminal is the whole machine, so this is its own scope, off unless the reader
 *  grants it, and even then a command whose program is not on the agent's own list asks
 *  the reader first, in either mode (9.3). The shell is one of the shells the crate
 *  found (the one Settings chose), started in a folder of a space the agent reaches,
 *  through the terminal's own commands (src-tauri/src/terminal.rs): the window never
 *  names a program, an argument or a variable, and neither does an agent - it types a
 *  line into a shell, as a person at the keyboard would, and `exit` after it.
 *
 *  No tab: the command runs in a session of its own that nobody is shown, and what it
 *  printed comes back, cleaned of the escapes a screen would draw, as the terminal's
 *  words rather than the reader's (9.6). A command that runs past its time is ended.
 *  The reader's own command line never reaches a shell (docs/terminal.md). */

import type { AgentAnswer } from '../../automation/caller'
import { Channel, invoke } from '../../native'
import { shells } from '../../terminal/shells.svelte'
import { identifier } from '../../identifier'
import { asked } from './asks'
import { type Call, count, done, maybe, need } from './call'
import { Refused } from './problem'
import { plainOf, programOf, startsOnlyOne } from './shell-text'
import { judged, onDisk, placeFor } from './spaces'

/** How long a command may run when the agent does not say, and at the most. */
const WAIT = 60_000
const MOST_WAIT = 600_000

/** How much of what it printed comes back: the end of it, which is where a build or a
 *  test run says how it went. */
const MOST_OUTPUT = 100_000

export async function runTerminal(call: Call): Promise<AgentAnswer> {
  const agent = call.caller.agent
  if (agent === null) throw new Refused('by_hand', 'the command line does not reach a shell')

  const command = need(call, 'command')
  if (/[\r\n]/.test(command)) throw new Refused('bad_arguments', 'one command line at a time')

  const place = placeFor(call, maybe(call, 'space'))
  const cwd = maybe(call, 'cwd')
  const folder = cwd === null ? place.space.root : onDisk(place, judged(cwd))

  await shells.ask()
  const shell = shells.chosen
  if (!shell) throw new Refused('unsupported_on_this_engine', 'there is no shell on this machine')

  const allowed =
    startsOnlyOne(command) &&
    agent.programs.map((one) => one.toLowerCase()).includes(programOf(command))
  const question = await asked(call, allowed ? null : 'terminal', command)
  if (question) return question

  const ran = await session(shell.id, folder, command, count(call, 'timeout_ms', WAIT, MOST_WAIT))
  const output = plainOf(ran.printed)
  const cut = output.length > MOST_OUTPUT

  return done(
    {
      command,
      exit: ran.exit,
      output: cut ? output.slice(-MOST_OUTPUT) : output,
      ...(cut ? { truncated: true } : {}),
      ...(ran.exit === null ? { timed_out: true } : {}),
    },
    'terminal output',
  )
}

/** The command typed into a fresh shell and `exit` after it, and everything it printed
 *  until the shell ended or the time ran out. `exit` is null for a shell that was ended
 *  because it had not. */
function session(
  shell: string,
  folder: string,
  command: string,
  patience: number,
): Promise<{ printed: string; exit: number | null }> {
  const id = `agent-${identifier().replace(/[^\w-]/g, '')}`.slice(0, 80)
  const decoder = new TextDecoder()
  let printed = ''

  return new Promise((settle, fail) => {
    let over: ReturnType<typeof setTimeout> | undefined

    const output = new Channel<unknown>()
    output.onmessage = (message) => {
      if (message instanceof ArrayBuffer) {
        const bytes = new Uint8Array(message)
        printed += decoder.decode(bytes, { stream: true })
        // Said at once, since nothing draws it: the crate holds back past a megabyte
        // nobody has seen.
        void invoke('pty_seen', { id, bytes: bytes.length }).catch(() => undefined)
        return
      }

      const exit = (message as { exit?: unknown } | null)?.exit
      if (typeof exit === 'number') {
        clearTimeout(over)
        settle({ printed: printed + decoder.decode(), exit })
      }
    }

    invoke('pty_spawn', { id, shell, folder, cols: 160, rows: 48, output })
      .then(async () => {
        over = setTimeout(() => {
          void invoke('pty_kill', { id }).catch(() => undefined)
          settle({ printed: printed + decoder.decode(), exit: null })
        }, patience)

        await invoke('pty_write', { id, data: `${command}\r`, binary: false })
        await invoke('pty_write', { id, data: 'exit\r', binary: false })
      })
      .catch((error: unknown) => {
        clearTimeout(over)
        fail(new Refused('failed', `the shell would not start: ${String(error)}`))
      })
  })
}
