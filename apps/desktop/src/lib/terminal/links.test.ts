import headless from '@xterm/headless'
import type { IBuffer } from '@xterm/xterm'
import { describe, expect, test } from 'vitest'
import { linksOn, unbroken } from './links'

const { Terminal } = headless

/** The shape of the sign-in link Claude Code prints, about 400 characters. */
const SIGN_IN =
  'https://claude.ai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e' +
  '&response_type=code&redirect_uri=https%3A%2F%2Fconsole.anthropic.com%2Foauth%2Fcode%2Fcallback' +
  '&scope=org%3Acreate_api_key+user%3Aprofile+user%3Ainference+user%3Asessions%3Aclaude_code' +
  '+user%3Amcp_servers&code_challenge=Q2xhdWRlQ29kZUNoYWxsZW5nZVZhbHVlRm9yVGVzdGluZzEy' +
  '&code_challenge_method=S256&state=U3RhdGVWYWx1ZUZvclRlc3RpbmdUaGVTaWduSW5MaW5rMDA5'

async function screen(cols: number, data: string) {
  const term = new Terminal({ cols, rows: 30, allowProposedApi: true })
  await new Promise<void>((resolve) => {
    term.write(data, resolve)
  })
  const buffer: IBuffer = term.buffer.active
  return { buffer, cols }
}

/** What Ink prints: the text cut at the width, each row its own line, dimmed. */
function hardWrapped(text: string, cols: number): string {
  const rows: string[] = []
  for (let at = 0; at < text.length; at += cols) {
    rows.push(`\x1b[2m${text.slice(at, at + cols)}\x1b[22m`)
  }
  return rows.join('\r\n')
}

function rowsOf(text: string, cols: number) {
  return Math.ceil(text.length / cols)
}

describe('an address over several rows', () => {
  for (const cols of [80, 120]) {
    for (const [how, data] of [
      ['soft', `${SIGN_IN}\r\n$ `],
      ['hard', `${hardWrapped(SIGN_IN, cols)}\r\n$ `],
    ] as const) {
      test(`${how}-wrapped at ${String(cols)} columns is one link from every row`, async () => {
        const { buffer } = await screen(cols, data)
        const last = rowsOf(SIGN_IN, cols) - 1
        for (let y = 0; y <= last; y++) {
          expect(linksOn(buffer, cols, y)).toEqual([
            {
              text: SIGN_IN,
              start: { x: 0, y: 0 },
              end: { x: (SIGN_IN.length - 1) % cols, y: last },
            },
          ])
        }
        expect(linksOn(buffer, cols, last + 1)).toEqual([])
      })

      test(`${how}-wrapped at ${String(cols)} columns copies without the breaks`, async () => {
        const { buffer } = await screen(cols, data)
        const end = { x: cols, y: rowsOf(SIGN_IN, cols) - 1 }
        const whole = unbroken(buffer, cols, { x: 0, y: 0 }, end)
        // Soft wraps are xterm.js's own to join; only a program's breaks need this.
        expect(whole).toBe(how === 'hard' ? SIGN_IN : null)
      })
    }
  }

  test('a part of it copies as that part', async () => {
    const cols = 80
    const { buffer } = await screen(cols, hardWrapped(SIGN_IN, cols))
    expect(unbroken(buffer, cols, { x: 70, y: 1 }, { x: 10, y: 2 })).toBe(SIGN_IN.slice(150, 170))
  })
})

describe('rows that are not one address', () => {
  const cols = 40
  const first = 'https://one.example/aaaaaaaaaaaaaaaaaaaa'
  const second = 'https://two.example/bbbbbbbbbbbbbbbbbbbb'

  test('two addresses each a full row stay two', async () => {
    expect(first).toHaveLength(cols)
    const { buffer } = await screen(cols, `${first}\r\n${second}\r\n`)
    expect(linksOn(buffer, cols, 0).map((link) => link.text)).toEqual([first])
    expect(linksOn(buffer, cols, 1).map((link) => link.text)).toEqual([second])
    expect(unbroken(buffer, cols, { x: 0, y: 0 }, { x: cols, y: 1 })).toBeNull()
  })

  test('an address that ends at the edge does not take the sentence under it', async () => {
    const { buffer } = await screen(cols, `${first}\r\nPress Enter to continue\r\n`)
    expect(linksOn(buffer, cols, 0).map((link) => link.text)).toEqual([first])
    expect(linksOn(buffer, cols, 1)).toEqual([])
  })

  test('an address followed by words on its row ends where they begin', async () => {
    const { buffer } = await screen(cols, 'see https://x.example/a for more\r\nok\r\n')
    expect(linksOn(buffer, cols, 0)).toEqual([
      { text: 'https://x.example/a', start: { x: 4, y: 0 }, end: { x: 22, y: 0 } },
    ])
  })

  test('full rows with no address in them are not joined', async () => {
    const { buffer } = await screen(cols, `${'='.repeat(cols)}\r\nhttps://x.example/a\r\n`)
    expect(linksOn(buffer, cols, 1).map((link) => link.start)).toEqual([{ x: 0, y: 1 }])
  })
})
