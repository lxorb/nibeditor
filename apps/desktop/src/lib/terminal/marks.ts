/** The drawings a terminal's tab wears; which one is naming.ts's `terminalMark`.
 *
 *  Lucide's, where Lucide has the thing: a branch for git, a container for Docker, a
 *  server for a host over SSH, a hexagon for Node, a prompt for a shell. Drawn here on
 *  Lucide's own grid where it has not - it carries no makers' marks - as the plainest
 *  outline of each program's own: Claude's burst of rays, the three loops of OpenAI's
 *  knot, Python's two snakes, Vim's diamond, PowerShell's slanted prompt. One weight
 *  and one colour, the strip's, so a strip of terminals reads as a strip of tabs and
 *  not a row of logos; the shape says which.
 *
 *  Fetched with the first terminal in the strip, never in front of the first paint. */

import type { IconNode } from 'lucide'
import Container from 'lucide/dist/esm/icons/container.mjs'
import GitBranch from 'lucide/dist/esm/icons/git-branch.mjs'
import Hexagon from 'lucide/dist/esm/icons/hexagon.mjs'
import Server from 'lucide/dist/esm/icons/server.mjs'
import SquareTerminal from 'lucide/dist/esm/icons/square-terminal.mjs'
import Terminal from 'lucide/dist/esm/icons/terminal.mjs'
import type { TerminalMark } from './naming'

/** Twelve rays out of the middle, long and short by turns. */
const Claude: IconNode = [
  [
    'path',
    {
      d: 'M12 9.4 12 2M13.3 9.75 15.6 5.76M14.25 10.7 20.66 7M14.6 12 19.2 12M14.25 13.3 20.66 17M13.3 14.25 15.6 18.24M12 14.6 12 22M10.7 14.25 8.4 18.24M9.75 13.3 3.34 17M9.4 12 4.8 12M9.75 10.7 3.34 7M10.7 9.75 8.4 5.76',
    },
  ],
]

/** Three loops turned a third of the way round each from the last. */
const Codex: IconNode = [0, 60, 120].map((turn) => [
  'rect',
  { x: '8', y: '2', width: '8', height: '20', rx: '4', transform: `rotate(${turn} 12 12)` },
])

/** Two snakes, each the other turned round, an eye on each head. */
const Python: IconNode = [
  [
    'path',
    {
      d: 'M12 9H5a3 3 0 0 0-3 3v1a3 3 0 0 0 3 3h3v-3a2 2 0 0 1 2-2h4a2 2 0 0 0 2-2V5a3 3 0 0 0-3-3h-2a3 3 0 0 0-3 3v2',
    },
  ],
  [
    'path',
    {
      d: 'M12 15h7a3 3 0 0 0 3-3v-1a3 3 0 0 0-3-3h-3v3a2 2 0 0 1-2 2h-4a2 2 0 0 0-2 2v4a3 3 0 0 0 3 3h2a3 3 0 0 0 3-3v-2',
    },
  ],
  ['path', { d: 'M11 5h.01M13 19h.01' }],
]

/** A diamond with the V inside it. */
const Vim: IconNode = [
  ['path', { d: 'M12 2 22 12 12 22 2 12Z' }],
  ['path', { d: 'm8.5 9 3.5 6.5L15.5 9' }],
]

/** The prompt in a slanted box. */
const PowerShell: IconNode = [
  ['path', { d: 'M6.5 4h15l-4 16h-15Z' }],
  ['path', { d: 'm8.5 9 3 3-4.5 3' }],
  ['path', { d: 'M12 15h3' }],
]

export const TERMINAL_MARKS: Record<TerminalMark, IconNode> = {
  claude: Claude,
  codex: Codex,
  node: Hexagon,
  python: Python,
  git: GitBranch,
  ssh: Server,
  docker: Container,
  vim: Vim,
  powershell: PowerShell,
  cmd: SquareTerminal,
  shell: Terminal,
}
