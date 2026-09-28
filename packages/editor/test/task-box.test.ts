import { afterEach, describe, expect, test } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { setLabels } from '../src/labels'
import { CheckboxWidget } from '../src/live-preview/widgets'

/** A task's box is a form control in the middle of a line, and a control with no
 *  name is read out as "checkbox, not checked" with nothing to say what ticking it
 *  means. These tests need no DOM: the widget only makes one element and names
 *  it, so a stand-in that remembers its attributes is the whole of what is read. */

interface StandIn {
  type: string
  className: string
  checked: boolean
  attributes: Map<string, string>
  setAttribute(name: string, value: string): void
  addEventListener(): void
}

function standIn(): StandIn {
  return {
    type: '',
    className: '',
    checked: false,
    attributes: new Map(),
    setAttribute(name, value) {
      this.attributes.set(name, value)
    },
    addEventListener() {
      return undefined
    },
  }
}

const made: StandIn[] = []

Object.assign(globalThis, {
  document: {
    createElement: () => {
      const one = standIn()
      made.push(one)
      return one
    },
  },
})

afterEach(() => {
  setLabels({})
  made.length = 0
})

describe("a task's box", () => {
  test('is named for what ticking it means', () => {
    new CheckboxWidget(false, 2, 5).toDOM({} as EditorView)
    expect(made[0]?.attributes.get('aria-label')).toBe('Done')
  })

  test('in the language the app hands the editor', () => {
    setLabels({ taskDone: 'Erledigt' })
    new CheckboxWidget(true, 2, 5).toDOM({} as EditorView)
    expect(made[0]?.attributes.get('aria-label')).toBe('Erledigt')
  })
})
