# Web tabs

A tab can be a website. The page is rendered by the system's own browser engine,
it has a bar with back, forward, reload and an address, and the site it shows is a
document in the space like a note or a canvas: a row in the file list with a globe
in front of it, a name somebody can rename, a bookmark, a `[[link]]`, a hit in the
search, a file the sync carries.

Emil, 2026-09-10: _"a tab can be a website rendered by Chromium, a URL bar,
back/forward, and a NOTE TYPE for it so a website is a document in the space."_

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
Nib-Icon=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0...
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
2026-09-13: _"I believe currently it resets the page every time you reopen it. That
is extremely annoying and should not be. It should basically reopen the exact same
page you had open last time when you open that page. So a web note should
essentially correspond to what is otherwise a browser tab."_ So following a link
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

**`Nib-Icon` is the site's own mark, as the picture itself**: a `data:` address
holding the PNG the page arrived with the last time it was open. An address to fetch
it from was what this used to hold, and it failed exactly where it mattered. WhatsApp
adds its mark with a script a second after the page has loaded and serves it with
`Cross-Origin-Resource-Policy: same-origin`, so only its own page may draw it; a site
behind a login serves its mark to the login's cookies, which the app's own page does
not have. Chrome keeps a bookmark's favicon as the picture for the same reason, and a
picture is also a file list that draws every web note's mark on launch without one
request. It is here so the tab strip and the file list have the site's mark before
the page has loaded and on a machine that has never opened it. A file written before
this holds an address, which is drawn as one until the page is next open.

**Where the picture comes from is the engine.** `WebView2` chooses a page's icon the
way Chrome does, fetches it inside the page's own profile, and says whenever the
choice changes (`FaviconChanged`). The picture it chose is read again inside the page,
at the size the site drew it, because the engine's own decoded copy (`GetFavicon`) is
sixteen pixels and blurred on a double density screen; that copy is what stands in
where the page will not hand the original over. So a
mark set by a script, an SVG, a `data:` mark, a bare `/favicon.ico`, a mark behind a
login and one served by a service worker all arrive the same way, and a mark a site
redraws with an unread count is redrawn in the tab. The file keeps the first mark each
load shows rather than every one, so an unread count never rewrites the note. Engines
with no such event are asked for every `<link>` the page declares once it has loaded,
and the best for a sixteen pixel box on a double density screen is chosen. See
`src-tauri/src/web_icons.rs`.

**What is _not_ in the file is where the reading was on the page, or the trail behind
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

**A new tab** - the strip's plus, Ctrl+T, the palette, the buttons a pane with
nothing open shows - is the other way round, and is a browser tab: a live page with an
address field and **no file at all**. Nothing is written while somebody is only reading,
and Ctrl+S does not change that: browsing is not a document being saved. **Keep as web
note** - on the tab's own menu, and in the palette while the page is in front - is the
moment they say to keep it, the way a bookmark is kept: the shortcut goes down in the
space with the address the tab is on, the page's title as its name and the mark the page
reported, and the tab becomes that file in place, still live. Nothing is asked; the row
can be renamed and moved like any other. See `keepAsWebNote` in `workspace.svelte.ts`.

Emil, 2026-09-14: _"if you create a new webnote by clicking the plus for a new tab, then
it should open it as a tab and not create it in the sidebar. Same for canvas and page
notes. And like normal notes, then can then of course be saved as well, but they should
be able to exist in an "unsaved" state. Just as a tab, like a browser tab normally
would."_ Which is one model for all four kinds: see `newCanvas` and `newPages` beside
`openWebsite` in `workspace.svelte.ts`. Since 2026-09-30 nothing is ever saved by hand: a
new note, plane or deck becomes a file in the space on its first word or stroke, and only
a web tab waits to be kept; see `workspace/drafts.ts`. A restart brings a tab with no file
back the way a browser does - the session is the only place its words exist.

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

|                   | what draws the page                                           | why                                                                                      |
| ----------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Windows           | a child webview: WebView2, Chromium                           | the only embedding that renders a site the way a browser does                            |
| macOS             | a child webview: WKWebView, WebKit                            | same, with Safari's engine                                                               |
| Linux             | a child webview: WebKitGTK                                    | same                                                                                     |
| the browser build | a card, and a sandboxed `<iframe>` once the reader presses it | a page in a browser has nowhere else to go, and no way to know whether a frame will work |
| Android and iOS   | the system browser, not a tab                                 | see below                                                                                |

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
whole app. Emil, 2026-09-13: _"When I open one, nib just freezes and all the
buttons don't do anything anymore."_

A `#[tauri::command]` that is not `async` runs **inline inside the callback
WebView2 hands the app its IPC in** - on the window's own thread, inside one of the
engine's own event handlers. Building a child webview from in there is a deadlock
rather than a stall: the platform creates a `CoreWebView2Controller`
asynchronously, wry waits for it by running a _nested message loop_
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

|                                            | before                                                                                                          | after                                  |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| the message pump, worst reply              | 0.55 ms, and never once dead                                                                                    | 2.4 ms, never dead                     |
| the window's own answers while a tab opens | **4 of 8 asks unanswered**; by hand, two trivial verbs timed out at 30 s each, minutes after the tab was opened | **0 of 24 unanswered**, 31 ms at worst |
| the page itself                            | never appeared: a bar over an empty pane                                                                        | the page, in the pane                  |

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
thing in this file that shipped wrong twice. Emil, 2026-09-13: _"if I switch between
web windows then it has decent speed, but if I switch between a note and then back
then it loads for an eternity till the web window shows the website."_

The pane's teardown asked the document where the hole had been, so that it could
hide the page there - and closed the page outright when the answer was nothing.
**The answer was always nothing.** Svelte's `destroy_effect` takes the DOM out of
the document and _then_ runs the teardowns, so an element measured from there is a
box of zeroes; every switch away from a web tab closed the webview. Coming back was
a fresh `add_child`, a fresh WebView2 environment where no other web tab was left
alive to keep one warm - the profile is the app's own `web` folder, which is a
browser process group of its own - and a fresh load of the site over the network.
Web to web was quicker only because the tab being left behind kept the engine warm
for the one arriving.

Measured with `scripts/web-switch-probe.py`, which asks the crate itself whether the
tab still has a page:

|                                                  | before                                           | after                        |
| ------------------------------------------------ | ------------------------------------------------ | ---------------------------- |
| the page is still there after a switch to a note | **no**                                           | **yes**                      |
| note to web, until the tab has a page again      | 293 ms, and a load of the site                   | 108 ms, and no load at all   |
| back to a web tab from another web tab           | 107 ms, and a load of the site                   | 33 ms                        |
| the page comes back where the reading left it    | no                                               | yes                          |
| the same, after the app is started again         | no                                               | yes                          |
| what the pages cost, with twelve web tabs open   | 894 MB - because only one or two were ever alive | 1.29 GB for the six that are |

Those are a local page on this machine, which is the fairest measure of the app's own
cost and the _kindest_ possible reading of the old behaviour: the site the before column
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

#### Putting a page away is never asked of what the window believes

Emil, 2026-09-18: *"For some reason a browser tab displayed above everything else. For
example when I switched to a note, there was still the browser open."*

A page left on screen over a note is not a page drawn in the wrong place - it is an
operating system surface over the whole window. The note is under it, so is the tab
strip, so is every menu, and nothing the reader can press reaches any of them. It is the
worst thing this feature can do, so it is worth being precise about how it happened.

`live` is the window's own idea of whether the crate is holding a webview for a tab, and
it is an idea: nothing in the window can see a webview. Every command used to write it
from its own failure. A refused address, a refused step, a refused placement - each of
them set `live` to false, which reads as "the page has gone". And `place` would not act
on a page it thought was gone, so from that moment the pane's *hide* did nothing at all:
the webview stayed exactly where it was, on top of whatever the pane showed next, with
nothing left in the window able to reach it. One refused call was the whole of it.

A guess is fine; a guess that can only be wrong in one direction is not. So the belief
gates **showing** a page and never **hiding** one. Hiding is asked of the crate whatever
the window thinks, and a tab with no page costs one refused call for it. Only a
placement that was meant to show the page may conclude the page has gone, because that
conclusion is the safe one to be wrong about: a page wrongly thought gone is built again
on the next placement, where a page wrongly given up on is the window. The same rule at
the other end of a page's life: the crate refuses a second page under one label, so a
build that comes back refused may have been refused *because* there is one - and the
pane is told there is no page only once the label has been cleared. See `place` and
`build` in `pages.svelte.ts`, and the tests in
`test/effects/web-switch.effect.test.ts`.

