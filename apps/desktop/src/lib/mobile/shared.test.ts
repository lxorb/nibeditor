import { describe, expect, test } from 'vitest'
import {
  type Arrived,
  arrivedFrom,
  embedFor,
  isNote,
  isPicture,
  type SharedItem,
  sharedPlan,
  sharedTask,
  sharedTitle,
  sharedWords,
} from './shared'

/** What another app hands nib, and what that becomes.
 *
 *  Everything crossing the bridge is a string written by Kotlin, so the first
 *  half of this is about strings that are not what they claim to be: a page that
 *  believed one would write a note called `undefined` holding `[object Object]`.
 *  The second half is the answer itself - where the words go, where the pictures
 *  go, and what the front matter says about where it all came from. */

function item(one: Partial<SharedItem>): SharedItem {
  return { name: '', mime: '', size: 0, text: null, ...one }
}

function arrived(one: Partial<Arrived>): Arrived {
  return { action: 'android.intent.action.SEND', subject: '', items: [], ...one }
}

const bytes = (text: string) => new TextEncoder().encode(text)

describe('what the activity said', () => {
  test('a share of words', () => {
    const read = arrivedFrom(
      JSON.stringify({
        action: 'android.intent.action.SEND',
        subject: 'The plan',
        items: [{ name: '', mime: 'text/plain', size: 0, text: 'Two lines\nabout it' }],
      }),
    )

    expect(read?.subject).toBe('The plan')
    expect(read?.items).toEqual([
      { name: '', mime: 'text/plain', size: 0, text: 'Two lines\nabout it' },
    ])
  })

  test('a share of a picture, which is bytes to ask for', () => {
    const read = arrivedFrom(
      JSON.stringify({
        action: '',
        subject: '',
        items: [{ name: 'a.png', mime: 'image/png', size: 12 }],
      }),
    )

    expect(read?.items).toEqual([{ name: 'a.png', mime: 'image/png', size: 12, text: null }])
  })

  test('nothing at all, in every shape nothing arrives in', () => {
    expect(arrivedFrom('')).toBe(null)
    expect(arrivedFrom('undefined')).toBe(null)
    expect(arrivedFrom('null')).toBe(null)
    expect(arrivedFrom('[]')).toBe(null)
    expect(arrivedFrom('{"items":[]}')).toBe(null)
    // An item with neither words nor bytes is not a thing that was shared.
    expect(arrivedFrom('{"items":[{"name":"a.png","size":0}]}')).toBe(null)
  })

  test('an item whose fields are not what they say', () => {
    const read = arrivedFrom(
      '{"action":7,"subject":{},"items":[{"name":null,"mime":1,"size":"12","text":"x"},"no"]}',
    )

    expect(read).toEqual({
      action: '',
      subject: '',
      items: [{ name: '', mime: '', size: 0, text: 'x' }],
    })
  })
})

describe('what each thing is', () => {
  test('a picture by its type, or by its name where there is no type', () => {
    expect(isPicture(item({ mime: 'image/jpeg' }))).toBe(true)
    expect(isPicture(item({ name: 'holiday.JPG', mime: 'application/octet-stream' }))).toBe(true)
    expect(isPicture(item({ name: 'report.pdf', mime: 'application/pdf' }))).toBe(false)
    // Words are never a picture, whatever they are called.
    expect(isPicture(item({ name: 'a.png', text: 'not really' }))).toBe(false)
  })

  test('a note is markdown, or plain text, which is a note nobody called one', () => {
    expect(isNote(item({ name: 'Plan.md', mime: 'text/markdown' }))).toBe(true)
    expect(isNote(item({ name: 'Plan.markdown', mime: 'application/octet-stream' }))).toBe(true)
    expect(isNote(item({ name: 'notes.txt', mime: 'text/plain' }))).toBe(true)
    expect(isNote(item({ name: 'a.png', mime: 'image/png' }))).toBe(false)
  })
})

describe('what the note is called', () => {
  test('the subject, which is the title of the page a link came from', () => {
    expect(
      sharedTitle(
        arrived({ subject: 'Costs: Q1/Q2', items: [item({ text: 'https://x.test/a' })] }),
      ),
    ).toBe('Costs Q1 Q2')
  })

  test('the first line of the words, when there is no subject', () => {
    expect(sharedTitle(arrived({ items: [item({ text: '# The plan\n\nand the rest' })] }))).toBe(
      'The plan',
    )
  })

  test('the host, for a link and nothing else', () => {
    expect(
      sharedTitle(arrived({ items: [item({ text: 'https://www.example.test/a/b?c' })] })),
    ).toBe('example.test')
  })

  test('the file, for a share with no words in it', () => {
    expect(
      sharedTitle(arrived({ items: [item({ name: 'holiday.png', mime: 'image/png', size: 4 })] })),
    ).toBe('holiday')
  })
})

