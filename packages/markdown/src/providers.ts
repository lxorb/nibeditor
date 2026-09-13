/** The handful of places on the web whose pages a note can show rather than
 *  merely link to: `![](https://youtube.com/watch?v=…)`.
 *
 *  Here, in the markdown package, because the app and the Worker both need the
 *  same answer: a note reads one way in the reading view and another way on a
 *  published page only if this list is written twice.
 *
 *  Ten rows and not two thousand. A list of every site with an embed API is a
 *  list nobody maintains, and each row is a promise: that this address turns into
 *  that frame, that the frame needs exactly these permissions, and that the space
 *  it takes is the shape it will turn out to be. A row nobody can make those
 *  three promises about is worth less than the link the note already had.
 *
 *  Two things are deliberately not here.
 *
 *  GitHub gists, because a gist is not a frame. What GitHub gives out is a
 *  `<script>` that writes the gist into the page it runs in, and running somebody
 *  else's script in the page a note is on is the one thing this file exists to
 *  avoid. A gist link stays a link.
 *
 *  And the title of the page behind an address, which a reader might like on the
 *  card. Learning it means asking the provider for it, which is a request to a
 *  third party made because a note was opened - exactly what click-to-load is
 *  here to prevent. So the card says which provider it is and nothing it had to
 *  ask for. */

/** How much room a frame takes, so the card standing in for it is the same size
 *  and nothing on the page moves when the reader presses play.
 *
 *  `video` is sixteen by nine, whatever the width; a number is that many pixels
 *  tall, for the providers whose thing has no shape of its own - a tweet, a
 *  track, a pen. */
export type Shape = 'video' | number

export interface Provider {
  /** What the card says, and what the stylesheet can hook onto. */
  id: string
  name: string
  /** What the card's mark says will happen: a video is played, a map is opened.
   *  Two marks and not one, because a triangle over a map is a small lie. */
  mark: 'play' | 'open'
  shape: Shape
  /** The least sandbox the frame still works inside.
   *
   *  `allow-scripts` is unavoidable for a player: there is no way to draw one
   *  without it. `allow-same-origin` reads worse than it is - with a
   *  cross-origin `src` it grants the frame *its own* origin rather than the
   *  page's, so a player can keep its own settings and still knows nothing about
   *  the note it sits in. It is a hole only when the framed document is
   *  same-origin with the page, and every address here is somebody else's
   *  domain - which is a fact about these rows rather than about the token, so a
   *  row whose address is ever this app's own is a row that must not ask for it.
   *  Anything a provider does not need is left off.
   *
   *  What each provider does without the token is measured rather than argued
   *  about; see apps/desktop/test/e2e/embed-sandbox.py, which drives the real
   *  players both ways round. */
  sandbox: string
  /** The capabilities the frame is granted, and no others. Absent where a
   *  provider needs none: a permission nobody asked for is a permission that
   *  should not be there. */
  allow?: string
}

/** One address recognised: what to frame, and who by. */
export interface WebEmbed {
  provider: Provider
  /** The page to frame once the reader has asked for it. */
  frame: string
  /** Where the reader goes if the frame never loads, or if the page they are on
   *  cannot load one - a published note, which runs no script of any kind. */
  href: string
}

/** A row of the table: the provider, and how it reads an address. */
interface Row extends Provider {
  /** The hosts this row answers for, without `www.`. */
  hosts: readonly string[]
  /** What to frame, or null when this row does not recognise the address after
   *  all - a YouTube channel page, say, which is not a video. */
  frame: (url: URL) => string | null
}

/** The characters a provider's own id is made of. Every row checks the piece it
 *  pulls out of an address against this before writing it into a URL: what is
 *  between the slashes of somebody else's link is not to be trusted, and a `?`
 *  or a `/` smuggled through here would be a frame pointed somewhere else. */
const ID = /^[\w-]{1,64}$/

/** The same, for the two-part names a pen and a repository have. */
const NAME = /^[\w.-]{1,80}$/

/** The path of an address, split, with the empty pieces gone. */
function parts(url: URL): string[] {
  return url.pathname.split('/').filter(Boolean)
}

/** A piece of a path, when it is a plain id. */
function id(piece: string | undefined): string | null {
  return piece !== undefined && ID.test(piece) ? piece : null
}