**What could not be reproduced.** The other half of the mechanism is the still picture,
and it is the half a measurement cannot tell from the page: asking Windows whether the
webview is hidden says yes while a photograph of the page is still drawn in the pane, and
a reader cannot tell those apart either. It was looked for and is not there. The picture
is drawn in exactly one place - the hole inside the web surface - the hole is keyed on
the tab and goes with the pane, and the picture is state on a page the store holds per
tab, so there is nowhere for one to be left over a note and no way for one tab's to be
drawn in another's. That is asserted rather than argued in the same file. Driving the
packaged app for the switch itself was done on 2026-09-17 and found nothing either: the
page was out of sight every time the pane stopped showing it.

**A native webview draws above every pixel of HTML in the window.** So while
anything of the app's is over the page - a menu, a sheet, the palette, the settings,
a permission bubble - the page is hidden, or the menu comes up _behind_ it and
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

**So nothing of the app's is placed over a page's rectangle at all.** The hit test is
honest and that is the trouble with it: any element that is not the hole counts,
wherever it is, so a card in the corner of the window is a page hidden for as long as
the card is up. Three things were, and the first was measured on 2026-09-18 by asking the
pane's own hit test what it found - `['hole' x 8, 'DIV.notice']`:

- **The update notice**, which floated in the bottom corner over the pane. Emil,
  2026-09-27, in the installed app: *"Nib 0.9.1 is ready to install"* in the corner and
  the whole web page gone until **Later** was pressed. A notice stands until it is
  dismissed, and a page hidden while nobody had pressed anything has no still picture to
  stand in for it: the pane was empty. The storage card sat in the other corner and did
  the same.
- **The recording pill**, which floated over the foot of the note. It was far enough
  down to miss the nine points, so the page stayed up - in front of it: a red dot
  somebody started, drawn where nobody could see or press it.
- **Full screen**, which put a layer on the overlay stack for the whole time it was on
  and so hid the page it exists to fill the screen with.

Neither was a slip in the test, so neither is fixed in it - a hit test with a list of
class names in it is a list to keep in step with the app, which is the thing this one
was written to stop being. They are fixed where they came from:

- The storage card, the recording pill and the update notice now sit in a **row of their
  own** between the panes and the foot - start, middle and end, the places they floated
  in - in the flow of the window rather than over it, so the pane is shorter by the
  height of whatever is in the row and the page keeps every pixel it is given, live.
  Empty, the row is nothing: no padding of its own and no height. On every kind of tab,
  so a note and a page are laid out by one rule. See `.notices` in `App.svelte`.
- **Full screen is a mode and not an overlay.** It draws nothing over the document - the
  document is the whole of what is left - and it was on that stack for one line of
  Escape. Escape leaves it from the window's own key handler now, under the line that
  asks the stack, which is the same order it had and the same four ways back.
- The way out of full screen is the one piece of furniture that is *meant* to be over
  the document, and over a page it would be drawn behind it. A strip across the top of
  the panes would have cost every document in the window more than full screen gives a
  web tab back - measured: 46 pixels taken for a title bar of 37 - so the **web tab's own
  bar** makes the room instead, and only while full screen is on. The page grows from 745
  to 774 pixels of an 820 pixel window instead of shrinking to 737.

What is left on the overlay stack is only ever a layer somebody opened over the note -
a menu, a dropdown, a sheet, a dialog, the address field's suggestions, a bubble under
the bar, a site's question, a drawer, a deck - and each of those hides the page with its
still picture standing in, photographed before the page goes. A picture is of one size
of page: once the page is shown at another - the row came or went, a divider moved - it
is dropped and the next cover waits for a fresh one, or the menu after **Later** stood
over a picture with a band of empty pane under it. `overlays.test.ts` names
every caller of the stack with what it is, so the next one fails until somebody has said
which kind it is, and holds the furniture to the row: on no stack, positioned over
nothing. The layout itself cannot be unit tested - jsdom has none, so a card over a pane
and a card beside it are the same object graph there - so
`apps/desktop/test/e2e/notices.py` asks it at the same nine points in a real browser, and
`scripts/web-furniture-probe.py` photographs the installed shape of it: a page with the
update notice up, and the same page under a menu.

**What is over the hole decides how the page is placed, and never whether there is
one.** That distinction is worth a paragraph of its own, because losing it cost the
whole feature. Asking for the page used to hang off the same measurement: a pane that
measured itself while something was over the hole asked for no page at all, and nothing
asked again - the rectangle had not changed and the overlay stack was already empty.

Emil, 2026-09-17: _"Browser tabs take AN ETERNITY to load."_ The eternity was not a
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

|                                                               | before    | after  |
| ------------------------------------------------------------- | --------- | ------ |
| a tab opened from the file list, to the site on screen        | 143 ms    | 99 ms  |
| the first web tab of the run, which starts the engine as well | 474 ms    | 388 ms |
| a tab opened under a layer that is still leaving              | **never** | 112 ms |
| what the window does before the crate is asked at all         | 54 ms     | 1 ms   |

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
taken on the moment a page _stops_ loading rather than on every report that it is not
loading: the crate says where a page is again whenever its title or its mark arrives, so
a page landing is three reports in a few milliseconds, and each of them used to throw the
picture away and ask for another - three engine captures at once, in the breath the
reader is watching the page appear. On macOS the same picture is `WKWebView`'s own
`takeSnapshotWithConfiguration:completionHandler:`, reached through the view wry hands
out and turned into a PNG through `NSBitmapImageRep`, so the window gets the same `data:`
address either way. On Linux there is no snapshot to be had through what wry hands out,
and the hole keeps its own ground there.

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

