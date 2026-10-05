import { expect, test } from 'vitest'
import { Scanner } from './scan'

const bytes = (text: string) => new TextEncoder().encode(text)

function safeAfter(text: string): number {
  const scanner = new Scanner()
  scanner.feed(bytes(text))
  return scanner.safe
}

test('plain text is safe after every character', () => {
  expect(safeAfter('abc')).toBe(3)
})

test('an open sequence is not, of any kind', () => {
  expect(safeAfter('ab\x1b')).toBe(2)
  expect(safeAfter('ab\x1b[3')).toBe(2)
  expect(safeAfter('ab\x1b[38;5;1')).toBe(2)
  expect(safeAfter('ab\x1b]0;title')).toBe(2)
  expect(safeAfter('ab\x1b]0;title\x1b')).toBe(2)
  expect(safeAfter('ab\x1bP1$r')).toBe(2)
  expect(safeAfter('ab\x1b(')).toBe(2)
})

test('a closed one is', () => {
  expect(safeAfter('ab\x1b[31m')).toBe(7)
  expect(safeAfter('\x1b]0;title\x07')).toBe(10)
  expect(safeAfter('\x1b]0;t\x1b\\')).toBe(7)
  expect(safeAfter('\x1b(B')).toBe(3)
  expect(safeAfter('\x1b[?1049h')).toBe(8)
  expect(safeAfter('\x1b=')).toBe(2)
})

test('half a UTF-8 character is not', () => {
  const euro = bytes('a€')
  const scanner = new Scanner()
  scanner.feed(euro.subarray(0, 2))
  expect(scanner.safe).toBe(1)
  scanner.feed(euro.subarray(2))
  expect(scanner.safe).toBe(4)
})

test('the state carries from one piece to the next', () => {
  const scanner = new Scanner()
  scanner.feed(bytes('x\x1b['))
  scanner.feed(bytes('1;2'))
  expect(scanner.safe).toBe(1)
  scanner.feed(bytes('H'))
  expect(scanner.safe).toBe(7)
})

test('CAN ends whatever was open', () => {
  expect(safeAfter('\x1b[12\x18')).toBe(5)
})
