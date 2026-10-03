/** Bases' expression language, read into a tree.
 *
 *  The language is JavaScript's expressions without assignment: literals (numbers,
 *  strings in either quote, `true`, `false`, `null`, `[lists]`, `{"objects": 1}`,
 *  `/regular expressions/g`), names, `.member`, `[index]`, calls, `!` and unary
 *  minus, `* / %`, `+ -`, comparisons, `== !=`, `&&`, `||`. Obsidian documents it
 *  on its Bases syntax and functions pages; this reads exactly that and refuses
 *  the rest with where it stopped, so the formula field can say where. */

import { BasesError } from '../errors'

export type Node =
  | { type: 'literal'; value: null | boolean | number | string }
  | { type: 'regex'; pattern: string; flags: string }
  | { type: 'list'; items: Node[] }
  | { type: 'object'; entries: [string, Node][] }
  | { type: 'name'; name: string; at: number }
  | { type: 'member'; object: Node; name: string; at: number }
  | { type: 'index'; object: Node; index: Node }
  | { type: 'call'; callee: Node; args: Node[]; at: number }
  | { type: 'unary'; op: '!' | '-' | '+'; argument: Node }
  | { type: 'binary'; op: BinaryOp; left: Node; right: Node }
  | { type: 'logical'; op: '&&' | '||'; left: Node; right: Node }

type BinaryOp = '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '<' | '>' | '<=' | '>='

type TokenKind = 'number' | 'string' | 'regex' | 'name' | 'punct' | 'end'

interface Token {
  kind: TokenKind
  text: string
  /** The value of a number or a string, the flags of a regex. */
  value?: string | number
  at: number
}

const PUNCT = [
  '&&',
  '||',
  '==',
  '!=',
  '<=',
  '>=',
  '!',
  '<',
  '>',
  '+',
  '-',
  '*',
  '/',
  '%',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  ',',
  '.',
  ':',
]

const NAME_START = /[\p{L}_$]/u
const NAME_PART = /[\p{L}\p{N}_$]/u

/** Whether a `/` here starts a regular expression rather than a division: after a
 *  value it divides, anywhere else it opens a pattern. */
function opensRegex(previous: Token | undefined): boolean {
  if (!previous) return true
  if (previous.kind === 'number' || previous.kind === 'string' || previous.kind === 'regex')
    return false
  if (previous.kind === 'name') return false
  return !(previous.text === ')' || previous.text === ']' || previous.text === '}')
}

const ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  b: '\b',
  f: '\f',
  v: '\v',
  '0': '\0',
}

function tokens(source: string): Token[] {
  const out: Token[] = []
  let at = 0

  while (at < source.length) {
    const char = source.charAt(at)
    if (/\s/.test(char)) {
      at++
      continue
    }

    if (/\d/.test(char)) {
      const found = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(at))
      const text = found?.[0] ?? char
      out.push({ kind: 'number', text, value: Number(text), at })
      at += text.length
      continue
    }

    if (char === '"' || char === "'") {
      let value = ''
      let end = at + 1
      while (end < source.length && source.charAt(end) !== char) {
        if (source.charAt(end) === '\\' && end + 1 < source.length) {
          const next = source.charAt(end + 1)
          if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(source.slice(end + 2, end + 6))) {
            value += String.fromCharCode(parseInt(source.slice(end + 2, end + 6), 16))
            end += 6
            continue
          }
          value += ESCAPES[next] ?? next
          end += 2
          continue
        }
        value += source.charAt(end)
        end++
      }
      if (end >= source.length) throw new BasesError('A string is not closed', at)
      out.push({ kind: 'string', text: source.slice(at, end + 1), value, at })
      at = end + 1
      continue
    }

    if (char === '/' && opensRegex(out.at(-1))) {
      let end = at + 1
      let inClass = false
      while (end < source.length) {
        const one = source.charAt(end)
        if (one === '\\') end++
        else if (one === '[') inClass = true
        else if (one === ']') inClass = false
        else if (one === '/' && !inClass) break
        end++
      }
      if (end >= source.length) throw new BasesError('A pattern is not closed', at)
      const flags = /^[dgimsuvy]*/.exec(source.slice(end + 1))?.[0] ?? ''
      out.push({ kind: 'regex', text: source.slice(at + 1, end), value: flags, at })
      at = end + 1 + flags.length
      continue
    }

    if (NAME_START.test(char)) {
      let end = at + 1
      while (end < source.length && NAME_PART.test(source.charAt(end))) end++
      out.push({ kind: 'name', text: source.slice(at, end), at })
      at = end
      continue
    }

    const punct = PUNCT.find((one) => source.startsWith(one, at))
    if (!punct) throw new BasesError(`Unexpected "${char}"`, at)
    out.push({ kind: 'punct', text: punct, at })
    at += punct.length
  }

  out.push({ kind: 'end', text: '', at: source.length })
  return out
}

