/** The bookmarks above the file list: `bookmarks` with `list`, `add` and `remove`
 *  (docs/agent-native.md 5.4).
 *
 *  The space's own list (workspace/bookmarks.svelte.ts), of whichever space is named:
 *  it is kept per space and by root, so another space's list is read and written where
 *  it is kept, and it reaches the account and every machine the way the reader's own
 *  bookmarking does. An agent keeps notes, folders, headings and searches; groups and
 *  graph views are the reader's arrangement of the list and are left to them. */

import type { AgentAnswer } from '../../automation/caller'
import { nameOf } from '../../space-paths'
import { type Bookmark, MOST_BOOKMARKS, sameBookmark } from '../../workspace/bookmarks.svelte'
import { workspace } from '../../workspace.svelte'
import { asked } from './asks'
import { type Call, done, maybe, need } from './call'
import { Refused } from './problem'
import { judged, type Place, placeFor } from './spaces'
import { entryIn } from './tree'

/** The bookmark a call describes: a search by its query, a heading by its note and its
 *  words, a note or a folder by its path, which has to be there. */
async function bookmarkOf(call: Call, place: Place): Promise<Bookmark> {
  const query = maybe(call, 'query')
  if (query !== null) return { kind: 'search', path: '', text: query }

  const path = judged(need(call, 'path'))
  const heading = maybe(call, 'heading')
  if (heading !== null) {
    const note = nameOf(path).includes('.') ? path : `${path}.md`
    return { kind: 'heading', path: note, text: heading }
  }

  const entry = await entryIn(place, path)
  if (!entry) throw new Refused('no_such_file', `there is nothing at ${path}`)

  return { kind: entry.is_dir ? 'folder' : 'note', path, text: '' }
}

/** A bookmark as an agent reads it. */
function shown(mark: Bookmark) {
  return {
    kind: mark.kind,
    path: mark.path,
    text: mark.text,
    ...(mark.parent ? { group: mark.parent } : {}),
  }
}

export async function bookmarks(call: Call): Promise<AgentAnswer> {
  const place = placeFor(call, maybe(call, 'space'))
  const root = place.space.root
  const held = workspace.bookmarks.of(root)

  switch (need(call, 'op')) {
    case 'list':
      return done(held.map(shown))

    case 'add': {
      const mark = await bookmarkOf(call, place)
      if (held.some((one) => sameBookmark(one, mark))) return done({ ...shown(mark), added: false })
      if (held.length >= MOST_BOOKMARKS) {
        throw new Refused('failed', `a space keeps at most ${MOST_BOOKMARKS} bookmarks`)
      }

      const question = await asked(call, null, `Bookmark ${mark.text || mark.path}`)
      if (question) return question

      workspace.bookmarks.put(root, [...held, mark])
      return done({ ...shown(mark), added: true })
    }

    case 'remove': {
      // Named the way it was added, or by the path or the query alone, which is what
      // `list` hands out.
      const mark = await bookmarkOf(call, place).catch(() => null)
      const found =
        held.find((one) => mark !== null && sameBookmark(one, mark)) ??
        held.find(
          (one) =>
            one.kind !== 'group' &&
            ((one.path !== '' && one.path === maybe(call, 'path')) ||
              (one.kind === 'search' && one.text === maybe(call, 'query'))),
        )
      if (!found) return done({ removed: false })

      const question = await asked(call, null, `Take the bookmark ${found.text || found.path} away`)
      if (question) return question

      workspace.bookmarks.remove(found, root)
      return done({ ...shown(found), removed: true })
    }

    default:
      throw new Refused('bad_arguments', 'op is one of list, add, remove')
  }
}
