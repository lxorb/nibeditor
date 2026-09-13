/** Typed client for the sync service. Every call carries the session token;
 *  nothing here touches cookies, so it works the same in the app and the web. */

import { deviceName } from './device'
import { isRecord, isString, parsed } from './stored'
import type { Bookmark } from './workspace/bookmarks.svelte'
import type { GraphSettings } from './workspace/graph-settings.svelte'

export const BASE: string = import.meta.env.VITE_NIB_API ?? 'https://nibeditor.com'

export interface Account {
  id: string
  email: string
  /** Shown on anything the account publishes. Null until chosen. */
  name: string | null
}

/** What this account may do in a space: its own, one somebody shared to write
 *  in, or one shared to read. */
export type SpaceRole = 'owner' | 'write' | 'read'

/** A role a person can be given. The third is being the owner, which is not
 *  something anybody is given. */
export type GivenRole = 'write' | 'read'

/** Somebody a share link let in, with no account behind them. A name and an id
 *  is the whole of one; see services/sync/src/guests.ts. */
export interface Guest {
  id: string
  name: string
}

/** One person a space was shared with. Exactly one of `email` and `guest` names
 *  them: somebody invited by address is the first, somebody the space's own link
 *  let in is the second. */
export interface Member {
  email: string | null
  /** Their guest id, when a link is how they got here. */
  guest: string | null
  /** The name on their account, once they have one and have chosen one, or the
   *  one a guest was given by their device and may change. */
  name: string | null
  role: GivenRole
  /** Nobody has opened the space under that address yet. */
  pending: boolean
}

/** The one link a space has, when it has one. */
export interface ShareLink {
  url: string
  role: GivenRole
  /** `open` lets in anybody who has it; `approval` turns it into a request. */
  mode: 'open' | 'approval'
}

/** Somebody who followed a link that asks first. Named the same two ways a
 *  member is: an address they proved, or the guest a link handed out. */
interface JoinRequest {
  email: string | null
  guest: string | null
  name: string | null
  role: GivenRole
  at: number
}

/** Who else may reach a space, or one file of it, which is the whole of what the
 *  Share sheet draws and what every change to it answers with. */
export interface Sharing {
  owner: { email: string; name: string | null }
  /** Which file this is about, when it is about one file rather than the whole
   *  space. Null for the space, which is what every sheet was about before. */
  item: { id: string; path: string } | null
  members: Member[]
  requests: JoinRequest[]
  link: ShareLink | null
}

/** One file somebody else shared on its own: a note or a canvas out of their
 *  space, with no folder of its own on this machine.
 *
 *  It is not a space and is never made into one. It is a row at the foot of the
 *  space switcher, grouped under whoever shared it, and it opens in a tab whose
 *  words travel through the file's room; see docs/sharing.md. */
export interface SharedItem {
  /** The note's id on the account, which is also what names its room. */
  id: string
  /** Where it sits in the owner's space, which is what its name comes off. */
  path: string
  /** What to call it: the file's own name, without the markdown extension. */
  name: string
  role: GivenRole
  updatedAt: number
  /** Whoever shared it, by name. Never an address. */
  owner: { name: string }
  /** Which space it came out of - for the row, not for a way in: nothing about
   *  that space is reachable with this. */
  space: { id: string; name: string }
}

/** What a link somebody was sent leads to, answered before there is a session,
 *  because it is what the page shows before there is one to have. */
export interface Invitation {
  kind: 'invite' | 'link'
  /** The space's name. */
  space: string
  /** The one file the link is about, by name, or null where it is the space. */
  note: string | null
  role: GivenRole
  /** The address an invitation was written to, so the sign-in is filled in.
   *  Null for a link, which is for whoever has it. */
  email: string | null
  /** The link asks the owner before it lets anybody in, which is the one case
   *  where anything at all is asked of whoever followed it. */
  asks: boolean
  /** What to call whoever shared it. */
  from: string | null
}

/** What walking through a link answers.
 *
 *  A link is its own proof, so most of these carry a session that did not exist
 *  a moment ago: an invitation opens the account it was written to, and a link
 *  the space itself holds hands out a guest. */
export interface Joined {
  /** The session the link established. Absent when the link was followed by a
   *  session that was already there. */
  token?: string
  /** The account an invitation opened. */
  user?: Account
  /** The guest a link handed out, or the one that followed it. */
  guest?: Guest
  space?: RemoteSpace
  /** The one file the link was about, where it was about one file. Exactly one
   *  of this and `space` comes back from a link that let somebody in. */
  item?: SharedItem
  /** The owner has been asked, and has not answered. */
  waiting?: boolean
  /** The owner said no. */
  declined?: boolean
}

