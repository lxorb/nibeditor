/** What the account is called in one shared space: asked in the app's one small
 *  question, with the name it has there now filled in, and kept on the account so every
 *  device and everybody in the space uses it (docs/chats.md 4.9). Empty is its own name
 *  again. Fetched with the space menu's row. */

import { account } from '../account.svelte'
import { busy } from '../busy.svelte'
import { key, message, t } from '../i18n.svelte'
import { prompt } from '../prompt.svelte'
import { sync } from '../sync.svelte'
import type { Space } from '../workspace.svelte'
import { nameIn } from './mine'

export async function nameHere(space: Space): Promise<void> {
  const id = sync.remoteIdFor(space.root)
  if (!id || !account.user) return

  const given = await prompt.ask({
    title: t('Your name in {space}', { space: space.name }),
    value: account.user.nicks?.[id] ?? '',
    placeholder: account.name ?? '',
    confirmLabel: key('Save'),
  })
  if (given === null) return

  try {
    await nameIn(id, given.trim())
  } catch (error) {
    busy.failed(message(error, 'that did not work'))
  }
}
