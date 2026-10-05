/** The connector an LLM talks to, over HTTP rather than a local process.
 *
 *  Streamable HTTP: one endpoint, JSON-RPC in, JSON-RPC out. The token is the
 *  only thing that identifies the caller, and what it may do travels with it -
 *  see tokens.ts - so this file is only the protocol: who is asking, what they
 *  asked for, and the shape of the answer. */

import { Hono } from 'hono'
import { SIGN_IN } from '../refused'
import { challenge } from '../oauth'
import type { Env } from '../types'
import { bearer } from './tokens'
import { callTaskTool, TASK_TOOLS } from './tasks'
import { callTool, TOOLS } from './tools'

export { mcpAdmin } from './tokens'

const PROTOCOL = '2025-06-18'

/** An id is echoed back as it arrived, so a client can match the answer to the
 *  call. Anything but a string, a number or null is not an id and is answered
 *  as if none was sent. */
function idOf(value: unknown): string | number | null {
  return typeof value === 'string' || typeof value === 'number' ? value : null
}

function fields(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export const mcp = new Hono<{ Bindings: Env }>()

// Streamable HTTP lets a client open a stream with GET; there is none here,
// and saying so is what stops the client waiting for one. Without this the
// request would fall through to the web app's HTML.
mcp.get('/', (context) => context.body(null, 405, { allow: 'POST' }))
mcp.delete('/', (context) => context.body(null, 405, { allow: 'POST' }))

mcp.post('/', async (context) => {
  const header = context.req.header('authorization')
  const token = await bearer(context.env, header)

  // The refusal says where to sign in (RFC 9728), which is how a client that
  // was only given the URL finds the OAuth server on its own.
  if (!token) {
    return context.json({ error: SIGN_IN }, 401, {
      'www-authenticate': challenge(context.env, !!header),
    })
  }

  // A body that is not an object - a list of calls, a bare string, nothing at
  // all - has no method in it, which is the same answer as a method nobody
  // sent. Read through `fields` so neither can throw on the way in.
  const request = fields(await context.req.json<unknown>().catch(() => null))
  const method = typeof request.method === 'string' ? request.method : ''
  if (!method) return context.json({ error: 'not a request' }, 400)

  const id = idOf(request.id)
  const reply = (result: unknown) => context.json({ jsonrpc: '2.0', id, result })

  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: 'nib', version: '1.0.0' },
      })

    // Notifications carry no id and expect no answer.
    case 'notifications/initialized':
      return new Response(null, { status: 202 })

    case 'ping':
      return reply({})

    case 'tools/list':
      return reply({ tools: [...TOOLS, ...TASK_TOOLS] })

    case 'tools/call': {
      const params = fields(request.params)
      const name = typeof params.name === 'string' ? params.name : ''
      const args = fields(params.arguments)

      try {
        const text = TASK_TOOLS.some((tool) => tool.name === name)
          ? await callTaskTool(context.env, token, name, args)
          : await callTool(context.env, token, name, args)
        return reply({ content: [{ type: 'text', text }] })
      } catch {
        // Whatever went wrong is ours to read in the logs, not the model's to
        // relay: an answer that carried the message could carry an internal.
        return reply({
          content: [{ type: 'text', text: 'That did not work. Try again.' }],
          isError: true,
        })
      }
    }

    default:
      return context.json({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `unknown method ${method}` },
      })
  }
})
