/** The note on paper, through whatever print dialog the machine has.
 *
 *  The same page an HTML export writes and the reading view shows, handed to the
 *  print engine of the webview it is already running in: one renderer, so what
 *  comes off the printer is what was on the screen, page breaks and paper size
 *  included. Nothing is written to disk - "Save as PDF" is a row inside the
 *  system's own dialog, and the app's PDF export is the row for anybody who wants
 *  the file itself.
 *
 *  Always the light scheme: it is going on paper, and a dark page costs a
 *  cartridge. */

import { busy } from '../busy.svelte'
import { t } from '../i18n.svelte'
import { type PaperInches, pageSetupFor, paperInches } from '../page-setup'
import { DEFAULT_PAGE_SETUP } from '../paper'
import { invoke } from '../tauri'
import { openTarget, renderOptions } from './context'

/** Whether this build has a print dialog to open at all. A desktop and a browser
 *  do; a phone's webview may or may not, and the row is left out where it does
 *  not - a menu row that does nothing is worse than no row. */
export const canPrint = typeof window !== 'undefined' && typeof window.print === 'function'

/** A PDF written straight to a file, where the machine can do that.
 *
 *  Answers whether it landed. Where it did not, it says so on the progress line
 *  before the caller falls back to the print dialog: somebody who chose a
 *  filename and waited is about to be handed a dialog they did not ask for, and a
 *  road that changes without a word reads as a fault rather than as a fallback.
 *
 *  What was thrown is not shown. It is the print engine's own sentence, in
 *  English and with a code in it, and it tells the reader nothing they can act
 *  on; what they can act on is that the dialog in front of them is now the way to
 *  save the file.
 *
 *  Three documents go out this way - a note, a plane and a deck - and this is the
 *  one place any of them tries. */
export async function writtenPdf(
  html: string,
  target: string,
  page: PaperInches,
): Promise<boolean> {
  try {
    await invoke('print_pdf', { html, output: target, page })
    return true
  } catch {
    busy.failed(t('The file could not be written, so it goes to the print dialog'))
    return false
  }
}

export async function printNote(): Promise<void> {
  // Asked for when somebody prints rather than at startup: the renderer carries the
  // diagram drawers, the syntax parsers and the fonts, which is most of what the app
  // can load, and the row that offers printing is a word.
  const { printInFrame, renderNote } = await import('../export')

  const target = openTarget()
  const options = await renderOptions(target)
  const html = await renderNote(target.source, target.name, { ...options, scheme: 'light' })
  // The paper the dialog opens on, where the dialog is the system's own and takes one;
  // see `printInFrame`.
  const page = paperInches(pageSetupFor(target.source, options.page ?? DEFAULT_PAGE_SETUP))

  await printInFrame(html, page)
}
