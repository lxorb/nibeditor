/** The four questions docs/ai-sidebar.md 6.3 put to Emil, each answered here by the
 *  doc's recommended default and each one line to change. Every lane reads its answer
 *  from here, so changing one is changing one line.
 *
 *  These are product decisions rather than settings: a reader never sees them. */

/** 1. The Ask panel is a mode of the one panel (Approve, where questions are asked), in
 *  its slot and on its key, rather than a tab of its own beside the new panel. */
export const ASK_IS_A_MODE = true

/** 2. Answered by the modes since (../modes.ts): Agent lets an edit land at once and
 *  reviews it after (Keep, Undo), Cursor's way; Approve asks first, Claude Code's. */

/** 3. The sidebar's agent may reach the reader's own web tabs (`browser.reader`) by
 *  default, because the reader is at the keyboard; an outside agent may not. */
export const READER_TABS = true

/** 4. Threads are kept on this device only, never synced: they hold the words of every
 *  note they read. The device's store (threads.ts) is the only home built; a synced one
 *  is what answering the other way would add. */
export const THREADS_SYNCED = false
