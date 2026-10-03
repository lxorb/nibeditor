#!/usr/bin/env node
// A stand-in for Claude Code and Codex: the same questions answered in the same shapes,
// with nobody's account behind it.
//
//     node scripts/fake-ai-cli.mjs claude -p --output-format stream-json ...
//     node scripts/fake-ai-cli.mjs claude -p --input-format stream-json ...   (a session)
//     node scripts/fake-ai-cli.mjs codex app-server -c ...
//
// The crate's tests start it in place of the real programs (src-tauri/src/ai_cli.rs), and
// a native probe points the app at it through NIB_AI_CLAUDE_CODE and NIB_AI_CODEX, so the
// settings rows, a streamed answer, a stop and a plan's limit are all seen without
// signing anybody in. It refuses a question asked without the flags that keep the real
// ones from touching the machine, which is how the tests know those flags arrive; and a
// session says, in its own first lines, what it was started with - its MCP servers,
// whether a token came with them, the tools it may call - so a test can read it back.
//
// FAKE_AI_CLI_MODE says how it behaves: `answer` (the default), `slow`, `hang` (starts a
// child of its own, writes both numbers to FAKE_AI_CLI_PIDS and never ends), `limit`,
// `signed-out`, and for Codex `approval` (asks to run a command and says what it was
// told).
//
// Every ending sets an exit code rather than calling `process.exit`, which on Windows can
// end the process before a pipe has taken what was written to it.

import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const [tool, ...args] = process.argv.slice(2)
const mode = process.env.FAKE_AI_CLI_MODE ?? 'answer'

const say = (event) => process.stdout.write(`${JSON.stringify(event)}\n`)
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const has = (flag) => args.includes(flag)
const after = (flag) => (has(flag) ? args[args.indexOf(flag) + 1] : undefined)

/** The question on stdin, as its last line of words: nib wraps a question in tags, and
 *  the answer echoes what was asked rather than the tag that closed it. */
async function question() {
  let text = ''
  for await (const chunk of process.stdin) text += chunk
  const lines = text.split(/\r?\n/).map((line) => line.trim())
  return lines.filter((line) => line && !/^<\/?[a-z]+>$/.test(line)).at(-1) ?? ''
}

function refuse(why) {
  process.stderr.write(`fake-ai-cli: ${why}\n`)
  process.exitCode = 2
}

/** Starts a child that ends only with its family, and never ends either on its own. */
function hang() {
  const child = spawn(process.execPath, ['-e', 'setInterval(Date.now, 1000)'], {
    stdio: 'ignore',
  })
  if (process.env.FAKE_AI_CLI_PIDS) {
    writeFileSync(process.env.FAKE_AI_CLI_PIDS, `${process.pid} ${child.pid}`)
  }
  setInterval(Date.now, 1000)
}

/** Each line of stdin, in order, to `heard`; then `ended`. */
function linesIn(heard, ended) {
  const reader = createInterface({ input: process.stdin })
  reader.on('line', (line) => {
    if (!line.trim()) return
    let message
    try {
      message = JSON.parse(line)
    } catch {
      return refuse(`not JSON: ${line}`)
    }
    heard(message)
  })
  reader.on('close', ended)
}

const CLAUDE_HELP = [
  '  --safe-mode  all customizations disabled',
  '  --no-session-persistence',
  '  --permission-prompts <target>',
  '  --input-format <format>',
  '  --effort <level>',
  '  --restricted',
  '  --permission-mode <mode>',
].join('\n')

const RESETS = 1790819400

