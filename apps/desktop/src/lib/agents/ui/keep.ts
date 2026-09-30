/** A session kept: written into the note in front, after a blank line, or into a note of
 *  its own that then opens. What Add to note does in the activity panel and in
 *  Settings > Agents alike, so the two keep a session the same way (docs/agent-native.md
 *  9.5). */

import { workspace } from '../../workspace.svelte'

export async function keepInNote(text: string): Promise<void> {
  const front = workspace.active

  if (front?.kind === 'note' && front.path !== null) {
    const { appendTo } = await import('../../recorder/note')
    const before = front.doc.endsWith('\n\n') ? '' : front.doc.endsWith('\n') ? '\n' : '\n\n'
    if (appendTo(front.path, `${before}${text}`)) return
  }

  const path = await workspace.noteFrom(text)
  if (path !== null) await workspace.open(path)
}
