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
URL=https://svelte.dev/docs/svelte/what-are-runes
Title=Svelte docs
Nib-Added=2026-09-12T08:30:00.000Z
Nib-Home=https://svelte.dev/docs
Nib-Icon=https://svelte.dev/favicon.png
```

The format is nobody's invention. `.url` is the Windows Internet Shortcut, which is
what Explorer writes when a page is dragged out of a browser onto the desktop, and
double-clicking one opens that page in the reader's own browser on a machine that
has never heard of nib. It is an INI file, so a reader for it is twenty lines, and
every program that reads one steps over a key it has no use for - which is why nib's
own two keys sit in the same block rather than in a section of their own.

`URL` is the format's own key and the only one it requires. `Title` is here rather
than taken from the file name because a name on disk cannot hold `?`, `:` or `/` and
a page's title often does. `Nib-Added` is the day, which is what `date:` was. The
last two are what makes a web note a browser tab, and a file with nothing to say in
them does not carry them at all - a note nobody has followed a link out of is the
three lines it always was.

**`URL` is where the reading has got to, not where the note was pointed.** Emil,
2026-09-13: *"I believe currently it resets the page every time you reopen it. That
is extremely annoying and should not be. It should basically reopen the exact same
page you had open last time when you open that page. So a web note should
essentially correspond to what is otherwise a browser tab."* So following a link
inside the page moves `URL`, a couple of seconds after the reading settles, and
opening the note tomorrow - or on another machine the space syncs to, because the
file is what syncs - opens the page that was open. Double-clicking the file in
Explorer lands there too, which is the behaviour anybody would expect of a shortcut
to a page they were reading.

**`Nib-Home` is where the note points**: the address somebody typed into the bar, or
the one the note was made with. It is kept because a note whose address had quietly
become the eighth page of somebody's browsing is a note no link could point at, and
because "take me back to the site" is worth being able to answer. Absent means it is
the same as `URL`.

**`Nib-Icon` is the site's own mark, as an address.** A picture inside a text file is
a text file nothing else will read, and `IconFile` in this format names an `.ico` on
this machine, which is not a thing that travels - but the one thing a favicon always
has is somewhere to be fetched from. It is here so the tab strip and the file list
have the site's mark before the page has loaded and on a machine that has never
opened it; a machine with no network falls back to the generic web mark.

**What is *not* in the file is where the reading was on the page, or the trail behind
the tab.** A scroll offset is about this screen at this width and a trail is a
session's own walk, so both live in this device's own storage, keyed by the file's
path - `nib:web-places`, beside the other things a device decides for itself. See
`lib/web-tab/place.ts`. The rule in one line: **the address is the document, and the
place is the device's.**

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

**New web note** - in the file list's menu - is the file list's own gesture and works
the way a new note's does there: a row goes into the tree waiting to be named, the name
it is given is the title, and the shortcut is written the moment there is one. The
address is what the bar asks for next. The row is in the list from that first moment,
which is the whole point of naming a thing before making it.

**A new tab** - the strip's plus, Ctrl+T, the File menu, the buttons a pane with
nothing open shows - is the other way round, and is a browser tab: a live page with an
address field and **no file at all**. Nothing is written while somebody is only reading.
Saving it is the moment they say to keep it - Ctrl+S, File ▸ Save, or Save on the tab's
own menu - and it asks the two questions Chrome asks when a page is bookmarked: what to
call it, and which folder. Then the shortcut goes down with the address the tab is on
and the mark the page reported, and the tab becomes that file in place, still live.

Emil, 2026-09-14: *"if you create a new webnote by clicking the plus for a new tab, then
it should open it as a tab and not create it in the sidebar. Same for canvas and page
notes. And like normal notes, then can then of course be saved as well, but they should
be able to exist in an "unsaved" state. Just as a tab, like a browser tab normally
would."* Which is one model for all four kinds: see `newCanvas` and `newPages` beside
`openWebsite` in `workspace.svelte.ts`, and `pickSavePath` in `workspace/saving.svelte.ts`
for the one sheet that names any of them. A restart brings unsaved tabs back the way a
browser does - the session is the only place their words exist, so it keeps them whether
or not anybody has typed in one.

Neither is offered on a phone, and neither is in the editor's `/` menu. A phone has
no bar to type an address into and no tab to put a page in - the row would make a
file nobody there could finish; see "A phone" below. And `/` is the menu for what
goes **in** the note being written: every row of it puts a block on the page, and a
website is a file beside the note rather than something in it. The two menus that
make files - the file list's and the tab strip's - are where it belongs.

**Following a link inside the page moves `URL`, and `Nib-Home` keeps where the note
points.** A web note is a browser tab, so the file says where the reading has got to
and opening the note again opens that page; see "The file" above. An address typed
into the bar moves both, because that is somebody saying where the document itself
points.

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

What the window may ask for is deliberately small, and each of these is one thing:
make a page (`web_open`), move or hide it (`web_place`), send it to an address
(`web_navigate`), step its history (`web_step`), read it for a clip (`web_clip`), ask
where it is (`web_look`), put it back there (`web_scroll`), draw it larger or smaller
(`web_zoom`), print it (`web_print`), photograph it (`web_shot`), answer what the site
asked for (`web_answer`), and take it away, parked or closed (`web_close`).

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

**Hidden when the tab is not showing, and never closed for it.** This is the one
thing in this file that shipped wrong twice. Emil, 2026-09-13: *"if I switch between
web windows then it has decent speed, but if I switch between a note and then back
then it loads for an eternity till the web window shows the website."*

The pane's teardown asked the document where the hole had been, so that it could
hide the page there - and closed the page outright when the answer was nothing.
**The answer was always nothing.** Svelte's `destroy_effect` takes the DOM out of
the document and *then* runs the teardowns, so an element measured from there is a
box of zeroes; every switch away from a web tab closed the webview. Coming back was
a fresh `add_child`, a fresh WebView2 environment where no other web tab was left
alive to keep one warm - the profile is the app's own `web` folder, which is a
browser process group of its own - and a fresh load of the site over the network.
Web to web was quicker only because the tab being left behind kept the engine warm
for the one arriving.

Measured with `scripts/web-switch-probe.py`, which asks the crate itself whether the
tab still has a page:

| | before | after |
| --- | --- | --- |
| the page is still there after a switch to a note | **no** | **yes** |
| note to web, until the tab has a page again | 293 ms, and a load of the site | 108 ms, and no load at all |
| back to a web tab from another web tab | 107 ms, and a load of the site | 33 ms |
| the page comes back where the reading left it | no | yes |
| the same, after the app is started again | no | yes |
| what the pages cost, with twelve web tabs open | 894 MB - because only one or two were ever alive | 1.29 GB for the six that are |

Those are a local page on this machine, which is the fairest measure of the app's own
cost and the *kindest* possible reading of the old behaviour: the site the before column
reloaded came off `127.0.0.1` in a millisecond. Emil's eternity was a real site over a
real network, loaded again every single time, and - when no other web tab was left alive
to keep the engine warm - behind a cold WebView2 environment as well.

So the rectangle the page was last placed at is kept by the pane rather than
measured when it is wanted, and the tab's departure hides the page and starts a
clock. **Parking** is the only thing that closes a webview: half an hour of nobody
looking, or being the least recently looked at page when a seventh is opened - Chrome's
own memory saver waits about as long and discards for the same reason. One open page is
about 180 MB on this machine, so six is a working set at a bit over a gigabyte, which is
what a browser with six tabs in it costs and is the honest price of never reloading one.
A parked tab keeps its address, its place on the page and its trail, so reviving it is a
load and not a loss. Closing the tab takes the webview and the trail with it.

**A native webview draws above every pixel of HTML in the window.** So while
anything of the app's is over the page - a menu, a sheet, the palette, the settings,
a permission bubble - the page is hidden, or the menu comes up *behind* it and
nobody can see it. That was the second half of what Emil called "very fucked up":
the app asked the document which element was on top **at the middle of the hole**,
so a menu that covered a corner of the page was a menu drawn behind it, and the
question was only asked again after a press - a palette row that opens the next
overlay is not a press.

It is now asked once, of the overlay stack, which every menu, sheet, dropdown and
popover in the app already puts itself on because that is what Escape closes. A kind
of overlay nobody has written yet is covered on the day it is written, and there is
no list in the web tab to keep in step with the app. The document is still asked as
well, at nine points rather than one, for the few things over the page that Escape
does not close.

**What is over the hole decides how the page is placed, and never whether there is
one.** That distinction is worth a paragraph of its own, because losing it cost the
whole feature. Asking for the page used to hang off the same measurement: a pane that
measured itself while something was over the hole asked for no page at all, and nothing
asked again - the rectangle had not changed and the overlay stack was already empty.

Emil, 2026-09-17: *"Browser tabs take AN ETERNITY to load."* The eternity was not a
load. Every way of opening a website except clicking its row in the file list goes
through a layer, and a layer that has closed is still in the document for the 120 to 190
milliseconds it takes to play its way out: the palette's scrim, the app menu's, the
chooser Ctrl+T opens, a row's own menu. The pane mounted under one of those, and the tab
then sat on an empty pane until the reader happened to press something - which is what
finally made the page arrive, because a press is one of the few things that asks again.

So the page is opened whatever is over the pane, and opened **out of sight** where
something is, which is the other half of the same rule: a webview built over a menu
would be a page in front of it. And while the hit test says covered with nothing on the
overlay stack - which is exactly a layer on its way out - the pane looks again on the
next frame until it has gone. Measured with `scripts/web-open-probe.py`, on a local page
so the number is about the app:

| | before | after |
| --- | --- | --- |
| a tab opened from the file list, to the site on screen | 143 ms | 99 ms |
| the first web tab of the run, which starts the engine as well | 474 ms | 388 ms |
| a tab opened under a layer that is still leaving | **never** | 112 ms |
| what the window does before the crate is asked at all | 54 ms | 1 ms |

That last row was three things in front of `web_open` that had nothing to do with this
tab: two painted frames spent waiting for a launch stage that had already passed, a
third for the frame the measurement is coalesced onto, and the window's two page
listeners - a fetch and two round trips, now started with the first page in the window
rather than with the first placement. For scale, the same pages in plain Chrome, new tab
to `DOMContentLoaded`: 589 ms for the local one, 607 ms for `example.com`, 1,420 ms for
the Svelte docs. Nothing here was ever a throughput problem.

**And the page does not blink out any more.** The engine is asked to photograph itself -
`CapturePreview`, which is the only way to those pixels - and the still picture is what
the pane holds while the webview is out of sight: under a menu, and while a parked page
is loading again, so neither an overlay nor a revival is a flash of empty pane.

**When** it is taken is the whole of making that free. A pane-sized PNG costs the engine
about 105 milliseconds, measured, which is far too long to hold a menu up for - so the
picture is taken on the press that is about to open something over the page, and again as
a page finishes loading, and the overlay then finds one already there. The one case that
waits is the first thing ever drawn over a page nothing has photographed yet, and that
wait is capped; a picture from a moment ago is used at once and refreshed behind the
menu. Nothing photographs a page that is already hidden, because a hidden webview has no
frame to hand over and a blank picture is worse than none. And one picture at a time,
taken on the moment a page *stops* loading rather than on every report that it is not
loading: the crate says where a page is again whenever its title or its mark arrives, so
a page landing is three reports in a few milliseconds, and each of them used to throw the
picture away and ask for another - three engine captures at once, in the breath the
reader is watching the page appear. On macOS and Linux there is no
snapshot to be had through what wry hands out, and the hole keeps its own ground there.

**Back and forward are the page's own history, until they cannot be.** Neither
WebView2 nor WKWebView hands Tauri a Go Back, so for a page that has been running
all along the step is `history.back()` in the page, which is what a browser's own
button calls - and it takes the place on the page and the half-filled form back with
it, which no navigation can. A page that has just been revived has no history in the
engine at all: the webview is a minute old and the trail behind the tab is half an
hour of reading. So the step is an address off the trail the crate keeps, and from
the first of those the tab steps that way for good, because a `history.back()` after
one of them would go the wrong way. Whether there is anywhere to step is the trail's
answer either way, because the engine will not give one and a back arrow that is
always lit is an arrow that lies half the time. A redirect can leave an extra entry
in the trail; that is the price of not having the engine's own answer.

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
words are a search - Google, because that is the answer most hands expect from an
address bar, and a browser that quietly searches somewhere else reads as one that
found nothing. It was DuckDuckGo, for asking the least.

| key | |
| --- | --- |
| Ctrl+L | the address field, in the pane that has the focus |
| Ctrl+Enter in the field | one word as a `.com`: `svelte` becomes `https://www.svelte.com`, which is the press every browser has had since Netscape. Anything that already reads as an address is left to the ordinary press |
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

