/** The launch's first reads, asked for the moment the page arrives.
 *
 *  An entry of its own, listed in index.html in front of the app and importing
 *  nothing, so that it runs as soon as the page is here rather than once every module
 *  of the app has been fetched and run - a tenth of a second on a fast machine, and
 *  several on a slow one. The crate read the answers while the webview was starting
 *  (src-tauri/src/ahead.rs); the round trip for them now overlaps the app's own
 *  loading, and lib/workspace/ahead.ts hands them out to whatever would have asked.
 *
 *  Only in the app's own window: a browser has no crate to ask, and a phone's crate
 *  reads nothing ahead, so the question is not answered there and the app asks for
 *  everything as it always did. */

interface Internals {
  invoke: (command: string) => Promise<unknown>
}

const internals = (window as unknown as { __TAURI_INTERNALS__?: Internals }).__TAURI_INTERNALS__

if (internals) {
  Object.assign(window, {
    nibEarly: internals.invoke('launch_ahead').catch(() => null),
  })
}
