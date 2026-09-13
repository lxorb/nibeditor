/** The broad list of places a note can show rather than link to, written out as
 *  packages/markdown/src/embeddable.ts.
 *
 *  The list nib used to have was nine rows long, each one a frame somebody had
 *  driven both ways round. Nine is a short list to hold up against Notion, which
 *  shows about forty places, so this is the rest of them - and the question that
 *  had to be answered first was where a list like that comes from without turning
 *  into a list nobody maintains.
 *
 *  The public oEmbed registry at oembed.com is the obvious source and it is half
 *  an answer. It is the only machine-readable census of which sites have an embed
 *  of any kind, and it says, per provider, which addresses belong to it. What it
 *  does not say is the one thing a renderer needs: the address of the frame. An
 *  oEmbed endpoint answers that, but it answers it with a block of HTML, over the
 *  network, per link - and a renderer that fetched HTML from a provider because a
 *  note was opened would undo the whole of web-embed.ts. So the frame address is
 *  derived from the page address by a pattern, and the pattern is the part a
 *  person writes.
 *
 *  Which leaves the registry doing the two jobs it is actually good for. It says
 *  whether a provider that claims to be registered still is - a row whose claim
 *  has gone stale stops the build rather than shipping a promise nobody keeps -
 *  and it says which hosts that provider answers for, which is how `embed.ted.com`
 *  and `instagr.am` reach the right row without anybody having thought of them.
 *  The rest it reports: every registered provider with no row here yet, so the
 *  list can grow by reading that output rather than by reading the web.
 *
 *  And the registry turns out to be missing exactly the providers a note is most
 *  likely to point at. Google Drive, Twitch, GitHub gists and Typeform have no
 *  oEmbed endpoint between them and all four publish a documented embed address,
 *  which is the practical reason this file holds a table of patterns with the
 *  registry checking it rather than a filter over the registry. Notion's list is
 *  the same shape for the same reason.
 *
 *  What is written is the table and nothing else: 170kB of registry becomes a few
 *  kilobytes of rows, because the renderer that reads it runs in front of the
 *  first paint. It is committed, like the sheets scripts/blog-css.ts writes, so
 *  the app needs no build step and no network to know what it can show; run
 *  `pnpm embed:table` after touching the rules below, or when a provider changes
 *  the shape of its embed address.
 *
 *  Node runs this as it is. The output goes through the repo's own prettier, so a
 *  regeneration can never be the thing that fails `prettier --check`. */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { format, resolveConfig } from 'prettier'

const ROOT = new URL('../', import.meta.url)
const TARGET = fileURLToPath(new URL('packages/markdown/src/embeddable.ts', ROOT))
const HAND_WRITTEN = fileURLToPath(new URL('packages/markdown/src/providers.ts', ROOT))

const REGISTRY = 'https://oembed.com/providers.json'

/** One rule: everything the table says about a provider, plus the name the
 *  registry knows it by, which is not shipped because nothing at render time has
 *  a use for it.
 *
 *  `frames` is tried in order, each pattern read against the address's path. The
 *  first that matches and fills in wins, so a narrower shape of address goes
 *  above a wider one. In a template, `$1`..`$9` are the pattern's own captures,
 *  `$path` is the address's path as the URL parser spells it, and `$url` is the
 *  whole address as a query parameter - for the handful of players that take an
 *  address rather than an id. Everything about how those are checked before they
 *  reach a frame is in providers.ts, which is the file that does the filling in. */
interface Rule {
  id: string
  name: string
  mark: 'play' | 'open'
  shape: 'video' | number
  /** The hosts a person could think of, without `www.`. The registry adds any
   *  others the provider has told it about. */
  hosts: string[]
  /** What oembed.com calls this provider, or null for one it has never heard of.
   *  Either way the row stands; the difference is only what can be checked. */
  oembed: string | null
  frames: [from: string, to: string][]
}

