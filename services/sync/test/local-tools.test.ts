/** The local server's tools beside this connector's.
 *
 *  `nib mcp`, the app's own binary speaking MCP on the reader's machine, has the sixteen
 *  tools this connector has under the same names, six of notes, five of to-dos and
 *  bases and five of chats, so a prompt or a skill written against one works against
 *  the other (docs/agent-native.md 10, docs/tasks.md 5.15, docs/chats.md 4.14). What that takes is held here, from
 *  the connector's side: every argument this connector takes, the local tool takes under
 *  the same name and type, and never needs an argument this one does not. The local tool
 *  may take more, and may need less - the open space stands in for `space` there. Its
 *  table is apps/desktop/src-tauri/src/mcp/tools.json; the six notes' answers' words are held
 *  in src-tauri/src/mcp/shared.rs, the chats' in `@nib/chats/agent`, and the five others
 *  answer the same JSON on both. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { CHAT_TOOLS } from '../src/mcp/chats'
import { TASK_TOOLS } from '../src/mcp/tasks'
import { TOOLS as NOTE_TOOLS } from '../src/mcp/tools'

const TOOLS = [...NOTE_TOOLS, ...TASK_TOOLS, ...CHAT_TOOLS]

interface Schema {
  type?: string
  properties?: Record<string, Schema>
  required?: string[]
}

interface Tool {
  name: string
  inputSchema: Schema
}

const LOCAL = fileURLToPath(
  new URL('../../../apps/desktop/src-tauri/src/mcp/tools.json', import.meta.url),
)

const local = JSON.parse(readFileSync(LOCAL, 'utf8')) as Tool[]

describe('the local server beside the connector', () => {
  test.each(TOOLS.map((tool) => [tool.name, tool as Tool] as const))(
    '%s is there under the same name, taking what it takes',
    (name, connector) => {
      const mine = local.find((tool) => tool.name === name)
      expect(mine, `nib mcp has no ${name}`).toBeDefined()
      if (!mine) return

      const theirs = connector.inputSchema.properties ?? {}
      const ours = mine.inputSchema.properties ?? {}
      for (const [argument, schema] of Object.entries(theirs)) {
        expect(ours[argument], `${name} takes no ${argument}`).toBeDefined()
        expect(ours[argument]?.type, `${name}.${argument}`).toBe(schema.type)
      }

      const needed = new Set(connector.inputSchema.required ?? [])
      for (const argument of mine.inputSchema.required ?? []) {
        expect(
          needed.has(argument),
          `${name} needs ${argument}, which the connector does not`,
        ).toBe(true)
      }
    },
  )

  test('the sixteen are every name the two share', () => {
    const theirs = new Set(TOOLS.map((tool) => tool.name))
    const shared = local.filter((tool) => theirs.has(tool.name)).map((tool) => tool.name)

    expect(shared.sort()).toEqual([...theirs].sort())
    expect(shared).toHaveLength(16)
  })
})
