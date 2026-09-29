import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** What a Mac and an iPhone ask before the app may use a device, held to what the
 *  page reaches for.
 *
 *  On both, a microphone, a camera and the speech recogniser are behind a question the
 *  system asks in the app's own words, and an app with no words for one is never asked
 *  about it: WebKit leaves `navigator.mediaDevices` out of the page altogether, so the
 *  recorder greys itself out, and the recogniser answers `not-allowed` the moment it is
 *  started. On a Mac there is a second gate behind the first. The bundle is signed with
 *  the hardened runtime, which refuses a device the entitlements do not name, words or
 *  no words. Neither shows up anywhere but on the machine: the build is green, the row
 *  is there, and pressing it does nothing.
 *
 *  Read off the files, so a new use of a device in the page fails here rather than on
 *  somebody's Mac. */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const TAURI = join(HERE, '..', 'src-tauri')
const SOURCE = join(HERE, '..', 'src')

const read = (...parts: string[]) => readFileSync(join(...parts), 'utf8')

/** The sentences one plist holds, by key. */
function sentences(plist: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const [, key = '', words = ''] of plist.matchAll(
    /<key>(\w+)<\/key>\s*<string>([^<]*)<\/string>/g,
  )) {
    found.set(key, words)
  }

  return found
}

/** What an entitlements file grants. */
const granted = (plist: string) =>
  new Set([...plist.matchAll(/<key>([\w.-]+)<\/key>\s*<true\/>/g)].map((one) => one[1]))

const mac = sentences(read(TAURI, 'Info.plist'))
const phone = sentences(read(TAURI, 'Info.ios.plist'))

/** Every `.ts` and `.svelte` under `src`, outside the tests. */
function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) sources(path, found)
    else if (/\.(ts|svelte)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
      found.push(path)
    }
  }

  return found
}

const page = sources(SOURCE).map((path) => readFileSync(path, 'utf8'))
const uses = (pattern: RegExp) => page.some((text) => pattern.test(text))

describe('the words a Mac and an iPhone ask with', () => {
  test('the page still reaches for the devices this file is about', () => {
    // If one of these goes, so can its sentence; until then a sentence is owed.
    expect(uses(/getUserMedia\(/)).toBe(true)
    expect(uses(/webkitSpeechRecognition/)).toBe(true)
    expect(uses(/\.capture = /)).toBe(true)
  })

  test('both builds say why they want the microphone and the recogniser', () => {
    for (const plist of [mac, phone]) {
      expect(plist.get('NSMicrophoneUsageDescription')).toBeTruthy()
      expect(plist.get('NSSpeechRecognitionUsageDescription')).toBeTruthy()
    }
  })

  test('both say why they want the camera', () => {
    // A site in a web tab on a Mac; a photograph into a note on a phone, which is
    // `<input capture>` and the camera WebKit opens for it.
    expect(mac.get('NSCameraUsageDescription')).toBeTruthy()
    expect(phone.get('NSCameraUsageDescription')).toBeTruthy()
  })

  test('a Mac says why printing looks at the network', () => {
    // The print sheet looks for printers, and macOS asks about that in the app's name.
    expect(mac.get('NSLocalNetworkUsageDescription')).toBeTruthy()
  })

  test('the phone does not promise a web tab it does not have', () => {
    for (const words of phone.values()) expect(words).not.toMatch(/web tab/i)
  })
})

describe('what an iPhone needs before it will show the app at all', () => {
  const plist = read(TAURI, 'Info.ios.plist')
  const config = JSON.parse(read(TAURI, 'tauri.conf.json')) as {
    bundle?: { iOS?: { minimumSystemVersion?: string } }
  }

  test('the app lives in a scene', () => {
    // Built against the iOS 27 SDK, an app with no scenes is stopped by UIKit before
    // its first frame, and tao only takes the scene road with multiple scenes on.
    expect(plist).toMatch(
      /<key>UIApplicationSceneManifest<\/key>\s*<dict>\s*<key>UIApplicationSupportsMultipleScenes<\/key>\s*<true\/>/,
    )
  })

  test('its notes and its exports are somewhere the Files app shows', () => {
    // An export on a phone is written into the app's documents folder (saveOnPhone in
    // export/save.ts), which is the reader's to see only with these two on.
    for (const key of ['UIFileSharingEnabled', 'LSSupportsOpeningDocumentsInPlace']) {
      expect(plist).toMatch(new RegExp(`<key>${key}</key>\\s*<true/>`))
    }
  })

  test('a picture offered to Photos has a sentence to ask with', () => {
    expect(sentences(plist).get('NSPhotoLibraryAddUsageDescription')).toBeTruthy()
  })

  test('the oldest iOS it installs on can read the page', () => {
    // The page is built for `esnext` and not lowered, and its regular expressions look
    // behind, which WebKit parses from 16.4: an older phone opens a blank app.
    const [major = 0, minor = 0] = (config.bundle?.iOS?.minimumSystemVersion ?? '0')
      .split('.')
      .map(Number)
    expect(major * 100 + minor).toBeGreaterThanOrEqual(1604)
  })
})

describe('the oldest Mac it installs on', () => {
  test('can read the page', () => {
    // The same page as a phone's, and the same WebKit floor: 16.4 came with macOS
    // 13.3. The default Tauri writes is 10.13, where the app opened blank.
    const config = JSON.parse(read(TAURI, 'tauri.macos.conf.json')) as {
      bundle?: { macOS?: { minimumSystemVersion?: string } }
    }
    const [major = 0, minor = 0] = (config.bundle?.macOS?.minimumSystemVersion ?? '0')
      .split('.')
      .map(Number)
    expect(major * 100 + minor).toBeGreaterThanOrEqual(1303)
  })
})

describe('what the hardened runtime lets a Mac open', () => {
  const config = JSON.parse(read(TAURI, 'tauri.macos.conf.json')) as {
    bundle?: { macOS?: { entitlements?: string; hardenedRuntime?: boolean } }
  }
  const macOS = config.bundle?.macOS ?? {}

  test('the bundle is signed with entitlements', () => {
    expect(macOS.entitlements).toBe('Entitlements.plist')
  })

  test('which name the microphone and the camera', () => {
    const grants = granted(read(TAURI, macOS.entitlements ?? 'Entitlements.plist'))
    expect(grants).toContain('com.apple.security.device.audio-input')
    expect(grants).toContain('com.apple.security.device.camera')
  })
})
