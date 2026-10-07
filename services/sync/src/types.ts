import type { Scope } from './spaces/share'
import type { Reached } from './spaces/space'

export interface Env {
  DB: D1Database
  NOTES: R2Bucket

  /** One room per note being written in by more than one device; see
   *  rooms/room.ts. Absent in the route tests, which reach the room class
   *  directly rather than through a namespace. */
  ROOMS?: DurableObjectNamespace

  /** One hub per account (and per guest): the socket every signed-in device keeps
   *  open, for pokes, web leases and the web key's relay; see hub/hub.ts. Absent in
   *  the route tests that do not ask for it, and every caller copes: a poke with no
   *  hub is a poke nobody hears, which polling covers. */
  HUB?: DurableObjectNamespace

  /** One `ChatLog` per chat (docs/chats.md 4.3): its log, its messages and its sockets.
   *  Where it is absent a chat's routes answer that the chat is not answering, and the
   *  tests that need one hand in their own; see chats/log.ts. */
  CHATS?: DurableObjectNamespace

  /** One `Machine` per online terminal machine (docs/online-terminal.md): where it is
   *  absent, the online routes answer 404. See machines/. */
  MACHINES?: DurableObjectNamespace
  /** Where the machines' homes are backed up (4.3): an R2 bucket in the EU jurisdiction,
   *  bound beside `MACHINES`. */
  HOMES?: R2Bucket
  /** How a machine's traffic leaves it, `open` (the default) or `web`; see
   *  machines/host.ts `egressOf`. */
  MACHINE_EGRESS?: string
  /** A `nibd` on this computer to drive instead of a container, and its link secret, for
   *  an end-to-end drive under `wrangler dev`; set only in `.dev.vars`. See
   *  machines/host.ts `DevHost`. */
  MACHINE_DEV_NIBD?: string
  MACHINE_DEV_SECRET?: string

  /** Hetzner machines (docs/online-terminal.md 4.15), each a secret the manager sets:
   *  the Hetzner Cloud project's API token, and a Cloudflare token that may edit Cloudflare
   *  Tunnels on the account and DNS on the zone. With either missing, a Hetzner machine is
   *  refused a start and says so to the admin route; see machines/hetzner-host.ts. */
  HETZNER_TOKEN?: string
  MACHINE_TUNNEL_TOKEN?: string
  /** The Cloudflare account the tunnels are made in. Not a secret. */
  CF_ACCOUNT_ID?: string
  /** The Access service token the link to a Hetzner machine is sent with (secrets), and
   *  the Access team and application audience `cloudflared` checks it against (vars).
   *  Optional: without them the link is guarded by `nibd`'s own secret alone. */
  MACHINE_ACCESS_ID?: string
  MACHINE_ACCESS_SECRET?: string
  MACHINE_ACCESS_TEAM?: string
  MACHINE_ACCESS_AUD?: string

  /** Root domain that hands out free blog subdomains. */
  BLOG_ROOT: string
  /** The host a domain of one's own is CNAMEd to. One fixed name inside
   *  BLOG_ROOT that publishes nothing itself; its label is reserved. Also the
   *  zone's fallback origin for Cloudflare for SaaS. */
  BLOG_CNAME_TARGET: string
  APP_ORIGIN: string

  /** Cloudflare for SaaS, which issues certificates for domains people bring:
   *  the zone that holds the custom hostnames, and a token allowed to edit
   *  them. Absent in tests and local development, where a domain is recorded
   *  and no certificate is asked for. */
  CF_ZONE_ID?: string
  CF_API_TOKEN?: string

  /** The built web app. Absent in tests, which never ask for it. */
  ASSETS?: { fetch(request: Request): Promise<Response> }

  /** Cloudflare Email Sending. Absent in tests, where codes are logged. */
  EMAIL?: EmailSender
  MAIL_FROM?: string

  /** Workers AI, which is what listens for an account with no OpenAI key of its own;
   *  see ask/heard.ts. Absent in tests, which hand in a fake, and in a Worker that has
   *  not had the binding added - and a plugin then simply hears nothing. */
  AI?: { run(model: string, input: unknown): Promise<unknown> }