async function claude() {
  if (has('--version')) {
    console.log('9.9.9 (Claude Code)')
    return
  }
  if (has('--help')) {
    console.log(CLAUDE_HELP)
    return
  }
  if (args[0] === 'auth' && args[1] === 'status') {
    const signedIn = mode !== 'signed-out'
    const status = signedIn
      ? {
          loggedIn: true,
          authMethod: 'claude.ai',
          subscriptionType: 'max',
          email: 'reader@example.com',
        }
      : { loggedIn: false, authMethod: 'none' }
    console.log(JSON.stringify(status, null, 2))
    process.exitCode = signedIn ? 0 : 1
    return
  }

  if (!has('-p')) return refuse('only -p is faked')
  if (after('--tools') !== '') return refuse('asked with tools')
  if (!has('--strict-mcp-config')) return refuse('asked with the MCP servers of whoever runs it')
  if (!after('--system-prompt')) return refuse('asked without a system prompt')
  if (after('--input-format') === 'stream-json') return claudeSession()

  const asked = (await question()).trim()
  const session = 'fake-session'
  say({
    type: 'system',
    subtype: 'init',
    model: `${after('--model') ?? 'claude-fake-1'}[1m]`,
    tools: [],
    mcp_servers: [],
    session_id: session,
  })

  if (mode === 'signed-out') {
    say({
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: 'Not logged in · Please run /login',
      session_id: session,
    })
    process.exitCode = 1
    return
  }
  if (mode === 'limit') {
    say({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'rejected', resetsAt: RESETS, rateLimitType: 'five_hour' },
    })
    say({
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: "You've hit your limit",
      session_id: session,
    })
    process.exitCode = 1
    return
  }

  const model = after('--model') ?? 'claude-fake-1'
  say({ type: 'stream_event', event: { type: 'message_start', message: { model, content: [] } } })
  const words = `You asked: ${asked}`.split(/(?<= )/)
  for (const word of words) {
    say({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: word } },
    })
    if (mode === 'hang') return hang()
    if (mode === 'slow') await wait(150)
  }
  say({ type: 'assistant', message: { model, content: [{ type: 'text', text: words.join('') }] } })
  say({
    type: 'rate_limit_event',
    rate_limit_info: {
      status: 'allowed_warning',
      resetsAt: RESETS,
      rateLimitType: 'five_hour',
      unifiedWindows: { five_hour: { utilization: 0.82, resetsAt: RESETS } },
    },
  })
  say({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: words.join(''),
    session_id: session,
  })
}

/** The MCP servers a session was given, as Claude Code's init lists them: none under
 *  `--safe-mode`, which drops even `--mcp-config`'s (measured on 2.1.280). */
function claudeServers() {
  const file = after('--mcp-config')
  if (!file) return []
  const config = JSON.parse(readFileSync(file, 'utf8'))
  const names = Object.keys(config.mcpServers ?? {})
  if (names.length !== 1 || names[0] !== 'nib') throw new Error(`servers ${names.join(', ')}`)
  const nib = config.mcpServers.nib
  if (nib.args?.join(' ') !== 'mcp' || nib.env) throw new Error('nib is not run as nib mcp')
  return has('--safe-mode') ? [] : [{ name: 'nib', status: 'connected' }]
}

