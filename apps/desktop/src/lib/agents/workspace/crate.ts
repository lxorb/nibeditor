/** What the crate asks the window on an agent's behalf (docs/agent-native.md 13.1):
 *  `agent.reader_tabs`, `agent.store_for` and `agent.markdown`. Each is optional -
 *  the crate answers from what it knows when the window does not - and each is only
 *  the window saying what it already knows: which of its tabs are pages, which store a
 *  space keeps a site's logins in, and a page's HTML through the clipper's converter,
 *  so an agent reads a page as the words a clip of it would have. */

import type { Said } from '../../automation/args'
import { said } from '../../automation/args'
import { READER } from '../../automation/caller'
import type { StoreSaid } from '../verbs'
import { placeFor } from './spaces'
import { readerTabs } from './tabs'

/** Which store the reader's tabs of a space use for an address, as the space's own
 *  choice makes it (web-tab/web-data.svelte.ts); the open space when none is named. */
async function storeFor(args: Said): Promise<StoreSaid> {
  const url = said(args, 'url') ?? ''
  const place = placeFor({ verb: 'agent.store_for', args, caller: READER }, said(args, 'space'))
  const { webData } = await import('../../web-tab/web-data.svelte')

  return { space: place.space.name, store: await webData.store(place.space.id, url) }
}

/** A page's HTML as the markdown a clip of it would say. */
async function markdown(args: Said): Promise<string> {
  const { htmlToMarkdown } = await import('@nib/markdown/from-html')
  const html = typeof args.html === 'string' ? args.html : ''
  return html.trim() ? htmlToMarkdown(html).trim() : ''
}

export async function answerTheCrate(name: string, args: Said): Promise<unknown> {
  switch (name) {
    case 'agent.reader_tabs':
      return readerTabs()
    case 'agent.store_for':
      return storeFor(args)
    case 'agent.markdown':
      return markdown(args)
    default:
      throw new Error(`there is no verb called ${name}`)
  }
}