export interface RemoteSpace {
  id: string
  name: string
  /** Where it sits in the list of spaces, shared across machines. */
  position: number
  icon: string | null
  /** The colour that icon is drawn in, as one of the app's own accents by its id.
   *  Null for the plain foreground, and absent from a build of the service older
   *  than this app - which is why the app reads it rather than trusting it. */
  tint?: string | null
  /** What this account may do here. Everything the app offers in a space asks
   *  this first, so a reader is never shown a button that would be refused. */
  role: SpaceRole
  /** Whether anybody besides the owner is in it, which is the dot on its row in
   *  the switcher. About the space itself: a file of it shared on its own is a
   *  mark on that row, and does not make the whole space shared. */
  shared: boolean
  /** Which of its files are shared on their own, by note id, so the tree can
   *  mark those rows. Empty for a space somebody else owns, and absent from a
   *  build of the service older than this app. */
  sharedItems?: string[]
  /** How many notes it holds. What a machine bringing the account down for the
   *  first time counts against, since it knows this before the first note has
   *  landed; see arriving.svelte.ts. */
  notes: number
  /** What is kept above the space's file list, in the order it appears. */
  bookmarks: Bookmark[]
  /** The icon each folder of the space wears, by the folder's path as the space
   *  speaks it. A note and a canvas keep their own inside the file; a folder has
   *  no file, so its icon comes down with the space. `{}` until one is chosen. */
  icons: Record<string, string>
  /** And the colour each of those icons is drawn in, under the same keys. Read
   *  rather than trusted, for the reason the graph settings are: a build of the
   *  service older than this app answers with nothing at all. */
  tints?: unknown
  /** How the space's graph is drawn: what the picture is filtered to, which
   *  queries are coloured, how far apart it sits. Read rather than trusted, since
   *  a build of the service older than this app answers with nothing at all; see
   *  workspace/graph-settings.svelte.ts. */
  graph: unknown
  /** The notes and folders the space leaves out of its search, its graph and its
   *  unlinked mentions, relative to the space. `[]` until one is; see
   *  workspace/excluded.svelte.ts. */
  excluded: unknown
  createdAt: number
  updatedAt: number
  blog: {
    enabled: boolean
    subdomain: string | null
    domain: string | null
    title: string | null
    note: string | null
    /** What to add at the registrar for a domain of one's own. Empty otherwise. */
    dns: DnsRecord[]
    /** What the site itself decides; see services/sync/src/blog/site.ts. */
    site: SiteSettings
  }
}

/** Which notes a site publishes, and what its pages fall back on.
 *
 *  The rules are about folders; a note that says `publish:` in its own front
 *  matter has settled its own case and no rule here changes that. `password` is
 *  only ever whether there is one: the account never hands one back. */
/** One answer somebody typed into a form on a published page. */
export interface FormAnswer {
  id: string
  /** The note that asked, and its path, so the list says which page. */
  note: string
  path: string
  at: number
  /** Keyed by the question as the note wrote it; see blog/form.ts. */
  answers: Record<string, string>
}

export interface SiteSettings {
  rules: {
    /** Folders published even where the default is to publish nothing. */
    include: string[]
    /** Folders never published, whatever the default is. */
    exclude: string[]
    /** What a note outside every rule, and silent about itself, gets. */
    otherwise: 'all' | 'none'
  }
  description?: string
  image?: string
  /** The icon a browser tab shows, as the SVG this app drew of the space's own
   *  mark; see site-icon.ts. */
  icon?: string
  /** The theme the site is dressed in: its name, and the blob its stylesheet
   *  was uploaded as. */
  theme?: { name: string; hash: string }
  /** Where a visit is counted, if the author asked for that at all. */
  analytics?: { url: string; domain?: string }
  password: boolean
}

/** What a publish would change: how many pages the site would have, which
 *  appear, which disappear. A nib site is live - the page is the note - so this
 *  is the only thing a publish can change and the only honest thing to show
 *  before one. */
export interface SiteChanges {
  pages: number
  /** How many bytes of notes the site would serve, for the line that says what
   *  a site costs against the account's allowance. */
  bytes: number
  /** Whether the space carries the two files a site is dressed with. */
  dressing: { css: boolean; js: boolean }
  before: number
  adds: string[]
  removes: string[]
  more: boolean
}

export interface RemoteNote {
  id: string
  path: string
  seq: number
  version: number
  updatedAt: number
  deleted: boolean
  size: number
  hash: string
}

/** A file a space keeps beside its notes: where it sits, and the blob holding
 *  its bytes. Today a PDF, so that a published note linking one can serve it. */
/** Whether the account asks for a second code when signing in, and how many
 *  one-shot codes are left for the day the phone is gone. `possible` is false
 *  where the service has no secret to keep one under. */
export interface SecondState {
  on: boolean
  since: number | null
  codesLeft: number
  possible: boolean
}

/** One session: the device that opened it, when, when it was last seen, and
 *  whether it is the one asking. */
export interface RemoteSession {
  id: string
  name: string
  createdAt: number
  lastUsedAt: number | null
  current: boolean
}

/** One version the account holds: when it was written, how big it was, and the
 *  device that sent it. */
export interface RemoteVersion {
  at: number
  size: number
  by: string
}

export interface SpaceFile {
  /** Relative to the space, `/`-separated. */
  path: string
  /** The hash of its contents, which is also the blob's name. */
  hash: string
}