The mark at the left of the field is the site: the page's own favicon, and a lock for
a site that has none - or a warning for an `http:` page. Pressing it says what this
site is and what it has been allowed, which is Chrome's site information bubble; see
"What a site may do" below.

**The dots hold Chrome's menu, in Chrome's order and Chrome's words**, because Emil
asked for exactly that: *"Our browser related menu structure should be very similar
to that of chrome. And in general we don't want to reinvent how a browser works."*
New tab, Bookmarks, Zoom out / the size / Zoom in, Full screen, Print, Save page,
Share, Copy link, Open in the browser, Settings - each bent onto what nib has where
the two differ: a bookmark here is the space's own kept files, Save page is the
clipper, and Share is nib's share sheet. The three zoom rows keep the menu open the
way a browser's do, which is the one thing a row in this app may now ask for; see
`keep` in `lib/menu-item.ts`.

**What the menu does not hold is what the page's own menu already has.** Back,
forward, reload, save as, print, view page source, inspect; open a link in a new tab,
copy a link address; open an image in a new tab, copy an image, save an image as;
copy a selection and search the web for it. Those are the engine's own context menus -
Chromium's on Windows, `WebKit`'s elsewhere - in the reader's own language, with the
engine's own behaviour behind every row, and a second copy written in this app would
be worse at every one of them. Inspect is how the developer tools are reached, which
is why there is no More tools row. What is still missing against Chrome's menu is
listed under "What is left".

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