/** Twitch is the one player that refuses to draw unless the embedder names
 *  itself, so every Twitch frame carries the two hostnames the app is ever served
 *  from: `tauri.localhost` on Windows, plain `localhost` everywhere else and in
 *  dev. A published page never builds a frame at all - there the card is a link -
 *  which is why no `*.nibeditor.com` is in here and none can be: Twitch takes
 *  exact hostnames and a published space is a subdomain nobody knows in advance. */
const TWITCH = 'parent=localhost&parent=tauri.localhost&autoplay=false'

/** Every row of the broad list, and the reasoning that is particular to one row
 *  written beside it. Ordered by nothing in the app: a link matches at most one
 *  row on its own host, so the order between hosts never shows. */
const RULES: Rule[] = [
  // Drive hands out `/view` links and frames the same file at `/preview`. Tall
  // rather than wide, because what is in a Drive link is usually a document.
  {
    id: 'drive',
    name: 'Google Drive',
    mark: 'open',
    shape: 720,
    hosts: ['drive.google.com'],
    oembed: null,
    frames: [['^/file/d/([\\w-]+)', 'https://drive.google.com/file/d/$1/preview']],
  },
  {
    id: 'gdocs',
    name: 'Google Docs',
    mark: 'open',
    shape: 720,
    hosts: ['docs.google.com'],
    oembed: null,
    frames: [
      ['^/document/d/([\\w-]+)', 'https://docs.google.com/document/d/$1/preview'],
      ['^/spreadsheets/d/([\\w-]+)', 'https://docs.google.com/spreadsheets/d/$1/preview'],
      // A form's own address carries an `e` between the `d` and the id; both
      // spellings exist in the wild and both frame at `/viewform`.
      ['^/forms/d/e/([\\w-]+)', 'https://docs.google.com/forms/d/e/$1/viewform?embedded=true'],
      ['^/forms/d/([\\w-]+)', 'https://docs.google.com/forms/d/$1/viewform?embedded=true'],
    ],
  },
  // A deck is sixteen by nine where a document is a page, which is the only
  // reason slides are a row of their own rather than a pattern of the one above.
  {
    id: 'gslides',
    name: 'Google Slides',
    mark: 'open',
    shape: 'video',
    hosts: ['docs.google.com'],
    oembed: null,
    frames: [['^/presentation/d/([\\w-]+)', 'https://docs.google.com/presentation/d/$1/embed']],
  },
  // A board id ends in `=`, which is a character a path may hold and a query
  // parameter may hold as part of a value; see the class providers.ts checks it
  // against.
  {
    id: 'miro',
    name: 'Miro',
    mark: 'open',
    shape: 'video',
    hosts: ['miro.com'],
    oembed: 'Miro',
    frames: [['^/app/board/([\\w=-]+)', 'https://miro.com/app/live-embed/$1/']],
  },
  {
    id: 'twitch',
    name: 'Twitch',
    mark: 'play',
    shape: 'video',
    hosts: ['twitch.tv', 'm.twitch.tv', 'player.twitch.tv'],
    oembed: null,
    frames: [
      ['^/videos/(\\d+)', `https://player.twitch.tv/?video=$1&${TWITCH}`],
      ['^/(\\w+)/clip/([\\w-]+)', `https://clips.twitch.tv/embed?clip=$2&${TWITCH}`],
      // A bare name is a channel, which is what most Twitch links in a note are.
      // It is also what a page of Twitch's own looks like, so `/directory` gets a
      // player saying there is no such channel - the price of not being able to
      // tell a channel from a page without asking Twitch.
      ['^/(\\w+)$', `https://player.twitch.tv/?channel=$1&${TWITCH}`],
    ],
  },
  // The clip host reads differently: there the bare name is the clip rather than
  // a channel, and a row cannot mean both.
  {
    id: 'twitch-clip',
    name: 'Twitch',
    mark: 'play',
    shape: 'video',
    hosts: ['clips.twitch.tv'],
    oembed: null,
    frames: [['^/([\\w-]+)$', `https://clips.twitch.tv/embed?clip=$1&${TWITCH}`]],
  },
  // Portrait, because that is the only shape a TikTok is.
  {
    id: 'tiktok',
    name: 'TikTok',
    mark: 'play',
    shape: 740,
    hosts: ['tiktok.com'],
    oembed: 'TikTok',
    frames: [
      ['^/@[\\w.-]+/video/(\\d+)', 'https://www.tiktok.com/embed/v2/$1'],
      ['^/embed/v2/(\\d+)', 'https://www.tiktok.com/embed/v2/$1'],
      ['^/v/(\\d+)', 'https://www.tiktok.com/embed/v2/$1'],
    ],
  },
  // A gist is the one row here that exists because a page turned out to be
  // frameable after all. What GitHub documents is a `<script>` that writes the
  // gist into whatever page runs it, which is the one thing web-embed.ts will not
  // do; `.pibb` is the same gist as a bare document, served with
  // `X-Frame-Options: ALLOWALL` and `frame-ancestors *`. Seven hex digits at
  // least, because that is what a gist id is and a two-character path is somebody
  // else's page.
  {
    id: 'gist',
    name: 'GitHub Gist',
    mark: 'open',
    shape: 400,
    hosts: ['gist.github.com'],
    oembed: null,
    frames: [['^/([\\w-]+)/([0-9a-f]{7,64})', 'https://gist.github.com/$1/$2.pibb']],
  },
  // A form's own address is its embed address: Typeform's official embed frames
  // exactly this. Only `form.typeform.com`, because the other spelling is a
  // customer's own subdomain and a row cannot name a host nobody knows.
  {
    id: 'typeform',
    name: 'Typeform',
    mark: 'open',
    shape: 560,
    hosts: ['form.typeform.com'],
    oembed: null,
    frames: [['^/to/([\\w-]+)', 'https://form.typeform.com/to/$1']],
  },
  // The id is the hex at the end of the slug, which is why the pattern is
  // anchored: without the `$` the reading would stop at the first hex it found.
  {
    id: 'sketchfab',
    name: 'Sketchfab',
    mark: 'open',
    shape: 'video',
    hosts: ['sketchfab.com'],
    oembed: 'Sketchfab',
    frames: [
      ['^/3d-models/[\\w-]*-([0-9a-f]{12,40})$', 'https://sketchfab.com/models/$1/embed'],
      ['^/models/([0-9a-f]{12,40})', 'https://sketchfab.com/models/$1/embed'],
    ],
  },
  {
    id: 'dailymotion',
    name: 'Dailymotion',
    mark: 'play',
    shape: 'video',
    hosts: ['dailymotion.com'],
    oembed: 'Dailymotion',
    frames: [['^/video/(\\w+)', 'https://geo.dailymotion.com/player.html?video=$1']],
  },
  {
    id: 'ted',
    name: 'TED',
    mark: 'play',
    shape: 'video',
    hosts: ['ted.com'],
    oembed: 'TED',
    frames: [['^/talks/([\\w-]+)', 'https://embed.ted.com/talks/$1']],
  },
  {
    id: 'reddit',
    name: 'Reddit',
    mark: 'open',
    shape: 500,
    hosts: ['reddit.com'],
    oembed: 'Reddit',
    frames: [
      ['^/r/(\\w+)/comments/(\\w+)', 'https://www.redditmedia.com/r/$1/comments/$2/?embed=true'],
    ],
  },
  {
    id: 'giphy',
    name: 'GIPHY',
    mark: 'open',
    shape: 'video',
    hosts: ['giphy.com'],
    oembed: 'GIPHY',
    frames: [
      ['^/gifs/[\\w-]*-(\\w+)$', 'https://giphy.com/embed/$1'],
      ['^/gifs/(\\w+)$', 'https://giphy.com/embed/$1'],
      ['^/clips/[\\w-]*-(\\w+)$', 'https://giphy.com/embed/$1'],
      ['^/embed/(\\w+)', 'https://giphy.com/embed/$1'],
    ],
  },
  {
    id: 'streamable',
    name: 'Streamable',
    mark: 'play',
    shape: 'video',
    hosts: ['streamable.com'],
    oembed: 'Streamable',
    frames: [
      ['^/e/(\\w+)$', 'https://streamable.com/e/$1'],
      ['^/(\\w+)$', 'https://streamable.com/e/$1'],
    ],
  },
  // The widget takes the address of the show rather than an id of its own, so
  // this is one of the two rows that hand the whole address over.
  {
    id: 'mixcloud',
    name: 'Mixcloud',
    mark: 'play',
    shape: 120,
    hosts: ['mixcloud.com'],
    oembed: 'MixCloud',
    frames: [['^/[\\w-]+/[\\w-]+/?$', 'https://www.mixcloud.com/widget/iframe/?feed=$url']],
  },
  {
    id: 'codesandbox',
    name: 'CodeSandbox',
    mark: 'open',
    shape: 500,
    hosts: ['codesandbox.io'],
    oembed: 'CodeSandbox',
    frames: [
      ['^/s/([\\w-]+)', 'https://codesandbox.io/embed/$1'],
      ['^/p/sandbox/([\\w-]+)', 'https://codesandbox.io/embed/$1'],
      ['^/embed/([\\w-]+)', 'https://codesandbox.io/embed/$1'],
    ],
  },
  {
    id: 'stackblitz',
    name: 'StackBlitz',
    mark: 'open',
    shape: 500,
    hosts: ['stackblitz.com'],
    oembed: null,
    frames: [['^/edit/([\\w.-]+)', 'https://stackblitz.com/edit/$1?embed=1']],
  },
  {
    id: 'replit',
    name: 'Replit',
    mark: 'open',
    shape: 500,
    hosts: ['replit.com'],
    oembed: 'Replit',
    frames: [['^/@([\\w-]+)/([\\w.-]+)', 'https://replit.com/@$1/$2?embed=true']],
  },
  {
    id: 'observable',
    name: 'Observable',
    mark: 'open',
    shape: 500,
    hosts: ['observablehq.com'],
    oembed: 'Observable',
    frames: [
      ['^/@([\\w-]+)/([\\w-]+)', 'https://observablehq.com/embed/@$1/$2'],
      ['^/d/(\\w+)', 'https://observablehq.com/embed/d/$1'],
    ],
  },
  // Both segments or nothing: a single one is somebody's profile page, and a
  // fiddle of theirs is not what that link meant.
  {
    id: 'jsfiddle',
    name: 'JSFiddle',
    mark: 'open',
    shape: 400,
    hosts: ['jsfiddle.net'],
    oembed: null,
    frames: [['^/([\\w-]+)/([\\w-]+)/?$', 'https://jsfiddle.net/$1/$2/embedded/']],
  },
  // Apple serves the embed at the same path on another host, which is what
  // `$path` is for. Without `allow-same-origin` and without an `encrypted-media`
  // permission the player draws the record and plays the thirty-second preview
  // Apple gives anybody; a full track needs a subscription the frame cannot see.
  {
    id: 'apple-music',
    name: 'Apple Music',
    mark: 'play',
    shape: 175,
    hosts: ['music.apple.com'],
    oembed: null,
    frames: [
      [
        '^/[\\w-]+/(?:album|song|playlist|artist|music-video)/',
        'https://embed.music.apple.com$path',
      ],
    ],
  },
  {
    id: 'apple-podcasts',
    name: 'Apple Podcasts',
    mark: 'play',
    shape: 175,
    hosts: ['podcasts.apple.com'],
    oembed: 'Apple Podcasts',
    frames: [['^/[\\w-]+/podcast/', 'https://embed.podcasts.apple.com$path']],
  },
  // The kind is a word out of the path rather than a number, which is why the
  // template has it in a segment of its own: it is checked the same way every
  // other capture is.
  {
    id: 'deezer',
    name: 'Deezer',
    mark: 'play',
    shape: 300,
    hosts: ['deezer.com'],
    oembed: null,
    frames: [
      [
        '^/(?:[\\w-]+/)?(album|playlist|track|show|episode)/(\\d+)',
        'https://widget.deezer.com/widget/dark/$1/$2',
      ],
    ],
  },
  {
    id: 'desmos',
    name: 'Desmos',
    mark: 'open',
    shape: 'video',
    hosts: ['desmos.com'],
    oembed: null,
    frames: [
      ['^/calculator/(\\w+)', 'https://www.desmos.com/calculator/$1?embed'],
      ['^/geometry/(\\w+)', 'https://www.desmos.com/geometry/$1?embed'],
    ],
  },
  {
    id: 'geogebra',
    name: 'GeoGebra',
    mark: 'open',
    shape: 'video',
    hosts: ['geogebra.org'],
    oembed: null,
    frames: [
      ['^/m/(\\w+)', 'https://www.geogebra.org/material/iframe/id/$1'],
      ['^/material/iframe/id/(\\w+)', 'https://www.geogebra.org/material/iframe/id/$1'],
    ],
  },
  // A booking page is its own embed, and tall, because it is a calendar.
  {
    id: 'calendly',
    name: 'Calendly',
    mark: 'open',
    shape: 700,
    hosts: ['calendly.com'],
    oembed: null,
    frames: [['^/[\\w-]+/[\\w-]+', 'https://calendly.com$path']],
  },
  {
    id: 'canva',
    name: 'Canva',
    mark: 'open',
    shape: 'video',
    hosts: ['canva.com'],
    oembed: 'Canva',
    frames: [
      ['^/design/([\\w-]+)/([\\w-]+)/view', 'https://www.canva.com/design/$1/$2/view?embed'],
    ],
  },
  // A board's address ends in an id long enough to tell it from `/pricing`, which
  // is the only way to know a board from a page of Whimsical's own.
  {
    id: 'whimsical',
    name: 'Whimsical',
    mark: 'open',
    shape: 'video',
    hosts: ['whimsical.com'],
    oembed: 'Whimsical',
    frames: [['^/([\\w-]+-\\w{12,})$', 'https://whimsical.com/embed/$1']],
  },
  {
    id: 'flourish',
    name: 'Flourish',
    mark: 'open',
    shape: 'video',
    hosts: ['public.flourish.studio'],
    oembed: 'Flourish',
    frames: [
      ['^/visualisation/(\\d+)', 'https://flo.uri.sh/visualisation/$1/embed'],
      ['^/story/(\\d+)', 'https://flo.uri.sh/story/$1/embed'],
    ],
  },
  // The address a Datawrapper chart is published at is the address it is framed
  // at, which is the whole of this row.
  {
    id: 'datawrapper',
    name: 'Datawrapper',
    mark: 'open',
    shape: 500,
    hosts: ['datawrapper.dwcdn.net'],
    oembed: 'Datawrapper',
    frames: [['^/(\\w+)/(\\d+)', 'https://datawrapper.dwcdn.net/$1/$2/']],
  },
  {
    id: 'pinterest',
    name: 'Pinterest',
    mark: 'open',
    shape: 600,
    hosts: ['pinterest.com'],
    oembed: 'Pinterest',
    frames: [['^/pin/(\\d+)', 'https://assets.pinterest.com/ext/embed.html?id=$1']],
  },
  {
    id: 'instagram',
    name: 'Instagram',
    mark: 'open',
    shape: 700,
    hosts: ['instagram.com'],
    oembed: 'Instagram',
    frames: [
      ['^/p/([\\w-]+)', 'https://www.instagram.com/p/$1/embed'],
      ['^/reel/([\\w-]+)', 'https://www.instagram.com/reel/$1/embed'],
      // The older spelling puts the account before the post.
      ['^/[\\w.]+/p/([\\w-]+)', 'https://www.instagram.com/p/$1/embed'],
    ],
  },
  // A post is named by the author's DID, which has colons in it - allowed in a
  // path segment, and in the character class providers.ts checks a capture
  // against, for exactly this row.
  {
    id: 'bluesky',
    name: 'Bluesky',
    mark: 'open',
    shape: 400,
    hosts: ['bsky.app'],
    oembed: 'Bluesky Social',
    frames: [
      [
        '^/profile/([\\w.:-]+)/post/(\\w+)',
        'https://embed.bsky.app/embed/$1/app.bsky.feed.post/$2',
      ],
    ],
  },
  {
    id: 'acast',
    name: 'Acast',
    mark: 'play',
    shape: 175,
    hosts: ['play.acast.com'],
    oembed: 'Acast',
    frames: [['^/s/([\\w-]+)/([\\w-]+)', 'https://embed.acast.com/$1/$2']],
  },
  {
    id: 'arcgis',
    name: 'ArcGIS StoryMaps',
    mark: 'open',
    shape: 'video',
    hosts: ['storymaps.arcgis.com'],
    oembed: 'ArcGIS StoryMaps',
    frames: [['^/stories/(\\w+)', 'https://storymaps.arcgis.com/stories/$1']],
  },
  {
    id: 'padlet',
    name: 'Padlet',
    mark: 'open',
    shape: 600,
    hosts: ['padlet.com'],
    oembed: 'Padlet',
    frames: [['^/[\\w-]+/([\\w-]+)$', 'https://padlet.com/embed/$1']],
  },
  // Airtable's shared views all carry a `shr` id, whether or not the base is in
  // the address, and that id is the only part the embed wants.
  {
    id: 'airtable',
    name: 'Airtable',
    mark: 'open',
    shape: 600,
    hosts: ['airtable.com'],
    oembed: null,
    frames: [
      ['^/app\\w+/(shr\\w+)', 'https://airtable.com/embed/$1'],
      ['^/embed/(shr\\w+)', 'https://airtable.com/embed/$1'],
      ['^/(shr\\w+)', 'https://airtable.com/embed/$1'],
    ],
  },
  {
    id: 'imgur',
    name: 'Imgur',
    mark: 'open',
    shape: 600,
    hosts: ['imgur.com'],
    oembed: null,
    frames: [
      ['^/a/(\\w+)', 'https://imgur.com/a/$1/embed'],
      ['^/gallery/(\\w+)', 'https://imgur.com/a/$1/embed'],
    ],
  },
  {
    id: 'asciinema',
    name: 'asciinema',
    mark: 'play',
    shape: 400,
    hosts: ['asciinema.org'],
    oembed: null,
    frames: [['^/a/(\\w+)', 'https://asciinema.org/a/$1/iframe']],
  },
  {
    id: 'coub',
    name: 'Coub',
    mark: 'play',
    shape: 'video',
    hosts: ['coub.com'],
    oembed: 'Coub',
    frames: [
      ['^/view/(\\w+)', 'https://coub.com/embed/$1'],
      ['^/embed/(\\w+)', 'https://coub.com/embed/$1'],
    ],
  },
  {
    id: 'scribd',
    name: 'Scribd',
    mark: 'open',
    shape: 600,
    hosts: ['scribd.com'],
    oembed: 'Scribd',
    frames: [['^/doc(?:ument)?/(\\d+)', 'https://www.scribd.com/embeds/$1/content']],
  },
]