/** What Recently deleted holds on the account. */
export interface TrashListing {
  spaces: { id: string; name: string; deletedAt: number; purgeAt: number; notes: number }[]
  notes: {
    id: string
    spaceId: string
    spaceName: string
    path: string
    deletedAt: number
    purgeAt: number
  }[]
}

/** The settings that follow the account from machine to machine. Each is
 *  there once chosen; a missing one means the machine's own choice stands. */
export interface AccountSettings {
  /** How much of a note the ligature glyphs are drawn over. A boolean is what
   *  a build that had a switch here wrote, and still reads. */
  ligatures?: boolean | string
  /** The Glasses section, which the Even Hub plugin is the only thing that shows.
   *
   *  All of it follows the account rather than the machine: the plugin runs on a
   *  phone and is set up on a desktop, and typing an API key into a WebView with a
   *  thumb is nobody's evening. See modes.svelte.ts and lib/even.
   *
   *  At which heading level a new page starts on the panel; 0 for none. */
  glassesBreak?: number
  /** A gutter of the note's own line numbers down the left of the panel. */
  glassesLineNumbers?: boolean
  /** Whether the glasses' microphone listens for spoken commands. */
  glassesVoice?: boolean
  /* `glassesPageNumber` was here. A page number means something where the app turns
     the pages and nothing where the glasses scroll, so the scroll mode decides it and
     there is no setting; a value an older build saved is ignored. The service still
     accepts the field so an older build's patch is not refused. */
  /** How much of a note's own white space reaches the panel: `none`, `collapse`
   *  or `aggressive`; see `Compaction` in @nib/glasses. */
  glassesCompaction?: string
  /** Which of a note's markers are drawn on the panel, by construct. */
  glassesMarks?: Record<string, boolean>
  /** Who scrolls the note: the app, page by page, or the glasses themselves. */
  /** The phrases a spoken command answers to, where the reader changed them.
   *  Only the differences travel, the way the shortcuts do. */
  glassesWords?: Record<string, string>
  /** Whether this account has ever had the plugin in front of a pair of glasses.
   *  What the Glasses section on every other device waits for. */
  glassesSeen?: boolean
  /** Which model answers, out of the families the API itself listed. */
  glassesModel?: string
  /** How hard it is asked to think, from the API's own list of efforts. */
  glassesEffort?: string
  /** Where a pasted picture is written; one of attachments.ts's three. */
  attachments?: string
  /** The words the reader has said are words, which the checker is turned off
   *  over; see spelling.ts in the editor package. */
  spellWords?: string[]
  /** Keys the reader chose, by shortcut id, as differences from the defaults.
   *  Null where they took a key away. Only the differences travel: a full
   *  dump would freeze today's defaults into every account that ever saved
   *  one, and a default that changed later would never reach anybody. */
  shortcuts?: Record<string, string | null>
  /** Which keyboard the map above is: one of shortcuts/presets.ts, or
   *  `custom` for a map somebody put together themselves. */
  preset?: string
  /** Which commands the phone's format bar holds, in order, by the same ids the
   *  shortcuts are filed under. Null for the default set, which is what lets a
   *  default that changes later reach everybody who never chose; see
   *  toolbar.svelte.ts. */
  toolbar?: string[] | null
  /** Which command pulling a list or a note down past its top runs: an id from
   *  the same registry, `none` for no gesture at all, or null for the one the app
   *  offers. See pull.svelte.ts. */
  pull?: string | null
  /** Modal editing, which is a mode rather than a map: it can be on over any
   *  of the presets. */
  vim?: boolean
  /** Minutes between the versions kept while a note is being written in, and
   *  how many days a version is kept for. Zero minutes is off; see
   *  recovery.ts. */
  recoveryEvery?: number
  recoveryDays?: number
  /** How long the account keeps what a note said before, in days: 30 or 365.
   *  The device's own history is the two above; this is the account's, and the
   *  nightly sweep reads the same number. See docs/sync.md. */
  keepVersions?: number
  /** What a device does when the same note was written in two places; see
   *  sync/conflicts.ts. On the account rather than on the device, because it is
   *  a decision about the notes rather than about the machine. */
  conflicts?: string
  /** Which colour the highlight button writes, as the palette tone it names, or
   *  null for a highlight with no colour of its own; see highlights.ts in
   *  @nib/markdown. How somebody marks up, not which machine they are at. */
  highlightTone?: number | null
  /** Whether a single newline breaks the line. On the account because it is about
   *  how the notes read, and read by the blog as well, so a published page reads
   *  the way its author reads it; see blog.ts in services/sync. */
  hardBreaks?: boolean
  /** How a link to another note is written: a wikilink, or a markdown link with
   *  one of three shapes of target; see link-format.ts. */
  linkFormat?: string
}

/** What any read can say about the account's OpenAI key.
 *
 *  Whether there is one, and its last four characters. Never the key: it is stored
 *  encrypted and no route hands it back. Emil's rule, in his words - "it stays in
 *  the account, but after you set it you can't read it anymore." Setting it is
 *  `PUT /v1/ask/key`, and a second write replaces the first. */
