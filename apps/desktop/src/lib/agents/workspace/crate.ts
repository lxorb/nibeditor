/** What the crate asks the window on an agent's behalf (docs/agent-native.md 13.1):
 *  `agent.reader_tabs`, `agent.lend`, `agent.store_for` and `agent.markdown`. Each is
 *  optional - the crate answers from what it knows when the window does not - and each
 *  is only the window saying or doing what it already would: which of its tabs are
 *  pages, a tab's page kept running while an agent acts in it, which store a
 *  space keeps a site's logins in, and a page's HTML through the clipper's converter,
 *  so an agent reads a page as the words a clip of it would have. */

import type { Said } from '../../automation/args'
import { said } from '../../automation/args'
import { READER } from '../../automation/caller'
import { articleOf } from '../../web-tab/note'
import type { StoreSaid } from '../verbs'
import { placeFor } from './spaces'
import { lendTab, readerTabs } from './tabs'

/** Which store the reader's tabs of a space use for an address, as the space's own
 *  choice makes it (web-tab/web-data.svelte.ts); the open space when none is named. */
async function storeFor(args: Said): Promise<StoreSaid> {
  const url = said(args, 'url') ?? ''
  const place = placeFor({ verb: 'agent.store_for', args, caller: READER }, said(args, 'space'))
  const { webData } = await import('../../web-tab/web-data.svelte')

  return { space: place.space.name, store: await webData.store(place.space.id, url) }
}

/** A page's HTML as the markdown a clip of it would say: a snapshot the clip's reader
 *  wrote is read for its article first, the way the clip button reads it. */
async function markdown(args: Said): Promise<string> {
  const html = typeof args.html === 'string' ? args.html : ''
  if (!html.trim()) return ''

  const url = said(args, 'url') ?? ''
  const [read, { htmlToMarkdown }] = await Promise.all([
    articleOf({ url, title: '', html }),
    import('@nib/markdown/from-html'),
  ])
  return read.html.trim() ? htmlToMarkdown(read.html).trim() : ''
}

export async function answerTheCrate(name: string, args: Said): Promise<unknown> {
  switch (name) {
    case 'agent.reader_tabs':
      return readerTabs()
    case 'agent.lend':
      return lendTab(said(args, 'tab') ?? '')
    case 'agent.store_for':
      return storeFor(args)
    case 'agent.markdown':
      return markdown(args)
    default:
      throw new Error(`there is no verb called ${name}`)
  }
}
