/** A space's feed: everything that changed since a cursor, the tree and the words in
 *  one order.
 *
 *  Folders and notes take their numbers off the same cursor, so one query over both,
 *  ordered by it, is the order the account applied them in, and a device that applies
 *  the feed in that order ends where the account is (docs/sync-v2.md section 7). A
 *  document's words moving shows as its `docSeq` moving, which happens when its room
 *  settles - the moment its snapshot is there to pull. */

import { FEED_PAGE, type FeedItem } from '@nib/sync-core'
import type { Env } from '../types'
import { kindOfName } from './tree'
import { prepareSpace } from './prepare'

interface Row {
  id: string
  kind: string
  parent: string | null
  name: string | null
  deleted: number
  seq: number
  doc_seq: number | null
  epoch: number | null
  epoch_base: string | null
  hash: string
  size: number
  by: string | null
  at: number
  folder: number
}

const CHANGED = `select * from (
    select id, kind, folder_id as parent, name, deleted, seq, doc_seq, epoch, epoch_base, hash,
           size, updated_by as by, updated_at as at, 0 as folder
      from notes where space_id = ?1 and seq > ?2
    union all
    select id, 'folder', parent_id, name, deleted, seq, null, null, null, '', 0, updated_by,
           updated_at, 1
      from folders where space_id = ?1 and seq > ?2
  ) order by seq limit ?3`

/** One page of the feed after `since`, with the cursor to ask from next. */
export async function feedPage(
  env: Env,
  spaceId: string,
  since: number,
): Promise<{ items: FeedItem[]; cursor: number; more: boolean }> {
  let rows = await changedSince(env, spaceId, since)

  // A note a v1 app wrote while the space was being prepared has no place yet: it is
  // placed now, and the page read again.
  if (rows.some((row) => row.name === null)) {
    await prepareSpace(env, spaceId)
    rows = await changedSince(env, spaceId, since)
  }

  const page = rows.slice(0, FEED_PAGE)
  return {
    items: page.flatMap((row) => (row.name === null ? [] : [itemOf(row, row.name)])),
    cursor: page.at(-1)?.seq ?? since,
    more: rows.length > FEED_PAGE,
  }
}

function changedSince(env: Env, spaceId: string, since: number): Promise<Row[]> {
  return env.DB.prepare(CHANGED)
    .bind(spaceId, since, FEED_PAGE + 1)
    .all<Row>()
    .then(({ results }) => results)
}

function itemOf(row: Row, name: string): FeedItem {
  const item: FeedItem = {
    id: row.id,
    kind: row.folder ? 'folder' : kindOf(row.kind, name),
    parent: row.parent,
    name,
    deleted: row.deleted === 1,
    seq: row.seq,
    hash: row.hash,
    size: row.size,
    by: row.by ?? '',
    at: row.at,
  }
  if (!row.folder) {
    item.docSeq = row.doc_seq ?? row.seq
    item.epoch = row.epoch ?? 0
    if (row.epoch_base !== null) item.epochBase = row.epoch_base
  }
  return item
}

function kindOf(value: string, name: string): FeedItem['kind'] {
  switch (value) {
    case 'note':
    case 'canvas':
    case 'pages':
    case 'url':
    case 'term':
    case 'file':
      return value
    default:
      return kindOfName(name)
  }
}