describe('a share as a task', () => {
  test('its title, linked to where it came from', () => {
    expect(
      sharedTask(
        arrived({ subject: 'Read: the plan [draft]', items: [item({ text: 'https://x.test/a' })] }),
      ),
    ).toBe('[Read the plan draft](https://x.test/a)')
  })

  test('its first line, where it came from nowhere', () => {
    expect(
      sharedTask(arrived({ items: [item({ text: 'Call the plumber\nabout the sink' })] })),
    ).toBe('Call the plumber')
  })
})

describe('the markdown for one thing', () => {
  test('a picture is drawn and a file is linked', () => {
    expect(embedFor(item({ name: 'a b.png', mime: 'image/png' }), 'assets/a b.png')).toBe(
      '![](assets/a%20b.png)',
    )
    expect(
      embedFor(item({ name: 'report.pdf', mime: 'application/pdf' }), 'assets/report.pdf'),
    ).toBe('[report.pdf](assets/report.pdf)')
  })
})

describe('what a share becomes', () => {
  const day = new Date('2026-09-12T10:00:00Z')

  test('a link, with where it came from and when', () => {
    const plan = sharedPlan(
      arrived({ subject: 'A page', items: [item({ text: 'Read this: https://x.test/a' })] }),
      new Map(),
      day,
      'assets',
    )

    expect(plan.files).toHaveLength(1)
    const note = plan.files[0]
    expect(note?.kind).toBe('note')
    expect(note?.path).toBe('A page.md')
    expect(note?.kind === 'note' && note.text).toBe(
      '---\ndate: 2026-09-12\nsource: https://x.test/a\n---\n\n# A page\n\nRead this: https://x.test/a\n',
    )
  })

  test('a picture, which lands where the setting says and is drawn in the note', () => {
    const plan = sharedPlan(
      arrived({ items: [item({ name: 'holiday.png', mime: 'image/png', size: 3 })] }),
      new Map([[0, bytes('png')]]),
      day,
      'assets',
    )

    expect(plan.files.map((one) => one.path)).toEqual(['holiday.md', 'assets/holiday.png'])
    const note = plan.files[0]
    expect(note?.kind === 'note' && note.text).toContain('![](assets/holiday.png)')
  })

  test('the folder the setting names, including the note’s own', () => {
    const one = arrived({ items: [item({ name: 'a.png', mime: 'image/png', size: 3 })] })
    const written = (folder: string) =>
      sharedPlan(one, new Map([[0, bytes('png')]]), day, folder).files.map((file) => file.path)

    expect(written('')).toEqual(['a.md', 'a.png'])
    expect(written('/assets/')).toEqual(['a.md', 'assets/a.png'])
  })

  test('a markdown file is its own note, with its own bytes', () => {
    const plan = sharedPlan(
      arrived({
        items: [item({ name: 'Kit list.md', mime: 'text/markdown', size: 9 })],
      }),
      new Map([[0, bytes('# Kit\n\nA tent')]]),
      day,
      'assets',
    )

    // No note about it: the thing shared was already a note.
    expect(plan.files).toEqual([{ kind: 'note', path: 'Kit list.md', text: '# Kit\n\nA tent' }])
  })

  test('words and pictures and a file, in one note', () => {
    const plan = sharedPlan(
      arrived({
        subject: 'Trip',
        items: [
          item({ text: 'What we need' }),
          item({ name: 'tent.png', mime: 'image/png', size: 3 }),
          item({ name: 'route.pdf', mime: 'application/pdf', size: 3 }),
        ],
      }),
      new Map([
        [1, bytes('png')],
        [2, bytes('pdf')],
      ]),
      day,
      'assets',
    )

    expect(plan.files.map((one) => one.path)).toEqual([
      'Trip.md',
      'assets/tent.png',
      'assets/route.pdf',
    ])

    const note = plan.files[0]
    const text = note?.kind === 'note' ? note.text : ''
    expect(text).toContain('What we need')
    expect(text).toContain('![](assets/tent.png)')
    expect(text).toContain('[route.pdf](assets/route.pdf)')
    // No address in it, so nothing claims a source.
    expect(text).not.toContain('source:')
  })

  test('a file nothing carried bytes for is left out entirely', () => {
    const plan = sharedPlan(
      arrived({ items: [item({ name: 'gone.png', mime: 'image/png', size: 40 })] }),
      new Map(),
      day,
      'assets',
    )

    expect(plan.files).toEqual([])
  })

  test('the words that came over, however many items carried them', () => {
    expect(sharedWords(arrived({ items: [item({ text: 'one' }), item({ text: 'two' })] }))).toBe(
      'one\n\ntwo',
    )
  })
})
