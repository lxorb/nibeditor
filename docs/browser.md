# The browser

A tab can be a website. Yesterday that meant a child webview over the pane and
the system's own engine behind it - Chromium on Windows, WebKit on a Mac, WebKit
on Linux - and the first paragraph of `web-tabs.md` said nib would never ship a
browser engine, because a second Chromium is 150 MB and its own update channel.

Emil, 2026-09-13: *"the browser feature should not just be a side feature, nib
should effectively replace not just a digital workspace but a browser at the same
time. Multiple tabs must not create separate Chromium instances but behave like
tabs in Chromium. We will support all the Chrome extensions and users can install
them. We don't need to reinvent what a browser does, we just need to integrate
Chromium properly, in a way that we don't need to do anything manually when there
are upstream changes. For now keep the Chromium settings within Chromium
(chrome://settings will work for us)."*

So the 150 MB and the update channel are the price now, and this document is
about paying it once and properly. It is a design and a measurement, not a
build: the code that exists is `spike/browser`, which is a proof and is not
wired into the app.

The short version. **nib ships Chromium through CEF, in a process of its own that
starts the first time somebody opens a web tab.** Every web tab is a view in that
one browser process, exactly as every tab in Chrome is. Chromium keeps everything
Chromium is good at, `chrome://settings` and `chrome://extensions` included, and
nib keeps the account, the files and the shell. Windows, macOS and Linux get the
same engine and therefore the same product; a phone gets the phone's browser, as
it did before.

---

## 1. What the engines can actually do

Every number and every claim below was read out of a primary source on
2026-09-13, and the source is named. The two candidates were the system engine
nib already uses and a Chromium of nib's own.

### WebView2, which is the engine on Windows today

WebView2 gets one thing exactly right and fails four of the asks above outright,
and both halves are documented rather than guessed.

**Tabs are already Chrome-like.** This was the worry and it is not a problem.
WebView2 uses Edge's own process model: one *browser* process per user data
folder, with renderer processes allocated by site isolation across every control
in that folder. "There's only a single, specific browser process in a WebView2
process group", and "a given renderer process is not associated with a single
`CoreWebView2` instance, because the renderer process can serve frames in
multiple `CoreWebView2` instances that use the same user data folder"
([process model](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-model)).
Creating a second `CoreWebView2Environment` over the same folder does not make a
second browser process; giving two environments *different* options over the same
folder does not either - the second one simply fails to create webviews. The only
documented way to get a second browser process is a second user data folder. So
nib's eight web tabs today are eight views in one browser process, not eight
Chromiums, and the fear in Emil's message was already unfounded on Windows.
`GetProcessExtendedInfos` (Win32 1.0.2210.55) even hands back which frames are
live in which renderer.

**And then:**

| the ask | WebView2 |
| --- | --- |
| `chrome://settings` works | **no, and not configurable.** `edge://settings` is on the published blocked-URL list, with `edge://extensions`, `edge://version`, `edge://newtab`, `edge://favorites`, `edge://apps` and nine more |
| users install any Chrome extension | **no.** `ICoreWebView2Profile7::AddBrowserExtension` takes "the `manifest.json` folder path" - an unpacked folder on the local disk. There is no CRX path and no store path in the API at all |
| extensions with a UI | **no.** "Extensions that are designed to include any UI interactions (e.g. icon, badge, pop up, etc.) can be loaded and used but **will have missing UI entry points** due to the lack of browser UI elements to host these entry points in WebView2" |
| Translate | **no, and not configurable.** "This feature is turned off" |
| History | no read API. The data is stored and can be *deleted* (`ClearBrowsingDataAsync`, `BrowsingHistory`) and never enumerated. `edge://history` is not on the blocklist and does work, and has broken as a regression three times in 2026 |

Sources: the blocklist and the Off/Configurable table are
[Differences between Microsoft Edge and WebView2](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/browser-features);
the extension API and the UI sentence are
[ICoreWebView2Profile7](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2profile7),
gated behind
[`AreBrowserExtensionsEnabled`](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2environmentoptions6)
which defaults to false; the history regressions are
[#5580](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5580),
[#5604](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5604) and
[#5670](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5670).

What WebView2 *does* give a host, for the record, because it is a lot and it is
all GA: full Chromium DevTools and the DevTools Protocol; `Print`, `ShowPrintUI`
and `PrintToPdfStream` (1.0.1518.46); a real find API with `MatchCount` and
`ActiveMatchIndex` and a `SuppressDefaultFindDialog` so a host can draw its own
bar (1.0.3405.78); downloads with a default dialog a host can place or hide
(1.0.902.49 and 1.0.1072.54); favicons (1.0.1293.44); `ZoomFactor`; several
profiles under one browser process, and `IsInPrivateModeEnabled` on the
controller options (1.0.1210.39) - though the docs say nothing at all about what
InPrivate isolates or whether it is ephemeral. Autofill for addresses is on by
default, passwords are off and can be turned on, payments cannot be turned on at
all, and the page that would manage any of them is `edge://settings`, which is
blocked.

Two footnotes worth keeping. The Evergreen runtime is part of Windows 11 and on
"the vast majority" of Windows 10 devices, so it costs nothing to ship; the fixed
version is "over 250 MB". And the feature table still says extensions are off and
not configurable, which the GA API contradicts - the reference is the one to
believe.

### CEF, which is Chromium with a host API

_This section is filled in from the CEF research below._

### The ones that need one sentence each

- **Electron.** A second application runtime beside Tauri, with its own Node,
  its own updater and its own 100 MB, to get the same Chromium CEF gives - and
  nib's shell, editor and crate would have to be rewritten into it. The engine is
  the thing worth taking; the runtime is not.
- **A Chromium fork.** Emil's requirement was "we don't need to do anything
  manually when there are upstream changes". A fork is the definition of doing it
  manually, four weeks at a time, forever.
- **Servo.** Not a Chromium, so no Chrome extensions and no `chrome://` pages,
  which is two of the four asks gone before compatibility is even discussed.
- **Remote-debugging a system Chrome.** Drive the user's own Chrome over the
  DevTools Protocol and draw nothing. It needs Chrome installed, it cannot put a
  page inside nib's window, `--remote-debugging-port` is a full-control channel
  any local process can also reach, and recent Chrome refuses to attach to the
  default profile for exactly that reason. A browser nib does not own is not a
  browser nib can ship.

---

## 2. The decision

_Filled in below._

---

## 3. What Chromium keeps, and what nib replaces

The rule, and it decides every row: **if Chromium already has an opinion about
something that is about the web, Chromium keeps it. If it is about nib - the
account, the files, the shell, the words - nib keeps it.** That is what "we don't
need to reinvent what a browser does" means in practice, and it is also the DRY
answer: every row nib takes over is a row nib maintains against Chromium's
changes forever.

### Chromium keeps

| | how it is reached |
| --- | --- |
| the page, the engine, site isolation, the sandbox | it is the tab |
| settings, all of them | `chrome://settings` as a tab |
| the search engine choice | `chrome://settings/search`, and the address bar obeys it |
| extensions and their management | `chrome://extensions` as a tab, developer mode and all |
| extension shortcuts | `chrome://extensions/shortcuts`, which nib's own clipper already links to |
| history | `chrome://history` as a tab |
| downloads | `chrome://downloads` as a tab, and Chromium's own download prompt |
| passwords and autofill | `chrome://password-manager` as a tab |
| delete browsing data | `chrome://settings/clearBrowserData` |
| site permissions - camera, microphone, location, notifications | Chromium's own prompt on the page, and `chrome://settings/content` |
| zoom | the engine's, per site, as Chromium stores it |
| print | Chromium's print preview |
| find in page | Chromium's find, in nib's bar |
| DevTools | Chromium's, F12 |
| translate | Chromium's, if the build has it; see the honest note below |
| incognito | an off-the-record context, one per private tab |
| PDF, media, DRM, codecs | whatever the distribution carries |

**The settings tab is the whole point of the decision and worth being plain
about.** nib's own Settings has a Web section, and that section is nearly empty:
a row that opens the engine's settings, a row for the extension list on the
account, and the two or three choices that are nib's rather than the web's. Emil
asked for exactly this - *"for now keep the Chromium settings within Chromium"* -
and it is the right answer for longer than "for now", because a settings pane nib
draws over `chrome://settings` is a pane that has to grow a row every time
Chromium grows one.

### nib replaces

| | with |
| --- | --- |
| the Google account row, and Chrome Sync | the nib account. See "The extension list on the account" |
| bookmarks, and the bookmark manager | a website is a file in the space: `Name.url`. The file list **is** the bookmark bar |
| the new tab page | nib's own, below |
| save page as | the clipper, which is already an extension nib ships |
| share | nib's share sheet |
| Gemini, and any AI in the browser | nib's providers, with the keys on the device |
| the profile picker | one browsing profile, plus ephemeral ones for private tabs |

**One browsing profile, not one per space.** Chromium can serve many profiles from
one browser process, so per-space profiles were available and were not taken:
extensions are installed per profile, so a space would be a place where an
extension was or was not installed, and "install it again over there" is not a
sentence this app should ever make somebody read. One profile, one extension
list, one set of logins - and a private tab for the case that wants none of them.

### Dropped

| | why |
| --- | --- |
| Google Lens | a Google service, with Google's keys. nib's AI providers are the answer to the same question |
| Cast | the Cast SDK is not in a CEF distribution, and a note-taking app is not a receiver |
| tab groups | nib's strip already groups by pane and by space. A third grouping nobody asked for |
| the bookmark bar | the file list is better: it is searched, linked, synced and in the same vault |
| Chrome's profile switcher | see above |
| reading list, Collections, Family Safety, IE mode | not things this app is |

**Translate, honestly.** Chromium's translate is a Google endpoint reached with
Google's API keys, which a CEF distribution does not carry. If the spike's build
cannot translate a page, the row is not drawn and nib does not apologise for a
button that would have failed: the honest substitute is nib's own AI providers,
which are already in the app and already translate a note. That is the one row
where nib replaces Chromium rather than keeping it, and the reason is that the
Chromium behind nib is not Google's build.

---

## 4. The shape of it on screen

Nothing about nib's shell changes. That is the design.

**The tab strip is nib's.** A web tab sits in the same strip as a note, a canvas,
a PDF and a page, with a favicon where a note has a glyph. Chromium's own tab
strip is never drawn, never configured and never shipped - which is a real
constraint on the engine choice and is in the decision above.

**The address bar is the tab's bar.** Back, forward, reload, the address, a clip,
the dots - the row `web-tabs.md` already specifies, under the strip and over the
page, built out of the same `.nib-glyph` squares and the same `.nib-field` as the
find bar. It is unchanged, and that is worth saying twice: a browser that arrives
as a new bar is a browser that arrives as a new design.

**A `chrome://` page is a tab like any other.** `chrome://settings` opens in the
strip with a gear where a website has a favicon and *Settings* as its name. It is
not a file in the space and never becomes one: it has no address anybody would
want to keep, so it lives and dies with the tab, exactly as a web tab does before
somebody has named it. The address field shows `chrome://settings` plainly,
because a page that can change what the browser does is a page worth being able
to see the address of.

**The ⋮ menu does not exist.** Chrome's menu is a menu because Chrome has no
other menus. nib has a menu bar, a palette and a settings window, and every row
of Chrome's menu belongs in one of them:

| Chrome's row | where it goes |
| --- | --- |
| New tab | Ctrl+T, and File. A new tab in nib's strip |
| New window | File, which nib already has |
| New Incognito window | a **private tab**, not a window: Ctrl+Shift+N |
| the account row | Settings, the account pane nib already has |
| Passwords and autofill | Settings ▸ Web, which opens `chrome://password-manager` |
| History | the palette, and Settings ▸ Web. `chrome://history` |
| Downloads | the palette, and the tab's dots while something is downloading |
| Bookmarks and lists | the file list. "Keep this page" writes the `.url` file |
| Tab groups | dropped |
| Extensions | Settings ▸ Web, and the puzzle glyph in the tab's bar |
| Delete browsing data | Settings ▸ Web |
| Zoom | View, which nib already has, applied to the tab |
| Print | File ▸ Print, which nib already has |
| Google Lens | dropped |
| Translate | the tab's dots, if the build can |
| Find and edit | Ctrl+F, nib's find bar, driving Chromium's find |
| Cast, save and share | the share sheet, and the clipper |
| More tools ▸ Developer tools | View, and F12 |
| Help | Help, which nib already has |
| Settings | Settings ▸ Web ▸ *the engine's own settings* |
| Exit | nib quits |

Twenty-one rows and no new surface. That is the test a design like this passes or
fails: if any row above had needed a menu of its own, the browser would not be
part of the app, it would be an app beside it.

**The new tab page is nib's, and it is small.** A search field, and the pages this
space keeps - the `.url` files, most recent first, with their favicons. No tiles
of "most visited", because a shortcut tile is a bookmark nobody chose and this app
already has a place for the ones somebody did. No feed, no weather, no sign-in
prompt. It is drawn by nib and not by Chromium, so it is one design on every
platform and it is translated into all thirty-nine languages like the rest of the
app; `chrome://newtab` is never reached.

**Zoom, and why it is Chromium's.** Chromium already remembers a zoom per site
and applies it to every tab on that site. nib's View menu and nib's Ctrl+plus
drive that, rather than keeping a second number: two places remembering the zoom
of the same site is a bug waiting for somebody to find it.

### The keyboard

Four keys, and they go in the registry with everything else so they show in
Settings, show in the palette and can be rebound. See `docs/keyboard.md`.

| | |
| --- | --- |
| Ctrl+T | a new tab. In a web tab that is a new web tab, on the new tab page |
| Ctrl+W | close, which nib already has |
| Ctrl+L | the address field, which `web-tabs.md` already specifies as `web.address` |
| Ctrl+Shift+N | a private tab |
| Alt+Left, Alt+Right | back and forward, which nib already has |
| Ctrl+F | find in page, which is nib's find bar over Chromium's find |
| F12 | DevTools |

**And a limitation goes away.** `web-tabs.md` says that once the page has the
keyboard, Ctrl+L is the site's shortcut and the app never sees the press, because
a child webview of the system's engine hands the host no chance at a key. CEF
does: `CefKeyboardHandler::OnPreKeyEvent` is called in the browser process before
the page's own handlers run, so nib decides which chords are the shell's and
passes the rest through. Ctrl+T, Ctrl+W, Ctrl+L, Ctrl+Shift+N, Ctrl+F and F12 are
the shell's in a web tab that has the keyboard; everything else is the page's,
including Ctrl+K in a site that wants it. This is one of the real reasons to
prefer an engine with a host API over a webview with a bounds rectangle, and it is
the kind of thing that decides whether a browser inside another app feels like a
browser.

---

_The sections below - the engine architecture, privacy, the update story and the
batch plan - depend on the CEF facts and the spike's numbers._