/** Binding strength of each binary operator, weakest first. */
const LEVELS: string[][] = [
  ['||'],
  ['&&'],
  ['==', '!='],
  ['<', '>', '<=', '>='],
  ['+', '-'],
  ['*', '/', '%'],
]

/** Reads an expression into its tree, or throws a BasesError saying where it
 *  stopped making sense. */
export function parseExpression(source: string): Node {
  const list = tokens(source)
  let at = 0

  const peek = () => list[at] ?? { kind: 'end' as const, text: '', at: source.length }
  const next = () => {
    const token = peek()
    at++
    return token
  }
  const is = (text: string) => peek().kind === 'punct' && peek().text === text
  const expect = (text: string) => {
    if (!is(text)) {
      const token = peek()
      throw new BasesError(
        token.kind === 'end' ? `Expected "${text}" at the end` : `Expected "${text}"`,
        token.at,
      )
    }
    return next()
  }

  const binary = (level: number): Node => {
    const ops = LEVELS[level]
    if (!ops) return unary()
    let left = binary(level + 1)
    while (peek().kind === 'punct' && ops.includes(peek().text)) {
      const op = next().text
      const right = binary(level + 1)
      left =
        op === '&&' || op === '||'
          ? { type: 'logical', op, left, right }
          : { type: 'binary', op: op as BinaryOp, left, right }
    }
    return left
  }

  const unary = (): Node => {
    if (is('!') || is('-') || is('+')) {
      const op = next().text as '!' | '-' | '+'
      return { type: 'unary', op, argument: unary() }
    }
    return postfix(primary())
  }

  const args = (close: string): Node[] => {
    const out: Node[] = []
    if (is(close)) {
      next()
      return out
    }
    for (;;) {
      out.push(binary(0))
      if (is(',')) {
        next()
        if (is(close)) break
        continue
      }
      break
    }
    expect(close)
    return out
  }

  const postfix = (start: Node): Node => {
    let node = start
    for (;;) {
      if (is('.')) {
        next()
        const name = next()
        if (name.kind !== 'name') throw new BasesError('Expected a name after "."', name.at)
        node = { type: 'member', object: node, name: name.text, at: name.at }
      } else if (is('[')) {
        next()
        const index = binary(0)
        expect(']')
        node = { type: 'index', object: node, index }
      } else if (is('(')) {
        const open = next()
        node = { type: 'call', callee: node, args: args(')'), at: open.at }
      } else {
        return node
      }
    }
  }

  const primary = (): Node => {
    const token = next()
    switch (token.kind) {
      case 'number':
        return { type: 'literal', value: Number(token.value) }
      case 'string':
        return { type: 'literal', value: String(token.value) }
      case 'regex':
        return { type: 'regex', pattern: token.text, flags: String(token.value) }
      case 'name':
        if (token.text === 'true') return { type: 'literal', value: true }
        if (token.text === 'false') return { type: 'literal', value: false }
        if (token.text === 'null') return { type: 'literal', value: null }
        return { type: 'name', name: token.text, at: token.at }
      case 'punct':
        if (token.text === '(') {
          const inner = binary(0)
          expect(')')
          return inner
        }
        if (token.text === '[') return { type: 'list', items: args(']') }
        if (token.text === '{') return object()
        throw new BasesError(`Unexpected "${token.text}"`, token.at)
      case 'end':
        throw new BasesError('The expression ends too soon', token.at)
    }
  }

  const object = (): Node => {
    const entries: [string, Node][] = []
    while (!is('}')) {
      const key = next()
      if (key.kind !== 'string' && key.kind !== 'name')
        throw new BasesError('Expected a key', key.at)
      expect(':')
      entries.push([key.kind === 'string' ? String(key.value) : key.text, binary(0)])
      if (!is(',')) break
      next()
    }
    expect('}')
    return { type: 'object', entries }
  }

  if (peek().kind === 'end') throw new BasesError('The expression is empty', 0)
  const tree = binary(0)
  const rest = peek()
  if (rest.kind !== 'end') throw new BasesError(`Unexpected "${rest.text}"`, rest.at)
  return tree
}