**A right click or a held finger on either arrow lists the pages that way**, Chrome's
list: the nearest first, a dozen at most, each by what the page called itself (off the
address field's history) or its address. A row goes straight there - `history.go(n)`
in the page, or the address off the trail for a revived one - and the trail is moved
to where it lands before the page arrives, so the jump reads as a step and not as
somewhere new. The trail comes from `web_trail`, which asks nothing of the page.

**The reload glyph is a cross while a page is coming**, and pressing it stops the page,
which is what Chrome's does; Escape does the same once whatever is open over the page
has had its Escape. The tab's mark turns meanwhile, so the bar only says what a press
would do. It turns the moment a navigation sets off rather than when the engine's own
"started" arrives, which is only once the site has begun to answer: a cross that
appears when there is nothing left to stop is no cross at all. The middle button or
Ctrl on it opens the page again in a tab behind, as Chrome's does. Ctrl+Shift+R and Ctrl+F5 load the page past the cache. Stopping and loading
fresh are `WebView2`'s own - `Stop`, and the DevTools Protocol's `Page.reload` with
`ignoreCache` - and elsewhere the nearest a page can do, `window.stop()` and an
ordinary reload; see `src-tauri/src/web_reload.rs`.

#### The pointer is never hidden while somebody types

Emil, 2026-09-28: _"manchmal habe ich einfach keinen mouse cursor waehrend ich im browser
bin. dann muss ich ihn aus dem browserfenster raus und dann wieder rein bewegen"_ - no
pointer over a web tab, and it only came back after leaving the page and coming back in.

The engine did it, for a Windows setting that is on by default: _Hide pointer while
typing_. `WebView2`'s Chromium honours it now - `ShowCursor(FALSE)` on its own thread when
a key types into something editable, `ShowCursor(TRUE)` on the next mouse event that same
browser process receives. In a browser that is one process under one window, so any move
brings the pointer back. In nib it is two at least: the app's own page and the web pages
keep separate profiles, so separate browser processes, and a store of a space's own is
one more. And the count `ShowCursor` moves is not the process's, it is the **input
queue's**, which every thread with a window in nib's window shares - a child window from
another thread attaches the two. So typing an address with the pointer resting on the page
(Ctrl+L, Ctrl+T) hid it over the whole window, and moving about the page reached only the
page's process, which had never hidden it. Only crossing into the app's own page - the bar,
the strip - brought it back. The same held the other way round: typing into a site and
then having the page go under a menu or another tab left the pointer gone over the app.

Measured by `scripts/web-cursor-probe.py`, which reads the queue's count without touching
the real mouse - it attaches to the window's queue for a `ShowCursor(TRUE)` and a
`ShowCursor(FALSE)`, which answer the count and leave it as it was - and posts the keys and
the moves to the engine windows themselves. Before, and after:

|                                                            | before | after |
| ---------------------------------------------------------- | ------ | ----- |
| typed in the address field                                 | -1     | 0     |
| ... then moved about the page                              | **-1** | 0     |
| ... then moved over the app's own page                     | 0      | 0     |
| typed in the page                                          | -1     | 0     |
| ... then switched to a note and moved about it             | **-1** | 0     |
| ... then back on the page and moved about it               | 0      | 0     |

Below nought is no pointer anywhere over nib's window; two runs of each build, the same
numbers. The address field held what was typed and the page heard its own, so the keys
arrived either way. The same thing was seen from outside in the installed app while Emil
used it: a page opened from the Ctrl+T dialog under a resting pointer, and the pointer
stayed hidden while it moved about the new page.

The engine has no way to show a pointer another process hid, and nothing nib can call
would put it back short of faking mouse moves into the other process - so the hiding goes:
every `WebView2` page nib starts has `HideCursorWhileTyping` switched off. The pointer
stays where it was while somebody types, which is how nib always behaved until the runtime
began hiding it. See `BROWSER_ARGS` in `src-tauri/src/engine.rs`: one list, because every
webview on one user data folder has to be started with the same switches or the engine
refuses the second one.

The app's own page hides it again itself, as a style (2026-09-30): typing into a note, a
card or a field puts `cursor: none` on that page and the first move takes it off, so no
count is ever touched and nothing another process does can leave it hidden. Over a web
page the pointer is that page's whatever the app's page says, so a site is never affected.
See `apps/desktop/src/lib/typing-pointer.ts`.

#### One notch of the wheel is one notch

Emil, 2026-09-30: _"the scrolling doesn't feel like it should. I have the feeling it may be
faster than it should be (this is only when scrolling in a web tab)"_. It was twice as
fast, and it lunged.

Not the switches, not the screen's scale and not a site's zoom: both engine processes run
the same command line, the engine's smooth scrolling is on, and a notch handed to it
animates exactly as Chrome's does. The engine takes mouse input in a window of its own over
the page, the "Chrome Legacy Window", which passes each message on to the page's own window.
A wheel that lands on _that_ window is handled twice - once passed on, once more when the
legacy window gives it to `DefWindowProc`, which bubbles a wheel up to the same parent. Two
wheel events for one notch, in a bare wry window and in upstream Chromium (Electron 33)
alike. Chrome never meets it, because its legacy window is on the thread that holds the
keyboard and Windows hands a wheel over it to that thread's focus, the browser's own
window. A page in nib is another process's window inside nib's, holding the keyboard only
after a click in it, so a wheel over it with the keyboard anywhere else - the address
field, the sidebar, a note, a tab just switched to - goes to the legacy window.

So a wheel over a page is sent where Chrome's goes. A low-level mouse hook, installed with
the first page of a run on a thread of its own, takes a wheel over a legacy window inside
one of nib's own windows and posts it to that window's parent, with the turn, the point
and the keys held as Windows writes them; every other wheel and every other program's
window is left alone. The distance is still the engine's own, from the reader's _lines to
scroll_, and a precision touchpad never comes this way: it pans the page through Direct
Manipulation. See `src-tauri/src/web_wheel.rs`.

Measured by `scripts/web-scroll-probe.py` at 200 per cent with five lines a notch, a pane of
1187 by 718, against Chrome 153 at the same size handed the notch those five lines make:

|                                                 | wheel events | pixels | frames moving | ms  |
| ----------------------------------------------- | ------------ | ------ | ------------- | --- |
| a notch at the legacy window (before)           | 2            | 333.5  | 6             | 95  |
| a notch at the page's own window (now)          | 1            | 166.5  | 8             | 123 |
| Chrome 153, one notch                           | 1            | 166.5  | 8             | 123 |

The two paths are the before and the after: the hook is what moves a wheel from the first
to the second, and no posted message passes a hook, so the Rust tests beside it hold that
part. The doubled notch also started with a lunge - 23 and then 100 pixels in its first two
frames where Chrome moves 5 and 24.

### The browser build: a card, and a frame when asked

A page in a browser can only be shown in a frame, and a great deal of the web
refuses to be framed: `X-Frame-Options: DENY` and CSP's `frame-ancestors` are a
header the site sends and the browser obeys.

**A page cannot find out whether framing worked.** That was measured rather than
assumed, with all four cases served side by side:

| the frame was pointed at | `load` | its location           | its document | `length` | the resource entry |
| ------------------------ | ------ | ---------------------- | ------------ | -------- | ------------------ |
| this origin, allowed     | fires  | reads back             | readable     | 0        | `iframe:200:363`   |
| another origin, allowed  | fires  | throws `SecurityError` | null         | 0        | `iframe:0:0`       |
| another origin, refused  | fires  | throws `SecurityError` | null         | 0        | `iframe:0:0`       |

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

**The field finishes what is typed from the pages already opened**, the way Chrome's
omnibox does. Emil, 2026-09-27: _"if I already opened moodle-app2.let.ethz.ch then it
should kinda of complete in the same way it does it for other browser"_. Typing `moo`
writes `dle-app2.let.ethz.ch` after the caret, selected: typing on narrows it,
Backspace drops it, Right or End takes it, and Enter goes there. It finishes to the
site first and to a whole address only once the typing has gone past the site, with
or without `www.` and the scheme, and only ever to something the typing is the start
of. A few pages hang under the field - a word from the middle of an address or a
title is enough there - ranked roughly as Chrome ranks them: a typed visit counts ten
followed ones, and all of it fades with time. Nothing is offered in the middle of an
input method's composition. `web-tab/omnibox.ts` decides both halves and
`web-tab/AddressField.svelte` is the field; every way a tab is given an address goes
through it.

The history behind it is `web-tab/visited.ts`: one row per address (the visits, the
typed visits, when, the title), the five hundred most recently open, in this device's
storage and never on the account. It is not read at launch - the first focus of an
address field or the first page a tab arrives at reads it.

| key                     |                                                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ctrl+L                  | the address field, in the pane that has the focus                                                                                                                                                 |
| Alt+D, and F6 in a page | the address field too, Chrome's other two ways to it                                                                                                                                              |
| F5, Ctrl+R              | reload; Ctrl+Shift+R and Ctrl+F5 past the cache                                                                                                                                                   |
| Escape                  | stops a page on its way in                                                                                                                                                                        |
| Ctrl+1 to 9             | the tab at that place along the strip, the ninth the last                                                                                                                                         |
| Alt+1 to 9, Alt+0       | the tab at that place, the ninth included, and the last; over a note too                                                                                                                          |
| Alt+Enter in the field  | the address in a tab of its own, in front                                                                                                                                                         |
| Ctrl+Enter in the field | one word as a `.com`: `svelte` becomes `https://www.svelte.com`, which is the press every browser has had since Netscape. Anything that already reads as an address is left to the ordinary press |
| Alt+Left, Alt+Right     | back and forward, which in a web tab is the page's history - the same key a note tab walks its own trail with                                                                                     |
| Right, End in the field | takes the rest of the address the field wrote in                                                                                                                                                  |
| Up, Down in the field   | walks the pages under it; the field reads the row the arrows are on                                                                                                                               |
| Shift+Delete on a row   | forgets that page, which is how Chrome takes one out of its history                                                                                                                               |
| Escape in the field     | takes back what the field offered and closes the list; the second puts the resting face back and lets go of the field                                                                             |

Ctrl+L is the chord CodeMirror selects a line with, and both keep it. That works
because the bar reads it where the bar is rather than off the window: an app-level
binding never reaches the editor, so the two could not have shared it, while a pane
showing a page has no editor to shadow. It is in the registry like every other key

- `web.address`, under View - so it can be found and changed. The canvas's keys are
  read the same way.

**While the page itself has the keyboard, its keys are the page's - but for the
browser's own.** After a click into a site the app never sees the press: that is what a
webview of its own means. The exception is Chrome's: the chords a browser never offers
a page - a new tab, closing one, reopening the last, going round them and moving one
along, a new window, Ctrl+1 to 9, nib's own Alt+0 to 9, and F6 back to the address
field - are taken before the page sees them and played on the app's own window, and the
keyboard goes back to the app with them. F5 and Ctrl+R in a page are the engine's own reload, as in Chrome, and
need nothing. The find keys, Ctrl+F, Ctrl+G and F3, and the address field's other two,
Ctrl+L and Alt+D, are the page's first, as in Chrome: a site with its own find or its own
Ctrl+L keeps it, and the app answers only when the page lets the key go by; see "The page
itself". So is Ctrl+D, which is Chrome's bookmark and nib's Deselect tab: Sheets fills
down with it and Figma duplicates, and what a page lets go by is played on the window as
the key it was. Shift pressed twice on its own opens the palette over a page as over a
note: the engine never tells the host about a lone Shift, so the page's own script counts
the taps and asks, the page keeping every Shift and one it answered itself not counting,
and the crate takes the ask only while that page has the keyboard and a key was just
pressed. On `WebView2` only; see `docs/keyboard.md`, `src-tauri/src/web_keys.rs` and
`src-tauri/src/web_opens.rs`.

The bar reads F5, the reload keys, Ctrl and a digit and the zoom keys before the window's
own handler does, and only in the focused pane, because they share their keys with
Present, a heading level and the size of a note's words: a pane showing a page has none of
the three. See `web-tab/bar-keys.ts`.

The mark at the left of the field is the site: the page's own favicon, and a lock for
a site that has none - or a warning for an `http:` page. Pressing it says what this
site is and what it has been allowed, which is Chrome's site information bubble; see
"What a site may do" below.

**The dots hold Chrome's menu, in Chrome's order and Chrome's words**, because Emil
asked for exactly that: _"Our browser related menu structure should be very similar
to that of chrome. And in general we don't want to reinvent how a browser works."_
New tab, Bookmarks, Zoom out / the size / Zoom in, Full screen, Print, Find, Save page,
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
be worse at every one of them. Inspect is how the developer tools are reached, as are
F12 and Ctrl+Shift+I, which is why there is no More tools row. What is still missing against Chrome's menu is
listed under "What is left".

## A link in a tab of its own

Chrome's convention, the same on every surface of the app that opens something (a
link in a note, a row of the file list, a bookmark, a search hit, the Links panel, a
node of the graph, the palette, the arrows over a note or a page): Ctrl+click (Cmd on
a Mac) and the middle button open it in a tab beside the one it was pressed in and
leave the reader where they are; with Shift as well the tab comes forward. Shift alone
on a web link is Chrome's new window, and a nib window is a second workspace rather
than one page, so it is a tab in front too; in the file list Shift picks a run of rows
and Alt picks one row at a time, since Ctrl is the tab's. Ctrl+Enter in the palette is
the keyboard's Ctrl+click. A tab asked for this way is never the preview. The rule is
`lib/new-tab.ts`.

