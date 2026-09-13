# Web tabs

A tab can be a website. The page is rendered by the system's own browser engine,
it has a bar with back, forward, reload and an address, and the site it shows is a
document in the space like a note or a canvas: a row in the file list with a globe
in front of it, a name somebody can rename, a bookmark, a `[[link]]`, a hit in the
search, a file the sync carries.

Emil, 2026-09-10: *"a tab can be a website rendered by Chromium, a URL bar,
back/forward, and a NOTE TYPE for it so a website is a document in the space."*

Chromium is half right, and the half that is wrong matters enough to say in the
first paragraph: on Windows the engine is WebView2, which **is** Chromium; on
macOS it is WKWebView, which is **WebKit** and is what Safari is built on; on
Linux it is WebKitGTK. nib does not ship a browser engine and never will - a
second Chromium is 150 MB and its own update channel - so a web tab is the
system's engine, and a page that behaves differently on a Mac is behaving the way
Safari behaves.

## The file

**A website in the space is a shortcut file: `Svelte docs.url`.**

```ini
[InternetShortcut]
URL=https://svelte.dev/docs
Title=Svelte docs
Nib-Added=2026-09-12T08:30:00.000Z
```

The format is nobody's invention. `.url` is the Windows Internet Shortcut, which is
what Explorer writes when a page is dragged out of a browser onto the desktop, and
double-clicking one opens that page in the reader's own browser on a machine that
has never heard of nib. It is an INI file, so a reader for it is twenty lines, and
every program that reads one steps over a key it has no use for - which is why nib's
own two keys sit in the same block rather than in a section of their own.

Three keys is the whole file. `URL` is the format's own and the only one it
requires. `Title` is here rather than taken from the file name because a name on
disk cannot hold `?`, `:` or `/` and a page's title often does. `Nib-Added` is the
day, which is what `date:` was. Nothing else: a favicon would be a picture inside a
text file, and `IconFile` in this format names an `.ico` on this machine, which is
not a thing that travels.

**`.webloc` is read too, and never written.** That is the same idea on macOS - a
plist with a `URL` string in it - and it is what Safari makes when a page is dragged
into a folder. A space that has one in it opens it as a website rather than as a
file nib has no use for. Only the XML kind: a binary plist is a format this app has
no business carrying a parser for, and Safari writes XML.

### What it was, and why it changed

A website used to be a note: `Svelte docs.md`, with `url:` in its front matter. The
argument for it was Obsidian, which lists the extensions it knows and hides every
other one, so a website written any other way is a row that is simply not there in
the same vault opened next door.

That argument still holds, and the answer is still the same - a `.url` file **is**
invisible in Obsidian - and it lost anyway, because the cost on this side was every
other thing a note is. A website was in the note count, in the graph as a note,
among the notes a link could be made against, in the words a search read, and one
front-matter line away from being prose. The mark in the file list could not come
off the name, so every list that drew one had to ask the link index what the file
said, and a row opened before that pass had finished opened as a note. And the file
itself was a heading and a link, written so that it would read as something in a
vault.

A shortcut is a document of a kind, the way a canvas and a PDF are. Its name says
what it is, so nothing reads it to draw a row; it is not a note anywhere; and it is
a file two dozen other programs already know. What Obsidian shows for it is a row
that is not there - which is what Obsidian shows for a `.canvas` file in a vault
where nobody has turned the setting on, and nib has lived with that for as long as
it has had canvases.

Everything else about a website in the space is unchanged, and the name is what
carries it: the globe in the file list (`file-mark.ts`), open, rename, bookmark,
`[[Svelte docs]]` with or without the extension (`links.ts`, `wikilink/notes.ts`),
the sync and the versions (`services/sync/src/notes.ts`), the trash, and the search
- which reads a shortcut as the small text file it is, so a site is found by its
address as well as by its name (`search.rs`).

### A note that is still a website

**A `url:` note converts on the first open.** Opening one writes `Svelte docs.url`
beside it and puts the note in Recently deleted; the tab that opens is the
shortcut's. A palette row - **Convert website notes** - does the whole space at
once, and it is only offered while a space still holds one.

