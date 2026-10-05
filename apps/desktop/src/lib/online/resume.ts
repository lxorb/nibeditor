/** Resume: an agent that a machine's restart stopped, started again where it was
 *  (docs/online-terminal.md 4.7).
 *
 *  A machine keeps no memory across a sleep, so a session comes back as its saved screen
 *  above a fresh prompt. The agents keep their own conversations in the home, and each has
 *  a command that picks the last one up: so when the program in front as the screen was
 *  saved was one of them, the tab offers that command, typed for the reader. Nothing of
 *  nib's holds the conversation. */

/** The command that continues each agent's last conversation, by the program's name. */
const CONTINUE: Readonly<Record<string, string>> = {
  claude: 'claude --continue',
  codex: 'codex resume --last',
}

/** What Resume types for a program, or null for one that has no conversation to pick
 *  up. */
export function resumeCommand(program: string | null): string | null {
  if (!program) return null
  return CONTINUE[program.toLowerCase()] ?? null
}