/** What one entry of the registry looks like, as far as anything here reads it. */
interface Registered {
  provider_name?: string
  endpoints?: { schemes?: string[] }[]
}

/** The registry, as it stands right now. Fetched rather than vendored whole: the
 *  committed artefact is the table below, and 170kB of schemes nothing reads is
 *  170kB in the app's first paint. */
async function registry(): Promise<Registered[]> {
  const answered = await fetch(REGISTRY)
  if (!answered.ok) throw new Error(`${REGISTRY} answered ${String(answered.status)}`)

  const read: unknown = await answered.json()
  if (!Array.isArray(read)) throw new Error(`${REGISTRY} is no longer a list of providers`)

  return read as Registered[]
}

/** The host a registry scheme names, as the table spells it, or null for the ones
 *  no row can match: a wildcard host, which is a pattern rather than a name, and
 *  a scheme that is not a URL at all - `spotify:*` is in there. */
function hostOf(scheme: string): string | null {
  let url: URL
  try {
    url = new URL(scheme)
  } catch {
    return null
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null

  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  return host.includes('*') || host === '' ? null : host
}

/** Every host a registered provider answers for. */
function hostsOf(provider: Registered): string[] {
  const schemes = (provider.endpoints ?? []).flatMap((one) => one.schemes ?? [])
  return [...new Set(schemes.map(hostOf).filter((host): host is string => host !== null))]
}

/** The hosts the nine hand-written rows already answer for, read out of
 *  providers.ts rather than restated here, so the two cannot drift. A row of the
 *  broad list on one of those hosts would never be reached - `webEmbed` asks the
 *  hand-written table first and takes its answer, including its refusals - so it
 *  is a mistake worth stopping the build for. */
function handWritten(): Set<string> {
  const source = readFileSync(HAND_WRITTEN, 'utf8')
  const found = [...source.matchAll(/hosts: \[([^\]]*)\]/g)].flatMap((one) =>
    [...(one[1] ?? '').matchAll(/'([^']+)'/g)].map((quoted) => quoted[1] ?? ''),
  )
  if (found.length < 9)
    throw new Error('providers.ts no longer spells its hosts out in `hosts: []`')

  return new Set(found)
}

