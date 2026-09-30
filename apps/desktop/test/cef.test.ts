import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { engineManifest } from '../../../scripts/engine-manifest'

/** The two builds, held apart and held together.
 *
 *  nib is built twice from one source: the app on the system's own engine, which is
 *  what the installers carry, and `nib-chromium`, the same library on nib's own
 *  Chromium through `tauri-runtime-cef`, which the Browser setting fetches and switches
 *  to (src-tauri/src/engine_switch.rs). Two promises make that safe, and neither can be
 *  a Rust test, because what would break them is a manifest or a workflow rather than
 *  a line of Rust:
 *
 *  - **apart**: the app that ships is untouched by the engine - no feature on by
 *    default, no Chromium in its dependency graph or its lock file, no installer that
 *    carries it;
 *  - **together**: the engine build compiles the app's own library with the app's own
 *    dependencies, so its manifest's dependency list is the app's, written by
 *    scripts/engine-manifest.ts, and never a copy that drifted. */

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const WORKFLOWS = fileURLToPath(new URL('../../../.github/workflows/', import.meta.url))

/** The workflows that build the engine: its proof, its bump, and the release that
 *  publishes it beside the installers. */
const BUILDERS = ['cef.yml', 'cef-bump.yml', 'release.yml']

const cargo = read('../src-tauri/Cargo.toml')
const engine = read('../src-tauri/cef/Cargo.toml').replace(/\r\n/g, '\n')

const workflows = readdirSync(WORKFLOWS)
  .filter((name) => name.endsWith('.yml'))
  .sort()

describe('the app that ships', () => {
  test('the feature exists, and is a name with nothing behind it', () => {
    expect(cargo).toContain('\ncef = []')
  })

  /** The one line that keeps it off. A default feature list is the only way a plain
   *  `cargo build`, the Tauri CLI or a runner could turn it on without anybody typing
   *  it. */
  test('the crate has no default features at all', () => {
    expect(cargo).not.toMatch(/\ndefault = \[/)
  })

  /** A patch section in the app's own manifest applies to every build of that
   *  workspace, which is exactly why the engine lives in a manifest of its own. */
  test('the app patches nothing, and depends on no engine', () => {
    expect(cargo).not.toContain('[patch')
    expect(cargo).not.toMatch(/^tauri-runtime-cef/m)
    // `cef = []` is the feature; `cef = "..."` would be Chromium itself.
    expect(cargo).not.toMatch(/^cef = ["{]/m)
  })

  test('the lock file the installers are built from has no Chromium in it', () => {
    const lock = read('../src-tauri/Cargo.lock')
    expect(lock).not.toContain('name = "tauri-runtime-cef"')
    expect(lock).not.toContain('name = "cef-dll-sys"')
  })
})

describe('the engine build', () => {
  /** Every dependency the app has, with the Tauri family on the engine's pins: a crate
   *  added to the app is a crate the engine build would be missing, and this says so
   *  with the fix in its message. */
  test('its dependencies are the app\'s, as scripts/engine-manifest.ts writes them', () => {
    expect(
      engine,
      'apps/desktop/src-tauri/cef/Cargo.toml is out of date: run `node scripts/engine-manifest.ts`',
    ).toBe(engineManifest(cargo, engine))
  })

  test('it is the only manifest that names the engine, and it compiles the app\'s own library', () => {
    expect(engine).toMatch(/^tauri-runtime-cef = /m)
    expect(engine).toContain('path = "../src/lib.rs"')
    expect(engine).toContain('default = ["cef"]')
  })

  /** Published crates at exact versions, so a build gives the same answer twice and a
   *  bump is a line in a diff. */
  test('every Tauri crate it takes is pinned exactly', () => {
    for (const line of engine.split('\n').filter((one) => /^(tauri|cef)[a-z-]* = /.test(one))) {
      expect(line, line).toMatch(/"=\d/)
    }
    expect(engine).not.toContain('git = ')
    expect(engine).not.toContain('[patch')
  })
})

describe('where it is built', () => {
  test('the scan finds the workflows', () => {
    expect(workflows).toContain('publish.yml')
    expect(workflows).toContain('check.yml')
    expect(workflows.length).toBeGreaterThan(6)
  })

  for (const name of workflows.filter((one) => !BUILDERS.includes(one))) {
    test(`${name} never builds it`, () => {
      const text = readFileSync(`${WORKFLOWS}${name}`, 'utf8')
      expect(text).not.toContain('features cef')
      expect(text).not.toContain('features=cef')
      expect(text).not.toContain('src-tauri/cef')
      expect(text).not.toContain('nib-chromium')
    })
  }

  /** The installers are the app's own `tauri build`, which passes no feature of its
   *  own; the engine is a job of its own whose archives go on the release beside them. */
  test('the release builds the engine in a job of its own, never into an installer', () => {
    const text = readFileSync(`${WORKFLOWS}release.yml`, 'utf8')
    expect(text).not.toContain('features cef')
    expect(text).not.toContain('--features=cef')
    expect(text).toMatch(/\n {2}chromium:\n/)
    expect(text).toContain('apps/desktop/src-tauri/cef/pack.py')
  })

  /** The proof and the bump download three hundred megabytes of Chromium each and take
   *  an hour: a branch named `ci-check-cef*`, a schedule, or somebody asking. */
  for (const name of ['cef.yml', 'cef-bump.yml']) {
    test(`${name} runs on nothing a release runs on`, () => {
      const text = readFileSync(`${WORKFLOWS}${name}`, 'utf8')
      expect(text).not.toContain('pull_request')
      expect(text).not.toMatch(/branches: \[main\]/)
      expect(text).toMatch(/workflow_dispatch|schedule/)
    })
  }

  test('no script and no bundle config asks for it', () => {
    expect(read('../package.json')).not.toContain('cef')
    expect(read('../src-tauri/tauri.conf.json')).not.toContain('cef')
    expect(read('../../../package.json')).not.toContain('cef')
  })
})