Inside a page every such link is a window the page asks the app for, and `WebView2`
does not say how it was pressed. So `src-tauri/src/web_opens.rs` has a page script
answer the press itself - the middle button, and Ctrl or Shift with the main one - and
open the link under a window name that says where its tab goes, read off the press
rather than the keyboard. Ctrl and Shift are read off the keyboard only for a window
the page's own script asks for, and the page's own "open link" menu row is recognised
by the link the menu was raised on. A plain `target="_blank"` opens in front. None of
this was ever reached from a link until 2026-09-30: the opener plugin put a script in
every webview that took a Ctrl+click, a Shift+click and a `target="_blank"` link away
from the page to hand to the system browser, which no site is granted, so in a web tab
those presses opened nothing at all. It is off (`src-tauri/src/lib.rs`), the app's own
links say where they go in its own code, and `scripts/web-click-probe.py` presses every
kind of link every way. A page that asks for a window at a size of
its own - a sign-in, a share dialog - gets a framed window on the opener's own store,
because that page reports back through `window.opener` and closes itself; on the
other engines it is a tab, as before.

## A link from another program

nib can be the machine's browser, so a link clicked in a mail, a chat, a PDF or a
terminal opens as a web tab. Settings > General > Browser has one row: a Make default
button while nib is not the browser, the tick once it is, asked again whenever the
window gets the keyboard back. No system lets a program make itself the default, so the
press does what Chrome's does: Windows opens nib's own page under Settings > Default
apps, a Mac asks its own question, and Linux sets the handler for the two schemes.

nib claims `http` and `https` and nothing else - not `.htm`, `.html` or `text/html`,
because a saved page is a local file and nib opens none. On Windows the registration
(`StartMenuInternet`, the `NibURL` ProgID, `RegisteredApplications`) is written by the
NSIS installer and the MSI, taken away by their uninstallers, and put back at launch
when a portable or Scoop copy moved; `src-tauri/src/default_browser.rs` holds all three
to the same values.

A link arrives as a command line on Windows and Linux (`nib.exe --url "%1"`, or a
second launch handed to the running app) and as the system's "open these" on a Mac.
The crate takes only a page on the web and never anything else on a link's command
line (`web_handed.rs`), and gives it to the window in front, else the first, holding it
until that window listens (`launch.rs`, the same road a file takes). The window opens
each page as a tab in front, beside the tab being read, in the open space and so in its
store of site data, and comes forward (`lib/web-tab/handed.ts`). A launch for a link
draws its window first; the listener is fetched with the rest of the roads in, after
the space has restored.

## The page itself

What a browser does with the page in front of it without being asked, each on
`WebView2`'s own event or call, and each said to the window as `nib://web-page` or
`nib://web-found` and landed on the tab's state by `web-tab/heard.ts`. Elsewhere the
engines say nothing, and what each one does there is said with it.

- **Find.** Ctrl+F opens the app's find bar under the bar - the one a note, a note
  being read and a PDF find with - and the engine's own find does the finding
  (`ICoreWebView2Find`): every match marked in the page, the lit one scrolled to, the
  tally and which one is lit said back as they change. Enter and Shift+Enter, Ctrl+G and
  F3 step; Escape closes it and the marks go. It is also a row in the dots and in the
  palette. Inside the page the keys are the page's first, which is Chrome's order: Google
  Docs, Notion, VS Code on the web and Figma have a find of their own on Ctrl+F and keep
  it. A line of script in every page listens last and, when nothing in the page took the
  key, asks for the bar under one of the window names `web_opens.rs` reads - find, next,
  previous, and the address field for Ctrl+L and Alt+D - for that tab alone, said to the
  window as `nib://web-passed`. Never a command name, so a page can reach its own find
  and its own address field and nothing else (see `lib/web-tab/passed.svelte.ts`). The
  script answers after every handler the page has, including the ones the page added
  after it. A page the tab
  arrives on while the bar is open is looked in again. An engine without the find (an
  older runtime, a Mac, Linux) is asked through the page: `window.find` walks and
  selects one match at a time and the page's text is counted for the tally. See
  `src-tauri/src/web_find.rs`.
- **The whole screen.** A video's own full screen button, or YouTube's `f`, asks for the
  whole screen and the engine can only give it the whole webview, which was the pane. The
  engine says when a page holds a full screen element, and the window goes full screen
  with the page placed over all of it; Escape or F11 give it back, and so does switching
  to another tab. A window the reader had already put full screen stays so. Any other
  pane's page steps out of the way while one holds the screen. See
  `web-tab/filling.svelte.ts`.
- **Sound.** A tab playing sound wears Chrome's speaker after its name. **Mute site**, in
  the tab's own menu, in the palette and on a key a reader may give it (`web.mute`),
  silences that site in every tab it is open in and the next time it plays anywhere,
  until it is unmuted - the speaker is struck through while it would be playing. By
  site, as the bar shows it, on this device; see `web-tab/sites.ts` and
  `web-tab/mute.ts`. Elsewhere a mute is the page's media elements told to be quiet.
- **Zoom.** Ctrl and the wheel over the page, Ctrl and `=`, `+`, `-` or `0`, and the dots'
  three rows all move one zoom, a rung of Chrome's ladder at a time from 25 to 500 per
  cent, and the menu's percentage says what it is however it was made. Each site opens at
  the size it was left at and every other at a hundred per cent, the way Chrome keeps zoom
  by site. A pinch on a touchpad or a screen magnifies the page the way Chrome's does,
  without laying it out again or moving the percentage; it comes on with the rest.

  Inside the page the wheel and the keys are the engine's own zoom, which every webview
  has off unless it asks: a web tab's page asks (`zoom_hotkeys_enabled` in `web_tabs.rs`)
  and the app's own page does not, since Ctrl and the wheel there size a note's words. So
  the page hears them first, as in Chrome: a map, a spreadsheet or a design tool that
  zooms itself on Ctrl and the wheel keeps it, and only what the page let go by zooms the
  page. A wheel reaches the page through `web_wheel.rs` with Ctrl held as Windows wrote
  it, one message a notch, so a notch is one rung. With the keyboard in the app - the
  address field, the sidebar - the bar reads the same keys, the text size's own bindings
  and Chrome's Ctrl and `+` beside them.

  The engine keeps a zoom made in the page for that one page and goes back, at the next,
  to the last size the app set - saying so, which read as the site going back to that
  size. So a zoom the engine reports is set again as the app's own at once, and a site
  keeps it from page to page; and the engine's own Ctrl+0, which goes back to that same
  size, is asked of the app the way the find keys are, when nothing in the page took it.
  See `src-tauri/src/web_page.rs`. Measured by `scripts/web-zoom-probe.py`: before, a
  notch of Ctrl and the wheel moved no rung; with the engine's zoom switched on and nothing
  more, a site zoomed to 110 per cent was back at 100 on its next page, and forgotten. Now a
  notch is one rung, the next page of the site keeps it, another site opens at 100, and a
  page with a Ctrl and the wheel of its own hears the notch and is not zoomed.

  The engine's zoom is `WebView2`'s alone. Elsewhere the dots' rows zoom the page, and so
  do the bar's keys but on a Mac, where the menu bar's Zoom rows take them first: Tauri's
  stand-in for the engine's zoom there is a script put into the page, which a site should
  never be given.
