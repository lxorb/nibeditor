# Chats

A design and a plan. It decides how nib gets a new kind of document, the chat: a channel
people write in together, as Slack's channels, Discord's text channels and a WhatsApp group
are, kept in a space beside the notes, readable as markdown, and reachable by the agent.
Section 6 is the plan the lanes build from.

Emil, 2026-10-03:

> As a new note type, I want chats. You can create a chat, and it is essentially the same as
> a Discord channel or a Slack channel. Think about literally everything that Discord, Slack
> or WhatsApp provide, from the users' perspective, and the features we should add to make
> that channel feel really nice, like an actual Slack/Discord channel. Hence people should be
> able to set a profile picture.

Read with `docs/sync-v2.md` (the hub, rooms, tree ids and blobs this builds on),
`docs/collaboration.md` and `docs/sharing.md` (roles, guests, item shares),
`docs/agent-native.md` (the verbs, grants and what an agent always asks first),
`docs/ai-sidebar.md` (the panel the agent lives in), `docs/tasks.md` (a message becomes a
task through its quick add) and `docs/design.md` (the shapes). Nothing here loosens any of
them.

## The short version

1. **A chat is a document in a space**, `Team.chat`, made from Ctrl+T's new Chat card or the
   file list's New, renamed, moved, bookmarked, archived and shared like a note. Everybody
   who can reach the space can reach its chats; a chat shared on its own (an item share,
   `docs/sharing.md`) is a private channel. A **direct message** is a chat between people
   that belongs to no space.
2. **The log is the truth, the markdown is its shadow.** Every chat is an append-only log of
   events (post, edit, delete, react, pin, vote) held by one Durable Object per chat,
   `ChatLog`, which gives every event its place in one order. Every device keeps the whole log
   in its sync store and writes it into the space as **month files of plain markdown**,
   `Team.chat/2026-10.md`: who, when, the words, a block id per message. Obsidian, git, grep,
   nib's search, the link index and the agent read those. Nothing ever reads them back.
3. **Not a CRDT, on purpose.** A chat is many short messages each with one author, so a
   server order and last-writer-wins per message is exact, where a Yjs document of 100,000
   messages would be a document nobody could open. Offline, messages wait in an outbox with
   ids of their own and are placed when they arrive; a reaction is a set, an edit is the
   author's, a delete wins.
4. **Live by the sockets nib already has.** An open chat holds a hibernating socket to its
   `ChatLog`, for messages, typing and who is here; every other chat hears through the
   account's hub as a poke with its new count, as notes already do. Nothing is polled.
5. **Not end-to-end encrypted by default**, as Slack, Discord and Teams are not, and as nib's
   notes are not: the server reads a chat so it can push a preview to a phone, the account
   connector can answer from it with nib closed, and search covers years. A secret chat with
   end-to-end encryption (MLS, RFC 9420) is later and decision 7.3.
6. **Everything Slack and Discord do that a channel needs**: markdown typed and drawn as it is
   written (the composer is a small nib editor), replies in a side pane, quotes, edits with
   "edited", delete for everyone, reactions with who reacted, @people, @here and @everyone,
   pins, saved messages, scheduled send, drafts per chat, files to 64 MB and more in parts,
   galleries, video, voice messages with a waveform and a transcript, link previews made by
   the sender, polls, typing, presence, custom status, unread lines, jump to unread, read
   receipts in small chats, per-chat notifications, keywords, a quiet schedule, search with
   `from:`, `in:`, `has:`, and message links.
7. **A profile is a picture, a name and a line.** The account gains an avatar (picked, dropped,
   pasted or taken with the camera, cropped in a round mask, kept as two small WebP blobs),
   pronouns, a short bio, a status with an emoji and a time it clears, and a nickname per
   space. The avatar is shown wherever a person is: messages, members, mentions, reactions,
   receipts, the share sheet, carets in a shared note, the tab's people, and under the
   agent's mark when it writes for somebody.
8. **One with the notes.** Quote a selection or drop a note into a chat (members who cannot
   open it are offered a share in one press); `[[` mentions a note and makes a backlink; a
   message becomes a task through quick add, or a note, each linking back to the message;
   search finds messages beside notes.
9. **The agent is a member, under the grant.** `nib mcp` and the account connector gain
   `list_chats`, `read_chat`, `search_chats`, `post_message`, `react` and `draft_message`.
   Reading is `chats.read`; posting where anybody else reads is Publishing in
   `docs/agent-native.md` 9.3 and asks first unless the reader allowed it for that chat; a
   draft into the composer never asks, because the reader presses Send. In a chat, `@nib`
   asks the asker's own agent, on their machine, and its answer is posted as theirs.
10. **Notifications reach the phone.** Desktop notifications from the hub while nib runs (and
    from the tray when the window is closed); phones and the browser build through push from
    the Worker (FCM, APNs, Web Push), built once for chats and tasks' reminders together
    (decision 7.4). A phone stays quiet while a desktop is in use.
11. **Fast at any size.** The first paint does not grow. A chat of 100,000 messages opens at
    its unread line in one frame from the device's store, renders a window of rows, and pages
    from the store as the reader scrolls; typing sends nothing but a typing frame every three
    seconds.
12. **Counted**: of the 117 features in section 3, 63 are must, 29 should, 14 later and 11
    dropped, each with its reason. Calls, video and screen share are later (decision 7.6).

---

## 1. What it is for

Three readers, one need. A small team or a family that shares a nib space and today keeps
the conversation about it in a second app; somebody who writes alone and wants a running log
to throw links, pictures and thoughts into (Signal's Note to Self, Telegram's Saved
Messages); and two people who just want to message each other without leaving the place
their work is. Each of them wants the conversation next to the notes it is about, on every
device, searchable, readable by their agent, and not locked in somebody else's database.

What matters to them, in order:

1. **It feels like a real chat.** A message appears for the others the moment it is sent,
   typing shows, a picture is a picture, a reply is one press, and the keys are the ones
   their fingers know from Slack and Discord.
2. **Nothing is missed and nothing nags.** An unread line, a count that is right on every
   device, a notification on the device in their hand and on no other, and a way to make a
   busy chat quiet.
3. **The conversation and the work are one place.** A message about a note links to it; a
   decision in a chat becomes a task; a note can be dropped in to discuss it.
4. **It is theirs.** History forever, on their disk as markdown, exportable, and gone when
   they delete it.
5. **People look like people.** A face and a name beside every message, and a profile card
   one press away.
6. **It never slows nib down.** A busy chat costs the editor nothing.

## 2. What others do

### 2.1 By product

Each product's own help centre, read 2026-10-03; the links are in Sources.

| product | does well | does badly |
| --- | --- | --- |
| **Slack** ([format][sl-format], [edit][sl-edit], [threads][sl-threads], [unread][sl-unread], [search][sl-search], [schedule][sl-schedule], [save][sl-save], [pins][sl-pins], [status][sl-status], [links][sl-links], [notifications][sl-notif], [DND][sl-dnd], [keys][sl-keys], [agents][sl-agents], [AI][sl-ai]) | threads with "also send to channel" and a Threads view; Ctrl+K switcher; Alt+Shift+↑/↓ through unread chats; Ctrl+J to the first unread; Unsend with Ctrl+Z for 15 s; scheduled send and a Drafts & sent list; Later with reminders; status that clears itself; keyword notifications and a notification schedule; search modifiers (`from:`, `in:`, `has:`, `before:`, `during:`, `is:thread`); agents added to a channel and @-mentioned; recaps of unread chats | history beyond 90 days paid; a WYSIWYG toolbar where markdown half-works; threads hide conversations people then miss; notification settings in four places |
| **Discord** ([markdown][dc-md], [forward][dc-forward], [voice][dc-voice], [polls][dc-polls], [forums][dc-forums], [threads][dc-threads], [profiles][dc-profiles], [nicknames][dc-nick], [roles][dc-roles], [channel permissions][dc-chperm], [timeout][dc-timeout], [AutoMod][dc-automod], [storage][dc-storage]) | real markdown with headings, subtext, spoilers and highlighted code; per-server nickname and (paid) avatar; pronouns, About me and banner; voice messages; polls with durations; forwarding with a note; forum channels for long topics; slowmode and timeouts; roles with channel overwrites; history kept forever; messages stored per channel in time buckets with sortable ids | roles and overwrites are a system to learn; the client is heavy; profiles are a shop (Nitro); no scheduled send; forwarding strips the author |
| **WhatsApp** ([delete][wa-delete], [edit][wa-edit], [multi-device][wa-multi], [transcripts][wa-transcripts], [polls][wa-polls]) | swipe to reply with the quote inline; voice messages with a waveform and on-device transcripts; read ticks; delete for everyone within two days with "This message was deleted"; edits for 15 minutes; end-to-end encryption on every device | the phone is the account's centre of gravity; search is weak; no threads; big groups are noise |
| **Telegram** ([FAQ][tg-faq], [scheduled][tg-scheduled]) | Saved Messages as a chat with yourself; scheduled and silent messages; edit in channels with no limit; folders of chats; the fastest client of all of them | cloud chats are not end-to-end encrypted while the brand suggests they are; edit and delete windows differ by chat kind |
| **Signal** ([receipts][sg-receipts], [typing][sg-typing], [note to self][sg-self], [edit][sg-edit], [link previews][sg-previews], [GIFs][sg-giphy]) | read receipts and typing indicators each a switch, and reciprocal (off means you see nobody's either); link previews made by the sender through a proxy so the server never sees the address; GIF search through a proxy; edits, 10 in 24 hours, shown as edited with the history | no threads, no search filters, small groups in mind |
| **Microsoft Teams** ([Loop][ms-loop], [announcements][ms-announce], [important][ms-important], [read receipts][ms-receipts]) | Loop components: a live, editable block inside a message; announcements with a headline; Important and Urgent delivery | two chat models (channels and chats) that behave differently; heavy |
| **Matrix / Element** ([threads][mx-threads], [security][el-security], [MLS][mls]) | an open protocol; threads with their own read receipts; spaces are rooms; cross-signing and key backup for encryption across devices | encrypted history on a new device is a recurring failure ("unable to decrypt"); federation makes ordering and moderation hard |

### 2.2 What nib takes, and what it leaves

- **Takes**: Slack's threads with "also send to the chat" (as **replies**, the word its
  button already shows), its keys, Unsend, scheduled send, Later, status that clears,
  keywords, the quiet schedule and search modifiers; Discord's markdown, per-space nickname,
  pronouns and bio, polls, forwarding with a note, voice messages, the author kept on a
  forward that Discord drops, and its storage shape (a log per channel, ordered by id);
  WhatsApp's swipe-to-reply quote, waveform, on-device transcript and delete for everyone;
  Telegram's chat with yourself and its speed; Signal's reciprocal receipts and typing
  switches and its sender-made link previews; Teams' live block, as a live note card;
  Matrix's per-reply read state.
