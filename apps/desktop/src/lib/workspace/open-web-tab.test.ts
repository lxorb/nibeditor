import { describe, expect, test } from 'vitest'
import { secondWebTabs } from './open'

/** A tab as the check sees one: its kind, its file, and the document it shows. */
const tab = (kind: string, path: string | null, note: object) => ({ kind, path, note })

describe('a second tab over a web note', () => {
  const site = {}
  const note = {}

  test('is found against the tab that was open before it', () => {
    const open = tab('web', '/s/Site.url', site)
    const copy = tab('web', '/s/Site.url', site)

    expect(secondWebTabs([open], [copy, open])).toEqual([[copy, open]])
  })

  test('against the first where none was open before, as a session arrives', () => {
    const one = tab('web', '/s/Site.url', site)
    const two = tab('web', '/s/Site.url', site)

    expect(secondWebTabs([], [one, two])).toEqual([[two, one]])
  })

  test('is nothing for a web tab with no file, or a note in two panes', () => {
    const page = {}
    const tabs = [
      tab('web', null, page),
      tab('web', null, page),
      tab('note', '/s/a.md', note),
      tab('note', '/s/a.md', note),
    ]

    expect(secondWebTabs([], tabs)).toEqual([])
  })

  test('is nothing for one tab moved about', () => {
    const open = tab('web', '/s/Site.url', site)

    expect(secondWebTabs([open], [open])).toEqual([])
  })
})