- **Developer tools.** F12, Ctrl+Shift+I (Cmd+Alt+I on a Mac) and the page menu's
  Inspect open the engine's own tools for the page, from inside it or from the bar. The
  build that ships has them for web tabs only - the `devtools` feature, on desktops -
  and nib's own window keeps them to a development build.
- **View page source.** The page menu's row asks for `view-source:` and the address,
  which opens as a tab: the source of anything a tab may hold and nothing else. The
  address field takes it typed, as Chrome's does.

## Downloads

A file a page hands over is saved the way Chrome saves it: into the Downloads folder,
under the name the server or the link gave it, numbered `name (1).pdf` beside a file
that is already there (`backup (1).tar.gz` for a two-part extension), with no dialog.
A glyph appears at the right of the bar with the first file of the run, in the accent
with a ring filling round it while anything is on its way; pressing it opens a list
under it, newest first. A finished row opens the file, its folder glyph shows it in
Explorer or Finder, a row on its way can be stopped, and a file that did not arrive
says Failed. The list is this run's, like Chrome's bubble.

**Why this was a bug and not a missing feature.** wry answers a download nobody has a
handler for by accepting it silently: `WebViewAttributes::default()` carries a handler
that returns true, so `WebView2`'s own download bubble was switched off and the file
went to the engine's default path. A course PDF on Moodle was pressed, arrived in
Downloads, and nothing on screen ever said so. `src-tauri/src/downloads.rs` is the
handler now, through `WebviewBuilder::on_download`, which is one hook on all three
desktop engines.

- **The engine fetches the file, on the page's own webview.** So the request carries the
  page's cookies and login from whichever profile or store `engine::web_store` put that
  webview on; a file behind a sign-in (`pluginfile.php`) arrives whenever the page could
  open it, and nothing about downloads has to know where the session is kept.
- **The window names a download by id, never by path.** `web_download_open` and
  `web_download_show` open only a file the crate itself saved and saw finish.
- **A name is made safe on every platform**: no separators, nothing a file system
  refuses, no device name, no dot at either end, at most 180 characters with the
  extension kept. `NIB_DOWNLOADS_DIR` points a probe at a folder of its own.
- **Progress is `WebView2`'s and `WKWebView`'s.** On Windows `downloads::progress`
  listens to the operation the engine hands out a second time, after wry's handler, and
  matches it by the path that handler chose; it is also what Cancel reaches. On macOS wry
  keeps the `WKDownload` to itself, so the tab's navigation delegate is given one of
  nib's own in front of wry's: `didBecomeDownload` is passed to wry's delegate first,
  unchanged, and the download is then kept and matched to the list by its address, the
  way wry's word that it ended is matched. Its `NSProgress` is read a few times a second
  while anything is going, and Cancel is its own `cancel:`. On Linux a file says when it
  starts and when it ends, the ring sweeps rather than fills, and Cancel only takes the
  row away.
- **A tab a page opened for a file closes again**, the way Chrome's does: `target="_blank"`
  on a download link opens a tab through `nib://web-open`, the file starts in it, and the
  reader is put back on the page that asked. Only a tab a page asked for that never
  showed a document of its own; see `downloaded` in `pages.svelte.ts`.
- **A page closed while a file is on its way stays until the file is in**, out of sight.
  The engine goes on fetching after its webview is gone but stops saying anything about
  it, so the list would have turned for ever. `web_close` hides such a page instead
  (`downloads::linger`), and it closes when its last file ends.
- **An inline PDF stays in the tab**, in the engine's own viewer, the way a browser shows
  one; its download button is a download like any other. nib's PDF viewer is for a file
  in a space, and a page's PDF is the page's.
- **Several files at once from one page without a press** is the engine's "automatic
  downloads" question, asked in the bubble like any other permission.

A phone has no web tabs - a site there opens in the system browser, whose downloads are
its own. `scripts/web-downloads-probe.py` is the drive: every shape a download takes, on
a probe build, read back out of the folder, the tabs and the crate's list.

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
and the session in it, do not die with the tab. Emil, 2026-09-13: _"When I close and
then reopen a web note, all state is lost. For example, when I log in, then I would be
logged out. That should not be the case."_

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
back out of the page, then closes the note, opens it again, quits the app by closing its
window and starts it over. Run it after any change to this seam.

|                                                          | an environment per tab | one shared | shared, and held open |
| -------------------------------------------------------- | ---------------------- | ---------- | --------------------- |
| two tabs open at once see one session                    | no                     | **yes**    | yes                   |
| the session cookie after closing the note and opening it | no                     | **no**     | **yes**               |
| a lasting cookie and `localStorage`, closed and opened   | yes                    | yes        | yes                   |
| the same, after the app is started again                 | yes                    | yes        | yes                   |
| the session cookie after the app is started again        | no                     | no         | no, until 2026-09-27  |

The middle column is the whole reason the page that holds the session open exists:
sharing the environment made two tabs one session and still lost it when the last webview
went, because that is when `WebView2` ends the profile's session. The third and fourth
rows were always true and are what the `web` folder on disk is for.

**A session cookie survives a restart, the way Chrome's do with "Continue where you left
off".** Emil, 2026-09-27: *"on moodle-app2.let.ethz.ch every time i reopen nib I have to
reloggin."* The last row was the whole of it. Moodle's `MoodleSession`, Shibboleth's
`_shibsession_...` and the identity provider's session at `aai-logon.ethz.ch` are all
session cookies - no expiry - and `WebView2` threw them away when nib quit, while the
lasting cookies and `localStorage` beside them came back off disk as they always had.

`WebView2` has no setting for it. Chromium's own switch for the same thing,
`--restore-last-session`, was tried and measured and is not enough: under it the engine
writes session cookies to its database, but a quit that closes the pages before the
process ends still ends the session and deletes them, so a login came back on some
restarts and not others. What nib does instead is what the setting does: a session cookie
is given an expiry, four hundred days out, in the profile's own cookie store, where the
engine keeps and reloads it like any other cookie. The site never sees the difference
(an expiry is not sent with a cookie) and keeps every say it had - a new value replaces
it, a logout deletes it. It happens after every page a tab loads, which is after every
step of a sign-in that goes through pages, and once more as the window closes, which
holds the window for the engine's answer - two seconds at most - and catches a login a
page made without loading another. See `apps/desktop/src-tauri/src/web_cookies.rs`.

Measured 2026-09-27 on the probe, with the cookie database read between the quit and the
next start:

| | before | `--restore-last-session` | the expiry |
| --- | --- | --- | --- |
| the session cookie after a quit and a start | 0 of 5 | 7 of 12 | **7 of 7** |
| the same, with the app killed seconds after signing in | - | 0 of 2 | **2 of 2** |
| the same, killed 45 s after signing in | 0 of 1 | 2 of 2 | - |
| a cookie a page set without loading another, just before the quit | - | - | **2 of 2** |

**A partitioned cookie stays in its partition.** A cookie set with `Partitioned` (CHIPS)
belongs to its site only under the one top-level site it was set under: a chat widget's
session inside a shop's page is not the widget's session anywhere else. The first version
of the expiry went through `WebView2`'s COM cookie manager, which knows nothing of
partitions, and wrote each partitioned session cookie back as a copy without one - lasting
four hundred days, and sent to its site under every top-level site. The expiry is written
through the `DevTools` Protocol now, `Network.getAllCookies` and then `Network.setCookie`
for each session cookie, which hands a cookie over with its partition and takes it back
with it: a partitioned login lasts across a restart too, in its partition. The copies the
COM manager left are taken away whenever the store is kept again - a lasting cookie with
no partition, the name, domain and path of a partitioned one in the same store, and an
expiry four hundred days after a day that manager was in use, and nothing else. See
`apps/desktop/src-tauri/src/web_cookies/twins.rs`.

