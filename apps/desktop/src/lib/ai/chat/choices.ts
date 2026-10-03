/** The four questions docs/ai-sidebar.md 6.3 put to Emil, each answered here by the
 *  doc's recommended default and each one line to change. Every lane reads its answer
 *  from here, so changing one is changing one line.
 *
 *  These are product decisions rather than settings: a reader never sees them. */

/** 1. Ask is a mode of the one panel, in Ask's slot and on its key, rather than a tab of
 *  its own beside the new panel. */
export const ASK_IS_A_MODE = true

/** 2. In Agent mode an edit lands at once and is reviewed after (Keep, Undo), Cursor's
 *  way, rather than asked first (Claude Code's Manual). The other is one click away. */
export const EDITS: 'apply-and-review' | 'ask-first' = 'apply-and-review'

/** 3. The sidebar's agent may reach the reader's own web tabs (`browser.reader`) by
 *  default, because the reader is at the keyboard; an outside agent may not. */
export const READER_TABS = true

/** 4. Threads are kept on this device only, never synced: they hold the words of every
 *  note they read. The device's store (threads.ts) is the only home built; a synced one
 *  is what answering the other way would add. */
export const THREADS_SYNCED = false
