/** The engine build's dependency list, written from the app's own.
 *
 *  `apps/desktop/src-tauri/cef/Cargo.toml` compiles the app's library a second time,
 *  against Tauri 3 and nib's own Chromium, so it needs every dependency the app has -
 *  and a list kept by hand beside the real one is a list that is one crate short the
 *  day somebody adds a crate. So the half of that manifest below its marker is this
 *  function's output: the app's dependency tables line for line - its tests' too, as the
 *  engine build runs them - with the Tauri family moved to the engine's pins, which are
 *  the one thing the half above the marker says (`[package.metadata.engine]`). `apps/desktop/test/cef.test.ts` fails when the file
 *  is not what this would write.
 *
 *      node scripts/engine-manifest.ts     # rewrite it
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** The line the written half starts after. */
export const MARKER =
  "# ---- below: the app's own dependencies, as scripts/engine-manifest.ts writes them ----"

/** What the half above the marker pins the Tauri family to. */
interface Pins {
  tauri: string
  runtime: string
  core: string
  build: string
  utils: string
  plugins: string
  cef: string
}

function pins(head: string): Pins {
  const table = head.split('\n[package.metadata.engine]\n')[1]
  if (table === undefined) throw new Error('the engine manifest names no [package.metadata.engine]')
  const value = (key: string) => {
    const found = new RegExp(`^${key} = "([^"]+)"$`, 'm').exec(table)
    if (!found?.[1]) throw new Error(`[package.metadata.engine] has no ${key}`)
    return found[1]
  }
  return {
    tauri: value('tauri'),
    runtime: value('tauri-runtime-cef'),
    core: value('tauri-runtime'),
    build: value('tauri-build'),
    utils: value('tauri-utils'),
    plugins: value('plugins'),
    cef: value('cef'),
  }
}

/** A feature list as a manifest writes one. */
const listed = (features: string[]) => features.map((one) => `"${one}"`).join(', ')

/** One line of the app's tables, as the engine build needs it. */
function moved(line: string, pinned: Pins): string[] {
  // The build script's own two: the step that makes the context, and what it reads the
  // config with (identity.rs).
  if (/^tauri-build = /.test(line)) return [`tauri-build = "=${pinned.build}"`]
  if (/^tauri-utils = /.test(line)) return [`tauri-utils = "=${pinned.utils}"`]
  const tauri = /^tauri = \{ version = "2", features = \[([^\]]*)\] \}$/.exec(line)
  if (tauri) {
    const features = [...(tauri[1] ?? '').matchAll(/"([^"]+)"/g)].map((one) => one[1] ?? '')
    // The app's own `tauri`, the one every build has: the engine's, with every feature
    // the app asks for, embedding the interface as a release does, and beside it the
    // engine itself and the crate the library reaches Chromium's own objects through.
    // And Tauri's runtime interface, held to the release the engine was built against:
    // a later one is within what the engine asks for and need not be what it implements.
    if (features.includes('protocol-asset')) {
      return [
        `tauri = { version = "=${pinned.tauri}", features = [${listed([...features, 'custom-protocol'])}] }`,
        `tauri-runtime-cef = { version = "=${pinned.runtime}", features = ["unstable"] }`,
        `tauri-runtime = "=${pinned.core}"`,
        `cef = { version = "=${pinned.cef}", default-features = false }`,
      ]
    }
    // A platform's own features - the desktop's developer tools, which Tauri 3 takes
    // from the runtime, and anything else, which it takes as Tauri 2 did.
    const kept = features.filter((one) => one !== 'devtools')
    return [
      ...(features.includes('devtools')
        ? [`tauri-runtime-cef = { version = "=${pinned.runtime}", features = ["devtools"] }`]
        : []),
      ...(kept.length > 0
        ? [`tauri = { version = "=${pinned.tauri}", features = [${listed(kept)}] }`]
        : []),
    ]
  }
  // Every plugin on the plugins' pin, whatever the app narrowed its own to: a `~2.3` that
  // keeps a Tauri 2 plugin off a release wanting a newer Tauri 2 says nothing about 3.
  const plugin =
    /^(tauri-plugin-[a-z-]+) = (?:"[~^=]?2[.\d]*"|\{ version = "[~^=]?2[.\d]*"(.*))$/.exec(line)
  if (plugin?.[1]) {
    return [
      plugin[2] === undefined
        ? `${plugin[1]} = "=${pinned.plugins}"`
        : `${plugin[1]} = { version = "=${pinned.plugins}"${plugin[2]}`,
    ]
  }
  if (/^tauri[a-z-]* =/.test(line)) {
    throw new Error(`the app depends on ${line}, which the engine build has no pin for`)
  }
  return [line]
}

/** The engine manifest `engine` with its written half made again from the app's
 *  manifest `app`. */
export function engineManifest(app: string, engine: string): string {
  const [head] = engine.split(`\n${MARKER}\n`)
  if (head === undefined || head === engine) throw new Error('the engine manifest has no marker')
  const pinned = pins(head)

  const lines = app.replace(/\r\n/g, '\n').split('\n')
  const from = lines.indexOf('[build-dependencies]')
  const profile = lines.indexOf('[profile.release]')
  if (from < 0 || lines.indexOf('[dependencies]') < from || profile < from) {
    throw new Error('the app manifest is not in the order this reads it in')
  }

  const kept = (slice: string[]) =>
    slice.filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'))

  const written = [
    ...kept(lines.slice(from, profile)).flatMap((line) =>
      line.startsWith('[') ? ['', line] : moved(line, pinned),
    ),
    '',
    ...kept(lines.slice(profile)),
  ].slice(1)
  return `${head}\n${MARKER}\n\n${written.join('\n')}\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const at = (path: string) => fileURLToPath(new URL(path, import.meta.url))
  const target = at('../apps/desktop/src-tauri/cef/Cargo.toml')
  const made = engineManifest(
    readFileSync(at('../apps/desktop/src-tauri/Cargo.toml'), 'utf8'),
    readFileSync(target, 'utf8').replace(/\r\n/g, '\n'),
  )
  writeFileSync(target, made)
}