**What it costs, said plainly: once nib has opened one website, it keeps one `WebView2`
browser process until you quit, the way a browser does.** That is the price of a web note
being a browser tab you can close and open again without signing in each time, and it is
paid once rather than per tab - the pages in the tabs are the part that costs a
gigabyte, and those are still parked and closed as they always were. See `session` in
`apps/desktop/src-tauri/src/web_tabs.rs`.

**On macOS a session cookie is given the same expiry, through `WKHTTPCookieStore`.**
wry hands out the `WKWebView` itself, and the view's configuration names its data store
and the store its cookie store, so the seam `WebView2` has exists here too: every cookie
of the store is read after each page a tab loads, and each session-only one is made again
from its own properties with a lifetime four hundred days out - an expiry and a maximum
age, because `NSHTTPCookie` reads one or the other by the cookie's version - `Discard`
said outright as no, and `HttpOnly` written back by name where it had it (the key is not
one `NSHTTPCookie` documents). The data store behind a tab is a persistent one - `nib-web-tabs`
or a space's own - so a cookie with an expiry is written to disk and comes back on the
next launch, where a session one lived only in the network process's memory and died with
it. The window's close waits for it as on Windows. **What it does not catch:** a login a
page made without loading another, followed straight by Cmd+Q. Quitting from the menu is
not a window closing, so the close hook is never asked; the next page load after a
sign-in is what keeps it.

On Linux the runtime already keeps the web tabs' context alive for the app's life (it
has to, to reuse the WebKit network process). A login there rests on the persistent data
store on disk - a lasting cookie survives, a session-only one does not, a restart
included - until the same seam exists for `WebKitGTK`: wry hands out no cookie store
there, so there is nothing yet to give an expiry through.

**No nib IPC reaches the site**, three times over:

1. The capabilities name the app's own **webviews** rather than the windows they
   sit in. A capability that names a window grants every webview in that window,
   whatever its own label says - so a website in a tab would have been holding
   `opener`, the dialogs and the updater. The two patterns name the same two
   windows they always did, because a webview built by `WebviewWindowBuilder`
   carries the window's label, and a web tab's `web-...` is not among them.
2. A remote origin matches no capability here, which Tauri refuses on its own.
3. The globals that reach the crate are deleted before the page's first script
   runs - **or rather, they are meant to be, and they are not. See below.**

### Where a space keeps its web data

**A space can keep what websites store apart: Global, Space or Site, in the space's own
menu under Web data.** Emil, 2026-09-27: *"there should be a setting for a space where
you can set on which granularity to save the website data. either global (default)
which just uses the global cookies and data store of nib or per space which saves it per
space or per site which makes it separate for each site in this space."*

- **Global**, which every space is until asked: the one store all spaces share, in
  `web`, exactly as before. Signed in once, signed in everywhere.
- **Space**: a store of the space's own, so a work space and a home space can be signed
  in to the same site as two different people.
- **Site**: within the space, a store per site, so no site sees what another one left.

**A site is the registrable domain** - one label under a public suffix, from the public
suffix list with its private section: `moodle-app2.let.ethz.ch` and `aai-logon.ethz.ch`
are both `ethz.ch`, `a.github.io` and `b.github.io` are two sites. It is where a
browser already draws the line between strangers (site isolation, `SameSite`, storage
partitioning), and it is what keeps a sign-in through a sister host working: Moodle and
ETH's identity provider are one site and so one store. A page's store is the site the
tab is on when its page is built; a login that passes through somebody else's domain
happens inside that tab and so inside that store. An address or `localhost` is its own
site. See `siteOf` in `apps/desktop/src/lib/web-tab/web-data.ts`.

What a store is, per engine (`apps/desktop/src-tauri/src/web_stores.rs`):

| | Global | Space, Site |
| --- | --- | --- |
| Windows (`WebView2`) | `<config>/web` | `<config>/web-stores/<name>`, a user data folder of its own |
| Linux (`WebKitGTK`) | `<config>/web` | `<config>/web-stores/<name>`, a web context of its own |
| macOS 14+ (`WKWebView`) | the store `nib-web-tabs` | a data store of its own, sixteen bytes hashed from the name |
| nib's own Chromium (`cef`) | the primary profile | **the primary profile** - the runtime cannot be asked for a profile per tab yet |

On Windows a store of its own is a user data folder rather than a `WebView2` profile,
because the runtime has no way to name a profile for a webview it builds. It costs a
browser process per store while one of its tabs is open, and nothing after: only the
global store has the page that holds a session open, and a login in a store of its own
survives its last tab closing because its session cookies are given an expiry as its
pages load. Measured on the probe build: a session cookie, a lasting cookie and
`localStorage` all survive closing the tab twice and a restart, in a space's store and
in a site's; a store of its own starts signed out; and going back to Global finds the
global login where it was.

**The name is the store.** `space_<id>` or `site_<id>_<site>`, from the space's id -
which a rename keeps - and never from its name or its folder. So the same store comes
back on every launch, and **changing the setting loses nothing**: the store left behind
stays on disk with its logins in it, and choosing it again is choosing them. The choice
is this device's (`nib:web-data`), because the stores are folders on this device.
Choosing builds the space's open pages again in the new store, each where it was and on
the page it was on, so the choice is on screen at once.

**A space kept apart keeps its history apart too.** The address field's history of
pages (`visited.ts`) is `nib:web-visits` for every space on Global and
`nib:web-visits:<id>` for a space on Space or Site, so a space that signs in apart does
not offer its pages to the others as they type.

### What a page is given that a browser would not give it

**This is open, it breaks Google Docs, Sheets and Slides, and it is the one thing on
this page that is a lie about what ships.** Measured on 2026-09-18 by
`scripts/web-globals-probe.py`, which is a page in a real web tab asking what it was
handed:

|                                                         | in a web tab                                                                                                     | in Edge |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------- |
| a classic script may declare `let ipc` at the top level | **no**                                                                                                           | yes     |
| what is on `window` of the app's                        | **`ipc`, `isTauri`, `__TAURI_INTERNALS__`, `__TAURI_OS_PLUGIN_INTERNALS__`, `__TAURI_EVENT_PLUGIN_INTERNALS__`** | nothing |

A web tab is a Tauri webview, and a Tauri webview carries the app's own machinery into
whatever page it shows. wry writes one of those globals for its message channel, before
any script this crate supplies:

```js
Object.defineProperty(window, 'ipc', { value: Object.freeze({ postMessage: ... }) })
```

`Object.defineProperty` leaves `configurable` out, so it defaults to false - and **a
classic script may not declare `let ipc`, `const ipc` or `class ipc` at the top level
while the global object carries a non-configurable `ipc`.** The whole script is a
`SyntaxError` before its first line runs. `ipc` is three letters and an ordinary name
for a bundle to use, and Google's editors bundle uses it, so a sheet in a web tab
rendered for a moment and was then replaced by Google's own _"Loading issue -
Troubleshoot this issue by clearing application resources"_ page. Its console said so
outright: `Uncaught SyntaxError: Identifier 'ipc' has already been declared` at
`m=core:1`, and then `RITZ_initializeModules is not defined`, `waffle_api is not
defined`, `DOCS_initialLoadTiming is not defined`. **Nothing was wrong with the
storage.** `navigator.storage.estimate()`, `navigator.cookieEnabled`, a cookie written
and read back, `localStorage`, `sessionStorage`, IndexedDB written and read back, the
Cache API, Web Locks, `getRegistrations()`, workers and the user agent all answer in a
web tab exactly as they answer in Edge on this machine, and the browsing profile on
disk has a `https_docs.google.com_0.indexeddb.leveldb` in it.

`GUARD` cannot undo any of it. It is one of the injected scripts and it runs **in the
middle** of them - after wry's and before Tauri's own - so the globals it deletes are
not there yet and all of them are there by the time the site's first script runs. And
`ipc` could not be deleted from anywhere: `delete window.ipc` answers false and
`Object.defineProperty` throws `Cannot redefine property: ipc`, because a page may not
redefine a non-configurable property of its own global object.