**Every web tab shares one session with the other web tabs, and a page nobody sees
holds it open past the last of them.** A web note is a browser tab, and a browser tab
keeps you logged in when you close it and open it again - because the browser process,
and the session in it, do not die with the tab. Emil, 2026-09-13: *"When I close and
then reopen a web note, all state is lost. For example, when I log in, then I would be
logged out. That should not be the case."*

Two things were wrong and only one of them was the obvious one. Each tab's webview
carried a `WebView2` environment of its own, so two tabs were two sessions; every tab
is now built on one environment instead. **But holding that environment is not enough,
and that took a measurement to learn.** `WebView2` ends a profile's session when the
last webview on it closes, however long the environment object is kept alive - so a
clone of it kept on the window's thread left two tabs open at once sharing one session
and the session gone the moment the last of them went. What a browser has and this did
not is a process that outlives the tabs. So one webview on the profile - `about:blank`,
a pixel wide, hidden, never placed again - is opened with the first website of the run
and never closed, and the session it holds open is the one every tab is built on.

`scripts/web-session-probe.py` is what measured it. It signs in to a page on the
loopback with a session cookie, a lasting cookie and a `localStorage` token, reads them
back out of the page, then closes the note, opens it again, and starts the app over. Run
it after any change to this seam.

| | an environment per tab | one shared | shared, and held open |
| --- | --- | --- | --- |
| two tabs open at once see one session | no | **yes** | yes |
| the session cookie after closing the note and opening it | no | **no** | **yes** |
| a lasting cookie and `localStorage`, closed and opened | yes | yes | yes |
| the same, after the app is started again | yes | yes | yes |
| the session cookie after the app is started again | no | no | no |