**A note somebody had written in stays a note.** What the old format wrote under the
front matter was a heading and the address as a link, and a file holding only those
two is the shortcut said twice over. Anything else in it is somebody's writing: that
note stays where it is, with the `url:` line taken out, beside the shortcut that now
carries the address. So one file can become two, which is exactly what was in it.

### Making one

Two gestures, because there are two ways somebody arrives at a website.

**New web note** - in the file list's menu, the tab strip's plus, the File menu and
the palette - is the file list's own gesture and works the way a new note's does: a
row goes into the tree waiting to be named, the name it is given is the title, and
the shortcut is written the moment there is one. The address is what the bar asks
for next. The row is in the list from that first moment, which is the whole point of
naming a thing before making it.

**Open a website** is the other way round, for somebody who has an address and no
name in mind: a tab with an address field and no file yet. The file is written the
moment the page says what it is called, named after the title, the way every note in
a space keeps itself. No file first, because a folder of `Untitled` shortcuts is
what asking for the name first would leave behind here.

Neither is offered on a phone, and neither is in the editor's `/` menu. A phone has
no bar to type an address into and no tab to put a page in - the row would make a
file nobody there could finish; see "A phone" below. And `/` is the menu for what
goes **in** the note being written: every row of it puts a block on the page, and a
website is a file beside the note rather than something in it. The two menus that
make files - the file list's and the tab strip's - are where it belongs.

**Following a link inside the page does not rewrite the file.** The file says where
the document points; where the reader has got to is the tab's, kept in the session
so a restart comes back on the page they were reading. A file that moved under every
click would be a file no link could point at. An address **typed into the bar** does
rewrite it, because that is somebody saying where the document points.

## The tab, per platform

| | what draws the page | why |
| --- | --- | --- |
| Windows | a child webview: WebView2, Chromium | the only embedding that renders a site the way a browser does |
| macOS | a child webview: WKWebView, WebKit | same, with Safari's engine |
| Linux | a child webview: WebKitGTK | same |
| the browser build | a card, and a sandboxed `<iframe>` once the reader presses it | a page in a browser has nowhere else to go, and no way to know whether a frame will work |
| Android and iOS | the system browser, not a tab | see below |

### A desktop: a webview over the pane

Tauri can put a second webview inside a window and give it bounds of its own.
That is what a web tab is: the pane leaves a hole in the document, measures it,
and the crate places the page exactly there. Nothing about the window changes and
nothing about the app's own webview is involved.

The one thing to know about the mechanism is that multi-webview support is behind
Tauri's `unstable` Cargo feature, which this crate now turns on. Unstable there
means the Rust API may be renamed in a minor release - not that the engine
underneath is experimental; it is the same WebView2 or WKWebView the app itself
runs in. What nib calls of it is `Window::add_child`, `Manager::get_webview` and a
handful of methods on the webview it hands back, all in one file, so an upstream
rename is one file to follow. See `apps/desktop/src-tauri/src/web_tabs.rs` and the
comment in `Cargo.toml`.

What the window may ask for is deliberately small: make a page, move it, show it,
hide it, send it to an address, step its history, read it for a clip, close it.

#### Where a page may be built, which is not where the request arrived

This is the one thing in this file that shipped wrong, and what it cost was the
whole app. Emil, 2026-09-13: *"When I open one, nib just freezes and all the
buttons don't do anything anymore."*

A `#[tauri::command]` that is not `async` runs **inline inside the callback
WebView2 hands the app its IPC in** - on the window's own thread, inside one of the
engine's own event handlers. Building a child webview from in there is a deadlock
rather than a stall: the platform creates a `CoreWebView2Controller`
asynchronously, wry waits for it by running a *nested message loop*
(`webview2_com::wait_with_pump`), and the engine will not deliver that completion
callback to a thread that is already inside one of its handlers. So the pump spins,
the handler never returns, the request that started it is never answered, and every
command the window sends afterwards queues behind it for ever.

**The window looks perfectly alive while that happens**, which is why it took a
measurement to find. A nested pump is still a pump: the window answers `WM_NULL` in
half a millisecond, `IsHungAppWindow` says no, Explorer never draws "Not
Responding", and the pixels are all there. Everything that needs the app to answer
is dead. So the probe asks the app itself as well, over its own automation endpoint,
one cheap verb a second. Measured on this machine, before and after, by
`scripts/web-freeze-probe.py`:

| | before | after |
| --- | --- | --- |
| the message pump, worst reply | 0.55 ms, and never once dead | 2.4 ms, never dead |
| the window's own answers while a tab opens | **4 of 8 asks unanswered**; by hand, two trivial verbs timed out at 30 s each, minutes after the tab was opened | **0 of 24 unanswered**, 31 ms at worst |
| the page itself | never appeared: a bar over an empty pane | the page, in the pane |

So `web_open` is `async`, which takes it off that callback and onto the async
runtime, and the build itself is posted to the event loop with
`app.run_on_main_thread`, which answers over a channel once the controller exists.
Both halves are needed: the nested wait has to happen where the engine is not
inside a handler, and the window still has to be told whether there is a page to
place. The other four commands stay on the window's thread on purpose - each is one
call into the engine and none of them waits for the platform, so none runs a nested
loop - and `web_open` is the one that had to move.

Two things follow from the page being built somewhere else. A placement that
arrives while a page is on its way is kept and applied when it lands, because the
pane can be dragged, switched away from or closed in that time; and one tab builds
one page at a time, claimed in the crate as well as in the window, because two
webviews under one label is not a thing that can exist.

**A window with a page in it is not a `WebviewWindow`.** Tauri's
`get_webview_window` only answers for a window whose webviews are all itself, so
from the moment a web tab puts a second webview in the window it answers nothing at
all - and everything that asked that way stopped working while a website was open:
the `nib` command line said the app had no window, a `nib://` link never raised it,
and a second launch handed its file over to a window that was never brought
forward. Nothing in the crate asks that way now; `get_window` is the call, because a
window is what all of them wanted.

**Following the pane.** A resize observer on the hole for a pane being dragged,
the window's own resize, and a look after any press - and the crate is only told
when the answer has changed, so a keystroke in a note beside the page costs one
layout read and no IPC.

**Hidden when the tab is not showing, and taken down when nobody comes back.**
Switching tabs hides the page rather than closing it, because coming back to a tab
should not be a reload. After five minutes hidden the webview is closed and the
tab keeps its address: a window left open overnight with eight sites in it is
holding no browsers. Looking at the tab again opens the page where it was. Closing
the tab takes the webview with it.

**A native webview draws above every pixel of HTML in the window.** So while
anything of the app's is over the page - a menu, a sheet, the palette, the
settings - the page is hidden, or the menu would come up behind it. The app asks
the document which element is on top at the middle of the hole rather than keeping
a list of everything that can open, so a new kind of overlay is covered the day it
is written. The cost is that the page blinks out while a menu is open over it,
which is the honest trade: see "What is left" below.

**Back and forward are the page's own history.** Neither WebView2 nor WKWebView
hands Tauri a Go Back, so the step is `history.back()` in the page, which is what
a browser's own button calls. Whether there is anywhere to step is kept by the
crate as a trail of addresses, because the engine will not answer that either, and
a back arrow that is always lit is an arrow that lies half the time. A redirect
can leave an extra entry in the trail; that is the price of not having the engine's
own answer.

### The browser build: a card, and a frame when asked

A page in a browser can only be shown in a frame, and a great deal of the web
refuses to be framed: `X-Frame-Options: DENY` and CSP's `frame-ancestors` are a
header the site sends and the browser obeys.

**A page cannot find out whether framing worked.** That was measured rather than
assumed, with all four cases served side by side:

| the frame was pointed at | `load` | its location | its document | `length` | the resource entry |
| --- | --- | --- | --- | --- | --- |
| this origin, allowed | fires | reads back | readable | 0 | `iframe:200:363` |
| another origin, allowed | fires | throws `SecurityError` | null | 0 | `iframe:0:0` |
| another origin, refused | fires | throws `SecurityError` | null | 0 | `iframe:0:0` |

The two rows that matter are identical in every column. No site is on the app's own
origin, so there is nothing to read: the first design here tried to tell them apart
by the frame's own location and was simply wrong - it called a refusal a success,
which is the worse of the two mistakes.

