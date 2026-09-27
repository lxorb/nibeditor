/** The one note a first visit is given, and how to tell it from writing.
 *
 *  Its own module because three places need it and none of them should reach for
 *  either of the others: the browser shim writes it, the workspace steps off it
 *  once there is something better to read, and syncing refuses to push it into an
 *  account. The last of those is the one that cost somebody an evening.
 *
 *  **A seed is not writing, and must never travel as though it were.** The Even
 *  Realities plugin is served from a local port that is picked afresh every
 *  launch, so its `localStorage` and its IndexedDB are empty on every launch: the
 *  shim read that as a first visit, wrote this note, and syncing then offered it
 *  to the account - every launch, for ever, putting it back each time Emil deleted
 *  it. His words: "on the plugin every time I open it it creates and syncs the
 *  default note onto my account. This is so annoying."
 *
 *  Three rules came out of that, and they are in three places:
 *
 *  1. the plugin never seeds at all (workspace.svelte.ts);
 *  2. a device is seeded once, remembered where the answer outlives a launch, so
 *     an empty folder is not read as a first visit (seeded.ts);
 *  3. an untouched seed is never created in an account, and a path the account
 *     already holds is paired with rather than pushed over (sync/mirror.ts).
 *
 *  Any one of them fixes Emil's complaint. All three are here because each is a
 *  different way of being wrong about the same thing. */

/** Where the shim writes it, in the virtual file system's own absolute form. */
export const WELCOME_PATH = '/Notes/Read me.md'

/** What it is called inside its space, which is the shape syncing sees. */
export const WELCOME_NAME = 'Read me.md'

/** Written by every build - see first-space.svelte.ts - so it names none. */
export const WELCOME = `# Welcome to Nib

Your notes live on this device until you sign in
and turn on syncing, and then they follow you everywhere.

- Everything is markdown, and nothing else
- **Bold**, *italic*, ==highlight==, \`code\`
- $E = mc^2$ renders as you type

\`\`\`js
const hello = 'world'
\`\`\`

| What | Where |
| ---- | ----- |
| Notes | this device |
| Synced notes | your account |
`

/** What earlier versions wrote. Still untouched on the devices they seeded. */
const EARLIER = [
  WELCOME.replace(
    'Your notes live on this device',
    'This is the browser version. Your notes live in this browser',
  ).replace('| this device |', '| this browser |'),
]

/** Whether a note is the seed exactly as the app wrote it.
 *
 *  Exactly: a character typed into it makes it the reader's, and the reader's
 *  notes go to their account like any other. Nothing about "looks like" the
 *  welcome note - a guess here would silently refuse to sync something somebody
 *  wrote. */
export function isUntouchedWelcome(path: string, content: string): boolean {
  const name = path.split(/[\\/]/u).at(-1) ?? ''
  return name === WELCOME_NAME && (content === WELCOME || EARLIER.includes(content))
}