The middle column is the whole reason the page that holds the session open exists:
sharing the environment made two tabs one session and still lost it when the last webview
went, because that is when `WebView2` ends the profile's session. The third and fourth
rows were always true and are what the `web` folder on disk is for. The last row is gone
either way, which is what a browser throws away when it quits; a login kept in a lasting
cookie or in `localStorage` comes back off disk.

**What it costs, said plainly: once nib has opened one website, it keeps one `WebView2`
browser process until you quit, the way a browser does.** That is the price of a web note
being a browser tab you can close and open again without signing in each time, and it is
paid once rather than per tab - the pages in the tabs are the part that costs a
gigabyte, and those are still parked and closed as they always were. See `session` in
`apps/desktop/src-tauri/src/web_tabs.rs`.

On Linux the runtime already keeps the web tabs' context alive for the app's life (it
has to, to reuse the WebKit network process). On macOS the context is let go when the
last tab closes, as it was on Windows; a login there rests on the persistent data store
on disk - a lasting cookie survives, a session-only one does not - until the same seam
exists for `WKWebView` as for `WebView2`.

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

### What a site may do

**A site is asked about at the moment it asks, in a bubble under the address bar.**
Emil, 2026-09-13: *"a lot of stuff is still done extremely bad, e.g. having explicit
buttons for allow clipboard or allow camera. I don't think chrome does it like
this."*