  /** What the account's OpenAI key is encrypted under; see ask/key.ts.
   *
   *  Set with `wrangler secret put OPENAI_KEY_SECRET`. Without it the Worker
   *  refuses to store a key rather than storing one in the clear, and the settings
   *  pane says the server cannot keep one yet - which is the right way round: a key
   *  somebody believes is encrypted and is not is worse than no key. */
  OPENAI_KEY_SECRET?: string

  /** What the second factor's authenticator secrets are encrypted under; see
   *  second.ts. A secret of its own so that rotating either leaves the other
   *  working. Set with `wrangler secret put SECOND_FACTOR_SECRET`; until it is,
   *  factors are sealed under `OPENAI_KEY_SECRET` as they were, and once it is they
   *  move across on their next use and on the next nightly run. */
  SECOND_FACTOR_SECRET?: string

  /** Push to the devices that registered for it (src/push): Web Push to the browser
   *  build, FCM to Android, APNs to an iPhone. Each service is off until its keys are
   *  set, and a target on a service that is off is simply not pushed to. See
   *  docs/mobile.md, "Push", for what each one is and how it is made.
   *
   *  The VAPID key pair, base64url: the public point (a var, which the browser build
   *  subscribes with) and the private scalar (a secret), and who to write to about them. */
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT?: string
  /** The JSON key of the Firebase project's service account, as Google hands it out. */
  FCM_SERVICE_ACCOUNT?: string
  /** The `.p8` key APNs tokens are signed with, its id, the team's id and the app's
   *  bundle id; `APNS_SANDBOX` is `true` for a development build. */
  APNS_KEY?: string
  APNS_KEY_ID?: string
  APNS_TEAM_ID?: string
  APNS_TOPIC?: string
  APNS_SANDBOX?: string
}

/** The `send_email` binding's surface, which workers-types does not yet cover. */
export interface EmailSender {
  send(message: {
    from: string | { name: string; email: string }
    to: string | string[]
    subject: string
    text?: string
    html?: string
  }): Promise<{ messageId?: string }>
}

export interface User {
  id: string
  email: string
  /** Shown on anything the account publishes. Null until chosen. */
  name: string | null
  created_at: number
}

/** Somebody a share link let in, with no account. Reaches the spaces its links
 *  granted and nothing else; see src/guests.ts. */
export interface Guest {
  id: string
  /** What the carets and the Share sheet call them. Never null: a guest is
   *  given a name from the device it arrived on, and renames it from there. */
  name: string
  /** What a link that asks first asked for, unverified. A label, not a
   *  credential. */
  email: string | null
  created_at: number
}

/** Whoever a request is from. Every route that names a space asks this and
 *  nothing more: what may this person do here. */
export type Whoever = { kind: 'user'; user: User } | { kind: 'guest'; guest: Guest }

