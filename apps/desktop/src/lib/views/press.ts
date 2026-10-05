/** A button cell pressed (docs/tasks.md 5.13): what the base's button says, done to
 *  the row. Its properties and its task are one write of the row's note; a palette
 *  command and an address come after, each the way a link would ask for one, because
 *  a base can be written by anybody a space is shared with and a press should never
 *  do what a link to the same command could not. */

import { type Base, pressed, readButtons, type Row } from '@nib/bases'
import { openExternal } from '../tauri'
import { pressRow } from './act'
import { nowHere } from './days'

export async function pressButton(base: Base, name: string, row: Row): Promise<void> {
  const button = readButtons(base).find((one) => one.name === name)
  if (!button) return
  const now = nowHere()
  const press = pressed(button, {
    title: row.file.basename,
    today: now.slice(0, 10),
    time: now.slice(11, 16),
  })
  await pressRow(row, { note: press.set }, press.task)
  if (press.command !== undefined) {
    const { runCommand } = await import('../automation/acts')
    try {
      runCommand({ id: press.command }, 'link')
    } catch {
      // A command that is gone or may not run from here does nothing; the rest of the
      // press already happened.
    }
  }
  if (press.open !== undefined) await openExternal(press.open)
}
