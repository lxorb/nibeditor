# Automation

Two ways to drive nibeditor from outside it: a `nib://` link, which is what a
shortcut, a launcher or another program can hand the system, and `nib`, which is
the same app driven from a terminal.

Both go through one dispatcher, and every verb in it goes through the call the app
itself makes. Opening a note is the call the palette's file row makes. Running a
command is the row out of the registry a key press would have run. Writing words
into a note is the workspace's own replacement, which snapshots the note first, is
one thing to undo, and syncs like any other edit. That is the whole design: a link
and the command line can only do what somebody sitting in front of the app could
do, and it happens the same way, so it is visible and undoable.

## `nib://` links

| Link | What it does |
| --- | --- |
| `nib://open?path=notes/Plan.md` | opens that note |
| `nib://open?path=Plan` | the same, found by name the way a `[[wikilink]]` is |
| `nib://open?space=Day%20job&path=Plan.md` | switches to that space first |
| `nib://open?path=Plan.md&heading=Later` | opens it and lands on the heading |
| `nib://open?path=Plan.md&block=idea` | lands on the block named `^idea` |
| `nib://new?name=Idea` | makes a note |
| `nib://new?path=inbox/Idea.md&content=Words` | makes it at a path, with words in it |
| `nib://new?path=inbox/Today.md&content=Words&append` | adds to the note that is there |
| `nib://new?path=inbox/Today.md&content=Words&prepend` | adds it at the top instead |
| `nib://new?name=Idea&content=Words&silent` | writes it without opening it |
| `nib://search?query=tag:%23work` | opens the search panel on that query |
| `nib://command?id=save` | runs one command out of the registry |

`nib://command` takes the ids the palette knows, minus the handful only somebody at
the keyboard may press: **Record**, **Meeting**, **Dictate**, **Photo** and **Sign
out**. A link is written by anybody and followed by a click, so a microphone, a
camera and who this machine is signed in as are not things a page on the web gets
to reach by handing the system an address. The row itself says so - `byHand` in
commands.ts - and the command line, which is behind this installation's own secret,
runs all of them. `nib commands list` prints the lot.

Written by hand, a path with a space or an ampersand in it has to be
percent-encoded, and `+` means a space. **Copy link to this note** in the palette
writes a correct one for whatever is open, with the heading the caret is in on it.

Both spellings work: `nib://open?…` and `nib:open?…`. So does
`nib://x-callback-url/open?…`, which is how the tools that invented the callbacks
below write it.

### Chaining, with x-callback-url

`x-success`, `x-error` and `x-cancel` are followed when the action is through:

| Key | When |
| --- | --- |
| `x-success` | `nib://new` worked. The values it answered with are added to the address: `path`, and whether the note was made or added to |
| `x-error` | `nib://new` did not, or the link named an action that does not exist. `error` is added |
| `x-cancel` | the app knows what was asked for and will not do it from a link |

```
nib://new?name=Standup&content=Notes&x-success=https://example.com/done
```

**Only `nib://new` says anything back.** `open`, `search` and `command` follow no
callback at all, neither success nor error, and the log says so when a link carried
one. A callback address is written by whoever wrote the link, so whatever a verb
answers is read by them - and `nib://open?path=Plan` answers the path it landed on.
Said back, that is a question about somebody's space: a hundred of those links, each
with an `x-success` of its own, is a listing of what a person keeps notes about, from
a scheme that was only ever allowed to move a window. Success and error are both
silent for the same reason - told apart, they are that question answered more slowly.
`new` is the exception because the caller named the note itself, which is the shape
x-callback-url exists for: file something from a shortcut and carry on. The column is
`byLink` in verbs.ts, `'quiet'` or `'back'`, and a test pins which verbs are which.

Only two kinds of address are followed: `http(s)`, which leaves through the system
browser, and `nib://`, which is followed inside the app and at most one step deep.
Nothing else, deliberately; see below.

### On each platform

- **Desktop.** The installer registers the scheme. A link that reaches an app which
  is already open goes to that window rather than starting a second copy. In a
  development build on Windows, and always on Linux, the app registers the scheme
  itself at launch because there is no installer to do it.
- **Android.** An intent filter on the one activity, which is `singleTask`, so a
  link goes to the window that is there.