/** A Claude Code kept open: a `user` message per turn, control requests between. */
function claudeSession() {
  let servers
  try {
    servers = claudeServers()
  } catch (error) {
    return refuse(`asked with ${error.message}`)
  }
  const allowed = (after('--allowedTools') ?? '').split(',').filter(Boolean)
  if (allowed.some((one) => !one.startsWith('mcp__nib'))) return refuse('asked with tools')
  if (after('--permission-mode') !== 'dontAsk') return refuse('asked with a permission mode')
  if (has('--safe-mode') || has('--dangerously-skip-permissions')) return refuse('asked unsafely')

  const session = 'fake-session'
  const state = {
    model: after('--model') ?? 'claude-fake-1',
    effort: after('--effort') ?? null,
    running: false,
    interrupted: false,
  }
  const queue = []
  let draining = Promise.resolve()

  const answer = (id, response) =>
    say({ type: 'control_response', response: { subtype: 'success', request_id: id, response } })

  function control(message) {
    const id = message.request_id
    const request = message.request ?? {}
    switch (request.subtype) {
      case 'interrupt':
        if (state.running) state.interrupted = true
        return answer(id, {})
      case 'set_model':
        state.model = request.model
        return answer(id, undefined)
      case 'get_context_usage':
        return answer(id, {
          categories: [
            { name: 'System prompt', tokens: 17 },
            { name: 'Messages', tokens: 505 },
            { name: 'Free space', tokens: 199478 },
          ],
          totalTokens: 522,
          maxTokens: 200000,
        })
      case 'list_models':
        return answer(id, {
          models: [
            {
              value: 'default',
              resolvedModel: 'claude-fake-1[1m]',
              displayName: 'Default (recommended)',
              supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
              supportsFastMode: true,
            },
            { value: 'haiku', resolvedModel: 'claude-fake-haiku', displayName: 'Haiku' },
          ],
        })
      default:
        return say({
          type: 'control_response',
          response: { subtype: 'error', request_id: id, error: `no ${request.subtype}` },
        })
    }
  }

  const result = (text, extra = {}) =>
    say({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: text,
      session_id: session,
      ...extra,
    })

  async function turn(text) {
    say({
      type: 'system',
      subtype: 'init',
      model: state.model,
      tools: [],
      mcp_servers: servers,
      allowed,
      token: !!process.env.NIB_MCP_TOKEN,
      effort: state.effort,
      session_id: session,
    })
    if (text.startsWith('/effort ')) {
      state.effort = text.slice('/effort '.length)
      return result(`effort set to ${state.effort}`)
    }
    if (text.startsWith('/compact')) {
      say({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'manual' } })
      return result('')
    }
    if (text.startsWith('/goal')) return result(`goal ${text.slice(6) || 'shown'}`)
    if (mode === 'signed-out') {
      return say({
        type: 'result',
        subtype: 'success',
        is_error: true,
        result: 'Not logged in · Please run /login',
        session_id: session,
      })
    }
    if (mode === 'limit') {
      say({
        type: 'rate_limit_event',
        rate_limit_info: { status: 'rejected', resetsAt: RESETS, rateLimitType: 'five_hour' },
      })
      return say({
        type: 'result',
        subtype: 'success',
        is_error: true,
        result: "You've hit your limit",
        session_id: session,
      })
    }

    state.running = true
    state.interrupted = false
    const usage = { input_tokens: 500, cache_read_input_tokens: 20, output_tokens: 0 }
    say({
      type: 'stream_event',
      event: { type: 'message_start', message: { model: state.model, content: [], usage } },
    })
    say({
      type: 'stream_event',
      event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
    })
    say({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Thinking about it.' },
      },
    })
    if (/use a tool/.test(text) && allowed.length) {
      const id = 'toolu_1'
      say({
        type: 'assistant',
        message: {
          model: state.model,
          content: [
            { type: 'tool_use', id, name: 'mcp__nib__read_note', input: { path: 'Herons.md' } },
          ],
        },
      })
      say({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: id, content: 'Herons wade.' }],
        },
      })
    }
    const words = `You asked: ${text}`.split(/(?<= )/)
    let spoken = ''
    for (const word of words) {
      if (state.interrupted) break
      if (mode === 'hang') return hang()
      say({
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: word } },
      })
      spoken += word
      if (mode === 'slow') await wait(150)
    }
    state.running = false
    if (state.interrupted) {
      return say({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        session_id: session,
      })
    }
    say({
      type: 'stream_event',
      event: { type: 'message_delta', usage: { ...usage, output_tokens: 12 } },
    })
    say({
      type: 'assistant',
      message: { model: state.model, content: [{ type: 'text', text: spoken }] },
    })
    say({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed', resetsAt: RESETS, rateLimitType: 'five_hour' },
    })
    result(spoken, {
      usage: { ...usage, output_tokens: 12 },
      total_cost_usd: 0.01,
      modelUsage: {
        [state.model]: { inputTokens: 520, outputTokens: 12, contextWindow: 200000 },
      },
    })
  }

  linesIn(
    (message) => {
      if (message.type === 'control_request') return control(message)
      if (message.type !== 'user') return
      const content = message.message?.content
      const text = Array.isArray(content)
        ? content
            .filter((one) => one.type === 'text')
            .map((one) => one.text)
            .join('')
        : String(content ?? '')
      queue.push(text.trim())
      draining = draining.then(async () => {
        while (queue.length) await turn(queue.shift())
      })
    },
    () => void draining,
  )
}

