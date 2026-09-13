import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** The Android project, held to what the page believes about it.
 *
 *  None of this can be run on the machine it is written on: an emulator does not
 *  run on Windows on ARM, and the one thing that compiles the Kotlin is the
 *  `android-check` job in check.yml. What a compiler would not catch either is the
 *  drift between the two sides - a method renamed in Kotlin and still called from
 *  the page, a tile carrying a command id nothing answers to, a widget layout with
 *  four rows where the page sends five - and that is what this is for.
 *
 *  Everything here is read off the files rather than written down twice. A list of
 *  what the manifest ought to say would go stale the first time somebody added a
 *  row to it; what these ask is that the two sides agree. */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ANDROID = join(HERE, '..', 'src-tauri', 'gen', 'android', 'app', 'src', 'main')
const SOURCE = join(HERE, '..', 'src')

const read = (...parts: string[]) => readFileSync(join(...parts), 'utf8')

const manifest = read(ANDROID, 'AndroidManifest.xml')
const activity = read(ANDROID, 'java', 'ch', 'emilvinu', 'nib', 'MainActivity.kt')
const tiles = read(ANDROID, 'java', 'ch', 'emilvinu', 'nib', 'Tiles.kt')
const widgets = read(ANDROID, 'java', 'ch', 'emilvinu', 'nib', 'Widgets.kt')
const layout = read(ANDROID, 'res', 'layout', 'widget_notes.xml')
const provider = read(ANDROID, 'res', 'xml', 'widget_notes.xml')
const proguard = read(HERE, '..', 'src-tauri', 'gen', 'android', 'app', 'proguard-rules.pro')

/** What the phone's own page says, which is where the two surfaces a widget can
 *  sit on are described. Held here because a comment and a document that
 *  describe a switch the project does not hold are believed for years. */
const mobile = read(HERE, '..', '..', '..', 'docs', 'mobile.md')

/** The shorter drawing, read inside the test that wants it: a file that is not
 *  there yet should fail one test rather than the whole file. */
const lockLayout = () => read(ANDROID, 'res', 'layout', 'widget_notes_lock.xml')

/** The row views one layout holds, in the order they are declared. */
const rowsIn = (text: string) =>
  [...text.matchAll(/@\+id\/nib_row_(\d+)/g)].map((one) => Number(one[1]))

const commands = read(SOURCE, 'lib', 'commands.ts')
const bridge = read(SOURCE, 'lib', 'mobile', 'bridge.ts')

/** Every `.ts` and `.svelte` under `src`, for the questions that are about the
 *  page as a whole rather than one file of it. */
function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) sources(path, found)
    else if (/\.(ts|svelte)$/.test(entry.name)) found.push(path)
  }

  return found
}

const page = sources(SOURCE)
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n')

describe('what Android may copy out of the app', () => {
  /** The reason is in the manifest itself and in docs/mobile.md: a note is the
   *  most private thing here, the account is the backup, and a new install needs
   *  none of it. */
  test('nothing: no cloud backup and no transfer to a new phone', () => {
    expect(manifest).toContain('android:allowBackup="false"')
    expect(manifest).toContain('android:dataExtractionRules="@xml/data_extraction_rules"')

    const rules = read(ANDROID, 'res', 'xml', 'data_extraction_rules.xml')
    expect(rules).toContain('<cloud-backup>')
    expect(rules).toContain('<device-transfer>')
  })
})

describe('what the app asks the phone for', () => {
  test('the microphone, for dictation, and nothing else beyond the network', () => {
    const asked = [...manifest.matchAll(/uses-permission android:name="([^"]+)"/g)].map(
      (one) => one[1],
    )

    expect(asked).toEqual(['android.permission.INTERNET', 'android.permission.RECORD_AUDIO'])
  })

  /** Deliberate, and load-bearing: the webview offers the camera for a `capture`
   *  input only when the app has the CAMERA permission *or* has not declared it at
   *  all. Declaring it and not holding it is the one state where the camera row
   *  does nothing. See wry's RustWebChromeClient. */
  test('not the camera, which is the camera app’s own business', () => {
    expect(manifest).not.toContain('android.permission.CAMERA')
  })

  /** From Android 11 an app sees only the other apps it has named, and both of
   *  these are asked with a question before they are used. */
  test('to see the camera app and the recogniser, or neither would answer', () => {
    expect(manifest).toContain('<queries>')
    expect(manifest).toContain('android.media.action.IMAGE_CAPTURE')
    expect(manifest).toContain('android.speech.RecognitionService')
  })
})

