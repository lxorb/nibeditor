/** A message's own menu (docs/chats.md 4.15): the same rows on ⋯ in the hover bar, a
 *  right click and a long press. Only what the reader may do is offered, by the roles
 *  table every end decides by (`may`), so a row is never there for something the
 *  account would refuse. */

import { may, type Message, type Role } from '@nib/chats'
import { copyText } from '../../clipboard'
import { t } from '../../i18n.svelte'
import { DIVIDER, type MenuEntry } from '../../menu.svelte'
import type { ChatPage } from './chat.svelte'

export interface MessageGestures {
  reply: () => void
  quote: () => void
  edit: () => void
}

export function messageMenu(
  page: ChatPage,
  message: Message,
  role: Role | null,
  gestures: MessageGestures,
): MenuEntry[] {
  const posting = page.view.meta.posting
  const mine = page.me !== null && message.author === page.me
  const canPost = may(role, 'post', posting)
  if (message.deleted) return []
  return [
    ...(canPost
      ? [
          { label: t('Reply'), run: gestures.reply },
          { label: t('Quote'), run: gestures.quote },
        ]
      : []),
    DIVIDER,
    { label: t('Copy'), run: () => void copyText(message.body) },
    { label: t('Copy link'), run: () => void page.copyLink(message) },
    ...(may(role, 'pin', posting)
      ? [{ label: message.pinned ? t('Unpin') : t('Pin'), run: () => page.pin(message) }]
      : []),
    { label: t('Save'), checked: page.isSaved(message), run: () => page.save(message) },
    { label: t('Mark unread'), run: () => page.markUnread(message) },
    DIVIDER,
    ...(mine && may(role, 'edit-own', posting) && !message.poll
      ? [{ label: t('Edit'), run: gestures.edit }]
      : []),
    ...((mine && may(role, 'delete-own', posting)) || may(role, 'delete-any', posting)
      ? [{ label: t('Delete'), danger: true, run: () => page.remove(message.id) }]
      : []),
  ]
}
