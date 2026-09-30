import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { mcpLine } from './mcp'
import { AGENT_WINDOW_VERBS, BROWSER_VERBS } from './verbs'

describe('the line that adds nib to a client', () => {
  it('names the installed exe in quotes on Windows, at user scope', () => {
    expect(mcpLine('C:\\Users\\me\\AppData\\Local\\Nib\\nib.exe')).toBe(
      'claude mcp add --scope user nib -- "C:\\Users\\me\\AppData\\Local\\Nib\\nib.exe" mcp',
    )
    expect(mcpLine('C:\\Program Files\\Nib\\nib.exe', 'codex')).toBe(
      'codex mcp add nib -- "C:\\Program Files\\Nib\\nib.exe" mcp',
    )
  })

  it('quotes a path elsewhere only when the shell would split it', () => {
    expect(mcpLine('/usr/bin/nib')).toBe('claude mcp add --scope user nib -- /usr/bin/nib mcp')
    expect(mcpLine('/Applications/Nib.app/Contents/MacOS/nib', 'codex')).toBe(
      'codex mcp add nib -- /Applications/Nib.app/Contents/MacOS/nib mcp',
    )
    expect(mcpLine("/home/a/Apps/Emil's Nib.AppImage")).toBe(
      "claude mcp add --scope user nib -- '/home/a/Apps/Emil'\\''s Nib.AppImage' mcp",
    )
  })

  it('is an entry for a client configured by file', () => {
    expect(JSON.parse(mcpLine('C:\\Nib\\nib.exe', 'json'))).toEqual({
      mcpServers: { nib: { command: 'C:\\Nib\\nib.exe', args: ['mcp'] } },
    })
  })
})

describe("the MCP server's tools", () => {
  /** The table `nib mcp` lists from, read as the crate includes it. */
  const table = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../src-tauri/src/mcp/tools.json', import.meta.url)),
      'utf8',
    ),
  ) as { name: string }[]

  it('are every verb an agent may call, and nothing else', () => {
    const own = new Set(['agent_pair', 'agent_bye'])
    const verbs = [
      ...BROWSER_VERBS.filter((verb) => !own.has(verb)),
      ...Object.keys(AGENT_WINDOW_VERBS),
    ]

    expect(table.map((tool) => tool.name).sort()).toEqual(verbs.sort())
  })
})