/** Every row, with what the registry knows added to it, and every claim it makes
 *  checked. What is thrown here is a rule that has stopped being true, which is
 *  the one thing this script is for: a row that cannot be checked is a card that
 *  frames the wrong page, and finding that out in a note is finding it out too
 *  late. */
function rows(known: Registered[], theirs: Set<string>): Rule[] {
  const byName = new Map(known.map((one) => [one.provider_name ?? '', one]))
  const registered = new Set(known.flatMap(hostsOf))
  const seen = new Set<string>()

  return RULES.map((rule) => {
    if (seen.has(rule.id)) throw new Error(`two rows are called \`${rule.id}\``)
    seen.add(rule.id)

    const hosts = new Set(rule.hosts)
    if (rule.oembed !== null) {
      const provider = byName.get(rule.oembed)
      if (provider === undefined) {
        throw new Error(`the registry no longer lists \`${rule.oembed}\` (row \`${rule.id}\`)`)
      }

      for (const host of hostsOf(provider)) hosts.add(host)
    } else {
      for (const host of rule.hosts) {
        if (registered.has(host)) {
          console.warn(`${rule.id}: the registry now names ${host}; give the row its provider name`)
        }
      }
    }

    for (const host of hosts) {
      if (theirs.has(host)) throw new Error(`\`${rule.id}\` claims ${host}, a hand-written host`)
      if (host !== host.toLowerCase() || host.startsWith('www.')) {
        throw new Error(`\`${rule.id}\` spells a host the table cannot match: ${host}`)
      }
    }

    for (const [from, to] of rule.frames) checked(rule, from, to)

    return { ...rule, hosts: [...hosts].sort() }
  })
}

