#!/usr/bin/env node
// A stand-in for Claude Code and Codex: the same questions answered in the same shapes,
// with nobody's account behind it.
//
//     node scripts/fake-ai-cli.mjs claude -p --output-format stream-json ...
//     node scripts/fake-ai-cli.mjs codex exec --json ... -
//
// The crate's tests start it in place of the real programs (src-tauri/src/ai_cli.rs), and
// a native probe points the app at it through NIB_AI_CLAUDE_CODE and NIB_AI_CODEX, so the
// settings rows, a streamed answer, a stop and a plan's limit are all seen without
// signing anybody in. It refuses a question asked without the flags that keep the real
// ones from touching the machine, which is how the tests know those flags arrive.
//
// FAKE_AI_CLI_MODE says how it behaves: `answer` (the default), `slow`, `hang` (starts a
// child of its own, writes both numbers to FAKE_AI_CLI_PIDS and never ends), `limit`,
// `signed-out`.
//
// Every ending sets an exit code rather than calling `process.exit`, which on Windows can
// end the process before a pipe has taken what was written to it.

import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const [tool, ...args] = process.argv.slice(2)
const mode = process.env.FAKE_AI_CLI_MODE ?? 'answer'

const say = (event) => process.stdout.write(`${JSON.stringify(event)}\n`)
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const has = (flag) => args.includes(flag)
const after = (flag) => (has(flag) ? args[args.indexOf(flag) + 1] : undefined)

async function question() {
  let text = ''
  for await (const chunk of process.stdin) text += chunk
  return text
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

const CLAUDE_HELP = [
  '  --safe-mode  all customizations disabled',
  '  --no-session-persistence',
  '  --permission-prompts <target>',
].join('\n')

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

  const asked = (await question()).trim()
  const session = 'fake-session'
  say({
    type: 'system',
    subtype: 'init',
    model: `${after('--model') ?? 'claude-fake-1'}[1m]`,
    tools: [],
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
      rate_limit_info: { status: 'rejected', resetsAt: 1790819400, rateLimitType: 'five_hour' },
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
  const words = `You asked: ${asked.split('\n').at(-1) ?? ''}`.split(/(?<= )/)
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
      resetsAt: 1790819400,
      rateLimitType: 'five_hour',
      unifiedWindows: { five_hour: { utilization: 0.82, resetsAt: 1790819400 } },
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

async function codex() {
  if (has('--version')) {
    console.log('codex-cli 9.9.9')
    return
  }
  if (args[0] === 'exec' && has('--help')) {
    console.log('  --ephemeral\n  --ignore-user-config')
    return
  }
  if (args[0] === 'login' && args[1] === 'status') {
    const signedIn = mode !== 'signed-out'
    process.stderr.write(signedIn ? 'Logged in using ChatGPT\n' : 'Not logged in\n')
    process.exitCode = signedIn ? 0 : 1
    return
  }

  if (args[0] !== 'exec' || !has('--json')) return refuse('only exec --json is faked')
  if (after('--sandbox') !== 'read-only') return refuse('asked without a read-only sandbox')
  if (!has('features.shell_tool=false')) return refuse('asked with the shell tool')
  if (args.at(-1) !== '-') return refuse('asked without the question on stdin')

  const asked = (await question()).trim()
  say({ type: 'thread.started', thread_id: 'fake-thread' })
  say({ type: 'turn.started' })
  if (mode === 'limit') {
    const message =
      "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 3:05 PM."
    say({ type: 'error', message })
    say({ type: 'turn.failed', error: { message } })
    process.exitCode = 1
    return
  }
  if (mode === 'hang') return hang()
  say({
    type: 'item.completed',
    item: { id: 'item_0', type: 'reasoning', text: 'Thinking about it.' },
  })
  if (mode === 'slow') await wait(300)
  say({
    type: 'item.completed',
    item: {
      id: 'item_1',
      type: 'agent_message',
      text: `You asked: ${asked.split('\n').at(-1) ?? ''}`,
    },
  })
  say({
    type: 'turn.completed',
    usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 },
  })
}

if (tool === 'claude') await claude()
else if (tool === 'codex') await codex()
else refuse(`no tool ${tool}`)