So a browser build asks. The pane shows a card - the site's favicon, the page's
title, the origin - and two rows: **Show it here**, which swaps the frame in, and
**Open in the browser**, which takes the page where it will certainly work. One
press per tab and not per page: saying yes to a site is about this tab, and once
the frame is up, typing another address re-points it.

That is the gesture the app already has for a page embedded in a note, for the same
two reasons - the card cannot know whether the frame will work, and nothing should
be loaded from a site before the reader asks for it. See `web-embed.ts` in
`@nib/markdown` and `web-frame.ts` in `@nib/editor`.

**A HEAD request through the Worker would get rid of the press**, and is the only
thing that would: ask `services/sync` to fetch the headers and report. It was not
taken. It makes the app's own server a fetcher of arbitrary addresses on a reader's
behalf, which is a thing that gets used for something else; it is a round trip
before a page the reader has already chosen; and it needs the Worker reachable to
answer something about a page in front of them. If the press ever grates, that is
the route to write, with the loopback and private ranges refused and the answer
cached.

### A phone: the system browser

**Tapping a website on a phone opens the phone's browser.** It is the answer
rather than a gap.

A phone app's webview is the app's own: no extensions, no content blocking, none
of the reader's logins, no password manager, no reader mode, and no way to hand
the page on to anything else. Their browser has all of that. The pane is also 390
points wide, where a bar with six controls and a page is two things fighting for
one column. And Tauri has no child webviews on a phone at all - `add_child` is
desktop only - so the in-app option there would be a frame, which most sites
refuse.

The file is still theirs in the space: the shortcut is a bookmark on a phone, which
is what a website on a phone is worth being - and a `.url` is a bookmark to the
phone's own system too. Making one is not offered there, because the address is
asked for in a bar and there is no bar; a tablet gets both, and the frame and the
card, because it has the room.

## The bar

Back, forward, reload, the address, a clip, the dots. The same `.nib-glyph`
squares the find bar is made of, the same `.nib-field`, the same row scale, in the
same place under the tab strip - a bar over the page would cover the first line of
it.

The address field is one control with two faces. Nobody typing in it wants to read
a title and nobody reading wants to read an address, so it holds the whole address
while it has the keyboard and `svelte.dev - Svelte docs` while it does not. **The
origin is shown plainly either way**, with `www.` dropped the way every browser
drops it, and an `http:` page keeps its scheme in front of the host, because that
is the one thing about an address worth warning somebody about.

What somebody types is read once, in `web-tab/address.ts`: a host gets `https:`
(`localhost:1425` is a host and not a scheme, which is the special case every
browser makes), a scheme is taken as written so `javascript:` never opens, and
words are a search - DuckDuckGo, because the search has to go somewhere and that
is the one that asks for the least.

| key | |
| --- | --- |
| Ctrl+L | the address field, in the pane that has the focus |
| Alt+Left, Alt+Right | back and forward, which in a web tab is the page's history - the same key a note tab walks its own trail with |
| Escape in the field | puts the resting face back and lets go of the field |

Ctrl+L is the chord CodeMirror selects a line with, and both keep it. That works
because the bar reads it where the bar is rather than off the window: an app-level
binding never reaches the editor, so the two could not have shared it, while a pane
showing a page has no editor to shadow. It is in the registry like every other key
- `web.address`, under View - so it can be found and changed. The canvas's keys are
read the same way.

**While the page itself has the keyboard, its keys are the page's.** After a click
into a site, Ctrl+L is that site's shortcut and the app never sees the press: that
is what a webview of its own means, and the alternative would be registering an
accelerator with the operating system. The bar is one click away.

The dots hold what a browser keeps in the same place: open in the browser, copy
the address, clip the page, and what this site is allowed.

## Clipping the page

The Clip glyph writes the page into the space as a note, through the same two
functions the clipper extension uses: `@nib/markdown/from-html` for the words and
`writeFrontMatter` for the block above them, with `source:` and `date:` as the
extension writes them. A page clipped from a tab, the same page clipped from the
extension and a page pasted into a note come out as the same markdown.

