/** The sidebar's agent's tools: nib's own `nib mcp` verbs, asked of the crate as the
 *  built-in agent of this provider (4.4).
 *
 *  The crate lists what the grant reaches in the thread's mode and answers each call the
 *  way the endpoint answers an outside agent's - the policy, the questions, the log, the
 *  marks round words from outside - and writes the result the way `nib mcp` writes it
 *  for a model. So there is no second policy here: this file only carries the calls
 *  across and reads the answers back. See src-tauri/src/ai_agent.rs.
 *
 *  Desktop only, like the endpoint; elsewhere a thread answers without tools. */

import { isDesktop, invoke } from '../../tauri'
import type { Provider } from '../providers'
import { EDITS, READER_TABS } from './choices'
import type { Mode, ToolOutput } from './types'
import { record, text, type ToolDef } from './wire'

/** What the loop needs of the tools: a list, and a call. A fake stands in for the crate
 *  in the tests. */
export interface Tools {
  list(provider: Provider, mode: Mode): Promise<Listed>
  call(provider: Provider, mode: Mode, name: string, args: unknown): Promise<ToolOutput>
}

/** What the crate lists: the tools, and the instructions `nib mcp` gives every outside
 *  agent's model - what the untrusted marks mean, what `needs_approval` asks of it. */
export interface Listed {
  instructions: string
  tools: ToolDef[]
}

/** Which built-in agent asks: the provider, and the two choices that shape its grant. */
function agentOf(provider: Provider) {
  return {
    id: provider.id,
    name: provider.name,
    readerTabs: READER_TABS,
    askFirst: EDITS === 'ask-first',
  }
}

/** One row of the crate's list. */
function toolIn(value: unknown): ToolDef | null {
  const row = record(value)
  const name = text(row.name)
  if (!name) return null
  return {
    name,
    description: text(row.description),
    inputSchema: row.inputSchema ?? { type: 'object' },
    ...(row.annotations ? { annotations: record(row.annotations) } : {}),
  }
}

/** An MCP tool result, read: its words, its pictures, whether it failed, and the
 *  question it asked where it asked one. */
export function outputIn(value: unknown): ToolOutput {
  const result = record(value)
  const content = Array.isArray(result.content) ? result.content.map(record) : []
  const meta = record(record(result._meta)['ch.emilvinu.nib/answer'])
  const approval = meta.status === 'needs_approval' ? text(meta.approval) : ''
  return {
    text: content
      .filter((one) => one.type === 'text')
      .map((one) => text(one.text))
      .join('\n'),
    images: content
      .filter((one) => one.type === 'image')
      .map((one) => ({ mime: text(one.mimeType) || 'image/png', data: text(one.data) })),
    error: result.isError === true,
    ...(approval ? { approval } : {}),
  }
}

/** The crate, as the sidebar's agent reaches it. */
export const crateTools: Tools = {
  async list(provider, mode) {
    if (!isDesktop) return { instructions: '', tools: [] }
    const listed = record(
      await invoke<unknown>('ai_agent_tools', { agent: agentOf(provider), mode }),
    )
    const tools = Array.isArray(listed.tools) ? listed.tools : []
    return {
      instructions: text(listed.instructions),
      tools: tools.map(toolIn).filter((one): one is ToolDef => one !== null),
    }
  },

  async call(provider, mode, name, args) {
    try {
      const answered = await invoke<unknown>('ai_agent_call', {
        agent: agentOf(provider),
        mode,
        tool: name,
        args: typeof args === 'object' && args !== null ? args : {},
      })
      return outputIn(answered)
    } catch (error) {
      // The crate could not ask at all (nib's window gone, a tool this mode does not
      // list): the model is told so in the crate's words and carries on.
      return {
        text: error instanceof Error ? error.message : String(error),
        images: [],
        error: true,
      }
    }
  },
}