/** One pattern and the template it fills in, held to what providers.ts will do
 *  with them: a template that is not an `https` address is a frame pointed
 *  somewhere else, and a marker with no capture behind it is a row that can never
 *  match. */
function checked(rule: Rule, from: string, to: string): void {
  const captures = new RegExp(`${from}|`).exec('')?.length
  if (captures === undefined) throw new Error(`\`${rule.id}\`: ${from} is not a pattern`)

  if (!to.startsWith('https://')) throw new Error(`\`${rule.id}\`: ${to} is not an https address`)

  // Every capture after the host's own slash, so a piece of somebody else's
  // address can never become part of the host it is framed from. No rule below
  // does that; the check is here so that no later one can. `$path` is read as the
  // slash it always begins with, which is what lets the two rows that frame the
  // same path on an embed host say so.
  const after = to.slice('https://'.length).replaceAll('$path', '/')
  const first = /\$\w+/.exec(after)
  if (first !== null && !after.slice(0, first.index).includes('/')) {
    throw new Error(`\`${rule.id}\`: ${to} would let an address write its own host`)
  }

  for (const marker of to.matchAll(/\$\w+/g)) {
    const which = marker[0]
    if (which === '$path' || which === '$url') continue

    const at = Number(which.slice(1))
    if (!Number.isInteger(at) || at < 1 || at >= captures) {
      throw new Error(`\`${rule.id}\`: ${to} asks for ${which}, which ${from} does not capture`)
    }
  }
}

