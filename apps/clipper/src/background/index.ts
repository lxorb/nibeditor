/** The service worker: the three ways a clip is asked for, and the one path
 *  they all take.
 *
 *  Chrome stops this worker between clips, so nothing is kept in memory here.
 *  Every handler reads what it needs from `chrome.storage` on the way in and
 *  puts back what changed; the language comes with it, because the menus and
 *  the tooltips are words. */

import { done, failed, working } from './badge'
import { clip, save } from './clip'
import { firstOf, refreshSpaces } from '../lib/account'
import { filledQuietly } from '../lib/interpreting'
import { type Kind, KINDS, LABELS } from '../lib/kinds'
import { type Answer, type Ask, readAsk } from '../lib/messages'
import { PROBLEMS } from '../lib/problems'
import { settings, type Settings } from '../lib/settings'
import { words } from '../lib/translate'

type Menus = NonNullable<chrome.contextMenus.CreateProperties['contexts']>

/** Which of the page's menus each action belongs on: the words under the
 *  cursor, the link under the cursor, or the page itself. */
const WHERE: Record<Kind, Menus> = {
  page: ['page', 'image'],
  selection: ['selection'],
  link: ['link'],
}

const EVERYWHERE: Menus = ['page', 'selection', 'link', 'image']

const PARENT = 'nib'

/** One entry called Nib with the three actions under it: the same three words
 *  the popup shows, in the same order. */
async function buildMenus() {
  const { language } = await settings()
  const said = await words(language)
  await chrome.contextMenus.removeAll()

  chrome.contextMenus.create({ id: PARENT, title: 'Nib', contexts: EVERYWHERE })

  for (const kind of KINDS) {
    chrome.contextMenus.create({
      id: kind,
      parentId: PARENT,
      title: said(LABELS[kind]),
      contexts: WHERE[kind],
    })
  }
}

/** The space a clip goes to with nobody there to choose one: the last one saved
 *  to, or the first in the rail. */
async function targetSpace(held: Settings): Promise<string> {
  const remembered = firstOf(held.spaces, held.target.spaceId)
  if (remembered) return remembered

  // The remembered space may have been deleted since, or there may never have
  // been one; either way the list is worth asking for once. A network that is
  // not there reads as no spaces, which is a sentence the person can act on.
  const listed = await refreshSpaces(held.token ?? '').catch(() => [])
  return firstOf(listed, '')
}

/** A clip with no popup in front of it: the page's own menu, or a shortcut. It
 *  goes where the last one went, and the toolbar button says how it went. */
async function straightToNotes(kind: Kind, tabId: number, link: string | null) {
  const held = await settings()
  // The words before the work: a catalogue is one small module off the disk, and
  // the sentence a failure needs is needed at the moment it fails rather than a
  // round trip later.
  const said = await words(held.language)
  const say = (problem: string) => {
    failed(tabId, said(problem))
  }

  working(tabId)

  if (!held.token) {
    say(PROBLEMS.signIn)
    return
  }

  const spaceId = await targetSpace(held)
  if (!spaceId) {
    say(PROBLEMS.noSpaces)
    return
  }

  const made = await clip(kind, tabId, link)
  if ('problem' in made) {
    say(made.problem)
    return
  }

  // The same question the popup would have asked, for the same page, when the
  // switch for its template is on; see `lib/interpreting.ts`. The clip is already
  // in hand either way, so an interpreter that cannot answer costs the note its
  // extra properties and nothing else.
  const filled = await filledQuietly(made.clip, held.interpreter)

  const saved = await save({ ...made.clip, filled }, spaceId, held.target.folder)
  if ('problem' in saved) say(saved.problem)
  else done(tabId, saved.path)
}

/** The popup has somewhere to show a sentence itself, and translates it there,
 *  so nothing here touches the badge or the dictionaries. */
async function answer(asked: Ask): Promise<Answer> {
  if (asked.ask === 'save') return save(asked.clip, asked.spaceId, asked.folder)

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.id === undefined) return { problem: PROBLEMS.blocked }

  return clip(asked.kind, tab.id, null)
}

chrome.runtime.onInstalled.addListener(() => void buildMenus())
chrome.runtime.onStartup.addListener(() => void buildMenus())

// The menu titles are words, so they are written again when the language is.
chrome.storage.onChanged.addListener((changes) => {
  if ('nib:language' in changes) void buildMenus()
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const kind = KINDS.find((one) => one === info.menuItemId)
  if (!kind || tab?.id === undefined) return

  void straightToNotes(kind, tab.id, info.linkUrl ?? null)
})

chrome.commands.onCommand.addListener((command, tab) => {
  const kind = KINDS.find((one) => `clip-${one}` === command)
  if (!kind || tab?.id === undefined) return

  void straightToNotes(kind, tab.id, null)
})

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  // Ours, and from a page of this extension's own. A message carries whatever the
  // sender wanted it to, and `save` writes a note into the account - so the shape
  // being right is not the same question as the sender being us. A web page cannot
  // reach this listener at all (there is no `externally_connectable` and no
  // `onMessageExternal`), which is what makes this the second lock rather than the
  // first; what it closes is a content script on a hostile page, which runs in that
  // tab and can say anything the popup can.
  if (sender.id !== chrome.runtime.id) return false
  if (!sender.url?.startsWith(chrome.runtime.getURL(''))) return false

  const asked = readAsk(message)
  if (!asked) return false

  void answer(asked).then(respond)

  // The answer is a round trip to the page or to the API, so the channel is
  // held open until it arrives.
  return true
})
