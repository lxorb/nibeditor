/** One notification from the page, the system's own: the crate's on a desktop (the one
 *  the agents ring through, `reminders_ring`), the browser's where the page was allowed
 *  to show them, and nothing on a phone, whose notifications are the activity's. Said by
 *  a reminder the page rang itself and by a terminal asking to be looked at.
 *
 *  `tag` folds a second notification of the same thing into the first in a browser, and
 *  `opened` is what a press on it does there; a desktop's press brings nib forward. */

import { invoke, isDesktop } from './tauri'

export function notify(
  title: string,
  body: string,
  tag?: string,
  opened?: () => void,
): void {
  if (isDesktop) {
    void invoke('reminders_ring', { title, body }).catch(() => undefined)
    return
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return

  const shown = new Notification(title, { body, ...(tag ? { tag } : {}) })
  shown.onclick = () => {
    window.focus()
    opened?.()
    shown.close()
  }
}