describe('what another app may share with nib', () => {
  test('one thing, several things, and a note opened from somewhere else', () => {
    expect(manifest).toContain('android.intent.action.SEND"')
    expect(manifest).toContain('android.intent.action.SEND_MULTIPLE"')
    expect(manifest).toContain('android.intent.action.VIEW"')
    expect(manifest).toContain('android:mimeType="text/markdown"')
  })

  /** The filters are on the launcher activity rather than on one of their own,
   *  which is what puts the app's own icon in the share sheet's row and what makes
   *  the second share arrive in the app that is already open. */
  test('through the activity that is already open', () => {
    expect(manifest).toContain('android:launchMode="singleTask"')
    expect(manifest).toContain('android:name=".MainActivity"')
    expect(activity).toContain('override fun onNewIntent')
    expect(activity).toContain('Shared.take(this, intent)')
  })
})

describe('the quick settings tiles', () => {
  const declared = [
    ...manifest.matchAll(/<service\s+android:name="\.(\w+Tile)"([\s\S]*?)<\/service>/g),
  ]

  test('are the three the page can answer', () => {
    expect(declared.map((one) => one[1])).toEqual(['NewNoteTile', 'SearchTile', 'RecordTile'])
  })

  test('each bound as a tile and nothing else', () => {
    for (const [, name, body = ''] of declared) {
      expect(body, name).toContain('android.permission.BIND_QUICK_SETTINGS_TILE')
      expect(body, name).toContain('android.service.quicksettings.action.QS_TILE')
      expect(body, name).toContain('android:exported="true"')
    }
  })

  /** The whole of the wiring: a tile carries the id of a row in the app's own
   *  registry, which `mobile/handed.ts` looks up and runs. A tile whose id nothing
   *  answers to would be a tile that does nothing, so the ids are held to the
   *  registry here and every tile is on.
   *
   *  The recorder's was off while its command was another batch; it landed, so the
   *  service is enabled and the picker offers all three. A row run this way has no
   *  editor behind it - a tile can be pressed with the app closed - which is why
   *  `record` acts on the window rather than on a view; see `Block` in commands.ts. */
  test('carry command ids the app has, and every one of them is on', () => {
    const ids = [...tiles.matchAll(/override val command = "([\w.-]+)"/g)].map((one) => one[1])
    expect(ids).toEqual(['new', 'search-space', 'record'])

    for (const id of ids) expect(commands, id).toContain(`id: '${id}'`)

    for (const [, name, body = ''] of declared) {
      expect(body.includes('android:enabled="false"'), name).toBe(false)
    }
  })

  /** And nothing beside them says otherwise. The comment in the manifest, and the
   *  paragraph in docs/mobile.md, both went on describing the recorder's tile as
   *  `android:enabled="false"` for as long as the switch had been gone - and a
   *  comment that describes a switch the file does not hold is a comment that gets
   *  believed. Neither file may name the attribute while none is declared. */
  test('and nothing written beside them claims a switch that is not there', () => {
    expect(manifest).not.toContain('android:enabled')
    expect(mobile).not.toContain('android:enabled')
  })
})

describe('the home screen widget', () => {
  test('is declared, with the provider that describes it', () => {
    expect(manifest).toContain('android:name=".NotesWidget"')
    expect(manifest).toContain('android.appwidget.action.APPWIDGET_UPDATE')
    expect(manifest).toContain('android:resource="@xml/widget_notes"')
  })

  /** The page decides which notes and how many; the layout has to have room for
   *  exactly that many, because a row the launcher has no view for is a note
   *  nobody sees. */
  test('has a row for every note the page sends', () => {
    const state = read(SOURCE, 'lib', 'mobile', 'widgets.svelte.ts')
    const most = Number(/const MOST = (\d+)/.exec(state)?.[1] ?? 0)
    expect(most).toBeGreaterThan(0)

    const inProvider = [...widgets.matchAll(/R\.id\.nib_row_(\d+)/g)].map((one) => Number(one[1]))

    expect(rowsIn(layout)).toEqual([...Array(most).keys()])
    // Once, in one list: the shorter drawing takes the first of these rather
    // than naming ids of its own, so a sixth note is a row in one place.
    expect(inProvider).toEqual([...Array(most).keys()])
  })

  test('is drawn in the app’s own colours, light and dark', () => {
    const light = read(ANDROID, 'res', 'values', 'colors.xml')
    const dark = read(ANDROID, 'res', 'values-night', 'colors.xml')

    for (const name of ['widget_text', 'widget_muted']) {
      expect(light, name).toContain(`name="${name}"`)
      expect(dark, name).toContain(`name="${name}"`)
    }
  })

  test('is offered to the home screen', () => {
    expect(provider).toContain('home_screen')
  })

  test('says its own words in both languages the app has', () => {
    const english = read(ANDROID, 'res', 'values', 'strings.xml')
    const german = read(ANDROID, 'res', 'values-de', 'strings.xml')
    const names = (text: string) => [...text.matchAll(/<string name="(\w+)"/g)].map((one) => one[1])

    // The app's own name is the same word in both, so the German file holds
    // everything but those two.
    expect(names(german)).toEqual(
      names(english).filter((one) => one !== 'app_name' && one !== 'main_activity_title'),
    )
  })
})

