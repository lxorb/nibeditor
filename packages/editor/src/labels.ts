/** The few words the editor's own widgets show. The app hands over translated
 *  ones at startup; on their own they read as English. */
const DEFAULTS = {
  setLanguage: 'Set the language',
  /** The empty field on a fence with no language on it yet. */
  fenceLanguage: 'language',
  copy: 'Copy',
  copyCode: 'Copy code',
  copied: 'Copied',
  run: 'Run',
  runCode: 'Run the code',
  running: 'Running…',
  /** The glyph on an `ai` fence, and the line it writes over the answer. The line
   *  is file content rather than interface: it is written in the language the app
   *  is set to and then left alone, so a note keeps whatever it was written in. */
  ask: 'Ask',
  askModel: 'Ask the model',
  aiAnswered: 'answered by {model}, {date}',
  stop: 'Stop',
  stopped: 'Stopped',
  result: 'Result',
  timedOut: 'Timed out after {seconds} s',
  outputTruncated: 'Only the first {count} lines are kept',
  dismiss: 'Dismiss',
  /** The chevron in the margin, and the mark a fold leaves behind. */
  fold: 'Fold',
  unfold: 'Unfold',
  /** The mark in the margin beside every block. */
  blockHandle: 'Move this block',
  dragToResize: 'Drag to resize',
  describeImage: 'Describe the image',
  openImage: 'Open image',
  copyLink: 'Copy link',
  editMarkdown: 'Edit markdown',
  deleteImage: 'Delete image',
  resetSize: 'Reset size',
  imageNotFound: 'Image not found',
  openLink: 'Ctrl+Click to open the link',
  openLinkMac: '⌘-click to open the link',
  openNote: 'Ctrl+Click to open the note',
  openNoteMac: '⌘-click to open the note',
  createNote: 'Ctrl+Click to create the note',
  createNoteMac: '⌘-click to create the note',
  noteNotFound: 'Note not found',
  loadingNote: 'Loading…',
  alignLeft: 'Align left',
  alignCenter: 'Align center',
  alignRight: 'Align right',
  moveColumnLeft: 'Move column left',
  moveColumnRight: 'Move column right',
  insertColumn: 'Insert column',
  deleteColumn: 'Delete column',
  moveRowUp: 'Move row up',
  moveRowDown: 'Move row down',
  insertRow: 'Insert row',
  deleteRow: 'Delete row',
  sortColumn: 'Sort by this column',
  /** The row at the foot of a note's properties that adds another one, and the
   *  word a new key is named with until it is given a name of its own. */
  addProperty: 'Add a property',
  property: 'property',
  /** The handle on a note's cover, which drags the band up and down the picture. */
  dragCover: 'Drag to reposition',
}

export type LabelKey = keyof typeof DEFAULTS

/** Every key, so the app knows what to translate without repeating the list. */
export const LABEL_KEYS = Object.keys(DEFAULTS) as LabelKey[]

/** The English wording, which doubles as the lookup key on the app's side. */
export const englishLabel = (key: LabelKey): string => DEFAULTS[key]

let current: Record<LabelKey, string> = { ...DEFAULTS }

/** Replaces the labels. Anything not given keeps its English wording. */
export function setLabels(labels: Partial<Record<LabelKey, string>>) {
  current = { ...DEFAULTS, ...labels }
}

export function label(key: LabelKey): string {
  return current[key]
}
