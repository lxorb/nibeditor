/** What a page says with `alert`, asks with `confirm` and `prompt`, and asks as it is
 *  left: a card over the page, answered the way a browser answers them.
 *
 *  A browser draws these in the page's own tab - Chrome's is a card at the top of the
 *  page, naming the site - and the page's script waits on the answer: `confirm()` is
 *  true or false, `prompt()` the words or nothing. They used to be the dialog plugin's,
 *  which a site's origin could not reach, so `alert()` showed nothing and `confirm()`
 *  answered yes before anybody was asked. The crate now holds each one open while the
 *  card is up; see src-tauri/src/web_dialogs.rs.
 *
 *  Nothing is remembered: a dialog is a question about this moment, not about the site. */

import { invoke, isDesktop } from '../tauri'
import { isRecord } from '../stored'
import { plainOrigin } from './address'

/** Which dialog, as the crate names them. `leave` is the one a page's `beforeunload`
 *  asks for as the tab moves on. */
export const KINDS = ['alert', 'confirm', 'prompt', 'leave'] as const

export type Kind = (typeof KINDS)[number]

function isKind(value: string): value is Kind {
  return KINDS.some((one) => one === value)
}

/** A dialog a page has opened and nobody has answered: the page's script is waiting. */
export interface Dialog {
  /** What the answer goes back with. */
  id: number
  /** The tab whose page opened it, so the card appears over that pane and no other. */
  tab: string
  kind: Kind
  /** What the page said, as it said it. */
  message: string
  /** What a prompt offers to start with. */
  text: string
  /** The site, as the bar shows it: what the card names. */
  site: string
}

/** What the crate says when a page opens a dialog. Read rather than trusted: an event
 *  is a boundary like any other. */
export function readDialog(value: unknown): Dialog | null {
  if (!isRecord(value)) return null

  const { tab, id, kind, message, text, origin } = value
  if (typeof tab !== 'string' || typeof id !== 'number') return null
  if (typeof kind !== 'string' || !isKind(kind)) return null
  if (typeof message !== 'string' || typeof text !== 'string' || typeof origin !== 'string') {
    return null
  }

  return { id, tab, kind, message, text, site: plainOrigin(origin) || origin }
}

class Dialogs {
  /** The dialogs waiting for an answer, oldest first. A page's script is stopped while
   *  one is up, so a tab has one at a time; the list is for the tabs behind it. */
  open = $state<Dialog[]>([])

  heard(one: Dialog) {
    this.open = [...this.open, one]
  }

  /** The reader answered: OK or Leave, with a prompt's words, or Cancel - which is also
   *  what closing the card is, and for an alert the only answer there is. */
  answer(one: Dialog, accept: boolean, text?: string) {
    this.open = this.open.filter((each) => each.id !== one.id)
    void this.tell(one.id, accept, one.kind === 'prompt' && accept ? (text ?? '') : null)
  }

  /** The tab has gone, so its dialogs have, cancelled: a page nobody can see is not
   *  a page anybody can answer. */
  dropped(tab: string) {
    const gone = this.open.filter((one) => one.tab === tab)
    if (!gone.length) return

    this.open = this.open.filter((one) => one.tab !== tab)
    for (const one of gone) void this.tell(one.id, false, null)
  }

  private async tell(id: number, accept: boolean, text: string | null): Promise<void> {
    if (!isDesktop) return
    await invoke('web_dialog_answer', { id, accept, text }).catch(() => undefined)
  }
}

export const dialogs = new Dialogs()