- **The web app.** A browser will not let a page register `nib://`, only
  `web+nib://`, so that is what the manifest registers. The browser reopens the app
  at `/?nib=<the link>`, the app follows it and takes it off the address so a
  reload does not follow it twice. Everything above works, spelled `web+nib://`.

## `nib`, the command line

`nib` drives the app that is running. It is a Node script with no dependencies:

```sh
node apps/cli/nib.mjs files list
pnpm --filter @nib/cli link --global && nib files list
```

It ships in no installer, on purpose. The only way an installer can carry a command
is as a sidecar, which is a second compiled binary in every bundle on every
platform for something almost nobody runs; a Node script adds nothing to any
download. Node is already this repository's answer for driving nib without the app
(`scripts/nib-sync.mjs`), so this sits beside it.

There is no browser build of `nib` and there will not be: a tab has no socket to
listen on. Run against the web app it says so rather than failing to connect.

### Verbs

| Verb | What it answers or does |
| --- | --- |
| `open <path> [--heading H] [--block B]` | opens a note |
| `new <name> [--content T] [--append] [--prepend] [--silent]` | makes one |
| `search <query>` | opens the panel on the query, prints the hits |
| `files list` | every file in the space |
| `files read [path]` | one note, or the one that is open |
| `files write <path> [--content T] [--from FILE|-]` | replaces what a note says |
| `files move <path> <to>` | moves or renames it, rewriting every link to it |
| `files delete <path>` | to Recently deleted, where the app's own delete puts it |
| `links [path]` | every link out of a note, resolved |
| `backlinks [path]` | every link in the space that points at it |
| `orphans` | notes nothing links to and which link to nothing |
| `tags` | every tag in the space, most used first |
| `properties read [path]` | the front matter, by kind |
| `properties set <key> [value] [--path P]` | sets one key, or removes it with no value |
| `outline [path]` | the headings |
| `bookmarks` | what is kept above the file list |
| `words [path]` | what the status bar counts |
| `commands list` | every command the palette would offer, with its key |
| `commands run <id>` | runs one |
| `sync status` / `sync now` | the light in the corner, and a pass now |
| `publish status` / `publish now` | whether the space is on the web, and a pass |
| `window` | where the window is and how big |
| `screenshot [--out FILE]` | a picture of the window |
| `eval <code>` | runs JavaScript in the window |
| `verbs` | the app's own list of these |

Every verb takes `--space` to work somewhere other than the space that is open;
naming one switches to it, because the result has to be visible. A verb that reads
a note reads the one that is open when no path is given, unsaved keystrokes and
all.

`--json` prints the whole answer as JSON; without it the answer is printed as
lines, with tab-separated columns for a list, which `cut` reads.

`--yes` is required by anything that changes a note: `files write`, `files move`,
`files delete`, `properties set` and `eval`. The app refuses without it, rather
than the script asking, so a caller that forgot cannot be talked past it.

`publish now` is a sync and nothing else, because a published page *is* the note on
the account: the blog serves what the account holds. Turning a blog on stays in the
sheet, where it asks outright.

`screenshot` is Windows and macOS. A webview cannot photograph the window it is
drawn in, so the app says where the window is and the platform's own tool takes the
picture: `scripts/capture-window.ps1` on Windows, `screencapture -R` on macOS. On
Linux there is nothing honest to shell out to, since X11 and Wayland share no
capture tool, and it says so.

## Security

**A path from outside is not a path until it has been read.** One function judges
every one of them, for both roads in: no absolute path, no `..` anywhere, no
character a file name cannot hold, no name Windows keeps for a device. A path that
fails is refused, not clamped.

**A link can do four things.** `open`, `new`, `search` and `command`. Everything
that writes over a note, moves one, deletes one or runs code is out of a link's
reach entirely, and the list is pinned by a test so that adding a verb cannot
quietly widen it. `new` never writes over an existing note: it says the note is
already there unless the link asked to append or prepend.

**A link hears only about what it changed.** `nib://new` answers its `x-success`
with the path it wrote; the three verbs that change nothing answer no callback, so a
link cannot ask whether a note exists and have the answer sent anywhere. See the
table above.

**Writes show their result.** A note that was made or added to is opened. With
`silent` it is written and the row appears in the file list, and the reader is left
where they were. A link that came to nothing says so on the line across the top of
the document, with the reason in the log.