export interface KeyState {
  set: boolean
  /** The last four characters, or empty when no key is set. */
  tail: string
}

export interface DnsRecord {
  type: string
  name: string
  value: string
  /** Only when there is something to say - at the root of a domain, where
   *  a plain CNAME is not always allowed. */
  note?: string
}

/** How far along a domain of one's own is. `none` when the space has no
 *  domain; `unproved` while the record that shows the domain is this account's
 *  has not been read there, which is before anything else can happen;
 *  `unconfigured` when the server records domains but does not ask for
 *  certificates. `detail` is what went wrong, in the server's words or
 *  Cloudflare's. */
export interface DomainStatus {
  domain: string | null
  state: 'none' | 'unproved' | 'pending' | 'active' | 'error' | 'unconfigured'
  detail: string | null
  dns: DnsRecord[]
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown = null,
  ) {
    super(message)
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string; device?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.token) headers.authorization = `Bearer ${options.token}`
  // Only where it is the answer to something: a version the account keeps says
  // which device wrote those words. See device.ts and services/sync/versions.ts.
  if (options.device) headers['x-nib-device'] = deviceName()

  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })

  const body = parsed(await response.text())

  if (!response.ok) {
    // The server says why in `error`, and it says so for everything it answers,
    // a fault of its own included. When there is no sentence to read - an edge
    // between here and there answering with a page of its own - the status is all
    // there is to go on, and a five hundred of that kind is something to try
    // again rather than a number to show somebody.
    const said = isRecord(body) && isString(body.error) ? body.error : null
    const otherwise =
      response.status >= 500
        ? 'could not reach the server - try again'
        : `request failed (${response.status})`

    throw new ApiError(response.status, said ?? otherwise, body)
  }

  // The service is the other half of this repo and answers the shapes above;
  // checking each one field by field here would be a second copy of its types.
  return body as T
}

/** Which share a call is about, as the query the service reads: one file of the
 *  space, or - empty - the space itself. Written once, because every call about
 *  sharing carries it and a hand-rolled query string is a place to forget the
 *  encoding. */
function about(item: string): string {
  return item ? `?item=${encodeURIComponent(item)}` : ''
}

/** Sound, as words. Sent as the bytes it is, which is why it is here rather than
 *  through `request`.
 *
 *  One function for the two things that send sound - a phrase said into a pair of
 *  glasses, and a piece of a recording - because it is one route and the difference
 *  between them is a query. `language` is the tag the model settled on, or empty
 *  where it did not say; a spoken command has no use for one. */