What none of the three carries out of a page: a link or a picture whose target no
surface would follow anyway - `javascript:`, a `data:` document, an SVG standing in
for an image - which the converter now drops rather than writing into a file that
outlives the page; and a fence saying `query` or `ai`, which are the two fence
languages that do something rather than show something. Every other language a page
names is kept, `js` and `mermaid` included: a clipped page of documentation is the
commonest clip there is. See `THE_APP_S_OWN` in `packages/markdown/src/from-html.ts`.

On a desktop the crate reads the page with a script in the site's own document, so
what is clipped is what the reader can see rather than what the server sent. What
somebody has selected wins; with nothing selected it takes the article - the
element a page says holds its writing, or the longest candidate, and otherwise the
body with the navigation, the header, the footer and the forms cut out of it. Every
address comes back resolved, because the note is read from a folder and not from
the site.

The answer comes back through the engine's own script callback, not through the
app's IPC. That is what lets a page be read without the page being given anything
to call.

**In a browser build a clip is the link.** The frame's document belongs to
somebody else's origin and cannot be read at all, so the note is the title and the
address. The glyph says so before it is pressed: it reads "Clip the link" there and
"Clip this page" on a desktop, which is better than an apology afterwards.

The clip does not open in a tab. The page is still what the reader is looking at,
and a note that opened over it would take them away from what they were reading;
the row appears in the file list, which is where a clip belongs.

### The content policy

The app runs under a policy written once in `apps/desktop/src/csp.ts`, and a web
tab needed nothing added to it.

On a desktop the page is not in the app's document at all: a child webview loads a
site over the network, and Tauri's policy is injected into what Tauri's own
protocols serve. The site is governed by whatever policy the site sends, which is
how a browser works.

In a browser build the frame is the app's, and `frame-src 'self' https:` is already
what it needs - the line is there for the embed cards, and a web tab frames the same
way for the same reasons. The favicon on the card is covered by `img-src`'s `https:`,
and a card whose mark will not load shows no mark rather than a broken picture.

## Privacy and safety

**A page shares no session with the app.** The child webview is given a data
directory of its own - `web` inside the app's config folder on Windows and Linux,
a WebKit data store of its own on macOS - so a site's cookies and logins sit in a
profile the app's own session is not in, and clearing one never touches the other.
Cross-origin reading is the engine's rule in either case; this is about what sits
in the same store on disk. On macOS before 14 there is no such API and WKWebView
falls back to the default store, which is the one case where the two share a
profile.

**No nib IPC reaches the site**, three times over:

1. The capabilities name the app's own **webviews** rather than the windows they
   sit in. A capability that names a window grants every webview in that window,
   whatever its own label says - so a website in a tab would have been holding
   `opener`, the dialogs and the updater. The two patterns name the same two
   windows they always did, because a webview built by `WebviewWindowBuilder`
   carries the window's label, and a web tab's `web-...` is not among them.
2. A remote origin matches no capability here, which Tauri refuses on its own.
3. The globals that reach the crate are deleted before the page's first script
   runs.

**Every permission is refused, and refused by not being there.** The camera and
the microphone, the clipboard, where you are, and the buses a page can reach
hardware over: the APIs are taken off `Navigator.prototype` in the same script, so
the engine never has a request to prompt about. Two of them can be allowed by
hand, per site, from the dots menu - the camera, which stands for the microphone
because they are one API and a page that may watch you may hear you, and the
clipboard. Nothing else can be allowed at all: a note-taking app has no reason to
let a page talk to a USB device. Grants live on the device, never on the account,
and changing one builds the page again, because the guard runs once and a page
already running was built under the old answer.

**Only http and https, and never the app itself.** `file:` would read this
machine, a scheme the system knows would hand the page to another application, and
`tauri://localhost` would put nib inside a tab with the site's script beside it.
The rule is in the crate as well as in the app, because it is what every link
inside the page is judged by, not only what somebody types. A window the page asks
for leaves the app the way every other link does: the system browser - and it is
judged by the same rule first, because `window.open` names a scheme of the page's
choosing and the system opens whatever is registered for one. A page is handed
over; `nib://`, `file:`, `smb:` and whatever else a machine has registered are
dropped, or a site could drive this app through its own links by asking for a
window it was never going to get.

