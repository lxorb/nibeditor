/** A Zen sidebar as `zen-sessions.jsonlz4` holds one, for the tests: three spaces,
 *  an Essential, pinned tabs, folders inside folders, an empty folder, a split view,
 *  a tab in a container, a tab on a settings page, a peeked page and a folder's
 *  stand-in tab. The fields and their spelling are Zen's own; see zen.ts.
 *
 *  `scripts/zen-import-probe.py` writes a sidebar of the same shape into a profile
 *  of its own for the app to find. */

/** Bytes as a `.jsonlz4`: the header and one LZ4 block of nothing but literals,
 *  which is a block like any other to a reader. */
export function mozLz4Of(bytes: Uint8Array): Uint8Array {
  const length: number[] = []
  if (bytes.length >= 15) {
    let rest = bytes.length - 15
    while (rest >= 255) {
      length.push(255)
      rest -= 255
    }
    length.push(rest)
  }

  const token = Math.min(bytes.length, 15) << 4
  const block = new Uint8Array([token, ...length, ...bytes])
  const out = new Uint8Array(12 + block.length)
  out.set([0x6d, 0x6f, 0x7a, 0x4c, 0x7a, 0x34, 0x30, 0x00])
  new DataView(out.buffer).setUint32(8, bytes.length, true)
  out.set(block, 12)
  return out
}

export const SIDEBAR = {
  lastCollected: 1_760_000_000_000,
  spaces: [
    {
      uuid: '{s-work}',
      name: 'Work',
      icon: 'chrome://browser/skin/zen-icons/selectable/briefcase.svg',
      position: 1,
      containerTabId: 0,
      theme: {
        type: 'gradient',
        gradientColors: [
          { c: [240, 90, 90], isPrimary: false },
          { c: [53, 132, 228], isPrimary: true },
        ],
        opacity: 0.5,
      },
    },
    { uuid: '{s-home}', name: 'Home', icon: '🏡', position: 0, theme: null },
    { uuid: '{s-reading}', name: 'Reading', position: 2 },
  ],
  folders: [
    {
      id: 'f-docs',
      name: 'Docs',
      parentId: null,
      workspaceId: '{s-work}',
      userIcon: 'chrome://browser/skin/zen-icons/selectable/book.svg',
      pinned: true,
      emptyTabIds: ['e-docs'],
    },
    { id: 'f-api', name: 'API', parentId: 'f-docs', workspaceId: '{s-work}', emptyTabIds: [] },
    {
      id: 'f-split',
      name: '',
      parentId: 'f-docs',
      workspaceId: '{s-work}',
      splitViewGroup: true,
      emptyTabIds: [],
    },
    { id: 'f-later', name: 'Later', parentId: null, workspaceId: '{s-work}', emptyTabIds: [] },
  ],
  tabs: [
    {
      zenSyncId: 't-mail',
      zenEssential: true,
      pinned: true,
      entries: [{ url: 'https://mail.example.com/', title: 'Mail' }],
      index: 1,
      image: 'data:image/png;base64,iVBORw0KGgo=',
    },
    {
      zenSyncId: 't-news',
      pinned: true,
      zenWorkspace: '{s-home}',
      entries: [{ url: 'https://news.example.com/today', title: 'News today' }],
      index: 1,
      image: 'https://news.example.com/favicon.ico',
      _zenPinnedInitialState: { entry: { url: 'https://news.example.com/', title: 'News' } },
    },
    {
      zenSyncId: 'e-docs',
      zenIsEmpty: true,
      groupId: 'f-docs',
      zenWorkspace: '{s-work}',
      entries: [{ url: 'about:blank' }],
    },
    {
      zenSyncId: 't-guide',
      pinned: true,
      groupId: 'f-docs',
      zenWorkspace: '{s-work}',
      zenStaticLabel: 'The guide',
      entries: [{ url: 'https://docs.example.com/guide', title: 'Guide' }],
      index: 1,
    },
    {
      zenSyncId: 't-api',
      pinned: true,
      groupId: 'f-api',
      zenWorkspace: '{s-work}',
      entries: [{ url: 'https://docs.example.com/api', title: 'API: reference' }],
      index: 1,
    },
    {
      zenSyncId: 't-left',
      pinned: true,
      groupId: 'f-split',
      zenWorkspace: '{s-work}',
      entries: [{ url: 'https://left.example.com/', title: 'Left' }],
      index: 1,
    },
    {
      zenSyncId: 't-right',
      pinned: true,
      groupId: 'f-split',
      zenWorkspace: '{s-work}',
      entries: [{ url: 'https://right.example.com/', title: 'Right' }],
      index: 1,
    },
    {
      zenSyncId: 't-board',
      pinned: true,
      zenWorkspace: '{s-work}',
      userContextId: 2,
      entries: [{ url: 'https://board.example.com/', title: 'Board' }],
      index: 1,
    },
    {
      zenSyncId: 't-search',
      zenWorkspace: '{s-work}',
      entries: [
        { url: 'https://search.example.com/?q=a', title: 'a - Search' },
        { url: 'https://search.example.com/?q=b', title: 'b - Search' },
      ],
      index: 2,
    },
    {
      zenSyncId: 't-settings',
      zenWorkspace: '{s-work}',
      entries: [{ url: 'about:preferences', title: 'Settings' }],
      index: 1,
    },
    {
      zenSyncId: 't-peek',
      zenIsGlance: true,
      zenWorkspace: '{s-home}',
      entries: [{ url: 'https://peek.example.com/', title: 'Peek' }],
      index: 1,
    },
  ],
  groups: [],
  splitViewData: [],
}
