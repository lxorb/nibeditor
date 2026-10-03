import { describe, expect, test } from 'vitest'
import { LONGEST_TASK, scanRows } from './scan'

/** The twins of the crate's cases in links.rs: the same notes, the same answers. */
describe('what a note gives the rows of its space', () => {
  test('its task lines and the sections above them', () => {
    const { tasks } = scanRows(
      '# Home\n- [ ] Water the plants 📅 2026-10-04\n## Kitchen\n  - [/] Descale\n# Bank\n1. [x] Call ✅ 2026-10-01\n',
    )

    expect(
      tasks.map((one) => [one.line, one.indent, one.mark, one.text, one.section.join(' > ')]),
    ).toEqual([
      [1, 0, ' ', 'Water the plants 📅 2026-10-04', 'Home'],
      [3, 2, '/', 'Descale', 'Home > Kitchen'],
      [5, 0, 'x', 'Call ✅ 2026-10-01', 'Bank'],
    ])
  })

  test('front matter is raw, and code and front matter hold no tasks', () => {
    const read = scanRows(
      '---\nstatus: open\n# a comment\n---\n```\n- [ ] not a task\n```\n- [ ] a task\n',
    )

    expect(read.front).toBe('status: open\n# a comment')
    expect(read.tasks.map((one) => [one.line, one.section])).toEqual([[7, []]])

    const plain = scanRows('- [ ] one\r\n')
    expect(plain.front).toBeNull()
    expect(plain.tasks[0]?.text).toBe('one')

    expect(scanRows('---\r\na: 1\r\n---\r\n').front).toBe('a: 1')
  })

  test('a line that runs on is kept to a length, cut on a character', () => {
    const { tasks } = scanRows(`- [ ] ${'😀'.repeat(LONGEST_TASK + 10)}`)
    expect(Array.from(tasks[0]?.text ?? '')).toHaveLength(LONGEST_TASK)
  })

  test('a heading of the same level or higher closes the one before it', () => {
    const { tasks } = scanRows('## A\n### B\n- [ ] one\n## C\n- [ ] two\n#nottag\n- [ ] three\n')
    expect(tasks.map((one) => one.section)).toEqual([['A', 'B'], ['C'], ['C']])
  })
})
