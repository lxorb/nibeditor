/** The two ways in, and the row on an embed's own menu.
 *
 *  `record` and `meeting` are one command each, with one id each, and every way of
 *  reaching them runs the same function: the palette, the Paragraph menu, the editor's
 *  `/` menu, the plus on a phone, and the quick settings tile on Android. That is the
 *  whole reason this file exists rather than the store being reached for directly - an
 *  id is a thing another surface can call, and a row that built its own behaviour would
 *  be the second answer to the same question.
 *
 *  `Transcribe` is the third: a row on the menu of a recording already in a note,
 *  which sends that file through the same Whisper path a meeting's live transcript goes
 *  through and writes what came back under the embed.
 *
 *  Nothing here carries the recorder. The microphone, the container it writes, the WAV
 *  pieces, the live transcript and the summary are a subsystem of their own, and a
 *  window that opens on a note has no use for any of it - so the store is fetched by
 *  whichever of the rows above is pressed, and held once it arrives. What is left in
 *  front of the first paint is what a menu needs in order to draw itself: whether the
 *  rows are worth offering, and what they are called. */

import type { EditorView } from '@nib/editor'
import { embedKind, parseWikilink } from '@nib/markdown/links'
import { canTranscribe } from '../ai/hears'
import { t } from '../i18n.svelte'
import { workspace } from '../workspace.svelte'
import { canRecordHere } from './container'

/** The recorder, once one of the rows below has woken it.
 *
 *  Held rather than imported, and null until then - which is also the answer to what
 *  the two labels say before that: nothing can be being recorded while the thing that
 *  records has not been fetched. A plain reference and not a rune, because a menu is
 *  built when it opens rather than watched. */
type Recorder = (typeof import('./recording.svelte'))['recorder']
let woken: Recorder | null = null

/** The store, fetched the first time anything asks. The import is held by the module
 *  registry, so the second press is not a second fetch. */
async function wake(): Promise<Recorder> {
  const { recorder } = await import('./recording.svelte')
  woken = recorder

  return recorder
}

/** Whether the row is worth offering: a microphone, and a space to write into.
 *
 *  Not "a note open": a recording makes one where there is none, which is the whole
 *  point of a command somebody presses in a hurry. */
export function canRecord(): boolean {
  return canRecordHere() && !!workspace.activeSpace
}

/** And a meeting, which needs the account as well: its transcript and its summary are
 *  both on the Worker, because the key is. */
export function canTakeMeetingNotes(): boolean {
  return canRecord() && canTranscribe()
}

/** What the row says, which is the other half of one command doing two things. */
export function recordLabel(): string {
  return woken?.on && woken.kind === 'note' ? t('Stop recording') : t('Record')
}

export function meetingLabel(): string {
  return woken?.on && woken.kind === 'meeting' ? t('Stop the meeting') : t('Meeting notes')
}

/** Whether a `![[…]]` under the pointer names a recording, and what it names. Null for
 *  anything else, which is what keeps the row off the menu for a picture. */
export function recordingAt(view: EditorView, at: number): string | null {
  const line = view.state.doc.lineAt(at)
  const column = at - line.from

  // Found with a regular expression rather than by walking the syntax tree: the menu
  // opens at a point, and what that point is inside is a question about the line's own
  // text. The inner part is read by the package's own parser, so `![[take.weba|Sam]]`
  // is the same link here as it is to the player.
  for (const match of line.text.matchAll(/!\[\[([^\]\n]*)\]\]/g)) {
    if (column < match.index || column > match.index + match[0].length) continue

    const link = parseWikilink(match[1] ?? '', true)
    if (!link?.target) continue

    return embedKind(link.target) === 'audio' ? link.target : null
  }

  return null
}

/** Turns the recording an embed names into words, and writes them under it. The reading
 *  and the writing are transcribing.ts, fetched by the press: see that file. */
export async function transcribeEmbed(view: EditorView, at: number) {
  const target = recordingAt(view, at)
  if (!target) return

  const { transcribeInto } = await import('./transcribing')
  await transcribeInto(view, at, target)
}

/** Starts or stops a recording. The one function the ids run. */
export async function record() {
  ;(await wake()).toggle('note')
}

export async function meeting() {
  ;(await wake()).toggle('meeting')
}
