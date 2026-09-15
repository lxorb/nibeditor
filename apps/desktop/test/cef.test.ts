import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** The engine the app ships on, held to.
 *
 *  nib has two builds: the app, on the system's own engine, and the one behind the
 *  crate's `cef` feature, which is nib's own Chromium through `tauri-runtime-cef`.
 *  The second one is a gate rather than a product - docs/browser.md batch 1 - and
 *  the promise that makes it safe to have in the repository at all is that the first
 *  one is untouched by it: the same engine, the same launch, the same installer, the
 *  same tests.
 *
 *  A promise like that is worth exactly as much as the test that holds it, and it
 *  cannot be a Rust test, because what would break it is a manifest or a workflow
 *  rather than a line of Rust. So this reads the packaging: the crate has no default
 *  features, nothing that builds a release passes the flag or builds the flagged
 *  workspace, the app's own manifest patches nothing, and the two workflows that do
 *  build it are gated to a branch nobody releases from. */

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const WORKFLOWS = fileURLToPath(new URL('../../../.github/workflows/', import.meta.url))

/** The two that are allowed to know about the engine, and nothing else is. */
const FLAGGED = ['cef.yml', 'cef-bump.yml']

const cargo = read('../src-tauri/Cargo.toml')
const flagged = read('../src-tauri/cef/Cargo.toml')
const locked = read('../src-tauri/cef/Cargo.lock')

const workflows = readdirSync(WORKFLOWS)
  .filter((name) => name.endsWith('.yml'))
  .sort()

describe('the app that ships', () => {
  test('the feature exists, and is a name with nothing behind it', () => {
    expect(cargo).toContain('\ncef = []')
  })

  /** The one line that keeps it off. A default feature list is the only way a
   *  plain `cargo build`, the Tauri CLI or a runner could turn it on without
   *  anybody typing it. */
  test('the crate has no default features at all', () => {
    expect(cargo).not.toMatch(/\ndefault = \[/)
  })

  /** And the other way a build could change under everyone: a patch section in the
   *  app's own manifest applies to every build of that workspace, which is exactly
   *  why the engine lives in a workspace of its own. */
  test('the app patches nothing, and depends on no engine', () => {
    expect(cargo).not.toContain('[patch')
    // The comment above the feature names the crate; a dependency on it would be
    // a line that starts with it, and there is none in either build.
    expect(cargo).not.toMatch(/^tauri-runtime-cef/m)
    // `cef = []` is the feature; `cef = "..."` would be Chromium itself.
    expect(cargo).not.toMatch(/^cef = ["{]/m)
  })

  test('the flagged workspace is the only place the engine is named', () => {
    expect(flagged).toContain('tauri-runtime-cef')
    expect(flagged).toContain('[patch.crates-io]')
  })

  /** The pin, in one place, as one revision. A second revision anywhere in that
   *  manifest would be a build made of two different Tauris; a short one is a
   *  moving target. */
  test('the pin is one whole revision', () => {
    const revisions = [...flagged.matchAll(/^revision = "([0-9a-f]+)"/gm)].map((one) => one[1])
    expect(revisions).toHaveLength(1)
    expect(revisions[0]).toHaveLength(40)
  })

  /** Every dependency the app takes is in the flagged workspace's lock file.
   *
   *  **This one is here because it cost a round of `cef.yml`.** That lock records the
   *  app crate's own dependency list, because the app is a path dependency of
   *  `nib-cef` - so adding a crate to the app's manifest makes the flagged build fail
   *  with `cannot update the lock file ... because --locked was passed`, in a workflow
   *  nothing on the way to main runs and forty-five minutes after the push. `check.yml`
   *  never builds that workspace and cannot notice. Reading two files can: the day
   *  somebody adds a dependency, this says so in the ordinary test run, and the fix is
   *  `cargo generate-lockfile` in `apps/desktop/src-tauri/cef`.
   *
   *  `window-vibrancy` was the one that found it. */
  test('every dependency the app takes is in the flagged lock file', () => {
    const inside = locked.split('\nname = "nib"\n')[1]?.split('\n[[package]]')[0] ?? ''
    expect(inside).toContain('dependencies')

    // The dependency names out of the app's own manifest, table by table: only the
    // ones under a `[...dependencies]` header, so `version` under `[package]` and the
    // feature names under `[features]` are not mistaken for crates. A renamed
    // dependency is written down as its package, which is the name the lock uses.
    const asked = new Set<string>()
    let table = ''
    for (const line of cargo.split('\n')) {
      const header = /^\[([^\]]+)\]/.exec(line)
      if (header) {
        table = header[1] ?? ''
        continue
      }
      if (!table.endsWith('dependencies')) continue

      const named = /^([a-z0-9_-]+) = [{"]/.exec(line)
      if (!named) continue
      const renamed = /package = "([a-z0-9_-]+)"/.exec(line)
      const name = renamed?.[1] ?? named[1]
      if (name) asked.add(name)
    }

    expect(asked.size).toBeGreaterThan(10)
    for (const name of asked) {
      // `windows` and friends appear in the lock with a version beside them, so the
      // quoted name is the test either way.
      expect(inside, `${name} is in the app's manifest and not in the flagged lock`).toContain(
        `"${name}`,
      )
    }
  })
})

describe('nothing that ships knows about the engine', () => {
  test('the scan finds the workflows', () => {
    expect(workflows).toContain('publish.yml')
    expect(workflows).toContain('check.yml')
    expect(workflows.length).toBeGreaterThan(6)
  })

  for (const name of workflows.filter((one) => !FLAGGED.includes(one))) {
    test(`${name} never asks for it`, () => {
      const text = readFileSync(`${WORKFLOWS}${name}`, 'utf8')
      expect(text).not.toContain('features cef')
      expect(text).not.toContain('features=cef')
      expect(text).not.toContain('src-tauri/cef')
      expect(text).not.toContain('nib-cef')
    })
  }

  /** The scripts a person runs by hand, and the config the installers are built
   *  from. `tauri build` reads the second one and passes no features of its own. */
  test('no script and no bundle config asks for it', () => {
    expect(read('../package.json')).not.toContain('cef')
    expect(read('../src-tauri/tauri.conf.json')).not.toContain('cef')
    expect(read('../../../package.json')).not.toContain('cef')
  })
})

describe('the two that do build it', () => {
  for (const name of FLAGGED) {
    /** A branch named `ci-check-cef*`, or somebody asking by hand. Never a pull
     *  request, and never a push to the branch releases are cut from: the job
     *  downloads three hundred megabytes of Chromium and takes an hour and a half. */
    test(`${name} runs on nothing a release runs on`, () => {
      const text = readFileSync(`${WORKFLOWS}${name}`, 'utf8')
      expect(text).not.toContain('pull_request')
      expect(text).not.toMatch(/branches: \[main\]/)
      expect(text).toMatch(/workflow_dispatch|schedule/)
    })
  }

  test('the gate builds the app as it ships as well, which is what the numbers are read against', () => {
    const text = readFileSync(`${WORKFLOWS}cef.yml`, 'utf8')
    expect(text).toContain('apps/desktop/src-tauri/Cargo.toml --release')
    expect(text).toContain('gate.py')
  })
})
