import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import Select from '../../src/lib/Select.svelte'
import { viewport } from '../../src/lib/viewport.svelte'

/** The mark a choice can carry, in the control that draws it.
 *
 *  preferences.test.ts asks which rows are marked; this asks what a marked row
 *  looks like, which needs the component built and a list open. The same mark on
 *  both of the two lists the app has - the dropdown under the trigger on a
 *  desktop, the sheet from the bottom of a phone - because they are one control
 *  with two shapes, and a design that appeared on only one of them would be two.
 *
 *  In the jsdom project because mounting a component needs a document. Nothing
 *  here asks about layout or paint, which is the one thing jsdom cannot do: what
 *  it asks is what is in the list, what the tooltip says, and what a screen
 *  reader is given. */

/** The list arrives with a transition, and Svelte plays one through the Web
 *  Animations API, which jsdom does not implement at all. Nothing here asks how
 *  the list moves - that is paint, and a drive with a real browser is what looks
 *  at it - so the call answers something inert and the list is simply there. */
Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation

const SAID = 'Machine-translated. Corrections welcome.'

/** Two rows: one nobody has anything to say about, one that was written in a
 *  single pass. */
const OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'yue', label: '粵語', note: SAID },
]

let target: HTMLElement
let was: 'phone' | 'tablet' | 'desktop'

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
  was = viewport.device
})

afterEach(() => {
  viewport.device = was
  target.remove()
})

/** The control, open, on the kind of screen asked for. */
function picker(device: 'desktop' | 'phone') {
  viewport.device = device

  const made = mount(Select, {
    target,
    props: { value: 'en', options: OPTIONS, onchange: () => undefined, label: 'Language' },
  })
  flushSync()

  target.querySelector<HTMLButtonElement>('button.trigger')?.click()
  flushSync()

  return () => void unmount(made, { outro: false })
}

/** Each row of the open list, by the words in it. */
function rows(): { label: string; marked: boolean; tooltip: string; said: string }[] {
  return [...target.querySelectorAll('[role="option"]')].map((one) => {
    const mark = one.querySelector('.mark')

    return {
      label: one.querySelector('.text')?.textContent ?? '',
      marked: !!mark,
      tooltip: mark?.getAttribute('title') ?? '',
      said: one.querySelector('.nib-said')?.textContent ?? '',
    }
  })
}

test('a dropdown marks the row that was written in one pass, and only that one', () => {
  const close = picker('desktop')

  try {
    const [plain, marked] = rows()

    expect(plain?.label).toBe('English')
    expect(plain?.marked).toBe(false)

    // The mark sits against the name with nothing between them, so it reads as a
    // footnote on that word rather than as a column of its own.
    expect(marked?.label).toBe('粵語*')
    expect(marked?.marked).toBe(true)
    // The words are in the tooltip, and said for somebody who cannot see a
    // tooltip at all: the mark itself is out of the reading.
    expect(marked?.tooltip).toBe(SAID)
    expect(marked?.said).toBe(SAID)
  } finally {
    close()
  }
})

test('and the phone’s sheet draws the same mark, saying the same thing', () => {
  const close = picker('phone')

  try {
    // The sheet, not the dropdown: the same control in the shape a thumb gets.
    expect(target.querySelector('.sheet')).not.toBe(null)

    expect(rows()).toEqual([
      { label: 'English', marked: false, tooltip: '', said: '' },
      { label: '粵語*', marked: true, tooltip: SAID, said: SAID },
    ])
  } finally {
    close()
  }
})

/** The mark is on the rows and not on the closed control: what the chosen
 *  language is, and what it says about itself, is the caption's job under the
 *  row - the mark is there for somebody deciding between rows. */
test('the closed control shows the name and nothing else', () => {
  viewport.device = 'desktop'
  const made = mount(Select, {
    target,
    props: { value: 'yue', options: OPTIONS, onchange: () => undefined, label: 'Language' },
  })
  flushSync()

  try {
    expect(target.querySelector('.trigger .text')?.textContent).toBe('粵語')
    expect(target.querySelector('.trigger .mark')).toBe(null)
  } finally {
    void unmount(made, { outro: false })
  }
})