He is right, and what was here before was exactly that. The camera, the microphone,
the clipboard, where you are and `Notification` were taken off `Navigator.prototype`
before the page's first script, so the engine never had a request to raise - and the
only way to give a site the camera was a row in a menu saying "Allow the camera",
which nobody goes looking for, which has to be pressed *before* the site asks rather
than when it does, and which cost the page being rebuilt because the guard script
runs once.

So the APIs are left where they are, and the engine's own request is what the window
answers. `ICoreWebView2::add_PermissionRequested` raises one when the page calls the
API - which is the only honest moment to ask, because it is the moment the reader
pressed something on the site - and the request is **held open** with a deferral
while the bubble is up: `example.com wants to / Use your camera`, with the site's own
mark, and **Don't allow** or **Allow**. The answer is remembered for that origin, so a
site is asked once; the next request from it is answered before anything appears on
screen.

Escape tells the site no and remembers nothing, which is what Chrome does with a bubble
somebody dismissed: they have not decided about the site, so the next time it asks is a
fair time to ask them again. And the refusing button says "Don't allow" rather than
"Block" for a reason worth knowing: the app already has a row called Block - the kind of
thing a paragraph is - and one English string cannot be two rows in a catalogue, so a
German reader was being offered *Block*, the markdown block, as the way to refuse a site
the camera.

Three things make that work, and each is load bearing: the deferral, because deciding
inside the engine's own event handler would mean either refusing everything or running
a nested message loop - which is the freeze this file spent a day on; **one thread**,
because everything the engine hands out there belongs to the window's thread, so the
requests waiting for an answer live in a thread local on it and `web_answer` posts
itself there; and the window deciding, because what a site was allowed belongs where
the reader's other choices live. Grants are per origin and per kind, on the device and
never on the account, in `nib:web-grants`.

**Clipboard write and paste need no prompt**, because they need none in Chrome: a
page may write to the clipboard on a gesture, and a paste is the reader pressing
paste. Only reading the clipboard without one is a request, and the engine raises
that itself.