So it cannot be answered from inside the page, and it has to be answered where the
scripts are registered. The engine will take them back - `RemoveScriptToExecuteOnDocument
Created` removed wry's and `window.ipc` was gone, measured - but an identifier is what it
takes, `WebView2` hands those out as a counter this crate never sees, and the removal has
to happen before the first document is created, which means a tab's webview being built
on `about:blank` and navigated afterwards. That is a change to `web_open`'s shape and it
belongs to a change of its own. The honest upstream fix is one word: wry writing
`configurable: true` in that descriptor, which would let `GUARD` delete it and let a page
declare its own `ipc` either way.

### What a site may do

**A site is asked about at the moment it asks, in a bubble under the address bar.**
Emil, 2026-09-13: _"a lot of stuff is still done extremely bad, e.g. having explicit
buttons for allow clipboard or allow camera. I don't think chrome does it like
this."_

He is right, and what was here before was exactly that. The camera, the microphone,
the clipboard, where you are and `Notification` were taken off `Navigator.prototype`
before the page's first script, so the engine never had a request to raise - and the
only way to give a site the camera was a row in a menu saying "Allow the camera",
which nobody goes looking for, which has to be pressed _before_ the site asks rather
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
German reader was being offered _Block_, the markdown block, as the way to refuse a site
the camera.

**The bubble answers the pointer and holds the keyboard.** Emil, 2026-09-28, of a mail
site asking to show notifications: _"and this thing here is not clickable."_ For two
weeks it was not. The card is `.nib-bubble`, the shape a one-sentence hint is drawn in,
and a hint lets every press through to the row it sits over - so both answers were
drawn over the page's hole and every press landed on the hole. The native side was
never in the way: the page is hidden while the bubble is up, and Windows sends a click
there to the app's own webview. Every probe had pressed the buttons with `click()`,
which skips the hit test a hand goes through. A bubble with something to press in it is
now `.nib-bubble.is-pressable` - the site's question, the site information and the
downloads - and `bubble.test.ts` reads every component to keep it that way. The keyboard
had the same shape of trouble: the page that asked held it, and a hidden webview keeps
it, so Escape went to a page nobody could see. The bubble takes the keyboard back to the
app's own webview as it appears, without bringing the window forward, and holds it
itself rather than on either answer, so a key meant for the site allows nothing. Measured
with `scripts/web-overlays-probe.py`, which now asks the window what a pointer lands on.

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
and the camera, because pressing Record _is_ the answer and a second bubble inside nib
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
decide.

**On macOS the camera and the microphone go through the same bubble.** What was here
before said a Mac site got the engine's own prompt, and that was not true: wry sets a UI
delegate on every `WKWebView` whose capture handler answers `WKPermissionDecisionGrant`
for every origin and every frame, so a site in a web tab was handed the camera without a
word, and so was a frame inside a note in the window's own page. The only prompt anybody
saw was the system's, once, for nib itself. wry has no setting and no hook for it, so each
webview is given a UI delegate of nib's own in front of wry's
(`webView:requestMediaCapturePermissionForOrigin:...`), which holds the decision handler
open while the window asks, exactly as the `WebView2` deferral is held, and passes every
other question - the file picker, a window the page asked for - to wry's delegate by
forwarding. A site that asks for both at once is two questions, camera first, because the
window remembers each for the site on its own; the microphone is only asked about once
the camera has been allowed. The window's own page is answered the Windows way: the app's
own origin is allowed, anything else in it refused. The requesting frame's origin is the
one asked about, as on Windows. Where you are, notifications and a clipboard read are
not raised through this delegate - `WKWebView` answers them itself, a clipboard read with
its own Paste callout - so on a Mac the bubble is the camera and the microphone. macOS
before 12 has no such delegate method.

**On Linux** the engine's own default is what a site gets: the same event exists there -
WebKitGTK's `permission-request` signal - and it is not reachable through what wry hands
out.

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
`holdsWords` answers no for a web tab, and `rooms/kind.ts` answers _no room at all_
for a `.url` path, which is the end both machines can see. Not a switch that could
be turned on by mistake, then, but two consequences of what the file is. It syncs,
versions and goes to the trash like every other document.

## Where the code is