/** The other surface the same widget is offered on. One provider, one drawing,
 *  one shorter variant of it: a lock screen has a few rows of room rather than
 *  five, and everything else about it is the home screen's widget. */
describe('the lock screen widget', () => {
  test('is the same provider, offered to the keyguard as well', () => {
    expect(provider).toContain('android:widgetCategory="home_screen|keyguard"')
    expect(provider).toContain('android:initialKeyguardLayout="@layout/widget_notes_lock"')
  })

  test('is the same drawing, cut short', () => {
    const lock = lockLayout()

    // The same card, the same heading, the same two marks, the same words for a
    // space with nothing in it: one design on both surfaces.
    for (const id of ['nib_title', 'nib_search', 'nib_new', 'nib_empty']) {
      expect(lock, id).toContain(`@+id/${id}`)
    }
    expect(lock).toContain('@drawable/widget_page')
    expect(lock).toContain('@style/NibWidgetRow')

    const shorter = rowsIn(lock)
    expect(shorter.length).toBeGreaterThan(0)
    expect(shorter.length).toBeLessThan(rowsIn(layout).length)
    // The first of the home screen's rows rather than a list of its own, which
    // is what lets the provider hand both surfaces the same notes.
    expect(shorter).toEqual(rowsIn(layout).slice(0, shorter.length))
  })

  /** A widget cannot be asked which surface it is on: the host says so in the
   *  widget's own options, and it says so again when a widget is moved between
   *  them, which is the only notice there is. */
  test('is drawn by a provider that asks which surface it is on', () => {
    expect(widgets).toContain('OPTION_APPWIDGET_HOST_CATEGORY')
    expect(widgets).toContain('WIDGET_CATEGORY_KEYGUARD')
    expect(widgets).toContain('R.layout.widget_notes_lock')
    expect(widgets).toContain('override fun onAppWidgetOptionsChanged')
  })

  /** Honestly: the surface came in Android 4.2, was taken out in 5.0 and came
   *  back in 16, and most launchers and lock screens still do not offer it. A
   *  reader who cannot find the widget should be able to read why. */
  test('is written down, with which phones actually show it', () => {
    expect(mobile).toMatch(/lock screen/i)
    expect(mobile).toContain('keyguard')
  })
})