async function codex() {
  if (has('--version')) {
    console.log('codex-cli 9.9.9')
    return
  }
  if (args[0] === 'login' && args[1] === 'status') {
    const signedIn = mode !== 'signed-out'
    process.stderr.write(signedIn ? 'Logged in using ChatGPT\n' : 'Not logged in\n')
    process.exitCode = signedIn ? 0 : 1
    return
  }
  if (args[0] !== 'app-server') return refuse('only app-server is faked')
  for (const setting of [
    'features.shell_tool=false',
    'mcp_servers={}',
    "sandbox_mode='read-only'",
    "approval_policy='never'",
  ]) {
    if (!has(setting)) return refuse(`served without ${setting}`)
  }
  appServer()
}

/** Codex's app-server: JSON-RPC lines without the `jsonrpc` field. */
function appServer() {
  let ready = false
  let threads = 0
  let turns = 0
  const running = new Map()
  const waiting = new Map()

  const reply = (id, result) => say({ id, result })
  const fail = (id, message, code = -32600) => say({ id, error: { code, message } })
  const tell = (method, params) => say({ method, params })

  function startThread(id, params) {
    if (params.sandbox !== 'read-only') return fail(id, 'not read-only')
    if (params.approvalPolicy !== 'never') return fail(id, 'asks somebody')
    if (params.ephemeral !== true) return fail(id, 'kept on disk')
    const config = params.config ?? {}
    if (Object.keys(config).some((key) => !key.startsWith('mcp_servers.nib.')))
      return fail(id, 'configured beyond nib')
    if (config['mcp_servers.nib.command']) {
      if (config['mcp_servers.nib.args']?.join(' ') !== 'mcp') return fail(id, 'not nib mcp')
      if (
        !config['mcp_servers.nib.env_vars']?.includes('NIB_MCP_TOKEN') ||
        !process.env.NIB_MCP_TOKEN
      )
        return fail(id, 'nib mcp has no token')
    }
    const thread = { id: `thread-${++threads}` }
    reply(id, {
      thread,
      model: params.model ?? 'gpt-fake',
      told: { enabled_tools: config['mcp_servers.nib.enabled_tools'] ?? null },
    })
    tell('thread/started', { thread })
  }

  async function runTurn(threadId, turn, text) {
    tell('turn/started', { threadId, turn: { id: turn.id, status: 'inProgress', items: [] } })
    if (mode === 'hang') return hang()
    if (mode === 'limit') {
      const error = {
        message: "You've hit your usage limit. Try again at 3:05 PM.",
        codexErrorInfo: 'usageLimitExceeded',
      }
      tell('error', { error, willRetry: false, threadId, turnId: turn.id })
      tell('turn/completed', { threadId, turn: { id: turn.id, status: 'failed', error } })
      return
    }
    if (mode === 'approval') {
      const answered = new Promise((resolve) => waiting.set('ask-1', resolve))
      say({
        id: 'ask-1',
        method: 'item/commandExecution/requestApproval',
        params: { threadId, turnId: turn.id, itemId: 'cmd-1', command: 'rm -rf /' },
      })
      const decision = (await answered)?.decision ?? 'nothing'
      const item = { type: 'agentMessage', id: 'msg-1', text: `answered ${decision}` }
      tell('item/completed', { threadId, turnId: turn.id, item })
      tell('turn/completed', { threadId, turn: { id: turn.id, status: 'completed' } })
      return
    }
    const reasoning = { type: 'reasoning', id: 'rs-1', summary: [], content: [] }
    tell('item/started', { threadId, turnId: turn.id, item: reasoning })
    tell('item/reasoning/summaryTextDelta', {
      threadId,
      turnId: turn.id,
      itemId: 'rs-1',
      delta: 'Thinking about it.',
      summaryIndex: 0,
    })
    tell('item/completed', { threadId, turnId: turn.id, item: reasoning })
    const itemId = `msg-${turn.id}`
    tell('item/started', {
      threadId,
      turnId: turn.id,
      item: { type: 'agentMessage', id: itemId, text: '' },
    })
    let spoken = ''
    for (const word of `You asked: ${text}`.split(/(?<= )/)) {
      if (turn.interrupted) break
      tell('item/agentMessage/delta', { threadId, turnId: turn.id, itemId, delta: word })
      spoken += word
      if (mode === 'slow') await wait(300)
    }
    tell('item/completed', {
      threadId,
      turnId: turn.id,
      item: { type: 'agentMessage', id: itemId, text: spoken },
    })
    const counts = {
      totalTokens: 530,
      inputTokens: 500,
      cachedInputTokens: 100,
      cacheWriteInputTokens: 0,
      outputTokens: 30,
      reasoningOutputTokens: 10,
    }
    tell('thread/tokenUsage/updated', {
      threadId,
      turnId: turn.id,
      tokenUsage: { total: counts, last: counts, modelContextWindow: 272000 },
    })
    tell('account/rateLimits/updated', {
      rateLimits: { primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: RESETS } },
    })
    const status = turn.interrupted ? 'interrupted' : 'completed'
    running.delete(threadId)
    tell('turn/completed', { threadId, turn: { id: turn.id, status, error: null } })
  }

  function request({ id, method, params = {} }) {
    if (method === 'initialize') {
      ready = true
      return reply(id, { userAgent: 'fake/9.9.9', platformFamily: 'windows' })
    }
    if (!ready) return fail(id, 'Not initialized')
    switch (method) {
      case 'thread/start':
      case 'thread/fork':
        return startThread(id, params)
      case 'thread/unsubscribe':
        return reply(id, {})
      case 'turn/start': {
        const text = (params.input ?? [])
          .filter((one) => one.type === 'text')
          .map((one) => one.text)
          .join('')
        const turn = { id: `turn-${++turns}`, interrupted: false }
        running.set(params.threadId, turn)
        reply(id, {
          turn: { id: turn.id, status: 'inProgress', items: [] },
          told: {
            model: params.model ?? null,
            effort: params.effort ?? null,
            summary: params.summary,
            serviceTier: params.serviceTier ?? null,
          },
        })
        void runTurn(params.threadId, turn, text)
        return
      }
      case 'turn/steer': {
        const turn = running.get(params.threadId)
        if (!turn || turn.id !== params.expectedTurnId) return fail(id, 'no such turn')
        return reply(id, { turnId: turn.id })
      }
      case 'turn/interrupt': {
        const turn = running.get(params.threadId)
        if (turn) turn.interrupted = true
        return reply(id, {})
      }
      case 'thread/compact/start':
        reply(id, {})
        return tell('item/completed', {
          threadId: params.threadId,
          turnId: 'compact',
          item: { type: 'contextCompaction', id: 'cc-1' },
        })
      case 'thread/goal/set':
      case 'thread/goal/get': {
        const goal = {
          threadId: params.threadId,
          objective: params.objective ?? 'a goal',
          status: params.status ?? 'active',
          tokenBudget: params.tokenBudget ?? null,
          tokensUsed: 0,
          timeUsedSeconds: 0,
        }
        reply(id, { goal })
        return tell('thread/goal/updated', { threadId: params.threadId, turnId: null, goal })
      }
      case 'thread/goal/clear':
        reply(id, { cleared: true })
        return tell('thread/goal/cleared', { threadId: params.threadId })
      case 'model/list':
        return reply(id, {
          data: [
            {
              id: 'gpt-fake',
              model: 'gpt-fake',
              displayName: 'GPT Fake',
              hidden: false,
              supportedReasoningEfforts: [
                { reasoningEffort: 'low', description: '' },
                { reasoningEffort: 'medium', description: '' },
                { reasoningEffort: 'high', description: '' },
                { reasoningEffort: 'xhigh', description: '' },
              ],
              defaultReasoningEffort: 'medium',
              inputModalities: ['text', 'image'],
              serviceTiers: [{ id: 'priority', name: 'Fast', description: '' }],
              isDefault: true,
            },
          ],
          nextCursor: null,
        })
      default:
        return fail(id, `no ${method}`, -32601)
    }
  }

  linesIn(
    (message) => {
      if (message.method && message.id !== undefined) return request(message)
      if (message.method) return
      const resolve = waiting.get(message.id)
      if (resolve) {
        waiting.delete(message.id)
        resolve(message.result)
      }
    },
    () => undefined,
  )
}

if (tool === 'claude') await claude()
else if (tool === 'codex') await codex()
else refuse(`no tool ${tool}`)
