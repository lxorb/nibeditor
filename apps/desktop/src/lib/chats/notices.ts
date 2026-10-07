/** The app's chat notifications: `ChatNotices` (./notify.ts) fed by the chats' store,
 *  with the store, the reader's choices and the window as its world (docs/chats.md 4.11).
 *
 *  Started with the chats (start.svelte.ts) for a signed-in desktop or browser, never
 *  the glasses' plugin, and never a phone: a phone's notifications are the activity's,
 *  and phone push is off (decision 7.4). Importing this is starting it.
 *
 *  The store hands over every new message by others once the device holds it
 *  (`chats.heard`), in the one window that holds the hub's socket so a message pings once
 *  a device; its list says where the reader has read to on every device, which takes a
 *  notification back, and whether the account has any chat, which keeps nib in the tray.
 *  A chat tab says it is on screen (./on-screen.ts); a press opens the chat at the message
 *  as a link to it would (view/open.ts). */

import { MUTED_FOR_GOOD } from '@nib/chats/notify'
import { account } from '../account.svelte'
import { t } from '../i18n.svelte'
import { show, unshow } from '../notify'
import { deviceActivity } from '../people/here'
import { people } from '../people/people.svelte'
import { stands } from '../people/status'
import { residency } from '../reminders/residency.svelte'
import { hub } from '../sync2/hub.svelte'
import { hush } from './hush.svelte'
import { ChatNotices, type NoticeWorld } from './notify'
import { inFront } from './on-screen'
import { chats } from './store.svelte'
import { openChat } from './view/open'

/** Do not disturb, as the reader's status says it now: a moment, for good, or none. */
function dndUntil(): number | null {
  const status = account.user?.status
  if (!status?.quiet || !stands(status, Date.now())) return null
  return status.until ?? MUTED_FOR_GOOD
}

const world: NoticeWorld = {
  me: () => chats.me,

  chat(chat) {
    const entry = chats.entry(chat)
    if (!entry) return Promise.resolve(null)
    const space = account.spaces.find((one) => one.id === entry.space)?.name ?? null
    return Promise.resolve({
      place: entry.name ? `#${entry.name}` : space,
      members: entry.members,
      notify: entry.notify,
      mutedUntil: entry.mutedUntil,
      readSeq: entry.readSeq,
    })
  },

  authorOf: async (chat, message) => (await chats.message(chat, message))?.author ?? null,

  async nameOf(chat, who) {
    const [kind, id] = who.split(':')
    const known = kind === 'user' && id ? people.called(id, chats.entry(chat)?.space) : undefined
    if (known) return known
    return (await chats.members(chat)).find((one) => one.who === who)?.name ?? ''
  },

  chosen: () => ({
    keywords: hush.keywords,
    hours: hush.hours,
    dndUntil: dndUntil(),
    previews: hush.previews,
    sound: hush.sound,
  }),

  active: () => deviceActivity().active,
  seen: inFront,
  now: () => Date.now(),
  show,
  unshow,

  open(chat, message) {
    const path = chats.entry(chat)?.path
    if (path) openChat(path, {}, message)
  },

  async reply(chat, body, parent) {
    await chats.post(chat, { body, ...(parent ? { parent } : {}) })
  },

  read: (chat, seq) => void chats.markRead(chat, seq),
}

const notices = new ChatNotices(world, () => ({
  hidden: t('New message'),
  reply: t('Reply'),
  send: t('Send'),
}))

chats.heard((chat, messages) => {
  if (hub.leads) notices.arrived(chat, messages)
})
chats.watch(() => {
  residency.chats = chats.list.length > 0
  for (const entry of chats.list) notices.read(entry.id, entry.readSeq)
})