describe('the bridge the page talks over', () => {
  const kotlin = [...activity.matchAll(/@JavascriptInterface\s+fun\s+(\w+)/g)].map((one) => one[1])
  const typed = [...bridge.matchAll(/^ {2}(\w+)\(/gm)].map((one) => one[1])

  test('is the same list on both sides', () => {
    expect(kotlin.length).toBeGreaterThan(5)
    expect([...kotlin].sort()).toEqual([...typed].sort())
  })

  /** `addJavascriptInterface` injects the bridge object into every frame of the
   *  webview, iframes included, and hands the activity nothing about which of them
   *  called. Nib's pages hold frames of somebody else's - a page a note embeds, a
   *  block of a note's own HTML - sandboxed exactly so the app is out of their
   *  reach, and the bridge was the way round that sandbox: a framed page could ask
   *  for every AI key on the phone, or turn the microphone on. So the calls that
   *  matter take a word the activity says only into the main frame. */
  test('asks for this launch’s word before a key or the microphone', () => {
    expect(activity).toContain('private val frame: String = UUID.randomUUID()')
    // Said by running a line in the page, which is the main frame and nothing else.
    expect(activity).toContain('fun askForTheFrame()')
    expect(activity).toContain('window.__nibFrame?.(')

    for (const name of ['secretRead', 'secretWrite', 'secretForget', 'listen']) {
      const found = new RegExp(`fun ${name}\\(\\s*said: String`).test(activity)
      expect(found, `${name} takes the word first`).toBe(true)
      expect(activity, `${name} checks the word`).toMatch(
        new RegExp(`fun ${name}\\([\\s\\S]{0,200}?said [!=]= frame`),
      )
    }

    // And the page asks for it rather than guessing: every call from this side
    // carries what `frameWord` answered.
    expect(page).toContain(`answer('__nibFrame'`)
    for (const call of [
      'secretRead(await frameWord(), id)',
      'secretWrite(await frameWord(), id, trimmed)',
      'secretForget(await frameWord(), id)',
    ]) {
      expect(page, call).toContain(call)
    }
  })

  /** The one thing a compiler cannot say until it has downloaded the artifact:
   *  `MasterKey` is in androidx.security:security-crypto from 1.1.0, and 1.0.0
   *  ships only the alias-based `MasterKeys` it replaced. With 1.0.0 on the path
   *  the import does not resolve and the `create` call falls through to the
   *  overload that takes a file name first, which is how this last failed - with a
   *  message about a String where an activity was, and nothing about a version. */
  test('asks for a version of the keystore library that has what it imports', () => {
    const gradle = read(HERE, '..', 'src-tauri', 'gen', 'android', 'app', 'build.gradle.kts')
    if (!activity.includes('MasterKey')) return

    const version = /androidx\.security:security-crypto:(\d+)\.(\d+)\.(\d+)/.exec(gradle)
    expect(version, 'the keystore library is not declared').not.toBe(null)

    const [major, minor] = [Number(version?.[1]), Number(version?.[2])]
    expect(major * 1000 + minor, `security-crypto ${version?.[0] ?? ''}`).toBeGreaterThanOrEqual(
      1001,
    )
  })

  /** A release build minifies, so a method the page calls by name and proguard
   *  does not keep is a method that is there in debug and gone in the APK
   *  somebody installs. */
  test('is kept whole by a release build', () => {
    expect(proguard).toContain('class ch.emilvinu.nib.MainActivity$Bridge')
    expect(proguard).toContain('@android.webkit.JavascriptInterface <methods>')
  })

  /** And the other direction: everything the activity runs in the page is
   *  something the page puts there. */
  test('every line the activity runs in the page is answered', () => {
    const called = [...activity.matchAll(/window\.(__nib\w+)/g)].map((one) => one[1])
    expect(called.length).toBeGreaterThan(2)

    for (const name of called) {
      expect(page, name).toContain(`answer('${name}'`)
    }
  })
})

describe('what a release build shrinks', () => {
  const gradle = read(HERE, '..', 'src-tauri', 'gen', 'android', 'app', 'build.gradle.kts')
  const workflow = read(HERE, '..', '..', '..', '.github', 'workflows', 'check.yml')

  /** Tink is what the keystore library encrypts with, and it is annotated with
   *  JSR-305 - two annotations that are compile-time only and on no classpath. R8
   *  stops on a dangling reference, so it is told about exactly those two. Without
   *  them a release APK cannot be built at all, which is a failure only a release
   *  assembly sees; see the job below. */
  test('is told which missing classes are meant to be missing', () => {
    if (!gradle.includes('androidx.security:security-crypto')) return

    expect(proguard).toContain('-dontwarn javax.annotation.Nullable')
    expect(proguard).toContain('-dontwarn javax.annotation.concurrent.GuardedBy')
    // A wildcard would silence the next dependency's real missing class too.
    expect(proguard).not.toContain('-dontwarn javax.annotation.**')
  })

  /** The variant matters. A debug assembly does not run R8 at all, so a job that
   *  built one proved the Kotlin and nothing about the APK anybody installs -
   *  which is how a missing keep rule reached main once already. */
  test('is what the pull request assembles, not only what a release does', () => {
    const job = workflow.slice(workflow.indexOf('android-check:'))
    const built = /tauri android build[^\n]*(?:\\\n[^\n]*)*/.exec(job)?.[0] ?? ''

    expect(built).toContain('--apk')
    expect(built, 'a debug assembly does not run R8').not.toContain('--debug')
  })
})
