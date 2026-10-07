/** The copies other sync tools make of a file they could not settle.
 *
 *  A space's folder is often inside Proton Drive, Dropbox, OneDrive or Syncthing as
 *  well, and each of those keeps both sides of a clash by writing one of them under
 *  a new name beside the file. nib syncing that copy is how one clash on one machine
 *  becomes a stray file on every device (Emil, 2026-10-05: seven `Hackathon List (#
 *  Name clash … #).md` on his account). So sync leaves such a file where it is and
 *  never carries it, and the file list shows it quietly as what it is.
 *
 *  Only names nobody types. Each mark below is the tool's own spelling, read from its
 *  source or its documentation, down to the stamp it writes. Google Drive's `Plan
 *  (1).md`, iCloud's `Plan 2.md` and a OneDrive copy named after a computer somebody
 *  renamed are left out on purpose: those are also names people give their own
 *  notes, and reading one wrongly would stop a real note from syncing. nib's own
 *  `(from another device …)` copy is not here either; it is a note like any other
 *  (`conflictPath` in @nib/markdown/paths).
 *
 *  Pure, so both engines and the file list read one rule. */

/** The tool a copy's name says made it, as the tooltip names it. */
export type ForeignTool =
  'Proton' | 'Dropbox' | 'OneDrive' | 'Syncthing' | 'Nextcloud' | 'ownCloud' | 'Seafile'

export interface ForeignCopy {
  tool: ForeignTool
  /** The name the copy was made of: what is beside it when the original is still
   *  there. */
  original: string
}

/** Each tool's mark, matched anywhere in a name and taken out of it for the original. */
const MARKS: readonly (readonly [ForeignTool, RegExp])[] = [
  // `Plan (# Name clash 2026-10-05 k3x9qaC #).md` and its four siblings, from
  // ProtonDriveApps/windows-drive SyncAgentFactory.cs (six random characters and a
  // letter) and mac-drive NSFileProviderItem+ConflictName.swift (seven). `Deleted`
  // follows the extension; an early build wrote no date.
  [
    'Proton',
    / \(# (?:Name clash|Edit conflict|Delete conflict|Temporary renamed|Deleted)(?: \d{4}-\d{2}-\d{2})? [0-9a-z]{6,8} #\)/i,
  ],
  // `mydata (conflicted copy 2018-04-10 093612).txt`: Nextcloud's manual, and
  // ownCloud's since 2.5. The time is what tells it from Dropbox's.
  ['Nextcloud', / \(conflicted copy \d{4}-\d{2}-\d{2} \d{6}\)/i],
  // `Plan (Emil's conflicted copy 2026-10-05).md`, ` (1)` inside for a second one
  // the same day (help.dropbox.com/organize/conflicted-copy).
  ['Dropbox', / \([^()]*conflicted copy \d{4}-\d{2}-\d{2}(?: \(\d+\))?\)/i],
  // `<name>.sync-conflict-<date>-<time>-<modifiedBy>.<ext>`, the device by the first
  // seven characters of its id (docs.syncthing.net/users/syncing.html).
  ['Syncthing', /\.sync-conflict-\d{8}-\d{6}-[A-Z0-9]{7}/],
  // ownCloud before 2.5: `<name>_conflict-<yyyyMMdd>-<hhmmss>.<ext>`.
  ['ownCloud', /_conflict-\d{8}-\d{6}/],
  // `test.txt (SFConflict name@example.com 2015-03-07-11-30-28)` (help.seafile.com).
  ['Seafile', / \(SFConflict [^()]+ \d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\)/],
  // OneDrive's `Report-<COMPUTER NAME>.txt`, only for the names Windows gives a
  // computer itself, `DESKTOP-` and `LAPTOP-` and a random seven or eight: a name a
  // person chose is a word, and `Plan-A.md` is a note.
  ['OneDrive', /-(?:DESKTOP-[A-Z0-9]{7}|LAPTOP-[A-Z0-9]{7,8})(?=\.[^.]*$|$)/],
]

/** What made a file or folder name a copy, and the name it is a copy of; null for a
 *  name of somebody's own. */
export function foreignCopy(name: string): ForeignCopy | null {
  for (const [tool, mark] of MARKS) {
    const found = mark.exec(name)
    if (found) return { tool, original: name.replace(found[0], '') }
  }
  return null
}

/** Whether a path is a copy or inside one: a folder Proton kept both sides of holds
 *  only copies. Either separator. */
export function inForeignCopy(path: string): boolean {
  return path.split(/[\\/]/).some((part) => foreignCopy(part) !== null)
}
