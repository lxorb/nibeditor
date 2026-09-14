import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** A window is photographed by pid, and never by name.
 *
 *  `capture-window.ps1` used to take `-ProcessName` as a fallback for a caller with no
 *  pid, defaulting to `nib`. On a machine that is building nib there is more than one
 *  process called that, Windows lists whichever it lists, and what came back was
 *  another application's window - somebody's own mail, in a file named after this
 *  app's overlay. A photograph of the wrong window is worse than none: it can hold a
 *  stranger's screen, and nothing in the file says it is not ours.
 *
 *  So the script takes a pid or refuses, and every caller passes one. That is a
 *  contract between four files in three languages, which no one of them can state on
 *  its own - hence this test, which reads them. The refusal itself is also checked
 *  where it can be: on Windows the script answers
 *  `capture-window.ps1 needs -Pid <process id>` and exits 2, for a name and for no
 *  argument at all. */

const HERE = new URL('./', import.meta.url)
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, HERE)), 'utf8')

const SCRIPT = read('../../../scripts/capture-window.ps1')

/** Everything that shells out to the script. A new one that goes by name fails here
 *  rather than in somebody's screenshots. */
const CALLERS = [
  '../../../apps/cli/nib.mjs',
  '../../../scripts/appearance-e2e.py',
  '../../../scripts/capture-e2e.py',
  '../../../scripts/recorder-e2e.py',
  '../../../scripts/web-freeze-probe.py',
] as const

describe('the window capture', () => {
  test('takes a pid, under both spellings', () => {
    expect(SCRIPT).toMatch(/\[Alias\('Pid'\)\]/)
    expect(SCRIPT).toMatch(/\[int\]\$ProcessId = 0/)
  })

  test('has no parameter for a name, and no way to look one up', () => {
    expect(SCRIPT).not.toMatch(/\$ProcessName/)
    expect(SCRIPT).not.toMatch(/Get-Process\s+-Name/)
  })

  /** One sentence and a non-zero exit, before anything is loaded or drawn. */
  test('refuses to photograph anything when no pid was given', () => {
    expect(SCRIPT).toMatch(/if \(\$ProcessId -le 0\) \{/)
    expect(SCRIPT).toContain('needs -Pid <process id>')
    expect(SCRIPT).toMatch(/exit 2/)

    // The refusal comes before the drawing machinery, so a bad call cannot get as far
    // as a window at all.
    expect(SCRIPT.indexOf('exit 2')).toBeLessThan(SCRIPT.indexOf('Add-Type'))
  })

  test('finds its window by the pid it was given, and errors when nothing answers to it', () => {
    expect(SCRIPT).toMatch(/Get-Process -Id \$ProcessId -ErrorAction Stop/)
  })

  test.each(CALLERS)('%s passes a pid', (relative) => {
    const caller = read(relative)
    expect(caller).toContain('capture-window.ps1')
    expect(caller).toMatch(/'-(Pid|ProcessId)',|"-(Pid|ProcessId)",/)
    expect(caller).not.toMatch(/-ProcessName/)
  })

  /** The one caller that has to find the pid out rather than being handed it: an
   *  endpoint file with no pid in it is an app too old to say which window is its
   *  own, and the answer to that is to say so rather than to guess. */
  test('the command line says so rather than guessing when the app named no process', () => {
    const cli = read('../../../apps/cli/nib.mjs')
    expect(cli).toContain('did not say which process it is')
    expect(cli).not.toMatch(/pid \? \[/)
  })
})