/** The module packages/markdown reads. Written as the rows and nothing else: the
 *  type they are read as lives in providers.ts, which is the file that says what
 *  each field means and is the only thing that fills a template in. */
function table(listed: Rule[]): string {
  const written = listed.map(
    (row) =>
      `  {\n` +
      `    id: ${JSON.stringify(row.id)},\n` +
      `    name: ${JSON.stringify(row.name)},\n` +
      `    mark: ${JSON.stringify(row.mark)},\n` +
      `    shape: ${JSON.stringify(row.shape)},\n` +
      `    hosts: ${JSON.stringify(row.hosts)},\n` +
      `    frames: ${JSON.stringify(row.frames)},\n` +
      `  },`,
  )

  return `/* Generated by scripts/embed-table.ts, checked against https://oembed.com/providers.json.
 * Do not edit: run \`pnpm embed:table\`.
 *
 * The broad half of the list of places a note can show rather than link to: the
 * providers nobody has driven a frame of by hand, each one an address pattern and
 * the frame it turns into. ${String(listed.length)} rows, of which ${String(listed.filter((row) => row.oembed !== null).length)} are in the public oEmbed
 * registry - which is where their hosts come from, so a provider that takes on a
 * new domain is a regeneration rather than a rewrite. The rest publish an embed
 * address and no oEmbed endpoint at all, Google Drive and Twitch and gists and
 * Typeform among them, which is why this is a table and not a filter.
 *
 * What every field means, and what is done to a capture before it reaches a
 * frame, is in providers.ts. Nothing here is a frame: a row is read only when a
 * note points at one of its hosts, and what it yields is an address. */

import type { Listed } from './providers'

export const EMBEDDABLE: readonly Listed[] = [
${written.join('\n')}
]
`
}

/** Every registered provider with no row yet, which is the list to read when the
 *  table should grow. Named rather than counted, because the answer to "what is
 *  missing" is the names. */
function missing(known: Registered[], listed: Rule[]): string[] {
  const mine = new Set(listed.flatMap((row) => row.hosts))
  return known
    .filter((one) => hostsOf(one).length > 0 && !hostsOf(one).some((host) => mine.has(host)))
    .map((one) => one.provider_name ?? '')
    .sort()
}

const known = await registry()
const listed = rows(known, handWritten())
const source = await format(table(listed), {
  ...(await resolveConfig(TARGET)),
  filepath: TARGET,
})

writeFileSync(TARGET, source)

const absent = missing(known, listed)
const shown = absent.slice(0, 40)

console.log(
  `wrote ${TARGET} (${(source.length / 1024).toFixed(1)}kB, ${String(listed.length)} rows)`,
)
console.log(
  `${String(known.length)} providers in the registry, ${String(absent.length)} of them with no row here:`,
)
console.log(`${shown.join(', ')}${absent.length > shown.length ? ', …' : ''}`)
