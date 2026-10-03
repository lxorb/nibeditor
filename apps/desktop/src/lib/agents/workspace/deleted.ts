/** Recently deleted, as an agent reaches it: `recently_deleted` lists what went and puts
 *  one thing back (docs/agent-native.md 5.4).
 *
 *  The list is the panel's own (trash.svelte.ts): the account's for a reader signed in,
 *  this device's trash folder besides, newest first. Putting one back is the panel's
 *  Restore, so it lands where it was, said as a file that came to be, and the undo step
 *  that would have done the same is forgotten. Nothing here deletes for good: emptying
 *  the list is the reader's, by hand.
 *
 *  What a grant does not reach is not there: a note of a space it may not reach is in no
 *  list, and a whole space only for an agent that reaches every space. */

import type { AgentAnswer } from '../../automation/caller'
import { within } from '../../space-paths'
import type { TrashItem } from '../../trash.svelte'
import { asked } from './asks'
import { type Call, done, need } from './call'
import { Refused } from './problem'
import { reachable } from './spaces'

/** Where an item was, as an agent reads it: the space's name and the folder in it, for
 *  a note or a folder of a space this agent reaches; null for one of a space it does
 *  not, which it is not shown. */
function whereOf(call: Call, item: TrashItem): string | null {
  const spaces = reachable(call)
  if (item.kind === 'space') {
    const agent = call.caller.agent
    return agent === null || agent.spaces === 'all' ? '' : null
  }

  // The account says the space by name; this device's trash says the folder on disk.
  if (item.source === 'account') {
    const [space = '', ...folder] = item.detail.split(' / ')
    return spaces.some((one) => one.name === space) ? [space, ...folder].join('/') : null
  }
  for (const space of spaces) {
    const inside = within(space.root, item.detail)
    if (inside !== null) return inside ? `${space.name}/${inside}` : space.name
  }
  return null
}

/** The list, as far as this agent reaches. */
async function listed(call: Call) {
  const { trash } = await import('../../trash.svelte')
  await trash.load()

  return trash.items.flatMap((item) => {
    const where = whereOf(call, item)
    return where === null
      ? []
      : [
          {
            id: item.id,
            kind: item.kind,
            name: item.name,
            from: where,
            deleted: item.deletedAt,
            item,
          },
        ]
  })
}

export async function recentlyDeleted(call: Call): Promise<AgentAnswer> {
  const op = need(call, 'op')
  const rows = await listed(call)

  if (op === 'list') return done(rows.map(({ item: _item, ...row }) => row))
  if (op !== 'restore') throw new Refused('bad_arguments', 'op is list or restore')

  const id = need(call, 'id')
  const found = rows.find((row) => row.id === id)
  if (!found) throw new Refused('not_found', `nothing called ${id} is in Recently deleted`)

  const question = await asked(call, null, `Put back ${found.name}`)
  if (question) return question

  const { trash } = await import('../../trash.svelte')
  await trash.restore(found.item)
  if (trash.error) throw new Refused('failed', trash.error)

  return done({ id, name: found.name, from: found.from, restored: true })
}