**The lock at the left of the address field says what a site has.** Chrome's site
information bubble: whether the connection is the secure kind, every kind this site
was allowed or refused with the answer on a button that gives the other one, and
Reset permissions, which forgets all of it. A site that has never asked for anything
shows the first line and nothing else.

**The window's own page has the same listener, and this is why it must.** A `WebView2`
webview with nothing registered for `PermissionRequested` answers such a request with
neither an allow nor a deny: `getUserMedia` there does not fail, it never settles. Every
web tab has had this listener from the first version and the window's own page had none,
so the app's own microphone request waited for ever - the recording pill sat at 0:00, no
file was written and nothing was said, because by the app's lights nothing had gone wrong
yet. Dictation was the same press and the same silence.

`hearing` in `web_tabs.rs` attaches it at setup, before the window is shown, and the
answer there is not a bubble: the app's own origin is allowed outright for the microphone
and the camera, because pressing Record *is* the answer and a second bubble inside nib
asking whether nib may use the microphone would be the app asking somebody to confirm
what they just pressed. The permission that matters - the one the system keeps - is not
this one. Every other origin in that webview is refused, which is what the whole webview
did before: a site inside a note is an iframe there rather than a tab of its own, and a
frame in somebody's note is not the thing to hand a camera to. A site that wants one
opens in a web tab, where it is asked about properly.

The recorder no longer trusts any of this to be true, either: it waits twenty seconds for
the microphone and then says it could not be opened. A promise that can hang for ever is
a clock that never moves, and that is the worst way for an app to be wrong. See
`PATIENCE` in `recorder/microphone.ts`.

`scripts/recorder-e2e.py` drives it against a built app, which is the only place any of
this happens: there is no `WebView2` under node, so every unit test passed while the app
sat at 0:00. It times the microphone request, presses Record through the row's own id, and
reads the `.weba` off the disk afterwards. A machine that refuses a microphone - Windows'
own privacy settings, a desk with none on it - is not a failure there; a request that
never settles is.