/** An address the note wrote, ready to be a query parameter of another one. */
function quoted(url: URL): string {
  return encodeURIComponent(url.toString())
}

const YOUTUBE = 'allow-scripts allow-same-origin allow-presentation'
const PLAYER = 'encrypted-media; picture-in-picture; fullscreen'

const ROWS: readonly Row[] = [
  {
    id: 'youtube',
    name: 'YouTube',
    mark: 'play',
    hosts: ['youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'youtu.be'],
    shape: 'video',
    sandbox: YOUTUBE,
    allow: PLAYER,
    // `youtube-nocookie.com` rather than `youtube.com`: the reader has already
    // chosen to load this, and that is not the same as choosing to be counted.
    frame: (url) => {
      const path = parts(url)
      const named = url.hostname.endsWith('youtu.be')
        ? path[0]
        : (url.searchParams.get('v') ?? undefined)
      const shorts = path[0] === 'shorts' || path[0] === 'embed' || path[0] === 'live'
      const video = id(shorts ? path[1] : named)
      if (video === null) return null

      const at = seconds(url.searchParams.get('t'))
      return `https://www.youtube-nocookie.com/embed/${video}${at === null ? '' : `?start=${at}`}`
    },
  },
  {
    id: 'vimeo',
    name: 'Vimeo',
    mark: 'play',
    hosts: ['vimeo.com', 'player.vimeo.com'],
    shape: 'video',
    sandbox: YOUTUBE,
    allow: PLAYER,
    frame: (url) => {
      const path = parts(url)
      const video = id(path[0] === 'video' ? path[1] : path[0])
      return video === null || !/^\d+$/.test(video)
        ? null
        : `https://player.vimeo.com/video/${video}`
    },
  },
  {
    id: 'x',
    name: 'X',
    mark: 'open',
    hosts: ['x.com', 'twitter.com', 'mobile.twitter.com'],
    // A post has no shape of its own, and without a script on this side there is
    // nothing to tell us how tall the one inside turned out to be. So it gets
    // room for a few lines and a picture, and scrolls inside its frame if it
    // needs more - which is the honest answer to a thing of unknown height.
    shape: 520,
    sandbox: 'allow-scripts allow-same-origin allow-popups',
    frame: (url) => {
      const path = parts(url)
      const post = path[1] === 'status' || path[1] === 'statuses' ? id(path[2]) : null
      return post === null || !/^\d+$/.test(post)
        ? null
        : `https://platform.twitter.com/embed/Tweet.html?id=${post}`
    },
  },
  {
    id: 'spotify',
    name: 'Spotify',
    mark: 'play',
    hosts: ['open.spotify.com', 'spotify.com'],
    shape: 152,
    sandbox: YOUTUBE,
    allow: 'encrypted-media',
    frame: (url) => {
      const path = parts(url)
      // `/intl-de/track/…` is the same page in another language.
      const from = path[0]?.startsWith('intl-') ? 1 : 0
      const kind = path[from]
      const thing = id(path[from + 1])
      if (thing === null || kind === undefined) return null
      if (!['track', 'album', 'playlist', 'episode', 'show', 'artist'].includes(kind)) return null

      return `https://open.spotify.com/embed/${kind}/${thing}`
    },
  },
  {
    id: 'soundcloud',
    name: 'SoundCloud',
    mark: 'play',
    hosts: ['soundcloud.com'],
    shape: 166,
    sandbox: YOUTUBE,
    // The player takes the whole address rather than an id, which is why this row
    // hands its own url over instead of picking it apart.
    frame: (url) =>
      parts(url).length < 2 ? null : `https://w.soundcloud.com/player/?url=${quoted(url)}`,
  },
  {
    id: 'figma',
    name: 'Figma',
    mark: 'open',
    hosts: ['figma.com'],
    shape: 'video',
    sandbox: YOUTUBE,
    frame: (url) => {
      const kind = parts(url)[0]
      if (kind === undefined || !['file', 'design', 'proto', 'board', 'slides'].includes(kind)) {
        return null
      }

      return `https://www.figma.com/embed?embed_host=nib&url=${quoted(url)}`
    },
  },
  {
    id: 'codepen',
    name: 'CodePen',
    mark: 'open',
    hosts: ['codepen.io'],
    shape: 400,
    sandbox: 'allow-scripts allow-same-origin',
    frame: (url) => {
      const path = parts(url)
      const who = path[0] !== undefined && NAME.test(path[0]) ? path[0] : null
      const pen = path[1] === 'pen' || path[1] === 'details' ? id(path[2]) : null
      return who === null || pen === null
        ? null
        : `https://codepen.io/${who}/embed/${pen}?default-tab=result`
    },
  },
  {
    id: 'loom',
    name: 'Loom',
    mark: 'play',
    hosts: ['loom.com'],
    shape: 'video',
    sandbox: YOUTUBE,
    allow: PLAYER,
    frame: (url) => {
      const path = parts(url)
      const video = id(path[0] === 'share' || path[0] === 'embed' ? path[1] : undefined)
      return video === null ? null : `https://www.loom.com/embed/${video}`
    },
  },
  {
    id: 'maps',
    name: 'Google Maps',
    mark: 'open',
    hosts: ['google.com', 'maps.google.com', 'goo.gl', 'maps.app.goo.gl'],
    shape: 'video',
    sandbox: YOUTUBE,
    // Two shapes of address, and nothing else: a search, and a point. A short
    // link cannot be read without following it, which is a request nobody asked
    // for, so one of those stays a link.
    frame: (url) => {
      if (url.hostname.endsWith('goo.gl')) return null

      const path = parts(url)
      if (path[0] !== 'maps' && url.pathname !== '/maps') return null

      const asked = url.searchParams.get('q') ?? placeOf(path) ?? pointOf(url.pathname)
      return asked === null
        ? null
        : `https://www.google.com/maps?q=${encodeURIComponent(asked)}&output=embed`
    },
  },
]

/** The place a `/maps/place/Name` address names. */
function placeOf(path: readonly string[]): string | null {
  if (path[1] !== 'place' || path[2] === undefined) return null

  try {
    return decodeURIComponent(path[2]).replace(/\+/g, ' ') || null
  } catch {
    return null
  }
}

/** The point a `/@lat,lng,zoom` address names. */
function pointOf(pathname: string): string | null {
  const found = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(pathname)
  return found === null ? null : `${found[1]},${found[2]}`
}

/** A `t=90`, `t=1m30s` or `t=90s` timestamp as whole seconds. */
function seconds(written: string | null): number | null {
  if (written === null) return null

  const plain = /^(\d+)s?$/.exec(written)
  if (plain) return Number(plain[1])

  const parsed = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(written)
  if (!parsed || parsed[0] === '') return null

  const total = Number(parsed[1] ?? 0) * 3600 + Number(parsed[2] ?? 0) * 60 + Number(parsed[3] ?? 0)
  return total > 0 ? total : null
}

/** The host of an address as the table spells it: lowercased, without `www.`. */
function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '')
}

