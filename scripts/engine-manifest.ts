/** The engine build's dependency list, written from the app's own.
 *
 *  `apps/desktop/src-tauri/cef/Cargo.toml` compiles the app's library a second time,
 *  against Tauri 3 and nib's own Chromium, so it needs every dependency the app has -
 *  and a list kept by hand beside the real one is a list that is one crate short the
 *  day somebody adds a crate. So the half of that manifest below its marker is this
 *  function's output: the app's dependency tables line for line, with the Tauri family
 *  moved to the engine's pins, which are the one thing the half above the marker says
 *  (`[package.metadata.engine]`). `apps/desktop/test/cef.test.ts` fails when the file
 *  is not what this would write.
 *
 *      node scripts/engine-manifest.ts     # rewrite it
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** The line the written half starts after. */
export const MARKER =
  '# ---- below: the app\'s own dependencies, as scripts/engine-manifest.ts writes them ----'

/** What the half above the marker pins the Tauri family to. */
interface Pins {
  tauri: string
  runtime: string
  build: string
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
    build: value('tauri-build'),
    plugins: value('plugins'),
    cef: value('cef'),
  }
}

/** One line of the app's tables, as the engine build needs it. */
function moved(line: string, pinned: Pins): string[] {
  // The app's own `tauri`, the one every build has: the engine's, embedding the
  // interface as a release does, with the engine itself and the crate the library
  // reaches Chromium's own objects through.
  if (line.startsWith('tauri = { version = "2", features = ["protocol-asset"')) {
    return [
      `tauri = { version = "=${pinned.tauri}", features = ["protocol-asset", "custom-protocol"] }`,
      `tauri-runtime-cef = { version = "=${pinned.runtime}", features = ["unstable"] }`,
      `cef = { version = "=${pinned.cef}", default-features = false }`,
    ]
  }
  // The desktop's `tauri` asks for developer tools, which Tauri 3 takes from the runtime.
  if (line === 'tauri = { version = "2", features = ["devtools"] }') {
    return [`tauri-runtime-cef = { version = "=${pinned.runtime}", features = ["devtools"] }`]
  }
  const plugin = /^(tauri-plugin-[a-z-]+) = (?:"2"|\{ version = "2"(.*))$/.exec(line)
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
  const from = lines.indexOf('[dependencies]')
  const to = lines.indexOf('[dev-dependencies]')
  const profile = lines.indexOf('[profile.release]')
  if (from < 0 || to < from || profile < to) {
    throw new Error('the app manifest is not in the order this reads it in')
  }

  const kept = (slice: string[]) =>
    slice.filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'))

  const written = [
    '[build-dependencies]',
    `tauri-build = "=${pinned.build}"`,
    ...kept(lines.slice(from, to)).flatMap((line) =>
      line.startsWith('[') ? ['', line] : moved(line, pinned),
    ),
    '',
    ...kept(lines.slice(profile)),
  ]
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