**A callback goes to two places.** `http(s)`, through the opener plugin, whose own
scope is those; and `nib://`, followed inside the app, one step deep so a chain
cannot loop. Not `file:`, not `javascript:`, and not a scheme another program
registered - allowing one would mean widening the opener's scope, and that scope is
the reason a link in a note cannot open anything it likes today. If chaining into a
shortcut app is ever worth it, the change is a scoped `opener:allow-open-url` entry
naming that one scheme, and it should be a decision rather than a side effect.

**The endpoint.** The app listens on 127.0.0.1 on a port the system hands out at
every launch - never a fixed one - and writes it, with this installation's secret,
to `automation.json` in the app's own config folder:

| Platform | Where |
| --- | --- |
| Windows | `%APPDATA%\ch.emilvinu.nib\automation.json` |
| macOS | `~/Library/Application Support/ch.emilvinu.nib/automation.json` |
| Linux | `~/.config/ch.emilvinu.nib/automation.json` |

The secret is 32 bytes of system randomness as hex, kept across launches, and the
file is `0600` where the platform has modes. Every request carries it as
`authorization: Bearer …`, compared in constant time. Four things are checked
before the secret even is, and all four are about a page in a browser rather than a
program: the method must be POST, the body must be `application/json`, there must be
no `Origin` header, and the `Host` must be this endpoint's own address. A page
cannot read the file, cannot send that content type to another origin without a
preflight nothing here answers, and cannot put `127.0.0.1:<port>` in the host while
pointing a name of its own at the loopback.

Nothing inside the app ever reaches the endpoint: the crate hands a request to the
window as an event and the window answers through a command, so the app's own
content policy has nothing to do with any of this. The host check accepts
`localhost:<port>` as well as `127.0.0.1:<port>`, which is the name `connect-src` in
`src/csp.ts` allows, so if anything in the page ever does have to ask, it can.

**`eval` is off.** It runs whatever it is sent with everything the window can
reach, which is every note on the machine. Turning it on means opening
`automation.json` and setting `"eval": true`, which is deliberately the same file
the secret is in; there is no way to turn it on from a request or from a link. The
check is in the crate, before the request reaches any code in the page. The Even
Realities plugin does not carry the code for it at all.

## Driving the app without writing into somebody's notes

**A probe says where its notes go, because nothing else does.** Building under an
identifier of its own - `--config '{"identifier":"ch.emilvinu.nib.probe"}'`, which is
what every drive in `scripts/` does - moves the settings folder and the browsing
profile, and says **nothing at all** about where the spaces are: `spaces_dir` resolves
`Documents/Nib` whatever the identifier is. So a drive that makes itself a space to
open makes it in the reader's own notes folder, beside their notes. That is not a
hypothetical; it is what happened, and the space had to be deleted by hand.

So the spaces root is a variable, and every probe and drive sets it:

```
NIB_SPACES_DIR=/some/temp/folder
```

| | |
| --- | --- |
| when it is set | it **is** the spaces root - used as given, with no `Nib` joined onto it |
| when it wins | outright, and before the documents folder is asked for, so a drive needs no documents folder to exist |
| when it is read | at call time, so a drive sets it and starts the app, with nothing built again |
| what is ignored | anything that is not an absolute path: a relative one would be read against whatever folder the app was started in, and an empty value is what a shell leaves behind when it clears a variable |

A drive points it at a folder it made in the system's temp area and writes its space
there, so a run touches nothing of anybody's. See `SPACES_DIR` and `spaces_named` in
`src-tauri/src/paths.rs`, and `scripts/web-session-probe.py` for a drive that does it.

## Where the code is

| File | What it owns |
| --- | --- |
| `src-tauri/src/paths.rs` | where the spaces are, and the variable a drive says it with |
| `src-tauri/src/uris.rs` | links arriving: the one the app was launched by, and every later one |
| `src-tauri/src/endpoint.rs` | the socket, the secret, and handing a request to the window |
| `src/lib/automation/uri.ts` | reading a link, and where a callback may go |
| `src/lib/automation/inside.ts` | whether a path may be joined to a space at all |
| `src/lib/automation/verbs.ts` | the table, and the one dispatcher both roads go through |
| `src/lib/automation/acts.ts` | the verbs that do something |
| `src/lib/automation/answers.ts` | the verbs that answer a question |
| `src/lib/automation/start.ts` | the listeners, and the callbacks |
| `src/lib/automation/link.ts` | writing a link to what is open |
| `apps/cli/nib.mjs` | words in a terminal into a request, and the answer printed |