**What is still refused outright** is the buses a page can reach hardware over -
Bluetooth, USB, serial, HID - and the credential store. Those are taken off
`Navigator.prototype` before the page's first script, because a note-taking app has no
business handing them to a page and because no sentence in a bubble would help anybody
decide. **On macOS and Linux** the engine's own prompt is what a site gets: the same
event exists there - a capture delegate and WebKitGTK's `permission-request` signal -
and neither is reachable through what wry hands out.

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
| `apps/desktop/src-tauri/src/web_tabs.rs` | the child webview: the twelve things the window may ask of a page, where a page may be built, the guard script, the place a revived page is put back at, the trail, the address rule, the permission request held open, the still picture. Unit tested |
| `apps/desktop/src-tauri/src/paths.rs` | `is_shortcut`, beside the other three kinds |
| `apps/desktop/src-tauri/src/tree.rs` | the four kinds the file list shows |
| `apps/desktop/src-tauri/src/search.rs` | a shortcut is searched as the text it is, so a site is found by its address |
| `apps/desktop/src-tauri/src/links.rs` | a website as a node in the index, and `url:` off every note, which now means a note that wants converting |
| `apps/desktop/src-tauri/capabilities/default.json` | webviews, not windows |
| `apps/desktop/src/lib/web-tab/shortcut.ts` | the file: written, read, and `.webloc` read. Pure, tested |
| `apps/desktop/src/lib/web-tab/note.ts` | what a clip says, and what the old format said. Pure, tested |
| `apps/desktop/src/lib/web-tab/address.ts` | what somebody typed, and the origin plainly. Pure, tested |
| `apps/desktop/src/lib/web-tab/frame.ts` | what a frame may do, and the measurements behind asking first |
| `apps/desktop/src/lib/web-tab/pages.svelte.ts` | the page each tab is on, the webview's life, parking, the still picture. Tested |
| `apps/desktop/src/lib/web-tab/place.ts` | where each note was left, per device: the offset and the trail. Tested |
| `apps/desktop/src/lib/web-tab/keep.ts` | the file keeping up with the page, debounced. Tested |
| `apps/desktop/src/lib/web-tab/permissions.svelte.ts` | what each site was told, and the requests waiting for an answer. Tested |
| `apps/desktop/src/lib/web-tab/WebAsk.svelte` | the bubble a site is answered in |
| `apps/desktop/src/lib/web-tab/WebSite.svelte` | what a site is, behind the mark in the bar |
| `apps/desktop/src/lib/web-tab/clip.ts` | where the HTML comes from |
| `apps/desktop/src/lib/web-tab/WebTab.svelte` | the pane: the hole, the frame, the card |
| `apps/desktop/src/lib/web-tab/WebBar.svelte` | the bar |
| `apps/desktop/src/lib/web-tab/menu.ts` | the dots: Chrome's rows, and the zoom ladder. Tested |
| `apps/desktop/src/lib/file-mark.ts` | the globe, off the name like every other mark |
| `packages/markdown/src/links.ts` | `isWebTarget`, and a website among the files a link resolves through |
| `packages/editor/src/wikilink/notes.ts` | `[[Svelte docs]]` with the extension left out |
| `apps/desktop/src/lib/rooms/kind.ts` | no room for a website, said at the file's end |
| `services/sync/src/notes.ts` | the extensions the account carries |
| `apps/desktop/src/lib/workspace.svelte.ts` | `openWeb`, `createWebsite`, `openWebsite`, `webNamed`, `keepWeb`, `webAimed`, `asShortcut`, `convertWebsites`, and the routing in `openEntry` |
| `apps/desktop/src/lib/workspace/saving.svelte.ts` | `pickSavePath`: the one sheet that names an unsaved tab of any kind, and where a save writes it |
| `scripts/web-tab-e2e.py` | the drive: the file, the mark, the tab, the card, the clip |
| `scripts/web-freeze-probe.py` | the drive for the freeze: the pump, the window's own answers, and the log |
| `scripts/web-switch-probe.py` | the drive for the switch: whether the page is still there, how long it takes to come back, what ten tabs cost |
| `scripts/web-open-probe.py` | the drive for the open: whether a tab covered when it mounted shows a page at all, and how long each kind of open takes - the clock behind `NIB_PERF=1` |
| `scripts/web-session-probe.py` | the drive for the session: signs in to a page on the loopback, closes the note, opens it again, and starts the app over - a session cookie, a lasting one and a `localStorage` token, read back out of the page |
| `apps/desktop/src/lib/overlays.ts` | the one place that says something is over the note, and tells the web tab |
| `apps/desktop/test/effects/web-switch.effect.test.ts` | the pane, mounted and unmounted, which is where the page used to be closed |
| `apps/desktop/test/effects/web-tab.effect.test.ts` | the pane, mounted, which is where a website used to take the window down with it |

## What is left

- **Five of Chrome's menu rows are not here, because nothing is behind them yet.**
  History and Downloads want surfaces nib does not have - a list of every page a
  window has been through, and where the engine put what it saved; Find wants an
  in-page find bar of its own, which is not the one a note has; Copy and Paste are
  the page's own context menu already; and More tools' developer tools are reached by
  Inspect in that same menu. Each is a row the day the thing behind it exists.
- **A page's still picture is Windows only.** `CapturePreview` is WebView2's own;
  `WKWebView`'s `takeSnapshot` and WebKitGTK's equivalent are not reachable through
  what wry hands out, so an overlay over a page on a Mac still blinks the pane.
- **A permission on macOS and Linux is the engine's own prompt**, for the same
  reason: the event that would let the app ask is not reachable there.
- **The place a page is put back at is the offset it was left at**, not the element
  that was under the reader's eye. A site that lays itself out differently at another
  width comes back near where it was rather than exactly on it, which is what a
  browser does too.
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
