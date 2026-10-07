import { describe, expect, test } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import { awarenessUpdate, receive, TEXT } from '@nib/rooms'
import * as Y from 'yjs'
import { peersIn, relative } from './peers'

/** Two devices, each with its own copy of the same words and its own awareness.
 *  What is measured is whether one can say where its caret is and the other can
 *  put it in the right place - including after the words underneath have moved. */
function pair(words: string) {
  const one = new Y.Doc()
  const two = new Y.Doc()
  one.getText(TEXT).insert(0, words)
  Y.applyUpdate(two, Y.encodeStateAsUpdate(one))

  return {
    one: { doc: one, text: one.getText(TEXT), awareness: new Awareness(one) },
    two: { doc: two, text: two.getText(TEXT), awareness: new Awareness(two) },
  }
}

describe('who else is in a note', () => {
  test('is nobody when nobody has said anything', () => {
    const { two } = pair('words\n')
    expect(peersIn(two.awareness, two.doc, 'dark')).toEqual({
      present: 0,
      carets: [],
      seen: { people: [], mine: 0 },
    })
  })

  test('never counts the device asking', () => {
    const { one } = pair('words\n')
    one.awareness.setLocalStateField('who', { name: 'Mac', accent: 'blue' })

    expect(peersIn(one.awareness, one.doc, 'dark').present).toBe(0)
  })

  test('is somebody in the note before they have put a caret anywhere', () => {
    const { one, two } = pair('words\n')
    one.awareness.setLocalStateField('who', { name: 'Mac', accent: 'blue' })
    receive(awarenessUpdate(one.awareness, [one.doc.clientID]), two.doc, two.awareness, 'room')

    const found = peersIn(two.awareness, two.doc, 'dark')
    expect(found.present).toBe(1)
    expect(found.carets).toEqual([])
  })

  test('carries a name, a caret and the shade the scheme needs', () => {
    const { one, two } = pair('one\ntwo\n')
    one.awareness.setLocalStateField('who', { name: 'Android', accent: 'teal' })
    one.awareness.setLocalStateField('caret', {
      anchor: relative(one.text, 4),
      head: relative(one.text, 7),
    })
    receive(awarenessUpdate(one.awareness, [one.doc.clientID]), two.doc, two.awareness, 'room')

    const { present, carets } = peersIn(two.awareness, two.doc, 'dark')
    expect(present).toBe(1)
    expect(carets).toHaveLength(1)
    expect(carets[0]).toMatchObject({ id: one.doc.clientID, name: 'Android', anchor: 4, head: 7 })

    // Teal, in the shade a dark background needs; the light one is another value.
    expect(carets[0]?.colour).toBe('#33c7ba')
    expect(peersIn(two.awareness, two.doc, 'light').carets[0]?.colour).toBe('#0d8277')
  })

  test('moves the caret along when words are written above it', () => {
    const { one, two } = pair('one\ntwo\n')
    one.awareness.setLocalStateField('who', { name: 'Mac', accent: 'blue' })
    one.awareness.setLocalStateField('caret', {
      anchor: relative(one.text, 4),
      head: relative(one.text, 4),
    })
    receive(awarenessUpdate(one.awareness, [one.doc.clientID]), two.doc, two.awareness, 'room')

    expect(peersIn(two.awareness, two.doc, 'dark').carets[0]?.head).toBe(4)

    // The other device writes a line above the caret, and says nothing new about
    // where its caret is. A number would have gone stale; a relative position has
    // not, because it names a character rather than an offset.
    two.text.insert(0, 'nought\n')
    expect(peersIn(two.awareness, two.doc, 'dark').carets[0]?.head).toBe(11)
  })

  test('leaves out a caret that says nothing readable', () => {
    const { two } = pair('words\n')
    // A state from a build that said something else, or from nothing at all.
    two.awareness.setLocalState({ who: 'Mac' })
    const other = new Y.Doc()
    const theirs = new Awareness(other)
    theirs.setLocalState({ nonsense: true })
    receive(awarenessUpdate(theirs, [other.clientID]), two.doc, two.awareness, 'room')

    expect(peersIn(two.awareness, two.doc, 'dark').present).toBe(0)
  })
})

