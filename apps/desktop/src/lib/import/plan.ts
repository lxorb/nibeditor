/** What an import would make, worked out before a single file is written.
 *
 *  Every format reader answers with one of these, so the sheet has one thing to
 *  count and to show and the writing has one thing to do. Nothing here knows
 *  about a space or a folder: paths are relative to wherever the reader chooses
 *  to put the import, which is what lets the same plan be previewed, targeted
 *  somewhere else, and then written.
 *
 *  A plan holds the whole import in memory. That is the honest limit of reading
 *  an export in a webview, and it is the reason the sheet says how much it is
 *  about to write before it starts. */

/** Which app the files came out of. `markdown` is the plain case: a folder of
 *  notes, which is what half of these apps export when asked nicely.
 *
 *  `apple-notes` is the one that arrives two ways: as a folder some exporter
 *  wrote, and on a Mac out of Notes' own database. Both are Apple Notes, so both
 *  are called that. */
export type FormatId =
  | 'notion'
  | 'evernote'
  | 'keep'
  | 'bear'
  | 'logseq'
  | 'roam'
  | 'craft'
  | 'onenote'
  | 'tomboy'
  | 'apple-notes'
  | 'journal'
  | 'table'
  | 'markdown'
  | 'pandoc'
  /** A PDF, brought in as pages to write on: the paper itself, and a page note
   *  beside it whose pages are that paper's pages. The one row here that is not
   *  another app's export - somebody's own paper is a thing to write on, and the
   *  door that already takes files is the door to bring it through. */
  | 'pdf-pages'
  /** Todoist, from the account through its API or from its CSV exports. */
  | 'todoist'

/** One file the import will write. A note carries words, anything else carries
 *  bytes, and both are addressed the same way so the writing does not branch. */
export type Planned =
  { kind: 'note'; path: string; text: string } | { kind: 'file'; path: string; bytes: Uint8Array }

/** One line about what could not be carried over.
 *
 *  The words come from `key()` and are translated by the sheet that shows them:
 *  a plan is built where there is no component and no reader yet, and a string
 *  that went through `t()` here would be in whatever language the app was in
 *  when the file was read. */
export interface Lost {
  /** The row as it is filed: the English sentence, which is also the `other` form
   *  where the line counts something. */
  text: string
  /** The form a count of one takes, for a line that counts something. Without it
   *  a line that says "{count} views" reads as "1 views" the first time somebody
   *  hits the one case, in every language that has a singular. */
  one?: string
  values?: Record<string, string | number>
}

export interface ImportPlan {
  format: FormatId
  /** In the order they will be written, which is the order the reader found
   *  them: a folder's note before the notes under it. */
  files: Planned[]
  /** What could not be carried over, one short line each, said before anything
   *  is written rather than in a log afterwards. */
  lost: Lost[]
  /** The note, among `files`, that is the space's inbox once written, where the space
   *  has none yet: Todoist's Inbox (docs/tasks.md 5.17). */
  inbox?: string
}

/** What the sheet shows about a plan. Folders are counted rather than listed:
 *  the question a reader has is "how much is about to arrive", and the folders
 *  are the shape of what they already know they exported. */
export interface Counts {
  notes: number
  files: number
  folders: number
  bytes: number
}

export function counts(plan: ImportPlan): Counts {
  const folders = new Set<string>()
  let notes = 0
  let files = 0
  let bytes = 0

  for (const one of plan.files) {
    const at = one.path.lastIndexOf('/')
    if (at > 0) for (const folder of everyFolder(one.path.slice(0, at))) folders.add(folder)

    if (one.kind === 'note') {
      notes += 1
      bytes += one.text.length
    } else {
      files += 1
      bytes += one.bytes.length
    }
  }

  return { notes, files, folders: folders.size, bytes }
}

/** A folder and every folder above it, so `a/b/c` counts three and not one. */
function everyFolder(folder: string): string[] {
  const parts = folder.split('/')
  return parts.map((_part, index) => parts.slice(0, index + 1).join('/'))
}