- **Leaves**: roles with channel overwrites (a space has three roles and that is enough);
  Nitro-style shop items (animated avatars, super reactions, banners as a product);
  stickers; forum channels (a note is the long-form answer); announcements and "urgent"
  repeat pings; disappearing messages on a chat the server can read anyway; a bot
  marketplace, where `nib mcp`, the connector and program tokens are the integration.

## 3. Every feature, marked

**must** ships in the first round of lanes, **should** in the same lanes after the musts,
**later** waits for a reason given, **drop** is a decision. "Best at" names who does it best.

| # | feature | best at | nib | mark | why |
| --- | --- | --- | --- | --- | --- |
| | **Messages** | | | | |
| 1 | Markdown typed and drawn | Discord | the composer is a small nib editor with live preview: bold, italic, strike, code, links, lists, quotes, headings, tables, math; a sent message is drawn by the reading view's renderer | must | nib is a markdown editor; one renderer |
| 2 | Formatting toolbar | Slack | the editor's format bar on a selection in the composer (`FormatBar.svelte`) | should | exists; markdown covers it first |
| 3 | Code blocks with a language | Discord | fenced code, highlighted as in notes, a copy button | must | free from the renderer |
| 4 | Spoilers `\|\|x\|\|` | Discord | drawn blurred until pressed; written as-is in the transcript | should | small; not markdown elsewhere |
| 5 | Subtext `-#` | Discord | none | drop | not markdown anywhere else; Obsidian would show the marks |
| 6 | Enter sends, Shift+Enter a new line, a long message grows the field | Slack | the same; inside a fence or a list Enter continues it, Ctrl+Enter sends | must | the habit |
| 7 | Edit your own message, "edited" | Slack | no time limit; "edited" after the words; the history kept and shown to members on the mark's hover | must | Slack has no limit; Signal's 24 h protects nothing on a server-read chat |
| 8 | Edit the last message with ↑ | Slack | ↑ in an empty composer | must | the habit |
| 9 | Delete for everyone | WhatsApp | your own any time, the owner's on anybody's; the row goes, and a message with replies leaves a quiet "deleted" line so the replies keep their place | must | |
| 10 | Unsend for 15 s | Slack | Ctrl+Z in the composer within 15 s takes the last message back into the field | should | cheap; the regret window |
| 11 | Delete for me | WhatsApp | none | drop | a channel is one shared history; mute and hide cover the need |
| 12 | Quote reply | WhatsApp | swipe right (phone) or R on a row: the quoted line above the new message, a press jumps to it | must | |
| 13 | Replies in a side pane (threads) | Slack | "Reply" opens the replies pane on the right; "also send to the chat" | must | the shape of a busy channel |
| 14 | Replies I follow, in one list | Slack | the Activity view's Replies tab (#69) | should | after the pane |
| 15 | Forward with a note | Discord | to up to five chats, the author and a link kept for members of the source | should | |
| 16 | Pin | Slack | per chat, a pin list in the chat's head | must | |
| 17 | Save for later | Slack | a message bookmark (bookmarks exist); the Saved list in the Chats panel | must | |
| 18 | Remind me about a message | Slack | "Remind me" makes a task with a reminder linking the message (`docs/tasks.md` 5.10) | should | tasks owns reminders |
| 19 | Scheduled send | Slack | the send button's menu; held by `ChatLog` with an alarm, editable until it goes | should | a server alarm is cheap |
| 20 | Draft per chat | Slack | kept per chat on the device, and in the account settings so the phone has it | must | |
| 21 | Drafts & sent list | Slack | none | later | after scheduled send proves it is wanted |
| 22 | Mark unread | Slack | Alt+click or the row's menu; the line moves up | must | |
| 23 | Silent message | Telegram | none | later | rare |
| 24 | Important, urgent | Teams | none | drop | a repeated ping is the opposite of calm |
| 25 | Announcement post | Teams | none | drop | a chat where only the owner posts (#83) is the announcement channel |
| 26 | Copy link to a message | Slack | `nib://chat/<chat>/<message>`, and the transcript's `[[Team.chat/2026-10#^m…]]` | must | |
| 27 | Translate a message | WhatsApp | through the AI sidebar's provider | later | needs a provider |
| 28 | Disappearing messages | Signal | none | drop | meaningless where the server and the transcript keep it |
| 29 | Live block in a message | Teams | a note dropped in is a live card (#108) | should | nib's version of Loop |
| | **Reactions** | | | | |
| 30 | Emoji reactions, recent ones first | Slack | the hover bar's three recent, then the picker; a reaction pressed again is taken back | must | |
| 31 | Who reacted | Slack | hover or long press: avatars and names | must | |
| 32 | Emoji picker with search and skin tone | Slack | one picker for the composer and reactions, emoji data fetched on first open | must | |
| 33 | `:shortcode:` completion | Slack | in the composer, `:` and two letters | must | |
| 34 | Custom emoji per space | Slack | owner uploads a square picture with a name; a blob like any other | should | |
| 35 | Super reactions, animated | Discord | none | drop | a shop item |
| | **Mentions** | | | | |
| 36 | @person with completion | Slack | the chat's members, avatar and name; written `@Lucile` with the id kept in the event | must | |
| 37 | @here, @everyone | Discord | @here reaches members with a device active; @everyone all; above ten people the composer asks once before sending | must | |
| 38 | Role and group mentions | Discord | none | later | nib has three roles and no groups |
| 39 | Keyword notifications | Slack | words in Settings, highlighted in the message | should | |
| | **Attachments** | | | | |
| 40 | Files by drop, paste, pick | Slack | to 64 MB in one request, larger in 8 MB parts (sync v2 blobs) | must | the routes exist |
| 41 | Pictures inline, several as a gallery | WhatsApp | one picture full width to a cap, two to six as a grid, more as a grid with +N; a lightbox with arrows | must | |
| 42 | Video inline | Discord | played in place, poster frame made by the sender | must | |
| 43 | Audio files | Discord | the voice message player (#44) | must | |
| 44 | Voice messages with a waveform | WhatsApp | hold the microphone (or Ctrl+Shift+M): the recorder, Opus; 64 bars made by the sender; 1×, 1.5×, 2× | must | the recorder exists |
| 45 | Voice message transcript | WhatsApp | on the reader's own device through the existing transcriber | should | exists |
| 46 | Link previews | Slack | made by the sender's device (Signal's way), title, site, picture; off per message (✕) or in Settings | must | |
| 47 | GIF search | Signal | none | later | a third party (Tenor, GIPHY) and a proxy to keep searches anonymous |
| 48 | Stickers | WhatsApp | none | drop | a shop item |
| 49 | Polls | Discord | single or several answers, an end time, results live, voters named | should | |
| 50 | Long paste as a file | Slack | past 4,000 characters the composer offers to send it as a `.md` file | should | |
| 51 | PDF preview | Slack | the first page as the card; opens in nib's PDF view | should | `Pdf.svelte` exists |
| | **Presence and reading** | | | | |
| 52 | Typing | every one | "Lucile is typing" in the composer's foot; at most one frame every 3 s | must | |
| 53 | Online, away, offline | Slack | a dot on the avatar: active, idle, not connected; from the hub | must | the hub knows |
| 54 | Appear offline | Discord | a status that sends no presence | should | |
| 55 | Custom status with emoji, clears after | Slack | an emoji and a line, cleared after 30 min, 1 h, 4 h, today, this week or never | should | |
| 56 | Do not disturb | Slack | a status and the quiet schedule (#65) | must | |
| 57 | Read receipts, "seen by" | WhatsApp | in DMs and chats of up to ten people, avatars under the last message each has read; a switch in Settings, reciprocal as Signal's | should | privacy first, then the feature |
| 58 | Sending, sent | WhatsApp | a faint clock while in the outbox, nothing once placed | must | the one state that matters |
| 59 | Delivered ticks | WhatsApp | none | drop | every device of a member reads the same log; "delivered" says nothing |
| 60 | New-messages line | Slack | a thin line in the accent with "New" at the reader's last read place | must | |
| 61 | Jump to unread | Slack | a pill at the top when the line is off screen; Ctrl+J | must | |
| 62 | Unread counts, mention badges | Discord | bold row and a count in the Chats panel; mentions as a badge in the accent | must | |
| 63 | Read state across devices | Slack | the read place is the account's, kept by `ChatLog` | must | |
| | **Notifications** | | | | |
| 64 | Per chat: all, mentions, nothing; mute until | Slack | the bell in the chat's head; DMs default to all, chats of more than ten to mentions | must | |
| 65 | Quiet schedule | Slack | days and hours in Settings; outside them nothing pings, counts still move | should | |
| 66 | Desktop notification | Slack | the system's, with the avatar; a press opens the message | must | |
| 67 | Reply from the notification | WhatsApp | inline reply where the system has it (Windows, macOS, Android) | should | |
| 68 | Phone push | WhatsApp | FCM, APNs and Web Push from the Worker; quiet while a desktop is active | must | decision 7.4 |
| 69 | Activity view | Slack | mentions, replies to you, reactions to you, in the Chats panel | must | |
| 70 | Hide previews | Signal | a switch: "New message" without words or name | should | |
| 71 | Sounds | Discord | one quiet sound, off by default | should | |
| | **Search** | | | | |
| 72 | Words in every chat | Slack | the search panel: chats beside notes, a hit opens the chat at the message | must | |
| 73 | Modifiers | Slack | `from:@Lucile`, `in:#Team`, `has:link`, `has:file`, `has:image`, `has:pin`, `has:reaction`, `is:reply`, `mentions:me`, `before:`, `after:`, `on:`, `during:` | must | |
| 74 | Search in this chat | Discord | Ctrl+F in a chat scopes the search to it | must | |
| 75 | Jump to a message in context | Slack | a hit loads the window around it and flashes the row | must | |
| | **Chats, people and moderation** | | | | |
| 76 | Channels in a space | Slack | a `.chat` in a space; every member of the space is in it | must | |
| 77 | Private channels | Slack | a chat shared on its own (item share) | must | the share exists |
| 78 | DMs | every one | a chat between two accounts outside every space, one per pair | must | |
| 79 | Group DMs | Slack | the same with up to 20 people; members added later see the history | must | |
| 80 | A chat with yourself | Signal | a chat in a space nobody else is in; works signed out | must | the solo reader's chat |
| 81 | Topic and description | Slack | a line under the name in the head, set by writers | must | |
| 82 | Members list | Discord | the right panel: online first, then the rest, with roles | must | |
| 83 | Who may post | Discord | writers (default), or the owner only | must | announcements without a new type |
| 84 | Roles and per-chat overwrites | Discord | none | drop | the space's three roles answer it |
| 85 | Invites | Slack | the share sheet of the space or the chat; a DM by picking a person | must | exists |
| 86 | Slowmode | Discord | a minimum gap per person, set by the owner | later | big public chats are not nib's first readers |
| 87 | Delete anybody's message | Slack | the space's owner | must | |
| 88 | Remove somebody | Discord | the share sheet's Remove | must | exists |
| 89 | Timeout | Discord | none | later | with slowmode |
| 90 | AutoMod | Discord | none | drop | a moderation product |
| 91 | Block a person | WhatsApp | in a DM: they cannot message you, their DMs to you are refused | must | the one safety tool a DM needs |
| 92 | Report | Discord | none | later | nib has no trust and safety team to report to; a DM block is the tool |
| 93 | Sections of chats | Slack | folders, and bookmarks first, in the Chats panel | should | folders exist |
| 94 | Archive a chat | Slack | the archive that exists: read-only, out of the panel | should | |
| 95 | Leave a chat | Slack | a DM or group DM: leave; a space's chat: mute (leaving is leaving the space) | must | |
| 96 | Forum channels | Discord | none | drop | a note is the long post |
| | **Profiles** | | | | |
| 97 | Avatar, uploaded and cropped | every one | 4.9 | must | Emil's ask |
| 98 | Display name | every one | the account's name (exists) | must | |
| 99 | Pronouns | Discord | a short field | should | |
| 100 | Bio | Discord | 190 characters, markdown links | should | |
| 101 | Banner | Discord | none | later | a profile card is enough |
| 102 | Nickname per space | Discord | set from the space's menu | should | |
| 103 | Avatar per space | Discord | none | later | Discord charges for it; one face is enough |
| 104 | Profile card | Slack | a press on a name or avatar: picture, name, pronouns, status, local time, bio, Message | must | |
| | **Calls** | | | | |
| 105 | Voice call, huddle | Slack | none | later | decision 7.6 |
| 106 | Video | Discord | none | later | decision 7.6 |
| 107 | Screen share | Slack | none | later | decision 7.6 |
| | **nib** | | | | |
| 108 | A note in a chat | Teams | drop a note or `[[`: a live card, offered as a share to members who cannot open it | must | |
| 109 | Quote a selection into a chat | - | the editor's menu: Send to chat | must | |
| 110 | A message to a task | - | quick add filled with the message and its link | must | Emil's ask |
| 111 | A message to a note | - | Save as note: the message and its replies, attachments copied | must | |
| 112 | The agent reads and posts | Slack | 4.14 | must | Emil's ask |
| 113 | Summary of unread | Slack | the pill's ✦: the AI sidebar summarises the unread part | should | needs a provider |
| 114 | Bots by token | Slack | a program token posts as "via <name>" with `chats.write` | should | program tokens exist |
| 115 | Slash commands | Slack | `/task`, `/poll`, `/remind`, `/me`, `/shrug`, and the reader's own AI commands | should | |
| | **Everything else** | | | | |
| 116 | History forever, offline, every device | Discord | the log on every device, the transcript on disk | must | |
| 117 | End-to-end encryption | Signal | none by default; a secret DM later | later | decision 7.3 |

Rows not numbered above because they are the ground every chat stands on, all must: date
separators, consecutive messages from one person grouped under one avatar and name within
five minutes, the hover bar, keyboard shortcuts (4.16), a screen reader's log (4.15),
multi-device, and the offline queue (4.5).

**Count: 63 must, 29 should, 14 later, 11 drop.** Of the musts, Slack charges for history past
90 days, Discord for the per-server profile and long uploads; here they are free.

## 4. The design

### 4.1 What a chat is

| kind | where it lives | who is in it | made from |
| --- | --- | --- | --- |
| **chat** | a `.chat` entry in a space's tree, beside notes | everybody who can reach the space, at their role | Ctrl+T's Chat card, the file list's New, the Chats panel's plus |
| **private chat** | the same entry, shared on its own | the people it is shared with (an item share, `docs/sharing.md`) and the owner | the chat's Share, or "Only…" when making it |
| **direct message** | the account, in no space | two accounts, one chat per pair | Message on a profile card, the palette's Message…, the panel's plus |
| **group message** | the account, in no space | up to 20 accounts | the same, with several people |

A chat in a space nobody else is in is the chat with yourself: a running log for links,
pictures and thoughts, synced to every device, which works signed out too.

**One word per term** (`docs/conventions.md`): **chat** is the kind; a message's side
conversation is its **replies**, never "thread", because `docs/ai-sidebar.md` 4.11 already
calls an AI conversation a thread; a **direct message** is a chat with one person. The
vocabulary table gains `chat` and `reply`. The Durable Object is `ChatLog`, not a room,
because "room" is the word for a live note (`docs/collaboration.md`).

A chat in a space is an entry of a new kind, `chat`, in sync v2's tree (`docs/sync-v2.md` 5.9),
so it already has what every entry has: an id that survives a rename and a move, Recently
deleted, bookmarks, the manual order, an icon and colour, archiving, and item shares keyed by
that id. Deleting it sends it to Recently deleted; its log is kept 30 days after it is
purged, then erased with the other leftovers.

### 4.2 On disk: the transcript

The log (4.3) is the truth. Each device that holds a space writes every chat of it into the
space as a folder of month files, so the conversation is in the place the notes are:

```
Thesis/
  Chapter 3.md
  thesis.chat/
    2026-09.md
    2026-10.md
```

```md
---
chat: thesis
month: 2026-10
nib: transcript
---

## Thursday 2 October 2026

**Emil** 16:40 ^m01j9qk3v8a
Draft of chapter 3 is up: [[Chapter 3]]
👍 2 · 👀 1

**Lucile** 16:52 ^m01j9qm0c2d
Reading it tonight

↳ **Mia** 17:02 ^m01j9qmy7r1
> **Lucile**: Reading it tonight

Same, the figures look off on page 4.
[figure-4.png](nib://chat/c8f2/m01j9qmy7r1/0)

**Mia** 17:30 ^m01j9qp2k9x
🎙 0:42
```

- **Plain markdown Obsidian reads**: a heading per day, a line per message with the name,
  the time and an [Obsidian block id][ob-blocks] (`^m` and the message id, lower case), then
  the words as written. So `[[thesis.chat/2026-10#^m01j9qk3v8a]]` is a link to one message
  in Obsidian and in nib, where it opens the chat at that message.
- **Replies are written under their parent**, each with `↳`, in the parent's month file, so
  a conversation reads in one place. A quote reply carries the quoted line as a quote.
- **The latest words only**: an edited message is written as edited and marked `(edited)`; a
  deleted one is gone; reactions are one line under the words; a poll is its question and
  its counts; a voice message its length.
- **A heading inside a message** is written as a bold line, so the month's outline stays
  days. Nothing else in the words is changed.
- **Attachments** are links to `nib://chat/...`, by name. The bytes stay in the device's
  blob store and are not copied into the space a second time; "Save to space" on an
  attachment copies one in as a file.
- **Derived, never read back.** The front matter says `nib: transcript`. Sync never sends
  these files (the space watcher and the file sync skip every path under a `.chat` entry), so
  two devices never meet over them; each writes the same bytes from the same log. An edit
  made in Obsidian is written over at the next change of that month, which is what a derived
  file is. A month is rewritten only when an event in it arrives, on the autosave pause,
  never per keystroke. A person's name is the one they have when the month is written; a
  rename rewrites the months that name them in idle time.
- **What reading them gives for free**: the search panel finds messages with the words it
  already finds in notes; the link index makes every `[[note]]` in a chat a backlink of that
  note; the agent's `read_note` and the connector read a chat as text; git keeps history;
  Obsidian, a phone's file app and grep read it.
- **The file list** draws `thesis.chat` as one row with the chat's mark and its unread count,
  never as a folder. Obsidian draws it as a folder of months, which is honest.
- **Direct messages have no space** and so no transcript by default; Settings > Chats can
  keep them in a chosen space, under `Direct/` (decision 7.1).

### 4.3 The log

**One `ChatLog` Durable Object per chat** (a new class, `new_sqlite_classes`, its own migration
tag, proved with `wrangler deploy --dry-run` first, as `docs/collaboration.md` requires). A
SQLite-backed object holds up to 10 GB on Workers Paid ([limits][do-limits]); a message is
a few hundred bytes, so a chat of a million messages is a fraction of that. Discord stores
messages the same way, partitioned by channel and ordered by id ([storage][dc-storage]).

```sql
create table events (
  seq integer primary key,          -- the order, given here and nowhere else
  id text not null unique,          -- the client's id for the event: a resend is the same event
  kind text not null,               -- post, edit, delete, react, pin, vote, meta, schedule
  target text,                      -- the message an edit, delete, react, pin or vote is about
  author text not null,             -- user:<id>, guest:<id>, program:<id>
  device text,
  at integer not null,              -- when it arrived here: the time everybody is shown
  made_at integer,                  -- when it was written, if more than a minute earlier
  body blob not null                -- the event's fields, framed (@nib/sync-core/wire)
);
create table messages (             -- every message as it stands, kept by the same writes
  id text primary key, seq integer not null, author text not null, at integer not null,
  parent text, quote text, body text not null, files text, poll text, preview text, via text,
  reactions text, pinned integer not null default 0, edited_at integer,
  deleted integer not null default 0, replies integer not null default 0, last_reply_at integer
);
create virtual table words using fts5(body, content='messages', content_rowid='seq');
create table members (               -- per person: where they read to, what they hear
  who text primary key, read_seq integer not null default 0,
  mentions integer not null default 0, notify text, muted_until integer
);
create table scheduled (id text primary key, at integer not null, event blob not null);
create table meta (key text primary key, value text);   -- topic, posting, slowmode
```

- **Ids** are made by the device: a ULID per message and per event, so an event resent
  after a lost answer is the same event, answered with the place it already has.
- **Order** is `seq`, given in arrival order. Every device shows every message in that order
  with the time it arrived. A message written offline at 13:40 and sent at 14:02 sits at
  14:02, and its time's hover says "written 13:40".
- **Events, not edits of a document**: `post` (words, a parent for a reply, a quote, files,
  a poll, a link preview, `via` for an agent), `edit` (new words, files), `delete`, `react`
  (`emoji`, `on`), `pin` (`on`), `vote` (`options`), `meta` (topic, who may post, slowmode),
  `schedule` (a post to place later, placed by the object's alarm). The object applies each
  to `messages` in the transaction that appends it, so a page of current state is one
  indexed read.
- **Limits**: 16,000 characters of words (Discord's 2,000 is too few for code, Slack's 40,000
  is cut in practice); ten files a message; 600 events a minute per account; 10 posts in 10 s
  per person per chat. The composer offers a long paste as a file before the limit.

**In D1**, migration `0044_chats.sql` (or the next free number; the lane says which):

```sql
create table chats (
  id text primary key,
  space_id text references spaces(id) on delete cascade,  -- null for a direct message
  entry_id text,                                           -- the tree entry, for a space's chat
  pair_key text unique,                                    -- two account ids sorted, for a DM
  created_by text not null, created_at integer not null,
  last_seq integer not null default 0, last_at integer, last_by text
);
create table chat_members (chat_id text, user_id text, joined_at integer not null,
  left_at integer, primary key (chat_id, user_id));        -- direct and group messages only
create table chat_reads (chat_id text, user_id text, read_seq integer not null default 0,
  mentions integer not null default 0, notify text, muted_until integer,
  primary key (chat_id, user_id));
create table chat_files (chat_id text, hash text, size integer, type text, name text,
  by text, at integer, primary key (chat_id, hash));
create table blocked (user_id text, blocked_id text, at integer,
  primary key (user_id, blocked_id));
create table push_targets (id text primary key, user_id text not null, device_id text,
  kind text not null check (kind in ('fcm', 'apns', 'webpush')), token text not null,
  created_at integer not null, failed_at integer);
create table presence (user_id text primary key, state text not null, at integer not null);
create table space_nicks (space_id text, user_id text, nick text not null,
  primary key (space_id, user_id));
alter table users add column avatar text;     -- {"s": hash of 96 px, "l": hash of 512 px}
alter table users add column pronouns text;
alter table users add column bio text;
alter table users add column status text;     -- {"emoji", "text", "until"}
alter table users add column accent text;     -- the person's own accent, for the initial
```

`chats.last_*` and `chat_reads` are written by `ChatLog` at most once a second (an alarm
coalesces them), so the Chats panel's counts for every chat are one query and no object is
woken to list them. Every new table goes on `ERASED` in `erase.ts` and the objects into
`leftovers`, as `docs/sync-v2.md` section 8 requires. The profile columns and
`space_nicks` are lane 3's own migration (6.2), so they can land without the rest.

### 4.4 Live

**An open chat** holds one socket to its `ChatLog`, `GET /v2/chats/:id/socket`, with the token
and `nib.device.<id>` in the subprotocol as a room's socket has. The door is the rooms' door
(`rooms/index.ts`): one query for the session, the chat's reach (space role, item share, or
membership of a direct message) and whether this person may post, passed to the object in
headers. Frames:

| from the device | from `ChatLog` |
| --- | --- |
| `hello {since}` | `events [...]` after that seq, or `behind` when it is too far behind (the device pages by HTTP) |
| `send {event}` | `placed {id, seq, at}` to the sender, `events [e]` to everybody else |
| `typing {parent?}` | `typing {who, parent?}`, never stored |
| `read {seq}` | `read {who, seq}` to the sender's other sockets, and to everybody where receipts are on (4.10) |
| | `here [who]` when somebody opens or leaves the chat; `profile {who}` when a member's profile changed |

The socket hibernates as a room's does, and the object keeps nothing in fields.

**Every other chat** hears through the account's hub (`docs/sync-v2.md` 5.12): on a post,
`ChatLog` tells the hub of each member with no socket open to it `{t: 'chat', chat, seq, at,
by, mention}`, coalesced per member to one frame every two seconds. The app moves that
chat's count and badge, and, if the reader should be told (4.11), shows a notification. A
poke never carries words; the app pulls them when it notifies or the chat opens.

**Listing**: `GET /v2/chats` answers every chat the account reaches with `last_seq`,
`last_at`, `read_seq`, `mentions`, `notify` and `muted_until`, one D1 query, fetched after
the first paint and kept current by pokes.

**Routes**, behind the session guard under `/v2`:

- `GET /v2/chats`; `POST /v2/chats` (a direct or group message, `{with: [ids]}`, answering the
  existing one for a pair); `PATCH /v2/chats/:id` (topic, who may post, slowmode).
- `GET /v2/chats/:id/events?after=|before=|around=&limit=` (at most 500);
  `GET /v2/chats/:id/state?before=` (messages as they stand, newest first, 4 MB pages, for a
  first copy); `POST /v2/chats/:id/events` (at most 50 from the outbox, idempotent by id).
- `GET /v2/chats/:id/search?q=` (the object's FTS5), and `GET /v2/chats/search?q=` across the
  account's chats for the browser build.
- `GET /v2/chats/:id/files/:hash` for members; uploads are sync v2's `PUT /v2/blobs/:hash`
  and parts routes, and the event names the hash, which `chat_files` records.
- `GET /v2/presence?ids=` (at most 200), `PUT /v2/me/profile`, `PUT /v2/me/avatar`,
  `PUT /v2/spaces/:id/nick`, `POST /v2/push/targets`, `DELETE /v2/push/targets/:id`,
  `PUT /v2/blocked/:id`, `DELETE /v2/blocked/:id`.

Every refusal a person can cause is an English sentence with a row in every catalogue, as
`docs/sync-v2.md` section 7 asks.

### 4.5 Offline, order and conflicts

- **The outbox.** Every event goes into the device's store first (`chat_outbox`, 4.17), then
  into the socket if it is open, else `POST /events` when the device is online, in order
  per chat, answered with `placed`. The row wears a faint clock until then, and nothing
  after.
- **Seen at once.** A message is drawn the moment Enter is pressed, from the outbox, at the
  bottom; placed, it takes its place in the order, which is almost always where it already
  is. A reaction and an edit are drawn at once the same way.
- **Refused** (the role was taken away, the chat deleted, a block, a limit): the row stays,
  marked, with Retry and Delete in its menu, and the words are never lost.
- **Conflicts are small by construction.** A message has one author, so an edit is the
  author's and the later by `seq` stands; a delete stands over an edit in either order; a
  reaction is a set per person and emoji, the later `on` or off standing; a vote is a set
  per person; a pin, the later. The chat's settings are last writer per key. Nothing asks.
- **Catching up**: a device holds a `seq` per chat and asks for the events after it, in
  pages, the chat on screen first. A device more than 10,000 events behind, or new to the
  chat, takes the messages as they stand, newest first, so the chat opens at once and the
  past fills in behind it, the way sync v2's first sync fills a space.
- **One clock**: times shown are the server's `at`, so two people never disagree about when
  something was said.

### 4.6 Who may do what

The space's roles (`docs/collaboration.md`, Sharing) answer it, with one setting per chat.

| | read | write | owner |
| --- | --- | --- | --- |
| read the chat, its files, search it | yes | yes | yes |
| post, reply, react, vote | | yes, unless the chat is owner only | yes |
| edit and delete their own messages | | yes | yes |
| topic, pins | | yes | yes |
| who may post, slowmode, delete anybody's message | | | yes |
| rename, move, delete, archive, share the chat | | as for a note | as for a note |

- A reaction is a write, and a reader's socket is read-only, as a room's is: a space shared to
  read is a chat to read.
- A guest is a person at their role (`guestMayReach` gains the chat routes), named by their
  device's name, with their initial for a face.
- **Direct and group messages** have no owner: everybody in one posts, edits and deletes
  their own, adds people (a group message) and leaves. People added later read the whole
  history, as Slack's group messages do.
- Taking somebody out of a space or a chat closes their sockets in the same request, as
  `roomsRevoked` does for notes.

### 4.7 Encryption

**Decision: not end-to-end encrypted by default** (decision 7.3).

- **What it would cost.** A chat the server cannot read cannot push a preview, cannot be
  searched or answered by the account connector with nib closed, and loses its history on
  every new device unless a key backup is built (Matrix's recurring "unable to decrypt",
  [Element][el-security]). Groups need MLS ([RFC 9420][mls]) or WhatsApp's per-device
  fan-out ([multi-device][wa-multi]), each a project of its own.
- **What it would protect.** The same people's notes beside the chat are not end-to-end
  encrypted (`docs/sync-v2.md` 6.6 encrypts web logins only, because they are live
  credentials), and every device writes the transcript to its disk as plain markdown. Slack,
  Discord and Teams make the same choice, and Telegram for its cloud chats.
- **What is done**: TLS on the wire, Cloudflare's encryption at rest, no third party sees a
  message (link previews are made by the sender, no GIF service), and the person's own
  controls in 4.18.
- **Later**: a **secret** direct message, end-to-end encrypted with MLS between the two
  people's devices, using the device keys sync v2 already registers (X25519, in the
  keychain), with no transcript, no push preview, no connector, and history only on the
  devices that were there. Telegram's model: a separate, honest kind, rather than a promise
  stretched over all of them.

### 4.8 Attachments, voice, previews, polls

- **Files** go up as sync v2 blobs (`PUT /v2/blobs/:hash` to 64 MB, 8 MB parts above,
  `docs/sync-v2.md` 7), then the `post` names them: `{hash, name, size, type, width?,
  height?, preview?, seconds?, wave?}`. Counted against the space owner's quota for a
  space's chat, as a note's pictures are, and against the sender's for a direct message. Up
  to 2 GB a file through parts; a bigger drop is refused with its size beside its name.
- **Pictures and video**: the sender makes a preview (480 px WebP, a video's first frame),
  sends it as its own blob and states width and height, so a row is the right size before
  anything loads and never jumps. Previews are fetched at once, originals when opened or
  when under 8 MB and on screen. Metadata (EXIF, GPS) is stripped before a picture leaves
  the device, its orientation applied first.
- **Galleries**: one picture as wide as the column, to 360 px tall; two to six as a grid;
  more as six with `+N`; a press opens the lightbox (arrows, Escape, zoom, Save to space,
  Copy, Open in a tab).
- **Voice messages**: hold the microphone (Ctrl+Shift+M toggles, Escape cancels; on a phone
  hold, slide left to cancel, slide up to lock, as WhatsApp). The existing recorder
  (`lib/recorder/`), at most 20 minutes (Discord's). The sender computes 64 bars of loudness
  and sends them with the file, so the waveform is drawn before the sound loads. The player:
  play, the bars filling as it plays, drag to seek, 1×, 1.5×, 2×. A transcript is made on
  the reader's own device by the transcriber that exists (`lib/recorder/transcribe.ts`), on a
  press, as WhatsApp makes it on the phone ([transcripts][wa-transcripts]); it is never sent.
- **Link previews** are made by the sender's device, as Signal's are ([previews][sg-previews]):
  the crate fetches the page (not the webview, so no cookies go with it), reads its title,
  description, site and picture, sends the picture as a blob, and the `post` carries the
  preview. Recipients never contact the site, everybody sees the same preview, and a page
  that changes later does not change the message. ✕ on the preview before sending drops it;
  Settings turns them off. No preview for a private address, a file, or a page slower than
  3 s.
- **A note dropped in or linked** is not a link preview: it is a live card (4.13).
- **Polls**: `/poll` or the attach menu's Poll: a question, two to ten answers, one or
  several, an end (1 h, 1 day, 3 days, 1 week, none). Votes are events; the card shows bars
  and counts, and on hover who; the asker can end it early ([Discord][dc-polls]).

### 4.9 Profiles and pictures

**The avatar.**

- **Set** from Settings > Account, from the account button at the panel's foot, and from
  your own profile card: pick a file, drop one, paste one, or take one with the camera
  (`lib/camera.ts`) on a phone or a desktop that has one.
- **Crop**: a sheet with the picture under a round mask in a square, dragged to move, the
  wheel, a pinch or a slider to zoom, a button to turn it 90°, Enter to keep, Escape to
  leave. Orientation applied, metadata dropped.
- **Kept** as two WebP blobs made on the device, 512 px (the profile card) and 96 px
  (everywhere else), each under 100 KB, in the account's blob store. `users.avatar` holds
  their hashes; `/i/:hash` serves them with a year's cache, as a note's pictures are
  (`docs/sharing.md`: a picture is a capability named after itself). Removing the avatar
  deletes both blobs.
- **Without one**, a person is their initial on their accent, as the share sheet draws people
  today (`docs/collaboration.md`, "What it looks like"); `users.accent` makes that accent the
  person's on every device, where today it is each device's.
- **Synced** with `/v1/me` and every list of people (members, the share sheet, a chat's
  members, `GET /v2/chats`): an avatar changed on the laptop is on the phone at the next
  answer that names the person, and an open chat hears `profile {who}` and fetches it.

**The rest of a profile**: the display name (exists); pronouns (40 characters); a bio (190
characters, links allowed, Discord's length); a status (an emoji and a line of 100
characters, cleared after 30 min, 1 h, 4 h, today, this week or never); the local time (the
device's zone, shown on the card when it is an hour or more from the reader's); and a
**nickname per space** (`space_nicks`), set from the space's menu and used in that space's
chats, carets and members. A banner and an avatar per space are later (#101, #103).

**One component, everywhere.** `Avatar.svelte` (a person; 16, 20, 24, 32 or 80 px; an
optional presence dot; an optional mark in its corner) is the face of a person in:

| where | what changes |
| --- | --- |
| a chat's rows, members, mention menu, reactions, receipts, the profile card | new |
| the share sheet's People card | the initial square becomes the avatar |
| the panel's foot (the account button) | the avatar, with presence |
| carets in a shared note | a person's label (`rooms/who.ts`) gains a 16 px avatar before the name; a device's label stays a word |
| the tab's people | people are small overlapping avatars; one's own other devices stay dots (`docs/collaboration.md`, "Carets and presence") |
| the versions list | the avatar of whoever wrote each version |
| an agent's work | an agent writing for a person: the agent's mark on the person's avatar's corner (chat rows, versions, the changes bar) |
| a shared space in the switcher | up to three members' avatars beside the shared mark |

### 4.10 Presence, status, typing, receipts

- **Presence** is the hub's (`docs/sync-v2.md` 7, "Hub"): each device says `active` and
  `idle`. A person is **active** when any of their devices is, **away** when connected and
  none is, **offline** otherwise. The hub writes `presence` in D1 only when a person's state
  changes, so reading it is one query. The app asks for the people on screen when a chat or
  a members list opens and every 60 s while it stays open; inside an open chat the object's
  `here` frame says, live, who has it open. No fan-out per person per change.
- **Appear offline** makes the hub write offline whatever the devices say.
- **Do not disturb** is a status with an end, and the quiet schedule; both stop pings, never
  counts. A person in it wears a small moon on their dot.
- **Typing**: a frame at most every 3 s while the composer's words change, relayed and never
  stored, drawn for 5 s after the last one as "Lucile is typing" (two names, then "Several
  people") in the composer's foot. A reply pane's typing is that reply's. A switch in
  Settings, reciprocal as Signal's ([typing][sg-typing]).
- **Read places**: the newest row that has been on screen with the window in front is read;
  the device sends `read`, the account keeps it per chat, and every device of the reader
  follows. The new-messages line stands where the read place was when the chat was opened
  and stays until it is left. Mark unread moves it back.
- **Receipts** ("seen by"): in direct messages and chats of up to ten people, each other
  person's avatar (16 px) sits under the newest message they have read, sliding down as they
  read: Messenger's shape, quieter than ticks. A switch in Settings, reciprocal
  ([Signal][sg-receipts]): off, nobody sees yours and you see nobody's. On by default
  (decision 7.5).

### 4.11 Notifications

- **What pings**, per chat (the bell in its head): **All**, **Mentions** (your name, @here
  while you are active, @everyone, replies to you, your keywords) or **Nothing**, and **Mute
  until** (1 h, 8 h, a day, a week, until turned back). Direct messages default to All, a
  chat of more than ten people to Mentions, the rest to All. Kept in `chat_reads.notify` so
  every device agrees.
- **Keywords** and the **quiet schedule** (days and hours, Slack's [schedule][sl-dnd]) are in
  Settings > Chats, in the account's settings, merged per key as `docs/sync-v2.md` 5.11 does.
- **Desktop**, while nib runs: the hub's poke arrives, the app decides (the chat is not on
  screen in a window in front, the level says yes, not muted, not quiet) and shows the
  system's notification through `tauri-plugin-notification`, with the sender's avatar and
  the first line; a press opens the chat at the message; Reply answers inline where the
  system offers it. One per chat, replaced rather than stacked.
- **The tray**: closing the window while any chat exists keeps nib in the tray, said once:
  the same question `docs/tasks.md` decision 6 and `docs/agent-native.md` question 6 ask,
  answered once for all three.
- **Phones and the browser build**: push from the Worker (decision 7.4). A phone registers a
  token (FCM on Android, APNs on iOS) and the browser build a Web Push subscription (VAPID)
  in `push_targets`. When `ChatLog` pokes a member who should be told, the Worker checks
  whether a desktop of theirs was active in the last two minutes (the hub knows) and pushes
  only if not, so the phone is quiet while the person is at their desk, Slack's rule. The
  payload carries the chat, the sender's name and the first 100 characters, unless Hide
  previews is on. A token that fails is dropped.
- **One push for nib**: `docs/tasks.md` 5.10 needs the same for reminders; lane 6 builds it
  once (`push/` in the Worker) and tasks' reminders use it.
- **Activity** (the Chats panel): mentions of you, replies to you and reactions to your
  messages, newest first, each opening the message; requests from strangers (4.18) on top.

### 4.12 Search

- **In the search panel**, chats beside notes. Words are found the way notes' words are,
  because the transcripts are markdown in the space; a hit inside `*.chat/` is drawn as a
  message (avatar, name, time, the line) and opens the chat at it.
- **Modifiers** (Slack's [search][sl-search]), parsed by `@nib/chats` and answered from the
  device's store of messages: `from:@Lucile`, `in:#thesis` (`in:@Lucile` for a direct
  message), `has:link`, `has:file`, `has:image`, `has:voice`, `has:pin`, `has:reaction`,
  `is:reply`, `mentions:me`, `before:`, `after:`, `on:`, `during:october`. A modifier
  switches the panel to messages only.
- **In one chat**: Ctrl+F in a chat is the search panel scoped to it, `in:` filled in.
- **The store** keeps every message of every chat with an FTS5 index (4.17); the browser
  build, with no transcripts on disk, asks `GET /v2/chats/search`.
- **A hit** loads the rows around the message from the store, scrolls it to the middle and
  flashes its row in the accent's tint.

### 4.13 One with the notes

- **A note in a chat.** Drag a note from the tree or a tab into the chat, or type `[[` and
  pick one (completion from the chat's space), and the message carries a **live card**: the
  note's icon, name, folder and first lines, kept current from the link index while it is on
  screen; a press opens the note beside the chat. If some members cannot open the note (it
  is in another space, or the chat is a direct message with somebody outside the space), the
  composer shows their avatars over the field with **Share** (to read) before sending,
  Slack's file-access prompt; sending without it sends the link alone.
- **Quote a selection.** The editor's context menu and the palette gain **Send to chat**:
  pick a chat in the switcher (4.16) and its composer opens with the selection as a quote and
  a link to the note at that heading. Nothing is sent until Enter.
- **@-mention a note**: `[[` as above; in the transcript it is a wikilink, so the note's
  backlinks list the chat's month and the message.
- **A message becomes a task**: ⋯ **Add as task** on a row (or T, or `/task` in the composer)
  opens quick add (`docs/tasks.md` 5.6) filled with the message's words, `+Name` for a person
  it mentioned, and a link back, `[[thesis.chat/2026-10#^m…]]`, as the task's description
  line. Enter writes it to the inbox, or wherever `>Note` says. **Remind me** is the same
  with the reminder chip open.
- **A message becomes a note**: **Save as note** makes a note named from the first words,
  with the message and its replies as quotes (name, time), attachments copied beside it, and
  a link back; it opens in a tab.
- **Link a message from a note**: Copy link on a message copies the transcript wikilink; in a
  note it opens the chat at the message, and in Obsidian the transcript at that line.
- **Ctrl+T's Chat card** (`lib/new-kinds.ts`, letter **M**, since C is the canvas's): a new
  tab with the chat's name field and, under it, who is in it (the space's people, or
  "Only…" to pick). Like every new kind it writes nothing until it is named or its first
  message is sent. The file list's New has Chat too.
- **The Chats panel**: a left panel, `'chats'` in `Panel`
  (`apps/desktop/src/lib/workspace.svelte.ts`) beside the Tasks panel's `'tasks'`, 4.15.

### 4.14 The agent

**Verbs**, in `nib mcp` (`apps/desktop/src-tauri/src/mcp/tools.json`, answered by the window as
the note verbs are) and, where marked, the account connector (`services/sync/src/mcp/tools.ts`):

| tool | arguments | what it does | scope | connector |
| --- | --- | --- | --- | --- |
| `list_chats` | `space`?, `unread`? | chats with counts, the last message and members | `chats.read` | yes |
| `read_chat` | `chat`, `around`? or `before`? or `after`?, `limit`? (≤ 200), `replies_of`? | messages with ids, authors, times, words, files by name, reactions | `chats.read` | yes |
| `search_chats` | `query` (with 4.12's modifiers), `limit`? | hits with their chat and id | `chats.read` | yes |
| `draft_message` | `chat`, `text`, `reply_to`? | puts the words in the reader's composer for that chat; never sends | `chats.write` | no |
| `post_message` | `chat`, `text`, `reply_to`?, `quote`?, `files`? (paths in a granted space) | sends, as the reader, `via` the agent | `chats.write` | yes |
| `react` | `chat`, `message`, `emoji`, `on`? | | `chats.write` | yes |
| `edit_message`, `delete_message` | `chat`, `message`, `text`? | only messages this agent sent | `chats.write` | no |

- **Two new scopes**, `chats.read` and `chats.write`, in the grant (`docs/agent-native.md` 9.1).
  Emil's default has both on, with the asks below; a third-party agent starts with both off.
  A space the agent was not granted has no chats to it, and direct messages need the grant's
  own switch, off by default.
- **Posting asks first.** `post_message`, `react`, `edit_message` and `delete_message` in a
  chat anybody else can read are the **Publishing** category of `docs/agent-native.md` 9.3
  ("anything in nib that puts words where somebody else can read them"): the call answers
  `needs_approval` with the chat and the words as its summary, and the reader sees the
  message as it would be sent, with **Don't allow**, **Allow** and **Always in this chat**. In
  the chat with yourself nothing asks. `draft_message` never asks: the reader sends. In
  `confirm` mode every write asks, as now.
- **Seen as the agent's.** A message an agent sent is the reader's, drawn with the agent's
  mark on their avatar's corner and "via Claude Code" on the name's hover; the event's `via`
  names the grant. People in a chat are owed knowing when a person's agent wrote.
- **Other people's words are data.** Every message `read_chat` and `search_chats` return that
  the reader did not write comes inside `<untrusted source="chat:thesis from:Lucile">`, as
  page text does (9.6), and Settings > Agents names the trifecta on an agent that holds
  `chats.read`, `browser` and `chats.write` together.
- **`@nib` in a chat** is the asker's own agent, on the asker's machine. `@nib what did we
  decide about the figures?` and Enter sends nothing: it opens the AI sidebar with the chat
  attached (the unread part, or the last 200 messages) and the question, and the answer
  comes back as a draft in the composer, sent with Enter. Nobody else's message ever starts
  anybody's agent: an agent answering strangers' words with its owner's notes is the
  injection `docs/agent-native.md` 9.6 describes (decision 7.7).
- **The AI sidebar** gains a chat as context (an `@` chip) and two commands for
  `docs/ai-sidebar.md` section 3: `/catchup` (every chat's unread part summarised, each with a
  link to where it starts) and `/reply` (a draft for the chat in front). The unread pill's ✦
  is `/catchup` for one chat, Slack's recap ([AI][sl-ai]).
- **Program tokens** (`programs.ts`) with `chats.write` post as "via <name>" (a CI job, a home
  server): Slack's incoming webhooks without a second system.

### 4.15 The surfaces

**The Chats panel**, on the left with Files, Search and Tasks; navigation only, as the Tasks
panel is. Discord's three row states (`docs/design.md`, "Discord, on a phone"): read is muted,
unread bright with a count, a mention a badge in the accent.

```
┌ Notes ▾ ──────────────────────────┐
│ [Files] [Search] [Tasks] [Chats]  │
├───────────────────────────────────┤
│  ⌕ Jump to                Ctrl+K  │
│  @  Activity                   3  │
│  ⚑  Saved                         │
│ CHATS                         ⊕   │
│  #  general                       │   read: muted
│  #  thesis                    12  │   unread: bright, a count
│  #  design                    @2  │   mentions: the accent
│  #  planning     ⛬                │   shared on its own: the shared mark
│ DIRECT                        ⊕   │
│  (L)• Lucile                   1  │   the avatar and its presence dot
│  (M)(P) Mia, Paul                 │   a group: two avatars overlapped
└───────────────────────────────────┘
```

**A chat tab.** The head is the chat's name and topic, the members' stack and count, pins, the
bell and search. Rows are grouped by person within five minutes: the first row of a group has
the avatar and name, the rest only their words, with the time in the gutter on hover
(Discord's).

```
┌ # thesis ─────────────────────────────────────────────────────────────────────────┐
│ # thesis   Chapters, deadlines, the defence       (L)(M)(P) 5   ⚲ 3   🔔   ⌕        │
├────────────────────────────────────────────────────────────┬──────────────────────┤
│                    ── Thursday 2 October ──                │ ↳ Lucile          ✕  │
│ (E) Emil  16:40                                            │ (L) Lucile  16:52    │
│     Draft of chapter 3 is up                               │     Reading it       │
│     ┌───────────────────────────────┐                      │     tonight          │
│     │ ▤ Chapter 3 · Thesis          │   a live note card   │ ──── 2 replies ────  │
│     │ The second experiment ran...  │                      │ (M) Mia  17:02       │
│     └───────────────────────────────┘                      │     Same, the        │
│     👍 2   👀 1                                             │     figures look...  │
│ (L) Lucile  16:52                                          │                      │
│     Reading it tonight                                     │                      │
│     (M) 2 replies  17:10                                   │                      │
│ ─────────────────────────────── New ───────────────────────│                      │
│ (M) Mia  09:14                                             │                      │
│     ▶ ▁▃▅▇▅▃▂▁▃▆▇▅▃▁▂▄▆▅▃  0:42   1×                         │                      │
│     ┌──────┬──────┬──────┐                                 │ ┃              ➤     │
│     │      │      │  +3  │                                 │ ☐ also to #thesis    │
│     └──────┴──────┴──────┘                                 │                      │
├────────────────────────────────────────────────────────────┤                      │
│ ┃ #thesis                                         ⊕  ☺  🎙  ➤ │                      │
│ Lucile is typing                                  (L)(M)   │                      │
└────────────────────────────────────────────────────────────┴──────────────────────┘
```

- **The hover bar** at a row's top right: three recent reactions, the picker, Reply, Quote,
  and ⋯ (Forward, Copy link, Pin, Save, Remind me, Add as task, Save as note, Mark unread,
  Edit, Delete). The same menu on a right click and a long press.
- **The composer** is a small nib editor (`@nib/editor`, live preview, the reader's own
  modes), one line growing to a third of the pane and then scrolling, with the chat's name
  faint in it while it is empty. ⊕ attaches (file, picture, poll, note); ☺ is the picker; 🎙
  the recorder; ➤ sends, and its chevron schedules. A file dropped anywhere on the chat
  lands in the composer as a chip and goes with the words. Drafts are kept per chat after
  the quiet pause.
- **The replies pane** is the right panel slot the AI sidebar and the outline share, so a
  reply and a note can sit side by side; its composer has "also to #thesis" as a checkbox
  (Slack's).
- **The pills**: when the new line is above the screen, a pill at the top with the count, ↑
  and ✦ (the summary); when the reader has scrolled up and messages arrive, a pill at the
  bottom with ↓ and the count.
- **Members** (the stack in the head): the right panel, active people first, then the rest,
  each with presence, status emoji and role; a press is the profile card.
- **The profile card**, a layer from a press on any avatar or name:

```
┌──────────────────────────────────┐
│ (   80 px avatar   )  •          │
│ Lucile Martin                    │
│ she/her          🌴 until Monday  │
│ 15:42                            │
│ Second year, thesis on sparse    │
│ solvers.                         │
│ [ Message ]                  ⋯   │   ⋯: nickname here, block, copy address
└──────────────────────────────────┘
```

- **The avatar sheet**: the picture under a round mask, the zoom slider and the turn button
  under it, Keep. Nothing else on it.
- **Words**: names, times and counts. No "Welcome to #thesis" banner (Slack's) and no "This
  is the beginning of…" line (Discord's): an empty chat is an empty page and a composer.
  Every new string goes into all 40 catalogues.
- **Motion**: a message arriving rises 6 px and fades in over `--dur-*` with `--ease-out`;
  your own appears at once; a reaction pops (0.8 to 1); the replies pane slides as every
  right panel does; the pills fade; a jumped-to row's tint fades over a second. Reduced
  motion makes all of it a cut.
- **A screen reader**: the rows are a `log` with `aria-live="polite"` for arrivals in the
  chat in front, each row read as name, time, words and reactions; the hover bar's actions
  are the row's menu by keyboard.

### 4.16 Keys

Every key is a row of the keyboard registry (`apps/desktop/src/lib/shortcuts/registry.ts`),
rebindable and shown in tooltips; where a key below is already taken, the registry's test
says so and the lane picks the next free one.

| key | where | what |
| --- | --- | --- |
| Ctrl+K | a chat or the Chats panel | jump to a chat or a person (the palette's chat rows) |
| Alt+↑ / Alt+↓ | a chat or the Chats panel | the previous or next chat |
| Alt+Shift+↑ / Alt+Shift+↓ | anywhere in nib | the previous or next chat with unread messages ([Slack][sl-keys]) |
| Ctrl+J | a chat | to the new line |
| Escape | a chat | mark it read and go to the bottom; in the replies pane, close it |
| ↑ | an empty composer | edit your last message |
| R, Q, E, P, S, T, Delete, + | a row with focus (Tab from the composer, then ↑ ↓) | reply, quote, edit, pin, save, add as task, delete, react |
| Ctrl+Z | the composer, within 15 s of sending | unsend |
| Ctrl+Shift+M | a chat | record a voice message; again to send |
| Ctrl+F | a chat | search this chat |
| Ctrl+Shift+L | anywhere in nib | the Chats panel |

### 4.17 Fast

- **Out of the first paint.** The Chats panel, the chat view, the composer's editor, the
  emoji data and `@nib/chats` are fetched when first asked for; `GET /v2/chats` runs after the
  launch order; `apps/desktop/test/weight.test.ts` is not raised.
- **The device's store** (`docs/sync-v2.md` 9.2, `sync/<account>.db`) gains:

  ```sql
  create table chats (id text primary key, space_id text, entry_id text, kind text not null,
                      seq integer not null default 0, read_seq integer not null default 0,
                      complete integer not null default 0, meta text);
  create table chat_messages (chat text not null, id text not null, seq integer not null,
                              author text not null, at integer not null, parent text,
                              body text not null, extra blob, primary key (chat, id));
  create index chat_messages_seq on chat_messages(chat, seq);
  create index chat_messages_parent on chat_messages(chat, parent, seq);
  create virtual table chat_words using fts5(body, content='chat_messages');
  create table chat_outbox (id text primary key, chat text not null, event blob not null,
                            made_at integer not null, tries integer not null default 0,
                            refused text);
  create table chat_drafts (chat text primary key, text text not null, at integer not null);
  ```

  The browser build keeps the same as IndexedDB stores and searches through the Worker.
- **Opening a chat** reads the 100 rows around the read place from the store by `seq` (an
  index read), draws them, and opens the socket after the first frame. Budget: the rows on
  screen within 50 ms of the press, for a chat of 100,000.
- **A window of rows, not the chat.** At most 1,000 messages in memory and about 60 rows in
  the DOM. Rows differ in height, so the list is a measured window
  (`lib/chats/view/window.ts`): heights estimated from what the event already says (lines of
  words at the column's width, a picture's stated size), measured when drawn, and the anchor
  row kept still when rows above it change, as history paging in requires. `row-window.ts`
  is fixed-height and stays as it is.
- **Paging** 200 at a time from the store as the reader nears either end; from the account
  only for history the store does not have yet.
- **Nothing per keystroke**: the composer is one editor with nothing decorating the chat;
  typing sends at most one frame every 3 s; the draft is stored on the quiet pause
  (`afterQuiet`, `lib/timing.ts`).
- **Arrivals**: one event, one row inserted, one store write (batched per frame when a
  catch-up brings hundreds); transcript months are written on the autosave pause, the month
  that changed only.
- **Budgets**, measured in the lanes' drives with a seeded chat of 100,000 messages: open at
  the read place under 50 ms; scroll through history at 60 fps; a message from another
  device on screen under 300 ms on a normal connection; a catch-up of 10,000 events applied
  in under 2 s off the UI thread; under 30 MB for the open chat.

### 4.18 Privacy, safety, moderation

- **Who can message you directly**: by default, people you share a space or a shared item
  with. Anybody else who has your address can send one **request**: the first message waits
  in your Activity with Accept and Block, and no second one can be sent until you accept
  (Signal's message requests). Settings opens it to anybody or closes it to nobody.
- **Block**, from a profile card or a request: their direct messages to you are refused, your
  shared chats fold their messages to one quiet row that opens on a press (Discord's), and
  they are not told.
- **Removal**: a space's owner deletes any message and removes people from the share sheet;
  removal closes their sockets at once.
- **Your switches**: read receipts, typing, appear offline, previews in notifications, link
  previews, who may message you. Reciprocal wherever they are about seeing others.
- **What leaves the device**: messages and files, to the account; link previews made here
  and nowhere else; no GIF service; no analytics on messages; pictures without metadata.
- **Deleting a message** removes it from the object, its file rows when no other message
  names the hash, and every device's store and transcript at their next catch-up; the blob
  goes with the other unreferenced blobs.
- **Deleting your account** deletes your direct and group messages for everybody; your
  messages in other people's spaces stay, shown as "Deleted account" without an avatar
  (Discord's way, decision 7.8). `erase.ts` and its test cover every new table.
- **Agents** (4.14): other people's words are untrusted; posting asks.
- **Ceilings**: a chat holds the space's 200 people; a group message 20; 600 events a minute
  per account; 10 posts in 10 s per person per chat; 30 requests to strangers a day per
  account; uploads count against storage.

### 4.19 The phone and the glasses

- **Phone**: the Chats panel is a drawer tab; a chat is the page; the composer sits on the
  keyboard; long press for the menu, swipe right to reply, hold the microphone to record,
  slide up to lock, slide left to cancel; the lightbox swipes; push (4.11) with Reply from
  the notification. The share sheet gains "Send to chat".
- **Even G2**: later. A row in the modal, **Chats**: the unread direct messages, a line each;
  a tap reads the last messages on the panel's eight lines, and the microphone row replies
  when what was said starts with "reply" ("Antwort"). After the phone's push exists.

## 5. What nib does not do

- **Federation** with Matrix, Slack or Discord. One account service, one order, one
  moderation. A bridge is a product.
- **Roles beyond read, write and owner**, and per-chat permission overwrites. The space is
  the unit of who; a chat shared on its own is the exception.
- **A shop**: animated avatars, super reactions, stickers, banners as a purchase.
- **Forum channels and announcements as types.** A note is the long post; an owner-only chat
  is the announcement channel.
- **Disappearing messages** while chats are readable by the server and written to disk.
- **Stories, channels with subscribers, communities with discovery.** nib's chats are among
  people who already share something.
- **A bot marketplace.** `nib mcp`, the connector and program tokens are the integration.

## 6. The implementation plan

Seven lanes in three waves, at most six at once. Each lane reads this document,
`docs/conventions.md` and the rules for every nib agent first, writes tests for its logic,
adds every new string to every catalogue in `apps/desktop/src/locales`, and never raises the
first-paint budget. New files in the app are named relative to `apps/desktop/src` (or
`src-tauri/src`), in the Worker relative to `services/sync/src`; the new package is
packages/chats, published in the workspace as `@nib/chats`.

### 6.1 The interfaces the lanes meet at

Written first, by lane 1, in `@nib/chats`'s `types.ts`, before any other lane builds on them;
the others code against fixtures until it lands.

```ts
type Who = `user:${string}` | `guest:${string}` | `program:${string}`

interface FileRef {
  hash: string; name: string; size: number; type: string
  width?: number; height?: number; preview?: string   // a blob hash
  seconds?: number; wave?: number[]                   // 64 bars, 0..255
}

interface Preview { url: string; title: string; site?: string; text?: string; picture?: string }
interface Poll { question: string; answers: string[]; several: boolean; ends?: number }

type Event =
  | { kind: 'post'; id: string; message: string; body: string; parent?: string
      quote?: string; files?: FileRef[]; poll?: Poll; preview?: Preview
      via?: { agent: string }; alsoToChat?: boolean; mentions?: Who[] }
  | { kind: 'edit'; id: string; target: string; body: string; files?: FileRef[] }
  | { kind: 'delete'; id: string; target: string }
  | { kind: 'react'; id: string; target: string; emoji: string; on: boolean }
  | { kind: 'pin'; id: string; target: string; on: boolean }
  | { kind: 'vote'; id: string; target: string; answers: number[] }
  | { kind: 'meta'; id: string; topic?: string; posting?: 'writers' | 'owner'; slowmode?: number }
  | { kind: 'schedule'; id: string; at: number; post: Extract<Event, { kind: 'post' }> }

interface Placed { seq: number; at: number; author: Who; device?: string; madeAt?: number }
type Logged = Event & Placed

interface Message {
  id: string; seq: number; at: number; author: Who; body: string
  parent?: string; quote?: string; files: FileRef[]; poll?: Poll & { votes: Record<Who, number[]> }
  preview?: Preview; via?: { agent: string }; reactions: Record<string, Who[]>
  pinned: boolean; editedAt?: number; deleted: boolean; replies: number; lastReplyAt?: number
}

function apply(state: Map<string, Message>, event: Logged): Message | null  // the one reducer
function transcript(month: string, messages: readonly Message[], names: Names): string
function parseSearch(query: string): SearchQuery     // words and 4.12's modifiers
function mentionsIn(body: string, members: readonly Member[]): Who[]
function ulid(now: number, random: () => number): string
```

The wire frames of 4.4 are typed in `@nib/chats/wire`, framed with `@nib/sync-core/wire`. The
client store (lane 4) is `chats.list()`, `chats.open(id)` (a window of messages and a
`watch`), `chats.send(chat, event)` (the one write path, through the outbox), and
`chats.search(query)`. The profile store (lane 3) is `people.of(who)` and `people.watch`,
which every surface showing a person reads.

### 6.2 The lanes

| lane | owns | builds | tests | wave |
| --- | --- | --- | --- | --- |
| **1 `chats-core`** | packages/chats (new, `@nib/chats`); `packages/sync-core/src/tree.ts` (the `chat` kind) | the types above; the reducer for every event and the conflict rules of 4.5; the transcript writer (4.2) with block ids, replies under parents, headings as bold, reactions and polls; the search language (4.12); mention parsing; ULIDs; the wire frames | the reducer against every ordering of a post, edits, a delete, reactions and votes (property tests: any order of placed events gives one state); transcript fixtures opened in Obsidian (block links resolve) and byte-identical across two runs; the search parser per modifier; `tree.test.ts` with chat entries moved, renamed and deleted | 1 |
| **2 `chats-server`** | `chats/` in the Worker (new): `ChatLog`, its routes and door; the Durable Object binding and migration tag in `wrangler.jsonc`; migration `0044_chats.sql` (the chat tables); the hub's `chat` frame (`hub/frames.ts`, `hub/poke.ts`); `guestMayReach`; `erase.ts` and `leftovers` for the new tables | 4.3's object (events, messages, FTS5, members, scheduled posts on its alarm), 4.4's routes and socket, the door through the rooms' one query, pokes coalesced per member, `chat_reads` and heads coalesced to D1, DMs unique per pair, blocks and requests, file access through `chat_files`, limits | route tests against real SQL as the Worker's are: the role table of 4.6 for five holders (two guests); idempotent resend; a reader's socket refused a post; revocation closes sockets; a DM pair made twice is one chat; a blocked sender refused; `erase.test.ts` green with every new table; `wrangler deploy --dry-run` with the new class; FTS5 proved in a SQLite-backed object on day one (fallback: a words table) | 1 |
| **3 `profiles`** | `lib/people/` (new: `Avatar.svelte`, `AvatarSheet.svelte`, `ProfileCard.svelte`, the people store); the profile and presence routes in `services/sync/src/account.ts` and `presence.ts` (new) in the Worker (new); its own migration for the `users` columns, `presence` and `space_nicks`; the hub's presence writes (`hub/hub.ts`, agreed with lane 2); the surfaces of 4.9's table outside chats (the share sheet, the panel's foot, `rooms/who.ts` and the caret label in `packages/editor/src/carets.ts`, the tab's people, the versions list, the switcher) | the avatar from file, drop, paste and camera; the crop sheet; two WebP sizes with metadata stripped; pronouns, bio, status with its clearing, accent, nickname per space; presence from the hub; Settings > Account's rows; `Avatar` in every place of 4.9 | crop maths and the WebP output's sizes; EXIF stripped (a fixture with GPS); status clears at its time; presence transitions written once; a drive: set an avatar, see it in the share sheet and on a caret in a second browser on the same space; `weight.test.ts` unchanged | 1 |
| **4 `chats-client`** | `lib/chats/` (new: the store, socket, outbox, catch-up, transcript projection, search); `src-tauri/src/sync_store.rs` (the tables of 4.17) and `lib/web/sync-store.ts`; `lib/sync2/kinds.ts`, `lib/sync2/watching.ts` and `src-tauri/src/space_watch.rs` (a `.chat` entry and the paths under it skipped); the link preview fetch in `src-tauri/src` (new file) | the store and its one write path; the socket with `hello since`, pages and `behind`; the outbox with placing, refusal and retry; first copies newest first; the transcript months written on the pause and never synced; the search modifiers over FTS5 and the browser build's route; the link preview made by the crate; drafts kept and synced through account settings | simulator tests in the style of `sync2/sim.test.ts`: three devices, offline posts, edits and deletes crossing, every device ending with one state and byte-identical transcripts; the outbox across a crash; cargo tests for the store's tables and FTS5; a perf test: 100,000 messages, the window around a read place under 10 ms; a draft-PR CI for the crate | 2 |
| **5 `chats-ui`** | `lib/chats/view/` (new); the `'chats'` panel in `apps/desktop/src/lib/workspace.svelte.ts` and `workspace/panels.ts`; the chat kind in `lib/new-kinds.ts`, `lib/openers.ts` and `lib/file-mark.ts`; the emoji picker (new, `lib/emoji/`); the chat keys in `lib/shortcuts/registry.ts` | the Chats panel, the chat tab, the measured window, grouping and separators, the new line and pills, the hover bar and menus, the composer on `@nib/editor` with mentions, `[[`, `:` and `/` completion, attachments, galleries and the lightbox, the voice recorder and player, polls, the replies pane, members, pins, Saved and Activity, the Ctrl+T card, the phone's layout, motion and the screen reader's log | component tests per surface; a drive `test/e2e/chats.py`: two browsers on one shared space, a message, a reply, a reaction and an edit seen on the other within a second, a picture and a voice message, the new line and Ctrl+J, a search hit opening the message; the same at phone width; 100,000 seeded messages scrolled at 60 fps | 2 |
| **6 `chats-notify`** | `push/` in the Worker (new: FCM, APNs, Web Push, the desktop-active rule); `lib/chats/notify.ts` (new); the Android and iOS token registration (Kotlin beside `Widgets.kt`, the iOS app delegate); the tray residency setting with `docs/tasks.md` lane 5 | per-chat levels, mute, keywords, the quiet schedule, hidden previews; desktop notifications with inline reply; the tray; push to phones and the browser build, quiet while a desktop is active; the one push module tasks' reminders also use | the decision table (level, mute, quiet, focus, desktop active) as a pure function with every row; push requests against recorded FCM, APNs and Web Push answers, a dead token dropped; a probe with its own identifier (never Emil's nib) that a notification is raised and pressing it opens the chat | 2 |
| **7 `chats-everywhere`** | `apps/desktop/src-tauri/src/mcp/tools.json` and the window's handlers (`lib/agents/workspace/chats.ts`, new); the grant's scopes (`src-tauri/src/agents/grants.rs`, `verbs.rs`: posting as Publishing); `services/sync/src/mcp/tools.ts`; `apps/desktop/src/lib/ai/commands/table.ts` and `docs/ai-sidebar.md` section 3 (`/catchup`, `/reply`); the search panel's chat hits (`lib/search/`); Send to chat in the editor's menu; Add as task and Save as note; program tokens' `chats.write` | the verbs of 4.14 on both servers, the asks and "Always in this chat", `<untrusted>` marks; `@nib` in the composer handed to the sidebar; the live note card and the share prompt; quoting a selection; a message to a task through quick add and to a note; the catch-up summary | verb tests through the MCP harness: a post asks, a draft does not, a chat with yourself does not, a grant without the space sees no chats, another person's words come back marked; the AI command table test green with the new rows; a drive: a message to a task lands in the inbox with its link, and the link opens the message | 3 |

**Wave 1** is lanes 1, 2 and 3 together: a pure package, the Worker and the profiles, which
meet at 6.1's types and nothing else. **Wave 2** is lanes 4, 5 and 6 once lanes 1 and 2 are
on main (lane 3 may still be running: that is six), each against fixtures until the other
lands; lane 5 draws what lane 4 stores and owns none of its logic. **Wave 3** is lane 7,
after lanes 4 and 5. If `docs/tasks.md`'s wave 2 runs at the same time, its lane 5 and this
lane 6 are one push module: whichever starts first builds it, the other uses it.

Docs each lane updates: lane 1 `docs/conventions.md` (the package and the words `chat` and
`reply`); lane 2 `docs/sync-v2.md` sections 7 and 8 (the routes, the object, the tables);
lane 3 `docs/collaboration.md` ("Carets and presence": avatars) and `docs/design.md`; lane 5
`docs/design.md` (the panel and the chat) and `docs/keyboard.md`; lane 6 `docs/mobile.md`
(push); lane 7 `docs/agent-native.md` 5.3 and 9.1, `docs/ai-sidebar.md` section 3 and
`docs/automation.md`.

### 6.3 Risks

- **FTS5 in a Durable Object's SQLite and in the bundled `rusqlite`.** Both are proved on day
  one by lanes 2 and 4; the fallback is a words table with a prefix index, slower but
  exact.
- **A new Durable Object class** is a migration that cannot be taken back. Proved with
  `wrangler deploy --dry-run` before anything else, as `NoteRoom` was.
- **Variable-height virtualisation** is where chat clients stutter. Lane 5 builds the measured
  window first, against 100,000 seeded rows, before any styling.
- **The transcript and other writers.** Obsidian or a sync tool editing a month file is
  overwritten at the next change; the watcher must never read it as a foreign edit (lane 4's
  test).
- **Push needs accounts nib does not have yet**: a Firebase project, an APNs key (the Apple
  developer account `docs/mobile.md` already waits on) and VAPID keys as Worker secrets.
  Lane 6 builds against recorded answers and ships what the secrets allow.
- **Fan-out cost.** A post in a chat of 200 is up to 200 hub pokes; coalescing per member per
  two seconds bounds it, and the ceiling of 200 people is the space's.

## 7. Decisions for Emil

1. **Direct messages live in the account, not in a space**, as Slack's and Discord's do; their
   transcript is written only if Settings keeps them in a chosen space (`Direct/`). Or make a
   DM a chat in the starter's space, shared on its own?
2. **Transcripts on disk**: every device writes each chat as month files of markdown, derived
   and never synced, so Obsidian, search, backlinks and the agent read chats as text. Or keep
   chats out of the space folder entirely, with an export?
3. **No end-to-end encryption by default**, as Slack, Discord and Teams; a secret direct
   message with MLS later, as Telegram's secret chats. Or encrypt every chat end to end now,
   at the cost of push previews, the connector, server search and history on new devices?
4. **Push from the Worker now** (FCM, APNs, Web Push), shared with tasks' reminders. Without
   it a phone hears nothing unless nib is open on it. Build it in this round, or later?
5. **Read receipts on by default** in direct messages and chats of up to ten, reciprocal. Or
   off by default?
6. **Calls, video and screen share later**, through Cloudflare's realtime SFU when the chats
   are in use, rather than in this round. Or drop them and leave calls to other apps?
7. **`@nib` runs only the asker's own agent**, and nothing anybody else writes ever starts an
   agent. Or allow a shared agent as a chat member (Slack's agents in channels), with its
   owner's grant?
8. **A deleted account's messages in other people's chats stay** as "Deleted account"
   (Discord). Or delete them with the account?
9. **"Replies", not "threads"**, because the AI sidebar's conversations are threads. Agreed?
10. **Who can message you**: people you share something with, plus one request from anybody
    with your address. Or anybody, or only people you share with?
11. **The Ctrl+T letter is M** (C is the canvas). Agreed?

## Sources

[sl-format]: https://slack.com/help/articles/202288908-Format-your-messages
[sl-edit]: https://slack.com/help/articles/202395258-Edit-or-delete-messages
[sl-threads]: https://slack.com/help/articles/115000769927-Use-threads-to-organize-discussions-
[sl-unread]: https://slack.com/help/articles/226410907-View-all-your-unread-messages
[sl-search]: https://slack.com/help/articles/202528808-Search-in-Slack
[sl-schedule]: https://slack.com/help/articles/1500012915082-Schedule-messages-to-send-later
[sl-save]: https://slack.com/help/articles/360042650274-Save-messages-and-files-for-later
[sl-pins]: https://slack.com/help/articles/205239997-Pin-messages-and-bookmark-links-and-files
[sl-status]: https://slack.com/help/articles/201864558-Set-your-Slack-status-and-availability
[sl-links]: https://slack.com/help/articles/204399343-Share-links-and-set-preview-preferences
[sl-notif]: https://slack.com/help/articles/360056534254-Manage-notifications-for-specific-channels-and-direct-messages
[sl-dnd]: https://slack.com/help/articles/214908388-Pause-notifications-with-do-not-disturb
[sl-keys]: https://slack.com/help/articles/201374536-Slack-keyboard-shortcuts
[sl-agents]: https://slack.com/help/articles/33076000248851-Work-with-AI-agents-in-Slack
[sl-ai]: https://slack.com/help/articles/25076892548883-Guide-to-AI-features-in-Slack
[dc-md]: https://support.discord.com/hc/en-us/articles/210298617-Markdown-Text-101-Chat-Formatting-Bold-Italic-Underline
[dc-forward]: https://support.discord.com/hc/en-us/articles/24640649961367-Message-Forwarding
[dc-voice]: https://support.discord.com/hc/en-us/articles/13091096725527-Voice-Messages
[dc-polls]: https://support.discord.com/hc/en-us/articles/22163184112407-Polls-FAQ
[dc-forums]: https://support.discord.com/hc/en-us/articles/6208479917079-Forum-Channels-FAQ
[dc-threads]: https://support.discord.com/hc/en-us/articles/4403205878423-Threads-FAQ
[dc-profiles]: https://support.discord.com/hc/en-us/articles/4409388345495-Per-Server-Profiles
[dc-nick]: https://support.discord.com/hc/en-us/articles/219070107-Server-Nicknames
[dc-roles]: https://support.discord.com/hc/en-us/articles/214836687-Discord-Roles-and-Permissions
[dc-chperm]: https://support.discord.com/hc/en-us/articles/10543994968087-Channel-Permissions-Settings-101
[dc-timeout]: https://support.discord.com/hc/en-us/articles/4413305239191-Time-Out-FAQ
[dc-automod]: https://support.discord.com/hc/en-us/articles/4421269296535-AutoMod-FAQ
[dc-storage]: https://discord.com/blog/how-discord-stores-trillions-of-messages
[wa-delete]: https://blog.whatsapp.com/deleting-messages-for-everyone
[wa-edit]: https://blog.whatsapp.com/now-you-can-edit-your-whatsapp-messages
[wa-multi]: https://engineering.fb.com/2021/07/14/security/whatsapp-multi-device/
[wa-transcripts]: https://blog.whatsapp.com/introducing-voice-message-transcripts
[wa-polls]: https://faq.whatsapp.com/796470361614974
[tg-faq]: https://telegram.org/faq
[tg-scheduled]: https://core.telegram.org/api/scheduled-messages
[sg-receipts]: https://support.signal.org/hc/en-us/articles/360007059812-Read-Receipts
[sg-typing]: https://support.signal.org/hc/en-us/articles/360020798451-Typing-Indicators
[sg-self]: https://support.signal.org/hc/en-us/articles/360043272451-Note-to-Self
[sg-edit]: https://support.signal.org/hc/en-us/articles/6255134251546-Edit-Message
[sg-previews]: https://signal.org/blog/i-link-therefore-i-am/
[sg-giphy]: https://signal.org/blog/signal-and-giphy-update/
[ms-loop]: https://support.microsoft.com/en-us/teams/apps-service/send-a-loop-component-in-microsoft-teams-chats
[ms-announce]: https://support.microsoft.com/en-us/office/send-an-announcement-to-a-channel-in-microsoft-teams-8f244ea6-235a-4dcc-9143-9c5b801b4992
[ms-important]: https://support.microsoft.com/en-us/teams/chat/mark-a-message-as-important-in-microsoft-teams
[ms-receipts]: https://support.microsoft.com/en-us/teams/chat/use-read-receipts-for-messages-in-microsoft-teams
[mx-threads]: https://matrix.org/blog/2022/09/30/this-week-in-matrix-2022-09-30/
[el-security]: https://docs.element.io/latest/element-support/matrix-account-management/securing-a-matrix-account/
[mls]: https://datatracker.ietf.org/doc/html/rfc9420
[do-limits]: https://developers.cloudflare.com/durable-objects/platform/limits/
[ob-blocks]: https://help.obsidian.md/Linking+notes+and+files/Internal+links#Link+to+a+block+in+a+note