async function listen(
  token: string,
  wav: Uint8Array<ArrayBuffer>,
  query: string,
): Promise<{ said: string | null; language: string }> {
  const response = await fetch(`${BASE}/v1/ask/heard${query}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'audio/wav' },
    body: wav,
  })

  const body = parsed(await response.text())

  if (!response.ok) {
    const said = isRecord(body) && isString(body.error) ? body.error : null
    throw new ApiError(response.status, said ?? 'could not be heard')
  }

  return body as { said: string | null; language: string }
}

export const api = {
  requestCode: (email: string) =>
    request<{ ok: true; resendIn: number }>('/v1/auth/code', { body: { email } }),

  /** `guest` is what this device was as a guest, if it was one: handing it over
   *  is how the spaces a link let the device into follow it into the account. */
  verifyCode: (email: string, code: string, guest?: string) =>
    request<{ token?: string; user?: Account; second?: boolean; holding?: string }>(
      '/v1/auth/verify',
      { body: { email, code, ...(guest ? { guest } : {}) }, device: true },
    ),

  /** The other half of a sign-in for an account with a second factor: the code
   *  out of an authenticator app, or one of the recovery codes. */
  verifySecond: (holding: string, code: string) =>
    request<{ token: string; user: Account }>('/v1/auth/second', {
      body: { holding, code },
      device: true,
    }),

  signOut: (token: string) => request<{ ok: true }>('/v1/auth/signout', { method: 'POST', token }),

  /* The second factor, and the sessions it is there to protect. See
     services/sync/src/second.ts, which says why it is six digits rather than a
     passkey. */

  second: (token: string) => request<SecondState>('/v1/second', { token }),

  /** A secret to put into an authenticator app. Nothing is on until the confirm
   *  below proves the app has it. */
  beginSecond: (token: string) =>
    request<{ holding: string; secret: string; uri: string }>('/v1/second', {
      method: 'POST',
      token,
      body: {},
    }),

  confirmSecond: (token: string, holding: string, code: string) =>
    request<{ on: true; recovery: string[] }>('/v1/second/confirm', {
      method: 'POST',
      token,
      body: { holding, code },
    }),

  /** Off again, which takes a code: somebody with the session and not the phone
   *  is who this is there to stop. */
  endSecond: (token: string, code: string) =>
    request<{ on: false }>('/v1/second', { method: 'DELETE', token, body: { code } }),

  freshRecovery: (token: string, code: string) =>
    request<{ recovery: string[] }>('/v1/second/recovery', {
      method: 'POST',
      token,
      body: { code },
    }),

  sessions: (token: string) => request<{ sessions: RemoteSession[] }>('/v1/sessions', { token }),

  endSession: (token: string, id: string) =>
    request<{ ok: boolean }>(`/v1/sessions/${id}`, { method: 'DELETE', token }),

  /** Every session but this one. What somebody does when a laptop has gone. */
  endOtherSessions: (token: string) =>
    request<{ ended: number }>('/v1/sessions', { method: 'DELETE', token }),

  /** Whoever the session belongs to: an account, or the guest a link let in. */
  me: (token: string) => request<{ user?: Account; guest?: Guest }>('/v1/me', { token }),

  /** What to call whoever is here. An empty name takes an account's away again;
   *  a guest keeps the one their device gave them. */
  rename: (token: string, name: string) =>
    request<{ user?: Account; guest?: Guest }>('/v1/me', {
      method: 'PATCH',
      token,
      body: { name },
    }),

  listSpaces: (token: string) =>
    request<{ spaces: RemoteSpace[]; deleted: string[] }>('/v1/spaces', { token }),

  createSpace: (token: string, name: string) =>
    request<{ space: RemoteSpace }>('/v1/spaces', { token, body: { name } }),

  usage: (token: string) => request<{ used: number; limit: number }>('/v1/usage', { token }),

  /** Everything the account has chosen, and whether it has an OpenAI key. The key
   *  is beside the settings rather than in them because it is the one thing here
   *  that can be written and never read. */
  settings: (token: string) =>
    request<{ settings: AccountSettings; key: KeyState }>('/v1/settings', { token }),
  saveSettings: (token: string, patch: AccountSettings) =>
    request<{ settings: AccountSettings }>('/v1/settings', { method: 'PATCH', token, body: patch }),

  /* The glasses' question flow. All four run on the Worker, because the key does:
     the plugin holds no key and reaches no origin but this one. See docs/even.md. */

  /** Sets the key, or replaces the one that is there. */
  setAskKey: (token: string, key: string) =>
    request<KeyState>('/v1/ask/key', { method: 'PUT', token, body: { key } }),

  removeAskKey: (token: string) => request<KeyState>('/v1/ask/key', { method: 'DELETE', token }),

  /** Which models this account's key may choose. Empty when there is no key, when
   *  the key is wrong, or when OpenAI could not be reached. */
  askModels: (token: string) => request<{ models: string[] }>('/v1/ask/models', { token }),

  /** A question, answered out of the account's own notes. */
  ask: (token: string, question: string, model: string, effort: string) =>
    request<{ answer: string }>('/v1/ask', { token, body: { question, model, effort } }),

  /** Opens the connection before there is anything to send through it.
   *
   *  A command spoken into a pair of glasses is one small request, and on a phone
   *  that has been idle it pays for a DNS lookup, a TCP handshake and a TLS
   *  handshake first - a couple of hundred milliseconds inside the one thing a
   *  reader is waiting on. `/health` is the cheapest thing this service answers: no
   *  session, no database, no work. Nothing waits on it and nothing is done with the
   *  answer; the point is the open socket it leaves behind. */
  warm: () => {
    void fetch(`${BASE}/health`, { method: 'GET', keepalive: true }).catch(() => undefined)
  },

  /** One utterance, as words. Null when nothing was heard.
   *
   *  `like` is the handful of words the plugin is hoping to hear - the spoken
   *  commands, as this reader has them. Whisper takes a prompt and biases what it
   *  writes towards it, which is the difference between "next" and "text" on a
   *  half-second of speech. */
  askHeard: (token: string, wav: Uint8Array<ArrayBuffer>, like = '') =>
    listen(token, wav, like ? `?like=${encodeURIComponent(like.slice(0, 300))}` : ''),

  /** One piece of a recording, as words.
   *
   *  The same route and the same models; `piece` says only that this is part of
   *  something somebody recorded rather than a phrase said into a pair of glasses, so
   *  the twelve-second ceiling a spoken command is held to does not apply. See
   *  recorder/transcribe.ts, which cuts the pieces, and services/sync/src/ask. */
  askPiece: (token: string, wav: Uint8Array<ArrayBuffer>) => listen(token, wav, '?piece=1'),

  /** A transcript, as takeaways and the tasks it left open.
   *
   *  The account's own key and the account's own model, on the Worker, because that
   *  is the only place the key can be opened. */
  askSummary: (token: string, text: string, model: string, effort: string) =>
    request<{ summary: string }>('/v1/ask/summary', { token, body: { text, model, effort } }),

  /** Named by its own hash, so a repeat costs one request and no storage. */
  putBlob: async (token: string, hash: string, type: string, bytes: ArrayBuffer) => {
    const response = await fetch(`${BASE}/v1/blobs/${hash}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': type },
      body: bytes,
    })

    const body = parsed(await response.text())

    if (!response.ok) {
      const said = isRecord(body) && isString(body.error) ? body.error : null
      throw new ApiError(response.status, said ?? 'upload failed')
    }

    return body as { hash: string; stored: boolean }
  },

  reorderSpaces: (token: string, order: string[]) =>
    request<{ ok: true }>('/v1/spaces/order', { method: 'PUT', token, body: { order } }),

  renameSpace: (token: string, id: string, name: string) =>
    request<{ space: RemoteSpace }>(`/v1/spaces/${id}`, { method: 'PATCH', token, body: { name } }),

  /** The space's own icon and the colour it is drawn in. One request, because they
   *  are one gesture in the picker, and the service takes the colour beside the icon
   *  for the same reason a note keeps `icon-color:` beside `icon:`. */
  setSpaceIcon: (token: string, id: string, icon: string | null, tint: string | null = null) =>
    request<{ space: RemoteSpace }>(`/v1/spaces/${id}`, {
      method: 'PATCH',
      token,
      body: { icon, tint },
    }),

  /** The whole list of what a space keeps beside its notes. Answers which of the
   *  hashes the account has no blob for yet, so a thirty megabyte PDF is sent
   *  once rather than on every pass. */
  saveSpaceFiles: (token: string, id: string, files: SpaceFile[]) =>
    request<{ files: SpaceFile[]; missing: string[] }>(`/v1/spaces/${id}/files`, {
      method: 'PUT',
      token,
      body: { files },
    }),

  /** The whole list, in its order: reordering is a change to the list itself,
   *  so there is nothing smaller worth sending. */
  saveBookmarks: (token: string, id: string, bookmarks: Bookmark[]) =>
    request<{ bookmarks: Bookmark[] }>(`/v1/spaces/${id}/bookmarks`, {
      method: 'PUT',
      token,
      body: { bookmarks },
    }),

  /** The whole map, for the same reason the bookmarks go whole: one folder's icon
   *  is not something the account keeps separately, and a map of a few dozen pairs
   *  is smaller than the request that would carry one pair.
   *
   *  And the colours under the same keys, in the same request: a folder's icon and
   *  the colour it is drawn in are one gesture in the picker. */
  saveFolderIcons: (
    token: string,
    id: string,
    icons: Record<string, string>,
    tints: Record<string, string>,
  ) =>
    request<{ icons: Record<string, string>; tints: Record<string, string> }>(
      `/v1/spaces/${id}/icons`,
      { method: 'PUT', token, body: { icons, tints } },
    ),

  /** How the space's graph is drawn, whole, for the reason the folder icons go
   *  whole: it is one small object, and a switch turned in the card is smaller than
   *  the request that carries it. */
  saveGraphSettings: (token: string, id: string, graph: GraphSettings) =>
    request<{ graph: unknown }>(`/v1/spaces/${id}/graph`, {
      method: 'PUT',
      token,
      body: { graph },
    }),

  /** The whole list, for the reason the bookmarks go whole: it is short, and a row
   *  taken back is smaller than the request that would carry it. */
  saveExcluded: (token: string, id: string, excluded: readonly string[]) =>
    request<{ excluded: string[] }>(`/v1/spaces/${id}/excluded`, {
      method: 'PUT',
      token,
      body: { excluded },
    }),

  deleteSpace: (token: string, id: string) =>
    request<{ ok: true }>(`/v1/spaces/${id}`, { method: 'DELETE', token }),

  // Sharing a space, or one file of it. Every one of these answers with the
  // whole of who may reach that thing, so the sheet is drawn from what came back
  // rather than from a guess about what the change did.
  //
  // `item` is the note's id where the share is about one file, and empty where
  // it is about the space - which is what all of these meant before there were
  // items. One set of calls for both, because it is one set of routes and one
  // sheet; see services/sync/src/spaces/share.ts.
  sharing: (token: string, id: string, item = '') =>
    request<Sharing>(`/v1/spaces/${id}/share${about(item)}`, { token }),

  invite: (token: string, id: string, email: string, role: GivenRole, item = '') =>
    request<Sharing>(`/v1/spaces/${id}/share/invite${about(item)}`, {
      token,
      body: { email, role },
    }),

  setMemberRole: (token: string, id: string, email: string, role: GivenRole, item = '') =>
    request<Sharing>(`/v1/spaces/${id}/share/members/${encodeURIComponent(email)}${about(item)}`, {
      method: 'PATCH',
      token,
      body: { role },
    }),

  removeMember: (token: string, id: string, email: string, item = '') =>
    request<Sharing>(`/v1/spaces/${id}/share/members/${encodeURIComponent(email)}${about(item)}`, {
      method: 'DELETE',
      token,
    }),

  setShareLink: (token: string, id: string, role: GivenRole, mode: ShareLink['mode'], item = '') =>
    request<Sharing>(`/v1/spaces/${id}/share/link${about(item)}`, {
      method: 'PUT',
      token,
      body: { role, mode },
    }),

  revokeShareLink: (token: string, id: string, item = '') =>
    request<Sharing>(`/v1/spaces/${id}/share/link${about(item)}`, { method: 'DELETE', token }),

  // The same four things, about somebody a link let in rather than an address.
  // A guest is one row rather than a membership and a request, so letting them
  // in, changing what they may do and ending it are three verbs on one path.
  acceptGuest: (token: string, id: string, guest: string, item = '') =>
    request<Sharing>(`/v1/spaces/${id}/share/guests/${encodeURIComponent(guest)}${about(item)}`, {
      method: 'POST',
      token,
    }),

  setGuestRole: (token: string, id: string, guest: string, role: GivenRole, item = '') =>
    request<Sharing>(`/v1/spaces/${id}/share/guests/${encodeURIComponent(guest)}${about(item)}`, {
      method: 'PATCH',
      token,
      body: { role },
    }),

  /** Declining somebody who is waiting, and taking out somebody who is in. */
  removeGuest: (token: string, id: string, guest: string, item = '') =>
    request<Sharing>(`/v1/spaces/${id}/share/guests/${encodeURIComponent(guest)}${about(item)}`, {
      method: 'DELETE',
      token,
    }),

  acceptRequest: (token: string, id: string, email: string, item = '') =>
    request<Sharing>(`/v1/spaces/${id}/share/requests/${encodeURIComponent(email)}${about(item)}`, {
      method: 'POST',
      token,
    }),

  declineRequest: (token: string, id: string, email: string, item = '') =>
    request<Sharing>(`/v1/spaces/${id}/share/requests/${encodeURIComponent(email)}${about(item)}`, {
      method: 'DELETE',
      token,
    }),

  /** Letting yourself out of a space somebody shared. The owner's own space
   *  cannot be left, only deleted. */
  leaveSpace: (token: string, id: string) =>
    request<{ ok: true }>(`/v1/spaces/${id}/share/me`, { method: 'DELETE', token }),

  /** The files somebody shared on their own, which belong to no space this
   *  account can reach: what the switcher's Shared-with-you section is drawn
   *  from. A guest reads the same. */
  shared: (token: string) => request<{ shared: SharedItem[] }>('/v1/shared', { token }),

  /** And handing one back, which is the same act as leaving a space: what
   *  somebody was given is theirs to give up. */
  leaveShared: (token: string, noteId: string) =>
    request<{ ok: true }>(`/v1/shared/${encodeURIComponent(noteId)}`, {
      method: 'DELETE',
      token,
    }),

  /** What a link leads to. No session: this is what the page shows somebody who
   *  has not signed in, which is most of the people who follow one. */
  invitation: (key: string) => request<Invitation>(`/v1/join/${key}`),

  /** Walking through it, which is also how somebody waiting asks again.
   *
   *  Everything is optional. Without a session the link itself is the proof, and
   *  what comes back is one: an invitation opens the account it was written to,
   *  and the space's own link hands out a guest. `device` is what to call that
   *  guest, and `name` or `email` is the one field a link that asks first asks
   *  for. */
  join: (
    key: string,
    options: { token?: string; device?: string; name?: string; email?: string } = {},
  ) =>
    request<Joined>(`/v1/join/${key}`, {
      method: 'POST',
      ...(options.token ? { token: options.token } : {}),
      body: {
        ...(options.device ? { device: options.device } : {}),
        ...(options.name ? { name: options.name } : {}),
        ...(options.email ? { email: options.email } : {}),
      },
    }),

  changes: (token: string, spaceId: string, since: number) =>
    request<{ notes: RemoteNote[]; cursor: number; more: boolean }>(
      `/v1/spaces/${spaceId}/changes?since=${since}`,
      { token },
    ),

  createNote: (token: string, spaceId: string, path: string, content: string) =>
    request<{ note: RemoteNote }>(`/v1/spaces/${spaceId}/notes`, {
      token,
      body: { path, content },
      device: true,
    }),

  readNote: (token: string, id: string) =>
    request<{ note: RemoteNote; content: string }>(`/v1/notes/${id}`, { token }),

  writeNote: (token: string, id: string, path: string, content: string, baseVersion: number) =>
    request<{ note: RemoteNote }>(`/v1/notes/${id}`, {
      method: 'PUT',
      token,
      body: { path, content, baseVersion },
      device: true,
    }),

  /** Every version the account holds of one note, newest first, and what one of
   *  them said. The device's own history is `list_snapshots`; see History.svelte,
   *  which shows the two as one list. */
  noteVersions: (token: string, id: string) =>
    request<{ versions: RemoteVersion[] }>(`/v1/notes/${id}/versions`, { token }),

  noteVersion: (token: string, id: string, at: number) =>
    request<{ at: number; content: string }>(`/v1/notes/${id}/versions/${at}`, { token }),

  /** A space, or one folder of it, back to how it read at a moment. `dry` asks
   *  what would change and changes nothing. */
  /** Putting a space back to a moment. Bounded on the server, so `partial` says
   *  there is more to do and `left` how much; see SyncPane's `roll`. */
  rollback: (token: string, spaceId: string, at: number, under = '', dry = false) =>
    request<{
      notes: number
      paths?: string[]
      more?: boolean
      partial?: boolean
      left?: number
    }>(`/v1/spaces/${spaceId}/rollback`, {
      token,
      body: { at, under, dry },
      device: true,
    }),

  deleteNote: (token: string, id: string) =>
    request<{ ok: true }>(`/v1/notes/${id}`, { method: 'DELETE', token }),

  // Recently deleted.
  trash: (token: string) => request<TrashListing>('/v1/trash', { token }),
  restoreNote: (token: string, id: string) =>
    request<{ note: RemoteNote }>(`/v1/trash/notes/${id}/restore`, { method: 'POST', token }),
  restoreSpace: (token: string, id: string) =>
    request<{ space: RemoteSpace }>(`/v1/trash/spaces/${id}/restore`, { method: 'POST', token }),
  purgeNote: (token: string, id: string) =>
    request<{ ok: true }>(`/v1/trash/notes/${id}`, { method: 'DELETE', token }),
  purgeSpace: (token: string, id: string) =>
    request<{ ok: true }>(`/v1/trash/spaces/${id}`, { method: 'DELETE', token }),
  emptyTrash: (token: string) => request<{ ok: true }>('/v1/trash', { method: 'DELETE', token }),

  /** `space` is the one being published: a name it already holds is free for
   *  it, and would otherwise read as taken by itself. */
  subdomainAvailable: (token: string, subdomain: string, space?: string) =>
    request<{ available: boolean; reason?: string }>(
      `/v1/spaces/available/${subdomain}${space ? `?space=${encodeURIComponent(space)}` : ''}`,
      { token },
    ),

  publish: (
    token: string,
    spaceId: string,
    settings: { subdomain?: string; domain?: string; title?: string; note?: string | null },
  ) =>
    request<{ space: RemoteSpace; dns: DnsRecord[] }>(`/v1/spaces/${spaceId}/blog`, {
      method: 'PUT',
      token,
      body: settings,
    }),

  unpublish: (token: string, spaceId: string) =>
    request<{ ok: true }>(`/v1/spaces/${spaceId}/blog`, { method: 'DELETE', token }),

  /** What the site decides, written whole. Every field is optional and what is
   *  left out stays as it was, except `password: null`, which is how taking one
   *  off is said. */
  site: (
    token: string,
    spaceId: string,
    settings: {
      rules?: SiteSettings['rules']
      description?: string
      image?: string
      icon?: string
      theme?: { name: string; hash: string } | null
      analytics?: { url: string; domain?: string } | null
      password?: string | null
    },
  ) =>
    request<{ space: RemoteSpace; site: SiteSettings }>(`/v1/spaces/${spaceId}/site`, {
      method: 'PUT',
      token,
      body: settings,
    }),

  /** What the forms on a site have collected, newest first, and the same as a
   *  file for a spreadsheet. */
  answers: (token: string, spaceId: string) =>
    request<{ answers: FormAnswer[]; more: boolean }>(`/v1/spaces/${spaceId}/answers`, { token }),

  answersCsv: async (token: string, spaceId: string) => {
    const response = await fetch(`${BASE}/v1/spaces/${spaceId}/answers.csv`, {
      headers: { authorization: `Bearer ${token}` },
    })

    if (!response.ok) throw new ApiError(response.status, 'could not read the answers')
    return response.text()
  },

  forgetAnswer: (token: string, spaceId: string, id: string) =>
    request<{ ok: true }>(`/v1/spaces/${spaceId}/answers/${id}`, { method: 'DELETE', token }),

  /** And what those rules would change, before they are written. */
  sitePreview: (token: string, spaceId: string, rules: SiteSettings['rules']) =>
    request<SiteChanges>(`/v1/spaces/${spaceId}/site/preview`, {
      method: 'POST',
      token,
      body: { rules },
    }),

  domainStatus: (token: string, spaceId: string) =>
    request<DomainStatus>(`/v1/spaces/${spaceId}/blog/domain`, { token }),

  /** Saying the record is in place. The server reads it there and then, so this
   *  is what turns a claimed domain into one that serves. */
  verifyDomain: (token: string, spaceId: string) =>
    request<DomainStatus>(`/v1/spaces/${spaceId}/blog/domain/verify`, {
      method: 'POST',
      token,
    }),

  /** The clients that signed in through the connector, and whether a pasted
   *  token exists. The secret itself is never handed back. */
  connector: (token: string) =>
    request<{
      exists: boolean
      readOnly: boolean
      lastUsedAt: number | null
      clients: {
        id: string
        name: string
        readOnly: boolean
        createdAt: number
        lastUsedAt: number | null
      }[]
    }>('/v1/mcp/token', { token }),

  disconnectClient: (token: string, id: string) =>
    request<{ ok: true }>(`/v1/mcp/clients/${id}`, { method: 'DELETE', token }),

  issueConnector: (token: string, readOnly: boolean) =>
    request<{ token: string }>('/v1/mcp/token', { token, body: { readOnly } }),

  revokeConnector: (token: string) =>
    request<{ ok: true }>('/v1/mcp/token', { method: 'DELETE', token }),
}

/** Where an LLM client points to reach these notes. */
export const MCP_URL = `${BASE}/mcp`