export interface Space {
  id: string
  user_id: string
  name: string
  /** Where it sits in the rail. Ties are broken by created_at. */
  position: number
  /** The name of the icon the rail shows, if one was chosen. */
  icon: string | null
  /** The colour that icon is drawn in, as one of the app's own accents by its id;
   *  see spaces/icons.ts. Null for the plain foreground, which is every space that
   *  never chose one. */
  tint: string | null
  /** A deleted space stays as a marker, so every machine learns it went. */
  deleted: number
  created_at: number
  updated_at: number
  blog_enabled: number
  blog_subdomain: string | null
  blog_domain: string | null
  /** What the owner puts in a TXT record to show the domain is theirs, and when
   *  that record was last seen there. Null until a domain is claimed; the stamp
   *  stays null until it is proved, which is also what says it may serve. See
   *  spaces/proof.ts. */
  blog_domain_token: string | null
  blog_domain_verified_at: number | null
  blog_title: string | null
  /** When set, the only note published, shown at the root. */
  blog_note: string | null
  /** What is kept above the space's file list, as a JSON array; see
   *  spaces/bookmarks.ts. `[]` until something is. */
  bookmarks: string
  /** The files of the space that are not notes, as a JSON array; see
   *  spaces/files.ts. `[]` until there are any. */
  files: string
  /** Which folder of the space's tree wears which icon, as a JSON map keyed by
   *  the folder's path; see spaces/icons.ts. `{}` until one does. */
  icons: string
  /** And the colour each of those icons is drawn in, under the same keys. Its own
   *  map rather than a second value in the one above, so that a build older than
   *  this one reads the icons it knows and writes them back without dropping a
   *  colour it cannot read. `{}` until one is chosen. */
  tints: string
  /** How the space's graph is drawn, as one JSON object; see spaces/graph.ts.
   *  `{}` until something about it is changed. */
  graph: string
  /** The notes and folders the space leaves out of its search, its graph and its
   *  unlinked mentions, as a JSON array of paths; see spaces/excluded.ts. `[]`
   *  until one is. */
  excluded: string
  /** The order somebody arranged the rows of a folder into, as a JSON map keyed by
   *  the folder's path, with the ordered names of its children under each; see
   *  spaces/arranged.ts. `{}` until a row is dragged, and holding only the folders
   *  where one was: everything a list leaves out falls to the end in name order. */
  arranged: string
  /** What the space has archived, as a JSON map of path to moment: positive while
   *  archived, negative once taken back; see spaces/archived.ts. `{}` until something
   *  is put away. */
  archived: string
  /** What the site made of this space decides, as one JSON object; see
   *  spaces/site.ts. `{}` until something about it is chosen. */
  site: string
  /** Which web store its pages live in on every computer; see spaces/web-store.ts.
   *  `global` until the owner chooses. Optional because a space made in this very
   *  request has not been read back, and it is `global` then too. */
  web_store?: string
  /** When a v2 device first asked for its tree as rows; null before. From then on
   *  every write that places a note keeps the rows current; see src/sync2/prepare.ts.
   *  Optional for the same reason as the web store. */
  prepared_at?: number | null
  /** When it went to Recently deleted; null while alive, and again once purged. */
  deleted_at: number | null
}

export interface Note {
  id: string
  space_id: string
  path: string
  seq: number
  version: number
  updated_at: number
  deleted: number
  /** When it went to Recently deleted; null while alive, and again once purged. */
  deleted_at: number | null
  size: number
  hash: string
  /** What the note says about its own page, as JSON; see blog/front.ts. Null for
   *  a note that says nothing, and for one last written before the site read
   *  such things at all. */
  front: string | null
  /** Sync v2's tree and document (migration 0040): the folder it is in and its name
   *  there, what kind of entry it is, the epoch of its document and the hash of the
   *  text that epoch was seeded from, and the cursor and device of its latest content
   *  change and of its latest change of any sort. Optional because a note is also
   *  made in memory before it is read back, and a space nobody prepared has none of
   *  the tree's columns filled; see src/sync2/. */
  folder_id?: string | null
  name?: string | null
  name_key?: string | null
  kind?: string
  epoch?: number
  epoch_base?: string | null
  doc_seq?: number | null
  doc_by?: string | null
  updated_by?: string | null
  deleted_in?: number | null
}

/** What the session guard puts on the request for the routes behind it, and
 *  what `atLeast` adds for a route that names a space.
 *
 *  `who` is always there; `user` and `guest` are the two halves of it, and each
 *  is set only on a request that is the one kind. A route reads whichever it
 *  needs: `who` where it only has to reach a space, `user` where it is about
 *  the account itself - and those routes are closed to a guest, which is what
 *  makes reading it safe. `space` has always worked that way, being set only
 *  behind `atLeast`. */
export interface Variables {
  /** Whoever is asking. `program` is set where that is an `nib_` token acting
   *  for the account rather than somebody at a keyboard; a program is the
   *  account for the routes it may reach, and the flag is for the two places
   *  where being the account is not enough. See index.ts and programs.ts. */
  who: Whoever & { program?: true; readOnly?: boolean }
  user: User
  guest: Guest
  space: Reached
  /** What one share is about: the space, or one file of it. Set only behind
   *  `about()` in spaces/share.ts, the way `space` is set only behind
   *  `atLeast`. */
  scope: Scope
}