/** What an address in a note can be shown as, or null for one that is a link
 *  like any other.
 *
 *  Only `https`. A provider that had to be reached over plain http would be a
 *  provider reading the note over the reader's shoulder, and none of these needs
 *  to be. */
export function webEmbed(address: string): WebEmbed | null {
  let url: URL
  try {
    url = new URL(address.trim())
  } catch {
    return null
  }

  if (url.protocol !== 'https:') return null

  const host = hostOf(url)
  for (const row of ROWS) {
    if (!row.hosts.includes(host)) continue

    const frame = row.frame(url)
    if (frame === null) return null

    return { provider: named(row), frame, href: url.toString() }
  }

  return null
}

/** A row without the two parts that are the table's own business. */
function named(row: Row): Provider {
  return {
    id: row.id,
    name: row.name,
    mark: row.mark,
    shape: row.shape,
    sandbox: row.sandbox,
    ...(row.allow === undefined ? {} : { allow: row.allow }),
  }
}

/** Every provider, without the two parts of a row that are the table's own.
 *
 *  For the two tests that hold the table to what it promises: this package's own,
 *  which says every row asks for a sandbox and none for more than it needs, and the
 *  editor's web-frame test, which says the allowlist a frame is actually built with
 *  narrows none of it. That second one needs both halves at once - the table here
 *  and the frame there - so it lives in the editor, which is the half that builds
 *  the frame. */
export function providers(): Provider[] {
  return ROWS.map(named)
}
