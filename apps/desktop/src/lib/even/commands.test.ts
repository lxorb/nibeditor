import { describe, expect, test } from 'vitest'
import { bare, bestOf, commandIn, likeness, numberIn } from './commands'

/** Every phrase Emil named, and the shapes a recogniser hands them over in. */
describe('the command grammar', () => {
  test.each([
    ['next', { kind: 'next' }],
    ['back', { kind: 'back' }],
    ['close', { kind: 'close' }],
    ['spaces view', { kind: 'spaces' }],
    ['notes view', { kind: 'notes' }],
    ['voice commands on', { kind: 'voice', on: true }],
    ['voice commands off', { kind: 'voice', on: false }],
  ])('hears %s', (said, want) => {
    expect(commandIn(said)).toEqual(want)
  })

  test('hears a name to switch to', () => {
    expect(commandIn('switch space to work')).toEqual({ kind: 'switchSpace', name: 'work' })
    expect(commandIn('switch note to meeting notes')).toEqual({
      kind: 'switchNote',
      name: 'meeting notes',
    })
  })

  test('hears a number, as digits or as the word for it', () => {
    expect(commandIn('open page 4')).toEqual({ kind: 'page', number: 4 })
    expect(commandIn('open page four')).toEqual({ kind: 'page', number: 4 })
    expect(commandIn('go to line 40')).toEqual({ kind: 'line', number: 40 })
    expect(commandIn('go to line forty')).toEqual({ kind: 'line', number: 40 })
    expect(commandIn('go to line twenty one')).toEqual({ kind: 'line', number: 21 })
    expect(commandIn('open page one hundred')).toEqual({ kind: 'page', number: 100 })
  })

  test('turns everything after "question" into one', () => {
    expect(commandIn('question what did I decide about the icons')).toEqual({
      kind: 'question',
      asked: 'what did i decide about the icons',
    })
  })

  test('survives the punctuation and capitals a recogniser adds', () => {
    expect(commandIn('Next.')).toEqual({ kind: 'next' })
    expect(commandIn('  CLOSE!  ')).toEqual({ kind: 'close' })
    expect(commandIn('Switch space to Work.')).toEqual({ kind: 'switchSpace', name: 'work' })
  })

  test('reads the longer phrase first, so off is never on', () => {
    // "voice commands off" starts with "voice commands on" only if the table is
    // read in the wrong order, and then every off was an on.
    expect(commandIn('voice commands off')).toEqual({ kind: 'voice', on: false })
    expect(commandIn('switch space to home')).toEqual({ kind: 'switchSpace', name: 'home' })
    // Without the name it is the picker rather than a switch to nowhere.
    expect(commandIn('switch space')).toEqual({ kind: 'spaces' })
    expect(commandIn('switch note')).toEqual({ kind: 'notes' })
  })

  test('refuses a phrase with nothing after it that needed something', () => {
    expect(commandIn('open page')).toBeNull()
    expect(commandIn('go to line')).toBeNull()
    expect(commandIn('switch space to')).toEqual({ kind: 'spaces' })
    expect(commandIn('question')).toBeNull()
    expect(commandIn('open page nowhere')).toBeNull()
    expect(commandIn('open page 0')).toBeNull()
  })

  test('hears nothing in a sentence that only mentions a command', () => {
    // A phrase has to open what was said: a reader dictating a note is not
    // turning pages.
    expect(commandIn('the next thing to do is close the door')).toBeNull()
    expect(commandIn('and back again')).toBeNull()
    expect(commandIn('')).toBeNull()
    expect(commandIn('...')).toBeNull()
  })
})

/** The words a phrase is matched on, once the recogniser's habits come off. */
describe('folding what was heard', () => {
  test('leaves bare lowercase words', () => {
    expect(bare('  Open Page 4! ')).toBe('open page 4')
    expect(bare("Emil's note, 2026.")).toBe('emil s note 2026')
  })

  test('reads a number either way it was written', () => {
    expect(numberIn('12')).toBe(12)
    expect(numberIn('twelve')).toBe(12)
    expect(numberIn('ninety nine')).toBe(99)
    expect(numberIn('two hundred')).toBe(200)
    expect(numberIn('nowhere')).toBeNull()
    expect(numberIn('')).toBeNull()
  })
})

/** Names, which are the part a recogniser gets wrong. */
describe('matching a name that was said out loud', () => {
  const notes = ['Meeting Notes 2026', 'Monday standup', 'Reading list', 'Even Realities glasses']

  test('finds a note from part of its name', () => {
    expect(bestOf('meeting notes', notes)).toBe('Meeting Notes 2026')
    expect(bestOf('monday', notes)).toBe('Monday standup')
    expect(bestOf('glasses', notes)).toBe('Even Realities glasses')
  })

  test('prefers the name more of what was said landed in', () => {
    expect(bestOf('even realities', notes)).toBe('Even Realities glasses')
    expect(bestOf('reading', notes)).toBe('Reading list')
  })

  test('finds nothing when nothing was close', () => {
    expect(bestOf('the weather in zurich', notes)).toBeNull()
    expect(bestOf('', notes)).toBeNull()
    expect(bestOf('anything', [])).toBeNull()
  })

  test('scores a whole name above a part of it', () => {
    expect(likeness('meeting notes 2026', 'Meeting Notes 2026')).toBeGreaterThan(
      likeness('meeting', 'Meeting Notes 2026'),
    )
  })

  test('ignores the case and the punctuation of both', () => {
    expect(likeness('MEETING NOTES!', 'meeting notes')).toBe(
      likeness('meeting notes', 'Meeting Notes'),
    )
  })

  test('matches the start of a word, for a plural nobody said', () => {
    expect(likeness('glass', 'glasses')).toBeGreaterThan(0.9)
    expect(likeness('note', 'notes')).toBeGreaterThan(0.9)
  })
})

describe('a task said aloud', () => {
  test('is everything after "task", or after "Aufgabe"', () => {
    expect(commandIn('Task, call mum tomorrow at four.')).toEqual({
      kind: 'task',
      said: 'call mum tomorrow at four',
    })
    expect(commandIn('Aufgabe Milch kaufen')).toEqual({ kind: 'task', said: 'milch kaufen' })
    expect(commandIn('task')).toBeNull()
  })
})
