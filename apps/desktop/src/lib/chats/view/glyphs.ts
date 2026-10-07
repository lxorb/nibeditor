/** The marks a chat is drawn with, as stroked paths on a 24-unit square: Lucide's
 *  drawings (ISC), which is the set the rest of the app is drawn in, written out here
 *  rather than imported one module each, so the chat's own chunk carries a few lines of
 *  paths and nothing else. A dot is a path of no length, drawn by the round cap. */

const RING = 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0'

export const GLYPHS = {
  reply: 'M20 18v-2a4 4 0 0 0-4-4H4m5 5-5-5 5-5',
  quote: 'M17 6H3M21 12H8M21 18H8M3 12v6',
  react: 'M22 11v1a10 10 0 1 1-9-10M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01M16 5h6M19 2v6',
  smile: `${RING}M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01`,
  more: 'M12 12h.01M19 12h.01M5 12h.01',
  pin: 'M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z',
  saved: 'm19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z',
  clock: `${RING}M12 6v6l4 2`,
  attach: `${RING}M8 12h8M12 8v8`,
  send: 'M3.71 3.05a.5.5 0 0 0-.68.63l2.84 7.62a2 2 0 0 1 0 1.4l-2.84 7.62a.5.5 0 0 0 .68.63l18-8.5a.5.5 0 0 0 0-.9zM6 12h16',
  mic: 'M12 19v3M19 10v2a7 7 0 0 1-14 0v-2M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0z',
  play: 'M6 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L7.5 3.64A1 1 0 0 0 6 4.5z',
  pause: 'M14 4h4v16h-4zM6 4h4v16H6z',
  chevron: 'm6 9 6 6 6-6',
  down: 'M12 5v14m7-7-7 7-7-7',
  up: 'M12 19V5m-7 7 7-7 7 7',
  close: 'M18 6 6 18M6 6l12 12',
  hash: 'M4 9h16M4 15h16M10 3 8 21M16 3l-2 18',
  search: 'm21 21-4.34-4.34M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  mention: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8',
  people:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  poll: 'M3 3v16a2 2 0 0 0 2 2h16M18 17V9M13 17V5M8 17v-3',
  file: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7zM14 2v4a2 2 0 0 0 2 2h4',
  retry: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5',
  replies: 'm15 10 5 5-5 5M4 4v7a4 4 0 0 0 4 4h12',
  save: 'M12 15V3M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5',
  left: 'm15 18-6-6 6-6',
  right: 'm9 18 6-6-6-6',
  words:
    'M18 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zM7 15h4M15 15h2M7 11h2M13 11h4',
  pencil:
    'M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5zM15 5l4 4',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
} as const

export type GlyphName = keyof typeof GLYPHS