describe('what a caret is labelled with', () => {
  /** A device announcing itself with a caret at the front of the note. */
  function announce(
    end: { doc: Y.Doc; text: Y.Text; awareness: Awareness },
    who: { name: string; accent: string; person?: string },
  ) {
    end.awareness.setLocalStateField('who', who)
    end.awareness.setLocalStateField('caret', {
      anchor: relative(end.text, 0),
      head: relative(end.text, 0),
    })
  }

  test('is the device, when the room holds one person’s machines', () => {
    // The question two carets raise here is which of my machines that is, and
    // "Emil" on both of them answers nothing.
    const { one, two } = pair('words\n')
    announce(one, { name: 'Android', accent: 'teal', person: 'Emil' })
    announce(two, { name: 'Windows', accent: 'blue', person: 'Emil' })
    receive(awarenessUpdate(one.awareness, [one.doc.clientID]), two.doc, two.awareness, 'room')

    expect(peersIn(two.awareness, two.doc, 'dark').carets[0]?.name).toBe('Android')
  })

  test('is the person, once more than one of them is in the note', () => {
    const { one, two } = pair('words\n')
    announce(one, { name: 'Android', accent: 'teal', person: 'Ada' })
    announce(two, { name: 'Windows', accent: 'blue', person: 'Emil' })
    receive(awarenessUpdate(one.awareness, [one.doc.clientID]), two.doc, two.awareness, 'room')

    expect(peersIn(two.awareness, two.doc, 'dark').carets[0]?.name).toBe('Ada')
  })

  test('is the person for everybody, including the reader’s own other machine', () => {
    // Three ends: this reader on two machines, and somebody else on one. Every
    // caret drawn here carries a person, because that is now the useful
    // difference between them.
    const { one, two } = pair('words\n')
    const third = new Y.Doc()
    Y.applyUpdate(third, Y.encodeStateAsUpdate(one.doc))
    const mine = { doc: third, text: third.getText(TEXT), awareness: new Awareness(third) }

    announce(one, { name: 'Android', accent: 'teal', person: 'Ada' })
    announce(mine, { name: 'Mac', accent: 'rose', person: 'Emil' })
    announce(two, { name: 'Windows', accent: 'blue', person: 'Emil' })

    for (const end of [one, mine]) {
      receive(awarenessUpdate(end.awareness, [end.doc.clientID]), two.doc, two.awareness, 'room')
    }

    const names = peersIn(two.awareness, two.doc, 'dark')
      .carets.map((caret) => caret.name)
      .sort()
    expect(names).toEqual(['Ada', 'Emil'])
  })

  test('is the device when nobody says who they are, which is a signed-out room', () => {
    const { one, two } = pair('words\n')
    announce(one, { name: 'Firefox', accent: 'teal' })
    announce(two, { name: 'Windows', accent: 'blue' })
    receive(awarenessUpdate(one.awareness, [one.doc.clientID]), two.doc, two.awareness, 'room')

    expect(peersIn(two.awareness, two.doc, 'dark').carets[0]?.name).toBe('Firefox')
  })

  test('falls back to the device for whoever did not send a person', () => {
    // An older build, still saying only which machine it is.
    const { one, two } = pair('words\n')
    announce(one, { name: 'Android', accent: 'teal' })
    announce(two, { name: 'Windows', accent: 'blue', person: 'Emil' })

    const third = new Y.Doc()
    Y.applyUpdate(third, Y.encodeStateAsUpdate(one.doc))
    const other = { doc: third, text: third.getText(TEXT), awareness: new Awareness(third) }
    announce(other, { name: 'Mac', accent: 'rose', person: 'Ada' })

    for (const end of [one, other]) {
      receive(awarenessUpdate(end.awareness, [end.doc.clientID]), two.doc, two.awareness, 'room')
    }

    const names = peersIn(two.awareness, two.doc, 'dark')
      .carets.map((caret) => caret.name)
      .sort()
    expect(names).toEqual(['Ada', 'Android'])
  })
})

