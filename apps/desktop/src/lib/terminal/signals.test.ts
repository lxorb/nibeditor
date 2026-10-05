import { describe, expect, it } from 'vitest'
import { clipboardWrite, MOST_COPY, osc777Notice, osc9Notice } from './signals'

const base64 = (text: string) => {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

describe('a program writing the clipboard (OSC 52)', () => {
  it.each(['c', 'p', 's', '0', '', 'cp'])(
    'writes it, whichever clipboard is named: %s',
    (where) => {
      expect(clipboardWrite(`${where};${base64('git push')}`)).toBe('git push')
    },
  )

  it('keeps every character, past ASCII too', () => {
    expect(clipboardWrite(`c;${base64('grüße 😀\nzweite Zeile')}`)).toBe('grüße 😀\nzweite Zeile')
  })

  it('never answers a read', () => {
    expect(clipboardWrite('c;?')).toBeNull()
  })

  it.each(['', 'c', 'c;', 'x;aGk=', 'c;not base64!', 'c;aGk=extra'])(
    'writes nothing for a payload that is not one: %j',
    (data) => {
      expect(clipboardWrite(data)).toBeNull()
    },
  )

  it('writes nothing past the most it may', () => {
    expect(clipboardWrite(`c;${base64('x'.repeat(MOST_COPY))}`)).toBe('x'.repeat(MOST_COPY))
    expect(clipboardWrite(`c;${base64('x'.repeat(MOST_COPY + 10))}`)).toBeNull()
  })
})

describe('a program asking to be looked at', () => {
  it('reads iTerm2’s OSC 9 message', () => {
    expect(osc9Notice('Claude is waiting for your input')).toEqual({
      title: null,
      body: 'Claude is waiting for your input',
    })
  })

  it.each(['9;/home/nib', '4;1;50', '1;500', '4', ''])('not ConEmu’s numbered ones: %j', (data) => {
    expect(osc9Notice(data)).toBeNull()
  })

  it('reads OSC 777’s notify, with a title and words that may hold semicolons', () => {
    expect(osc777Notice('notify;Claude Code;Done; tests pass')).toEqual({
      title: 'Claude Code',
      body: 'Done; tests pass',
    })
    expect(osc777Notice('notify;Build;')).toEqual({ title: 'Build', body: '' })
  })

  it.each(['notify;;', 'preexec', 'precmd;x', ''])('nothing else of OSC 777: %j', (data) => {
    expect(osc777Notice(data)).toBeNull()
  })

  it('cuts words a system would cut anyway', () => {
    expect(osc9Notice('x'.repeat(1000))?.body).toHaveLength(256)
  })
})