|                                                       |                                                                                                                                                                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/desktop/src-tauri/src/web_tabs.rs`              | the child webview: the things the window may ask of a page, where a page may be built, the guard script, the place a revived page is put back at, the trail, the address rule, the permission request held open, the still picture. Unit tested |
| `apps/desktop/src-tauri/src/web_reload.rs` | stopping a page, and loading it past the cache |
| `apps/desktop/src-tauri/src/web_wheel.rs` | a wheel over a page sent to the page's own window, so a notch is one notch. Unit tested, with windows of its own |
| `apps/desktop/src-tauri/src/web_page.rs` | what the engine says about a page besides where it is: its sound, its full screen and Escape out of it, its zoom, kept as the app's own, and Ctrl+0; and a mute. Unit tested |
| `apps/desktop/src-tauri/src/web_find.rs` | finding in the page: the engine's find, and the page's own where there is none. Unit tested |
| `apps/desktop/src-tauri/src/downloads.rs`             | where a file goes, the list of what this run saved, progress and Cancel on `WebView2` and `WKWebView`, a closed page kept until its file is in. Unit tested                                                                                                            |
| `apps/desktop/src-tauri/src/web_handed.rs` | which of what another program handed over is a page: `http` and `https` with a host, never the app, never a path. Unit tested |
| `apps/desktop/src-tauri/src/default_browser.rs` | nib among the browsers: the Windows registration and its repair, whether nib is the default and the press that asks each system. Unit tested |
| `apps/desktop/src-tauri/src/web_cookies.rs` | a session cookie given an expiry, so a login survives a restart: after each page and as the window closes. `WebView2` (through the `DevTools` Protocol, partitions kept) and `WKWebView`. Unit tested |
| `apps/desktop/src-tauri/src/web_cookies/twins.rs` | the copies without a partition that the COM cookie manager made of partitioned cookies, found so each keep takes them away. Unit tested |
| `apps/desktop/src-tauri/src/web_stores.rs` | a store's name checked, and what it is on each engine. Unit tested |
| `apps/desktop/src-tauri/src/paths.rs`                 | `is_shortcut`, beside the other three kinds                                                                                                                                                                                                            |
| `apps/desktop/src-tauri/src/tree.rs`                  | the four kinds the file list shows                                                                                                                                                                                                                     |
| `apps/desktop/src-tauri/src/search.rs`                | a shortcut is searched as the text it is, so a site is found by its address                                                                                                                                                                            |
| `apps/desktop/src-tauri/src/links.rs`                 | a website as a node in the index, and `url:` off every note, which now means a note that wants converting                                                                                                                                              |
| `apps/desktop/src-tauri/capabilities/default.json`    | webviews, not windows                                                                                                                                                                                                                                  |
| `apps/desktop/src/lib/web-tab/shortcut.ts`            | the file: written, read, and `.webloc` read. Pure, tested                                                                                                                                                                                              |
| `apps/desktop/src/lib/web-tab/note.ts`                | what a clip says, and what the old format said. Pure, tested                                                                                                                                                                                           |
| `apps/desktop/src/lib/web-tab/address.ts`             | what somebody typed, and the origin plainly. Pure, tested                                                                                                                                                                                              |
| `apps/desktop/src/lib/web-tab/frame.ts`               | what a frame may do, and the measurements behind asking first                                                                                                                                                                                          |
| `apps/desktop/src/lib/web-tab/pages.svelte.ts`        | the page each tab is on, the webview's life, parking, the still picture. Tested                                                                                                                                                                        |
| `apps/desktop/src/lib/web-tab/place.ts`               | where each note was left, per device: the offset and the trail. Tested                                                                                                                                                                                 |
| `apps/desktop/src/lib/web-tab/keep.ts`                | the file keeping up with the page, debounced. Tested                                                                                                                                                                                                   |
| `apps/desktop/src/lib/web-tab/permissions.svelte.ts`  | what each site was told, and the requests waiting for an answer. Tested                                                                                                                                                                                |
| `apps/desktop/src/lib/web-tab/WebAsk.svelte`          | the bubble a site is answered in                                                                                                                                                                                                                       |
| `apps/desktop/src/lib/web-tab/WebSite.svelte`         | what a site is, behind the mark in the bar                                                                                                                                                                                                             |
| `apps/desktop/src/lib/web-tab/downloads.svelte.ts`    | the list the glyph and the bubble draw, and the ring. Tested                                                                                                                                                                                           |
| `apps/desktop/src/lib/web-tab/WebDownloads.svelte`    | the list under the glyph                                                                                                                                                                                                                               |
| `apps/desktop/src/lib/web-tab/clip.ts`                | where the HTML comes from                                                                                                                                                                                                                              |
| `apps/desktop/src/lib/web-tab/WebTab.svelte`          | the pane: the hole, the frame, the card                                                                                                                                                                                                                |
| `apps/desktop/src/lib/web-tab/WebBar.svelte`          | the bar                                                                                                                                                                                                                                                |
| `apps/desktop/src/lib/web-tab/AddressField.svelte`    | the field an address is typed into: two faces, the rest of the address written in, the pages under it                                                                                                                                                  |
| `apps/desktop/src/lib/web-tab/omnibox.ts`             | what the field offers: the rest of an address and the pages worth listing, ranked. Pure, tested                                                                                                                                                        |
| `apps/desktop/src/lib/web-tab/visits.ts`              | the history's rows and what a visit does to them, bounded. Pure, tested                                                                                                                                                                                |
| `apps/desktop/src/lib/web-tab/visited.ts` | this device's history, one per space kept apart, read on first use. Tested |
| `apps/desktop/src/lib/web-tab/web-data.ts` | Global, Space or Site: what a site is, a store's name, a space's history. Pure, tested |
| `apps/desktop/src/lib/web-tab/web-data.svelte.ts` | which of the three each space chose, on this device. Tested |
| `apps/desktop/src/lib/web-tab/menu.ts`                | the dots: Chrome's rows, and the zoom ladder; the list under a held arrow. Tested                                                                                                                                                                                                   |
| `apps/desktop/src/lib/web-tab/bar-keys.ts` | what a key means to the bar: the address field, reload, the tabs by number, the zoom, Escape. Pure, tested |
| `apps/desktop/src/lib/web-tab/heard.ts` | what the engine says about a page, read and landed on the tab. Tested |
| `apps/desktop/src/lib/web-tab/sites.ts` | a site muted, and the size a site is drawn at, per device. Tested |
| `apps/desktop/src/lib/web-tab/mute.ts` | Mute site, in every tab showing it |
| `apps/desktop/src/lib/web-tab/filling.svelte.ts` | a page holding the whole screen, and the window following it |
| `apps/desktop/src/lib/web-tab/seek.ts` | finding in the page from the bar and from the keys. Tested |
| `apps/desktop/src/lib/web-tab/passed.svelte.ts` | a key the page let go by - find, a step, the address field, a modifier tapped twice - answered for that tab alone, the tap by the palette. Tested |
| `apps/desktop/src/lib/file-mark.ts`                   | the globe, off the name like every other mark                                                                                                                                                                                                          |
| `packages/markdown/src/links.ts`                      | `isWebTarget`, and a website among the files a link resolves through                                                                                                                                                                                   |
| `packages/editor/src/wikilink/notes.ts`               | `[[Svelte docs]]` with the extension left out                                                                                                                                                                                                          |
| `apps/desktop/src/lib/rooms/kind.ts`                  | no room for a website, said at the file's end                                                                                                                                                                                                          |
| `services/sync/src/notes.ts`                          | the extensions the account carries                                                                                                                                                                                                                     |
| `apps/desktop/src/lib/workspace.svelte.ts`            | `openWeb`, `createWebsite`, `openWebsite`, `webNamed`, `keepAsWebNote`, `webAimed`, `asShortcut`, `convertWebsites`, and the routing in `openEntry`                                                                                                       |
| `scripts/web-tab-e2e.py`                              | the drive: the file, the mark, the tab, the card, the clip                                                                                                                                                                                             |
| `scripts/web-freeze-probe.py`                         | the drive for the freeze: the pump, the window's own answers, and the log                                                                                                                                                                              |
| `scripts/web-switch-probe.py`                         | the drive for the switch: whether the page is still there, how long it takes to come back, what ten tabs cost                                                                                                                                          |
| `scripts/web-open-probe.py`                           | the drive for the open: whether a tab covered when it mounted shows a page at all, and how long each kind of open takes - the clock behind `NIB_PERF=1`                                                                                                |
| `scripts/web-session-probe.py`                        | the drive for the session: signs in to a page on the loopback, closes the note, opens it again, quits the app by closing its window and starts it over - a session cookie, a lasting one, a `localStorage` token and a partitioned cookie a widget from another site set, read back out of the page, all four kept; the widget's own site never sees its cookie, and a planted copy without the partition is gone after the next page |
| `scripts/web-downloads-probe.py`                      | the drive for downloads: an attachment, `<a download>`, an inline PDF, `blob:` and `data:`, a file behind a cookie, a `_blank` link, a name taken, progress, Cancel and a tab closed halfway                                                           |
| `scripts/web-globals-probe.py`                        | the drive for what a page is handed: whether a site's own script may declare `ipc`, and what of the app's is on its `window`. Both are wrong today; see "What a page is given that a browser would not give it"                                        |
| `scripts/web-bar-probe.py` | the drive for the bar and its keys: F6 and F5 inside the page, F5 and the reload keys in the app with the request's cache header, the cross and Stop, the history under Back, Alt+Enter, the middle button on reload and Ctrl+1 |
| `scripts/web-cursor-probe.py` | the drive for the pointer: the window's pointer count after typing in the app's page and in a site, and after moving over each. See "The pointer is never hidden while somebody types" |
| `scripts/web-scroll-probe.py` | the drive for the wheel: one notch at the legacy window and at the page's own, frame by frame, against Chrome headless. See "One notch of the wheel is one notch" |
| `scripts/web-zoom-probe.py` | the drive for the zoom: Ctrl and the wheel, the same site, another site, a site with its own Ctrl and the wheel, the keys in the app, and Ctrl+0 from inside the page. See "Zoom" under "The page itself" |
| `scripts/web-click-probe.py` | the drive for a link in a tab of its own: a plain press, Ctrl, Ctrl+Shift and the middle button on a link, a `target="_blank"` link and a script's own link inside a page, and on a website's row in the file list. See "A link in a tab of its own" |
| `apps/desktop/src/lib/overlays.ts`                    | the one place that says something is over the note, and tells the web tab                                                                                                                                                                              |
| `apps/desktop/test/effects/web-switch.effect.test.ts` | the pane, mounted and unmounted, which is where the page used to be closed                                                                                                                                                                             |
| `apps/desktop/test/effects/web-tab.effect.test.ts`    | the pane, mounted, which is where a website used to take the window down with it                                                                                                                                                                       |

## What is left

- **Windows 11's one-press Set default button may not be offered for nib.** Microsoft
  gives it to programs that claim `http`, `https`, `.htm` and `.html`, and nib claims
  only the first two, so its page under Default apps may ask for HTTP and HTTPS one at
  a time. Claiming the file types would hand nib every saved page on the disk.
- **A Mac may not list nib in its own default browser menu.** Launch Services files a
  program as a browser only when it also claims HTML documents; the press asks for the
  two schemes directly and does not need the menu. Not yet seen on a real Mac.
- **Linux packages list nib as a browser only once it has been made one.** The press
  writes its own handler; the desktop entries under `packaging/` still say `%F` and
  markdown, and change with the file types.
- **The history has no Delete browsing data yet**, because nothing in nib clears a
  browser's data today; Shift+Delete on a row is the one way out of it. Whatever
  clears the rest when it exists clears `nib:web-visits` too, and a private tab, when
  there is one, must not write to it. It is one list per device; a space whose web
  data is kept apart from the others would want its own list.
- **Four of Chrome's menu rows are not here, because nothing is behind them yet.**
  History wants a surface nib does not have - a list of every page a window has been
  through; Downloads is the glyph in the bar rather than a row, see "Downloads"; Copy
  and Paste are the page's own context menu already; and More tools' developer tools
  are reached by Inspect in that same menu and by F12. Each is a row the day the thing
  behind it exists.
- **A page holding the whole screen, the speaker and the find's marks are `WebView2`'s
  alone.** A Mac and Linux have no event for the first two reachable through wry, and
  their find marks one match at a time; see "The page itself".
- **A page still gets `ipc` and the app's other globals, and Google's editors will not
  load because of it.** The whole of it is in "What a page is given that a browser would
  not give it" above, with the measurement and what the fix costs. It is the largest
  thing open here: it is not one site, it is any site whose bundle happens to declare a
  top level `ipc`, and nothing in the page can tell the reader why.
- **A page's still picture is Windows and macOS only.** `CapturePreview` and
  `WKWebView`'s `takeSnapshot` are reachable; WebKitGTK's equivalent is not through what
  wry hands out, so an overlay over a page on Linux still blinks the pane.
- **A permission on Linux is the engine's own default**, for the same reason: the
  event that would let the app ask is not reachable there.
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