describe('a caret nothing in this app would have sent', () => {
  /** One other device in the room, saying whatever it likes about where its
   *  caret is. What arrives over awareness is JSON from somebody else's machine:
   *  a build that speaks something else, or a guest a link let in who has read
   *  the protocol. */
  function saying(caret: unknown) {
    const { two } = pair('one\ntwo\n')
    const other = new Y.Doc()
    const theirs = new Awareness(other)
    theirs.setLocalState({ who: { name: 'Mac', accent: 'blue' }, caret })
    receive(awarenessUpdate(theirs, [other.clientID]), two.doc, two.awareness, 'room')

    return two
  }

  test('carries a name that is a label rather than a paragraph', () => {
    const { two } = pair('one\ntwo\n')
    const other = new Y.Doc()
    const theirs = new Awareness(other)
    theirs.setLocalState({
      who: { name: 'x'.repeat(5000), accent: 'blue' },
      caret: { anchor: relative(two.text, 0), head: relative(two.text, 0) },
    })
    receive(awarenessUpdate(theirs, [other.clientID]), two.doc, two.awareness, 'room')

    const name = peersIn(two.awareness, two.doc, 'dark').carets[0]?.name ?? ''
    expect(name.length).toBeLessThan(100)
  })

  /** A position that is a record but not one of Yjs's own: reading it is a
   *  lookup for a client nobody has heard of. */
  test('leaves the note with a peer and no caret rather than throwing', () => {
    const two = saying({ anchor: null, head: { item: 5 } })
    const found = peersIn(two.awareness, two.doc, 'dark')

    // Still somebody in the note - they are in it - with nothing to draw.
    expect(found.present).toBe(1)
    expect(found.carets).toEqual([])
  })

  test('leaves it out when the position names a place that cannot exist', () => {
    const two = saying({
      anchor: { item: { client: 1, clock: 0 } },
      head: { item: { client: 1, clock: -1 } },
    })
    const found = peersIn(two.awareness, two.doc, 'dark')

    expect(found.present).toBe(1)
    expect(found.carets).toEqual([])
  })
})

describe('an unreadable presence', () => {
  test('is left out', () => {
    const { two } = pair('words\n')
    // A state from a build that said something else, or from nothing at all.
    two.awareness.setLocalState({ who: 'Mac' })
    const other = new Y.Doc()
    const theirs = new Awareness(other)
    theirs.setLocalState({ nonsense: true })
    receive(awarenessUpdate(theirs, [other.clientID]), two.doc, two.awareness, 'room')

    expect(peersIn(two.awareness, two.doc, 'dark').present).toBe(0)
  })
})

describe('the faces of who else is in a note', () => {
  const FACE = 'f'.repeat(64)

  /** One device saying who it is, heard by another that is somebody else. */
  function heard(who: Record<string, unknown>, mine: Record<string, unknown>) {
    const { one, two } = pair('words\n')
    one.awareness.setLocalStateField('who', who)
    one.awareness.setLocalStateField('caret', {
      anchor: relative(one.text, 0),
      head: relative(one.text, 0),
    })
    two.awareness.setLocalStateField('who', mine)
    receive(awarenessUpdate(one.awareness, [one.doc.clientID]), two.doc, two.awareness, 'room')
    return peersIn(two.awareness, two.doc, 'dark')
  }

  test('are another person’s, by their account, with their picture', () => {
    const found = heard(
      { name: 'Mac', accent: 'blue', person: 'Lucile', id: 'u-lucile', face: FACE, tint: 'teal' },
      { name: 'Windows', accent: 'red', person: 'Emil', id: 'u-emil' },
    )

    expect(found.seen).toEqual({
      people: [
        {
          key: 'u-lucile',
          name: 'Lucile',
          face: `https://nibeditor.com/i/${FACE}.webp`,
          fill: '#33c7ba',
        },
      ],
      mine: 0,
    })
    expect(found.carets[0]).toMatchObject({
      name: 'Lucile',
      face: `https://nibeditor.com/i/${FACE}.webp`,
    })
  })

  test('leave this account’s own other devices as dots, named by the device', () => {
    const found = heard(
      { name: 'Phone', accent: 'blue', person: 'Emil', id: 'u-emil', face: FACE },
      { name: 'Windows', accent: 'red', person: 'Emil', id: 'u-emil' },
    )

    expect(found.seen).toEqual({ people: [], mine: 1 })
    expect(found.carets[0]).toMatchObject({ name: 'Phone', face: undefined })
  })

  test('take nothing for a face that is not a hash', () => {
    const found = heard(
      { name: 'Mac', accent: 'blue', person: 'Mia', id: 'u-mia', face: 'javascript:alert(1)' },
      { name: 'Windows', accent: 'red', person: 'Emil', id: 'u-emil' },
    )

    expect(found.seen.people[0]?.face).toBeNull()
    expect(found.carets[0]?.face).toBeUndefined()
  })
})
