/** Where the keyboard is once a print is over.
 *
 *  A print is shown in a frame of its own, and the frame is focused because an
 *  engine prints the window that has the keyboard. The frame then goes away, and
 *  whoever was typing has to get the keyboard back: a reader who printed a note
 *  from the palette and carried on typing was typing into nothing.
 *
 *  jsdom has no print dialog and no fonts, so the frame's own window is stood in
 *  for - its `focus` moves the real focus to the real frame element, which is what
 *  a browser does when focus goes inside one, and its `print` does nothing, which
 *  is what a headless engine does too. Everything else is the app's own code, the
 *  frame included: it is found in the page where `printInFrame` put it. */

import { afterEach, expect, test } from 'vitest'

import { printInFrame } from '../../src/lib/export'

interface Shown {
  frame: HTMLIFrameElement
  /** What the code asked to be told about the dialog closing. */
  closed: () => void
  printed: number
}

/** The frame a print is being shown in, with a window it can use.
 *
 *  Called straight after `printInFrame`, which appends the frame before it waits
 *  for anything, so the frame is already in the page and its load has not been
 *  heard yet. */
function shown(): Shown {
  const frame = document.querySelector<HTMLIFrameElement>('iframe[aria-hidden="true"]')
  if (!frame) throw new Error('the print put no frame in the page')

  const held: Shown = {
    frame,
    closed: () => {
      throw new Error('the print never asked to be told the dialog had closed')
    },
    printed: 0,
  }

  Object.defineProperty(frame, 'contentWindow', {
    configurable: true,
    get: () => ({
      document: { fonts: { ready: Promise.resolve() } },
      addEventListener: (kind: string, run: () => void) => {
        if (kind === 'afterprint') held.closed = run
      },
      focus: () => frame.focus(),
      print: () => {
        held.printed += 1
      },
    }),
  })

  return held
}

/** The frame's load, and the two microtasks the fonts are awaited over. */
async function loaded(held: Shown): Promise<void> {
  held.frame.dispatchEvent(new Event('load'))
  await Promise.resolve()
  await Promise.resolve()
}

/** A field somebody is typing in, holding the keyboard. */
function typing(): HTMLInputElement {
  const field = document.createElement('input')
  document.body.append(field)
  field.focus()

  return field
}

afterEach(() => {
  document.body.innerHTML = ''
})

test('the keyboard goes back to whoever had it when the dialog closes', async () => {
  const field = typing()
  expect(document.activeElement).toBe(field)

  const printing = printInFrame('<p>on paper</p>')
  const held = shown()
  await loaded(held)

  expect(held.printed).toBe(1)
  expect(document.activeElement).toBe(held.frame)

  // The reader closes the dialog.
  held.closed()
  await printing

  expect(held.frame.isConnected).toBe(false)
  expect(document.activeElement).toBe(field)
})

test('a print does not take the keyboard off what the reader moved to', async () => {
  typing()

  const printing = printInFrame('<p>on paper</p>')
  const held = shown()
  await loaded(held)

  // Somebody clicked into something else while the dialog was up, so the frame is
  // not holding the keyboard any more and the print must not pull it back.
  const other = document.createElement('button')
  document.body.append(other)
  other.focus()

  held.closed()
  await printing

  expect(document.activeElement).toBe(other)
})
