/** The activity's side of the phone app, and the one place the page looks for it.
 *
 *  A webview has no API for a share, a quick settings tile, a home screen widget
 *  or a speech recogniser, so `MainActivity` hangs one object on the page under
 *  `__NIB_SYSTEM__` and every one of those goes through it. Everything that
 *  crosses is a string, a number or a boolean - a `@JavascriptInterface` carries
 *  nothing else - so anything with a shape is JSON on the way over and is read
 *  by the module that asked for it.
 *
 *  Methods are asked for one at a time rather than the object being taken whole.
 *  There is no object at all in a browser, on a desktop or on iOS, an APK built
 *  before a method existed does not have it, and a test stubs only the method it
 *  is about; each caller says what it needs and does nothing where the answer is
 *  nothing. */

/** Every method `MainActivity.Bridge` publishes. One list, so the page and the
 *  activity can be read against each other; `test/android.test.ts` holds the two
 *  sides to it.
 *
 *  The three about a secret are the AI providers' keys, and they are called from
 *  ai/keys.ts rather than from here - that module asks the same object for its own
 *  three by name, the way everything on this bridge is asked for. They are in the
 *  list because the list is what the activity publishes, not what this file uses.
 *
 *  Four of them take a word first. `addJavascriptInterface` injects the object into
 *  every frame of the webview - an embedded page, a block of a note's own HTML - and
 *  tells the activity nothing about which of them called. Those frames are sandboxed
 *  so the app is out of their reach, and the bridge was the way round it: a framed
 *  page could read every AI key or turn the microphone on. So the calls that matter
 *  want the word only the page can have; see `frameWord` and `frame` in
 *  MainActivity.kt. */
export interface NibSystem {
  /** The four edges the system bars keep, as JSON; see insets.ts. */
  insets(): string
  /** Asks the activity to say this launch's word - into the page itself, whoever
   *  asked. See `frameWord`. */
  askForTheFrame(): void
  /** Which way round the system bars' own icons go. */
  bars(dark: boolean): void
  /** What a tile or a widget row asked for, once, as JSON; see handed.ts. */
  handed(): string
  /** What another app shared, without the bytes, as JSON; see shared.ts. */
  shared(): string
  /** One slice of one shared file, as base64. */
  sharedBytes(at: number, offset: number, length: number): string
  /** The page has written what it was given; the copies may go. */
  sharedDone(): void
  /** The rows the home screen draws, as JSON; see widgets.ts. */
  widgets(json: string): void
  /** Whether this phone has a speech recogniser at all. */
  dictates(): boolean
  /** Turns dictation on or off; answers whether it is listening. */
  listen(said: string, on: boolean): boolean
  /** An AI provider's key, out of the file the Keystore guards; see ai/keys.ts. */
  secretRead(said: string, name: string): string | null
  secretWrite(said: string, name: string, secret: string): void
  secretForget(said: string, name: string): void
  /** The reminders' plan and the buttons' words, as JSON: the alarms the phone sets;
   *  see reminders/platform.ts and Reminders.kt. */
  reminders(said: string, json: string): void
  /** Done and presses on a reminder since the page last asked, as JSON, once. */
  remindersTaken(): string
  /** Whether the phone rings an alarm at its minute rather than within a few. */
  exactAlarms(): boolean
  /** The system's own switch for exact alarms, opened once. */
  askExactAlarms(): void
}

/** One method of the bridge, or nothing where there is no activity behind it. */
export function method<K extends keyof NibSystem>(name: K): NibSystem[K] | undefined {
  const found: unknown = (globalThis as { __NIB_SYSTEM__?: unknown }).__NIB_SYSTEM__
  if (typeof found !== 'object' || found === null) return undefined

  // Checked before it is named: a value crossing into the page is unknown until
  // it has been read.
  const held = (found as Partial<NibSystem>)[name]
  return typeof held === 'function' ? held : undefined
}

/** Whether the page is running inside the activity at all, which is the one
 *  question every mobile feature asks before it offers itself. */
export function onTheActivity(): boolean {
  return !!method('insets')
}

/** This launch's word, asked for once and kept for as long as the page lives.
 *
 *  Asked for rather than pushed, because the page is what needs it and the page
 *  knows when. The activity answers by running a line in the main frame, so a frame
 *  at another origin can ask all it likes and the answer lands somewhere it cannot
 *  read. The empty string anywhere there is no activity - a desktop, a browser, an
 *  iOS build - which is also what a call carrying nothing would say.
 *
 *  One promise, shared: two features asking at the same moment are one question. */
let word: Promise<string> | undefined

/** How long the activity has to answer before the page gives up on it. An answer is
 *  one line run in the page and is there within a frame; a wait with no end would be
 *  a key field that never settles on an older build of the app. */
const PATIENCE = 2000

export function frameWord(): Promise<string> {
  if (word) return word

  const ask = method('askForTheFrame')
  if (!ask) return Promise.resolve('')

  word = new Promise<string>((said) => {
    const timer = setTimeout(() => said(''), PATIENCE)
    answer('__nibFrame', (text: string) => {
      clearTimeout(timer)
      said(text)
    })
    ask()
  })

  return word
}

/** What the activity calls back on. Kotlin cannot hold a reference to a function,
 *  so it runs a line in the page instead and the page leaves one on the window
 *  under the name that line names; `undefined` takes it away again.
 *
 *  On the window rather than on `globalThis`, because that is what the activity
 *  writes (`window.__nibInsets?.()`) and the two have to be the same object. */
export function answer(
  name: string,
  fn: ((text: string) => void) | (() => void) | undefined,
): void {
  if (typeof window === 'undefined') return
  Object.assign(window, { [name]: fn })
}