**No collaboration.** A website holds no words, so it is never in a room and the
service never has a document for it. Said twice over, at both ends of the file:
`holdsWords` answers no for a web tab, and `rooms/kind.ts` answers *no room at all*
for a `.url` path, which is the end both machines can see. Not a switch that could
be turned on by mistake, then, but two consequences of what the file is. It syncs,
versions and goes to the trash like every other document.

## Where the code is

| | |
| --- | --- |
| `apps/desktop/src-tauri/src/web_tabs.rs` | the child webview: make, place, show, navigate, step, read, close. Where a page may be built, the guard script, the trail, the address rule. Unit tested |
| `apps/desktop/src-tauri/src/paths.rs` | `is_shortcut`, beside the other three kinds |
| `apps/desktop/src-tauri/src/tree.rs` | the four kinds the file list shows |
| `apps/desktop/src-tauri/src/search.rs` | a shortcut is searched as the text it is, so a site is found by its address |
| `apps/desktop/src-tauri/src/links.rs` | a website as a node in the index, and `url:` off every note, which now means a note that wants converting |
| `apps/desktop/src-tauri/capabilities/default.json` | webviews, not windows |
| `apps/desktop/src/lib/web-tab/shortcut.ts` | the file: written, read, and `.webloc` read. Pure, tested |
| `apps/desktop/src/lib/web-tab/note.ts` | what a clip says, and what the old format said. Pure, tested |
| `apps/desktop/src/lib/web-tab/address.ts` | what somebody typed, and the origin plainly. Pure, tested |
| `apps/desktop/src/lib/web-tab/frame.ts` | what a frame may do, and the measurements behind asking first |
| `apps/desktop/src/lib/web-tab/pages.svelte.ts` | the page each tab is on, the webview's life, the five-minute sleep. Tested |
| `apps/desktop/src/lib/web-tab/permissions.svelte.ts` | what each site is allowed, which is nothing |
| `apps/desktop/src/lib/web-tab/clip.ts` | where the HTML comes from |
| `apps/desktop/src/lib/web-tab/WebTab.svelte` | the pane: the hole, the frame, the card |
| `apps/desktop/src/lib/web-tab/WebBar.svelte` | the bar |
| `apps/desktop/src/lib/web-tab/menu.ts` | the dots |
| `apps/desktop/src/lib/file-mark.ts` | the globe, off the name like every other mark |
| `packages/markdown/src/links.ts` | `isWebTarget`, and a website among the files a link resolves through |
| `packages/editor/src/wikilink/notes.ts` | `[[Svelte docs]]` with the extension left out |
| `apps/desktop/src/lib/rooms/kind.ts` | no room for a website, said at the file's end |
| `services/sync/src/notes.ts` | the extensions the account carries |
| `apps/desktop/src/lib/workspace.svelte.ts` | `openWeb`, `createWebsite`, `openWebsite`, `keepWeb`, `webAimed`, `asShortcut`, `convertWebsites`, and the routing in `openEntry` |
| `scripts/web-tab-e2e.py` | the drive: the file, the mark, the tab, the card, the clip |
| `scripts/web-freeze-probe.py` | the drive for the freeze: the pump, the window's own answers, and the log |
| `apps/desktop/test/effects/web-tab.effect.test.ts` | the pane, mounted, which is where a website used to take the window down with it |

## What is left

- **The page blinks while something is over it.** A native webview cannot be drawn
  under the window's own HTML, so an overlay means hiding the page. The fix if it
  ever grates is the one reactive flag every overlay already could bump, rather
  than the element test the app makes now.
- **A browser build asks before it frames a page.** Nothing on the page can tell a
  framed site from a refused one, so the card asks; the Worker route above is what
  would remove the press.
- **A redirect can leave a spare entry in the back trail.** The engine will not
  say whether a navigation was a redirect, and the alternative is a back arrow
  that lies.
- **The article a clip takes is nib's own pick, not Readability's.** The extension
  runs Mozilla's extractor, which lives in `apps/clipper`; sharing it would mean
  moving `extract.ts` into `packages/markdown`, which is worth doing and is not
  this batch.
- **A web tab has no reading view, no export and no glasses.** There is nothing to
  render: the document is a window on somebody else's page. Clipping it is how a
  page becomes words this app owns.
