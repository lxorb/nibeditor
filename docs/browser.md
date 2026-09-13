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

Two things about CEF are out of date everywhere on the internet, including in the
question this design started from, so they go first.

**There is no Alloy runtime any more.** CEF used to have two runtimes and the
choice between them was the whole architecture: Alloy, built on Chromium's content
layer, with no browser features; and the Chrome runtime, built on Chrome's UI
layer, with all of them. That split is gone. *"Starting with the M125 release the
Alloy runtime has been split into separate style and bootstrap components... The
Alloy bootstrap has been removed starting with the M128 release."*
([architecture](https://chromiumembedded.github.io/cef/architecture),
[#3685](https://github.com/chromiumembedded/cef/issues/3685)). `chrome_runtime` is
not a field of `CefSettings` any more; there is nothing to switch on.

**What is left is a per-browser *style*, and the one nib wants is Chrome style
with no toolbar.** From `cef_types_runtime.h`:

> "Chrome style provides the full Chrome UI and browser functionality whereas
> Alloy style provides less default browser functionality but adds additional
> client callbacks and support for windowless (off-screen) rendering. The style
> type is individually configured for each window/browser at creation time and
> different styles can be mixed during runtime."

And the toolbar is opt-in, not opt-out: `CefBrowserViewDelegate::GetChromeToolbarType()`
returns `CEF_CTT_NONE` by default, and CEF's own sample only draws a toolbar when
asked with `--show-chrome-toolbar`. So **a Chrome-style browser view inside a
window the host owns, with no toolbar, is a supported configuration** - which is
precisely nib: Chromium's pages, Chromium's extensions, Chromium's print preview
and find bar, inside nib's window, under nib's tab strip, behind nib's own address
bar.

That is the whole answer to "integrate Chromium properly", and it is worth being
clear that the alternative would have been a trap. Alloy style blocks almost every
`chrome://` page: `AlloyBrowserHostImpl::MaybeAllowNavigation` holds a
twenty-four-host allowlist, and `settings`, `extensions`, `history`, `downloads`,
`bookmarks` and `flags` are all absent from it - only `version` and
`net-internals` of the ones this design needs are on it. The maintainer, on
[#3859](https://github.com/chromiumembedded/cef/issues/3859): *"Extension
functionality that requires Chrome UI (like toolbars, etc) will not be supported
with Alloy style browsers. You can create a windowed Chrome style browser if you
wish to load chrome://extensions."*

**The price of Chrome style is that there is no off-screen rendering.** Windowless
rendering always uses Alloy style (`cef_types_win.h`: *"Alloy style will always be
used if windowless_rendering_enabled is true"*), so nib cannot have Chromium's own
pages *and* the page composited into nib's own document. The page is a native view
over the pane, which is what a web tab already is - so the trade
`web-tabs.md` already made stands, and so does its consequence: **an overlay over
the page means hiding the page.** That is not a thing CEF fixes.

#### What comes with it

| | |
| --- | --- |
| `chrome://` pages | the Chrome set, with no CEF-side filter on the Chrome-style path. `settings`, `extensions`, `history`, `downloads`, `bookmarks`, `password-manager`, `version`, `net-internals`. CEF's own sample opens `chrome://settings/manageProfile` and wires `IDC_MANAGE_EXTENSIONS`, `IDC_OPTIONS`, `IDC_CLEAR_BROWSING_DATA`, `IDC_TASK_MANAGER` and `IDC_NEW_INCOGNITO_WINDOW` into its menu |
| DevTools | the real thing. `ShowDevTools`, `CloseDevTools`, `HasDevTools`, and the DevTools Protocol |
| print | `Print()` opens Chrome's print preview; `PrintToPDF` takes the same settings as `Page.printToPDF` |
| find | `Find(searchText, forward, matchCase, findNext)` and `StopFinding`, with results through `CefFindHandler` - and in Chrome style, Chromium's own find bar draws the match count |
| downloads | `CefDownloadHandler` for the host, and Chrome's own download bubble |
| passwords | Chrome's password manager, at `chrome://password-manager`. No CEF API wraps it and none is needed |
| zoom | `SetZoomLevel` / `GetZoomLevel`, and Chromium remembers it per site |
| incognito | a real off-the-record profile: an empty `cache_path` makes `Profile::OTRProfileID::CreateUniqueForCEF()`, a genuine `OffTheRecordProfileImpl`, in-memory and destroyed with the context |
| several profiles | one `CefRequestContext` each, as direct children of the user data directory. Deeper paths are refused |
| preferences | `CefRequestContext::SetPreference` and `CefPreferenceManager` reach Chromium's own preference tree - which is how the default search engine gets set without nib drawing a settings pane |
| keyboard | `CefKeyboardHandler::OnPreKeyEvent`, in the browser process, before the page sees the key |
| PDF | Chromium's viewer, the one extension that survived every runtime change |
| Widevine | compiled in and required by CEF's own build assertions. The CDM binary is *not* in the distribution: Chromium's component updater fetches it at run time into the cache path |
| one browser process | *"The main process which handles window creation, UI and network access is called the 'browser' process... The default process model will spawn a new render process for each unique origin"* - so many tabs are many `CefBrowser`s in one browser process, exactly as in Chrome |

#### The four honest holes

These are not small and they are not hidden further down.

**1. There is no programmatic way to install an extension, and the Chrome Web
Store is unconfirmed.** The supported routes are `chrome://extensions` with
developer mode, and Chromium's own
[pre-installed-extension mechanisms](https://www.chromium.org/administrators/pre-installed-extensions/)
- `ExtensionInstallForcelist` and friends, driven from the preference tree. The
maintainer's summary is [#3450](https://github.com/chromiumembedded/cef/issues/3450),
open since 2023: *"Extensions with the Chrome runtime can currently be installed
and managed via `chrome://extensions` and various existing admin mechanisms. It
should also be possible for applications to programmatically manage extensions"* -
"should also be possible" being a wish, not an API.
[#3877](https://github.com/chromiumembedded/cef/issues/3877) is the same request
again, with a user reporting that writing Chrome's `extensions.settings`
preference works *"like a charm but not on the first load... I need to restart one
time the application."* `--load-extension` is not filtered by CEF and people rely
on it, but no document blesses it. And on the store: there is no mention of the
Web Store anywhere in CEF's docs, tests, headers or tracker, CEF ships no Google
API keys, and store installs depend on Google-branded endpoints and install
verification - so **assume the in-page store install does not work until the spike
or a batch proves otherwise.** What this means for the product is in "Extensions"
below: nib fetches the CRX itself and installs it by policy, which is a route that
needs no Google anything.

**2. Manifest V2 is gone.** CEF 152 is Chromium 152, where MV2 is disabled - CEF
even carries a patch to *"avoid crash showing MV2 disabled dialog with hidden
toolbar"*, which is a sentence about exactly nib's configuration. So "all the
Chrome extensions" means all the MV3 ones, which is what Chrome itself means by it
now.

**3. H.264 and AAC are not in the official builds.** magreenblatt,
[#3820](https://github.com/chromiumembedded/cef/issues/3820): *"We don't provide
builds with proprietary codecs due to licensing reasons."* A browser that cannot
play H.264 is a browser that fails on a great deal of video. The routes are to
build CEF with `proprietary_codecs=true ffmpeg_branding=Chrome` and take on the
AVC licensing, or to wait for
[#3559](https://github.com/chromiumembedded/cef/issues/3559), open, which would
allow hardware decode through the operating system's own decoders with no FFmpeg
and no added licence. **This is a ship gate, not a detail**, and it is in the
batch plan as one.

**4. Chromium's sandbox on Windows is not available on the in-process path
today.** Since Chromium M138 `cef_sandbox` can only be linked by a binary built
with Chromium's own toolchain, so CEF ships `bootstrap.exe`, which loads the
application as a **DLL** exporting `RunWinMain`
([sandbox setup](https://chromiumembedded.github.io/cef/sandbox_setup)). cef-rs
implements that pattern behind its `sandbox` feature. `tauri-runtime-cef` does
not, and says so in its own documentation: *"Whatever this policy says, a Windows
build currently runs unsandboxed... CEF supplies prebuilt `bootstrap.exe` hosts
for that, and they load the application as a DLL, which a Tauri application is
not."* A browser whose renderers run with the user's full privileges is not a
browser to ship. **This is the other ship gate**, and the fix is known: make the
application the DLL, which cef-rs already does for its own example.

#### What it weighs, and how often it moves

Read from `https://cef-builds.spotifycdn.com/index.json` on 2026-09-13. Stable is
**CEF 152.0.6, Chromium 152.0.7977.83**, cut 2026-09-07.

| the `minimal` archive | | unpacked, what a release ships |
| --- | --- | --- |
| windows64 | 164 MB | 285 MB required only; 309 MB with the resource packs and one locale; 346 MB with the GPU fallbacks; 395 MB with all 220 locales |
| macosarm64 | 125 MB | 316 MB framework; 267 MB without the locales |
| macosx64 | 131 MB | as above |
| linux64 | 307 MB | `libcef.so` ships unstripped at 1362 MB and has to be stripped before anything else is true |

`libcef.dll` alone is 272 MB of that, `resources.pak` 21 MB, `icudtl.dat` 10 MB,
and the 220 locale packs 50 MB. **Budget 285-350 MB unpacked per platform**, and
the compressed installer delta is what the spike measures.

The cadence: *"CEF branches are created to track each Chromium release milestone
branch"*, which is about four weeks, and *"every sixth branch (starting with M138)
proceeds through the long-term support candidate and long-term support channels...
[which] continue to receive platform-agnostic security fixes for ~8 additional
months"*
([branches and building](https://chromiumembedded.github.io/cef/branches_and_building)).
On 2026-09-13: Beta 154, **Stable 152**, LTC 150, **LTS 144**. That LTS row is the
most useful fact in this document for a shipping product, and the update story
below is built on it.

`index.json` is the machine-readable channel list and has one trap worth writing
down, because the first version of `spike/browser/scripts/fetch-cef.py` fell into
it: **`channel` only ever says `stable` or `beta`, LTC and LTS branches are
labelled `stable` too, and the array is ordered by modification date.** So the
newest `stable` entry on 2026-09-13 was 150.0.20 (LTC, patched 09-11), not 152.0.6
(true stable, 09-07). Sort by version, not by date, and read the channel table for
which major is which. Also: percent-encode the `+` in a file name or the download
comes back wrong, verify the published `sha1`, and record `sandbox_compat`, which
changes when the sandbox ABI does.

#### The Rust side, and why it satisfies "nothing manual"

[`cef`](https://crates.io/crates/cef) is the Tauri organisation's binding, 462
stars, Apache-2.0 OR MIT, and its version *carries the CEF version*: `152.2.0+152.0.6`
was published **2026-09-12, five days after CEF cut 152.0.6**. It gets there by
itself - `.github/workflows/get-latest.yml` runs nightly, `get-latest -u` bumps the
pin, `update-bindings` regenerates and release-plz publishes. CEF's own minor
number *"changes only when the CEF C/C++ API changes"*, so a bump that keeps the
minor is source-compatible by construction.

So the upstream story is one line in one `Cargo.toml` and a Renovate bump - which
is as close to Emil's *"we don't need to do anything manually when there are
upstream changes"* as an embedded engine gets. `cef-dll-sys`'s build script
downloads the matching distribution itself, and `export-cef-dir` caches it.

And there is a second crate that changes the shape of the whole answer.
**`tauri-runtime-cef`** is a first-party Tauri runtime that puts CEF where
`tauri-runtime-wry` puts WebView2 and WebKitGTK, on the
[`feat/cef`](https://github.com/tauri-apps/tauri/tree/feat/cef) branch, last
touched 2026-09-12. It is not a sketch: 133 KB of runtime, 84 KB of webview, a
`SandboxPolicy` with a paragraph on each platform's sandbox, an external message
pump, a macOS application bootstrap with a test of its own, popup and dialog
handling, locale negotiation, a hardening allowlist over Chromium's command line,
DevTools-Protocol access with an identifier allocator, and a bundler that installs
the setuid `chrome-sandbox` helper in the deb and the rpm. The public shape is
`tauri::Builder::default().runtime(tauri_runtime_cef::Cef::default())`. It is
version 0.1.0, unpublished, and pins `cef = "=151.8.1"`.

#### Three facts that decide the architecture

These came out of reading CEF's and Tauri's own code, and between them they settle
where the engine goes.

**CEF cannot be initialised twice, or late.** magreenblatt, on
[whether CEF can be started on demand](https://magpcss.org/ceforum/viewtopic.php?f=6&t=15241):
*"CEF cannot be reinitialized in the same process. You should initialize it before
first use and shutdown immediately before terminating the application. You can
then create multiple browsers at different times during your application's
lifespan."* `libcef/browser/context.cc` makes a second `CefInitialize` a silent
no-op, and `CefShutdown` and the message-loop calls `DCHECK` the initialising
thread. It must also happen while the process is effectively single-threaded:
CEF's own sample calls `gtk_init` *after* `CefInitialize` with the comment *"The
Chromium sandbox requires that there only be a single thread during
initialization."*

So **"initialised lazily on the first web tab" is not available in nib's own
process.** What is available is the other half of the same sentence: initialise
once at startup, then create and destroy browsers whenever. That is the shape the
design takes, and dropping the laziness is the one requirement in Emil's brief
this document recommends against - with the number that justifies it measured
rather than asserted.

**On macOS, whoever makes the `NSApplication` first wins, and it must be CEF's.**
CEF requires the application object to conform to `CefAppProtocol` so Chromium can
tell whether it is inside `-sendEvent:`. Tauri's own CEF work hit this and had to
close a pull request over it
([#15990](https://github.com/tauri-apps/tauri/pull/15990)): *"Native recovery
dialogs can create an NSApplication object before the CEF runtime starts. CEF then
rejects the incompatible application class and stops startup."* Loading the
framework also *replaces the process's default malloc zone*, and Tauri
[#15650](https://github.com/tauri-apps/tauri/pull/15650) found that an allocation
on another thread racing that swap *"corrupts the heap and crashes at startup...
probabilistically, on every launch."* `spike/browser/src/mac.rs` is this fact
written as code, with the assertion that proves it.

**On Linux, GTK 3 and GTK 4 cannot share a process.** `tauri-runtime-cef`'s own
comment: *"GTK 4 aborts when it detects GTK 2/3 symbols - so a single binary can
only ever run one of them."* wry and WebKitGTK are GTK 3; `tauri-runtime-cef` is
GTK 4. So on Linux the choice is not "add CEF to the app" - it is "the app is a
CEF app" or "CEF is a different process". There is no third option, and no
positive report of CEF and WebKitGTK coexisting in one process exists anywhere.

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

Three shapes were on the table and the third splits in two, because the facts
above take the obvious version of it away.

| | what it is |
| --- | --- |
| **A** | WebView2 on Windows, WebKit on macOS and Linux. What ships today |
| **B** | CEF on all three desktops, in **nib's own process**, through `tauri-runtime-cef`. The whole app becomes a Chromium app |
| **B′** | CEF on all three desktops, in **a process of its own** - a `nib-browser` helper whose views are parented into nib's window |
| **C** | hybrid: WebView2 where it is enough, CEF where it is not |

**A is out on the requirements, not on taste.** Four of the asks in Emil's message
are documented as impossible in WebView2: `chrome://settings` is on the published
blocked-URL list; installing an extension from the store has no API at all;
extensions with any UI *"will have missing UI entry points"*; Translate is *"turned
off"* and *"not configurable"*. And on two of the three desktops the engine is not
Chromium at all, so there is nothing to discuss about Chrome extensions there.

**C is out on the philosophy.** It is tempting, because WebView2 is already
installed on every Windows 11 machine and costs zero bytes, and it already gives
Chrome-like tabs. But look at what the product would be: on Windows no
`chrome://settings`, no store, no extension popups and no translate; on macOS and
Linux all four. That is not one product with a platform difference, it is two
products, and *"ONE consistent design on every device"* is the first line of the
philosophy this app is written to. It is also the opposite of DRY: every row in the
table in section 3 would need two implementations, and the WebView2 one would be
"cannot".

So it is CEF, and the only real question is **where the engine lives**.

| | B - in nib's process | B′ - in a process of its own |
| --- | --- | --- |
| installer / download | one engine, ~285-350 MB unpacked per platform; compressed delta measured by the spike | the same |
| memory floor with no web tab | Chromium is always up: a browser process, a GPU process, a network service | nothing. The helper is not running |
| memory with two web tabs | one browser process, renderers per site | the same, plus nib's own webview engine |
| launch | every launch starts Chromium | untouched. The spike's control measures this |
| first web tab | instant | the engine starts: the spike measures it |
| lazily on the first tab, as asked for | **impossible.** CEF cannot be initialised late or twice | yes, and this is its one clear win |
| extensions | Chromium's own, `chrome://extensions` | the same |
| `chrome://` pages | the same | the same |
| the app's own interface | **becomes Chromium on all three desktops** | stays WebView2 / WebKit / WebKitGTK: three engines for nib's own UI |
| who writes the embedding | Tauri. `Window::add_child` with bounds, which `web_tabs.rs` already calls | **nib.** `SetParent` on Windows, a child `NSWindow` on macOS, `XReparentWindow` on Linux, plus a transport and a lifecycle |
| Wayland | Tauri's problem, and it forces X11 through GTK 4 | cross-process embedding needs X11. Wayland has no protocol for it, so nib would be Xwayland-only |
| Chromium's sandbox on Windows | **not today.** A Tauri app is not the DLL `bootstrap.exe` loads | **yes today.** The helper can be that DLL; cef-rs already builds one |
| crash isolation | a browser-process crash is nib's crash | a browser-process crash loses the web tabs and nothing else |
| macOS signing | Tauri's bundler signs the framework and the helper bundles | nib's packaging does |
| Linux packaging | Tauri's deb and rpm bundlers already install the setuid `chrome-sandbox` | nib's packaging does |
| Android | unaffected: Android keeps wry and the system WebView | the same |
| ready when | `tauri-runtime-cef` releases, and Windows is sandboxed | sooner, and nib owns it forever |
| lines of nib's own code | the design in section 3, and little else | the design, plus the largest new surface in the app |

### The recommendation: B

**nib's desktop app moves onto `tauri-runtime-cef`. One Chromium in nib's own
process. The app's own interface and every web tab are webviews in it, and a web
tab is `Window::add_child` with bounds - the call `web_tabs.rs` already makes.**

Three reasons, in the order they matter.

**It is the only shape that is actually "integrating Chromium properly".** Emil's
sentence was *"we don't need to do anything manually when there are upstream
changes"*. Under B, the message pump, the macOS application class, the malloc-zone
race, the sandbox on three platforms, the bundle layout, the helper bundles, the
setuid helper in the deb, the GTK 4 migration and the command-line hardening are
all **Tauri's code**, maintained by the people who maintain Tauri and cef-rs, and
already written. Under B′ every one of those is nib's, in three platform flavours,
forever - and a cross-process window embedding is the single most fragile kind of
code a desktop app can own.

**It makes nib's own interface one engine on every desktop.** This is the sleeper
and it may be worth more than the browser. Today the editor runs on Chromium on
Windows and on WebKit on macOS and Linux, and that is the largest source of
inconsistency in the product: every layout difference, every font-rendering
difference, every `contenteditable` and `IntersectionObserver` and CSS difference
in the list in `docs/gaps` traces back to it. B deletes that whole class of bug and
replaces it with a single engine nib pins and tests. "ONE consistent design on
every device" stops being a thing to chase.

**The work above the engine is identical either way.** Everything in sections 3, 4
and 5 - the `chrome://` tabs, the extension list on the account, the new tab page,
the clipper as a built-in extension, the keyboard, the privacy model - is the same
code under B and B′. The only thing B′ adds is a transport, and the only thing it
saves is a lazy start.

### What that costs, said plainly

**The laziness goes, and that is the one place this recommends against the brief.**
CEF cannot be initialised on the first web tab; the maintainer's answer is
unambiguous. So every launch starts Chromium, and somebody who never opens a web
tab pays for one. The spike measures exactly this - the control with no Chromium
linked in, a launch that links it and never initialises it, and the full run - and
the numbers in section 8 are what the trade should be judged on. If the floor turns
out to be intolerable, B′ is the fallback and this document has its shape.

**Two ship gates, and nib does not ship a browser until both are shut.**

1. **Chromium's sandbox on Windows.** A DLL host is the known fix and cef-rs
   already implements it; the work is to bring that pattern into
   `tauri-runtime-cef`, which is a contribution nib should make rather than wait
   for, since every Tauri-on-CEF application needs it.
2. **H.264 and AAC.** Either a CEF build with `proprietary_codecs=true` and the
   AVC licensing that comes with it, or
   [#3559](https://github.com/chromiumembedded/cef/issues/3559) landing so the
   operating system's own decoders can be used. A browser that cannot play half the
   web's video is not a browser somebody will keep using.

**And `tauri-runtime-cef` is unpublished.** So batch 1 is a gate, not a migration:
build nib against the branch behind a Cargo feature, run every test the app has,
and keep wry as the default until the crate has a release and the app is green on
all three desktops under both.

### Android, iOS and the browser build

Unchanged from `web-tabs.md`, and now for a reason that can be stated rather than
argued: **CEF has no Android or iOS build at all.** `index.json` offers nine
platforms - three Linux, two macOS, three Windows, and that is the list. Android's
system WebView is Chromium but an app's `WebView` has no extension support and no
`chrome://` pages; iOS forbids another engine outside the EU's
BrowserEngineKit entitlement. So:

- **a phone opens the phone's browser**, and the `.url` file is a bookmark in the
  space. That is the answer rather than the gap: their browser has their logins,
  their extensions, their password manager and their reader mode, and a 390-point
  pane has no room for a bar and a page.
- **a tablet** gets the card and the frame, as it does now.
- **the browser build** gets the card and the sandboxed frame, as it does now. A
  page in a browser has nowhere else to go.

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

---

## 5. The engine

### The process model

One nib process, and it is Chromium's browser process.

```
nib                      the browser process. The window, the UI, every webview,
                         the profiles, the extensions, the network service
 ├─ renderer             nib's own interface, on its own origin
 ├─ renderer             svelte.dev
 ├─ renderer             github.com
 ├─ renderer             an extension's service worker
 ├─ gpu-process
 ├─ utility              the network service
 └─ utility              storage, audio, whatever a page asks for
```

Renderers come and go per site, as in Chrome, and that is the answer to the
question Emil asked first: **eight web tabs are eight webviews in one browser
process, not eight Chromiums.** The spike's whole job is to put a number on that
sentence, and the number is "one".

### Two profiles, one browser process

**nib's own interface and the web live in different Chromium profiles.** This is
the single most important line in this section and it is what makes everything in
"Privacy" below true rather than hopeful.

| | |
| --- | --- |
| `app` | nib's own webview. No extensions, no history, no downloads, nothing granted, no site data that is not nib's own |
| `web` | the browsing profile. The extensions, the cookies, the logins, the history, the downloads, the passwords, the settings `chrome://settings` shows |
| an ephemeral one per private tab | an off-the-record profile: `cache_path` left empty, which CEF turns into `Profile::OTRProfileID::CreateUniqueForCEF()`. In memory, and gone with the tab |

Chromium serves many profiles from one browser process, so this costs nothing in
processes. What it buys is exact: **an extension is installed into a profile, so an
extension installed in `web` cannot see a document in `app`.** A content script
with `<all_urls>` cannot read nib's own interface, not because of a rule somebody
remembered to write but because the extension does not exist in that profile. The
same fact means a site's cookies are never in the same jar as nib's session, which
is what `web-tabs.md` was reaching for with a separate data directory and now gets
from the engine's own model.

The directory layout keeps the name the crate already uses: Chromium's user data
directory is `web` inside the app's config folder, and `app` and `web` are profile
directories inside it. One consequence to know: Chromium takes a **process
singleton lock** on the user data directory, so two installations pointed at one
directory need `OnAlreadyRunningAppRelaunch`, which is the same problem
`tauri-plugin-single-instance` already solves for nib.

### Where it starts

At the top of `main`, and nowhere else. `cef_entry_point` runs
`execute_process` before anything - so the same binary serves as Chromium's
renderer, GPU and utility processes - and returns; then the builder takes the
runtime:

```rust
tauri::Builder::default()
    .runtime(Cef::default()
        .cache_path(web_dir)
        .sandbox(SandboxPolicy::Required)
        .profile_preferences(...))
```

`SandboxPolicy::Required` and not `Auto`: a build that cannot sandbox its renderers
should refuse to start rather than start unsafely, and the one platform where that
would fail today is the ship gate in section 2.

Nothing about this is lazy, and section 2 says why it cannot be.

### How a tab's view follows the pane

Unchanged, which is the point. The pane leaves a hole in the document, measures it,
and the crate places the webview exactly there - `Window::add_child`,
`Webview::set_position`, `Webview::set_size`, the same three calls
`apps/desktop/src-tauri/src/web_tabs.rs` makes now, only the engine underneath is
CEF on every desktop instead of three engines on three. The economy stays too: a
resize observer on the hole, the window's own resize, a look after any press, and
the crate is told only when the answer changed, so a keystroke in a note beside a
page costs one layout read and no IPC.

What changes for the better:

- **Back and forward are real.** `web-tabs.md` keeps its own trail of addresses
  because neither WebView2 nor WKWebView will say whether there is anywhere to step,
  and notes that a redirect can leave a spare entry. CEF answers:
  `CefBrowser::CanGoBack` and `CanGoForward`. The trail goes, and so does the
  caveat.
- **The keys are nib's when nib wants them.** `CefKeyboardHandler::OnPreKeyEvent`
  runs in the browser process before the page's handlers, so Ctrl+T, Ctrl+W,
  Ctrl+L, Ctrl+Shift+N, Ctrl+F and F12 work over a page that has the keyboard. The
  limitation in `web-tabs.md` - *"After a click into a site, Ctrl+L is that site's
  shortcut and the app never sees the press"* - goes away.
- **A five-minute sleep is no longer needed for the engine's sake.** Hiding eight
  tabs today means eight webviews holding eight engines' worth of memory, which is
  why the crate closes a hidden one after five minutes. In one browser process a
  hidden tab is a renderer, and Chromium already discards and restores those.
  Whether to keep a sleep at all becomes a memory question with a measurement
  behind it rather than a structural one.

What does not change: **a native view draws above every pixel of HTML in the
window**, because Chrome style rules out off-screen rendering. So an overlay over
the page still means hiding the page, and the blink is still the honest trade.

### What reaches the page, and what the page reaches

Nothing, four times over now instead of three.

1. The capabilities name the app's own **webviews** rather than the windows they
   sit in, so a web tab's `web-...` label matches nothing.
2. A remote origin matches no capability, which Tauri refuses on its own.
3. The globals that reach the crate are deleted before the page's first script
   runs.
4. And now: the page is in a different **profile** from nib's interface, so even an
   extension cannot cross.

What *does* change is permissions, and deliberately. Today the camera, the
microphone, the clipboard, geolocation and the hardware buses are taken off
`Navigator.prototype` so the engine never has a request to prompt about. A browser
cannot do that: a browser is the thing that asks. So **Chromium asks**, with its own
prompt, and `chrome://settings/content` is where an answer is changed - which is the
same rule as every other row in section 3. nib keeps exactly one refusal of its
own: the `app` profile grants nothing and never prompts, because nib's own interface
has no business asking for a camera.

### Clipping, and the extractor that was already written

The Clip glyph keeps its meaning and loses its worst compromise.

Today a script runs in the page and the answer comes back through the engine's
script callback, and the article it picks is nib's own heuristic rather than
Mozilla's Readability - which `web-tabs.md` lists under "What is left", with the fix
named as moving `extract.ts` out of `apps/clipper` into `packages/markdown`. That
is what this does. The read-out runs over the **DevTools Protocol**, which
`tauri-runtime-cef` exposes as a first-class API with an identifier allocator, so
there is no injected channel and nothing for the page to call; the extractor is the
same TypeScript the extension runs; and `from-html` and `writeFrontMatter` are
already shared. A page clipped from a tab, the same page clipped from the extension
and a page pasted into a note come out as the same markdown, and now for the same
reason.

**The clipper extension is not installed inside nib's browser.** It would be a
second Clip that did the same thing through a longer path. It stays what it is: the
extension for other people's browsers.

### Extensions, and the list on the account

The mechanism is Chromium's and the list is nib's.

**On the device.** `chrome://extensions` is the management surface - enable,
disable, remove, developer mode, per-extension options, the shortcuts page nib's own
clipper already links to. nib draws none of it.

**Installing.** CEF has no API for this (section 1, hole 1), so nib uses Chromium's
own mechanism: fetch the CRX and declare it in the preference tree. The CRX comes
from the Web Store's own update endpoint - `clients2.google.com/service/update2/crx`
with the extension id, which needs no key and no account - and the declaration is
Chromium's external-extension mechanism rather than `ExtensionInstallForcelist`,
because a forced extension is one the reader cannot remove and a reader must be able
to remove what they installed. Batch 4 proves this path, and if the store's own
in-page install turns out to work in a Chrome-style browser then that is simply a
better door to the same room.

**On the account.** `users.settings` on the account is already a validated JSON
object of the settings that follow a person from machine to machine - migration
`0012_user_settings.sql`, checked key by key in `services/sync/src/settings.ts`. One
more key:

```json
{ "extensions": [{ "id": "dbepggeogbaibhgnhhndojpepiihcmeb", "version": "2.0.9", "enabled": true }] }
```

Ids, versions and whether each is on. A device reconciles: install what is listed
and missing, remove what is installed and no longer listed, match the enabled flag.
Nothing else - an id is not a secret and a version is not personal, and the column
is validated so an account cannot carry a key no version of the app understands.

**What does not sync, and there is no way around it.** An extension's *own*
settings. Chrome syncs those through `chrome.storage.sync`, which is Chrome Sync,
which is a Google account - and without one Chromium quietly treats
`chrome.storage.sync` as local storage. So an extension's options are per device.
Saying so is better than a switch that looks like it works.

---

## 6. Privacy

Most of this is section 5 read from the other end, and it is short because the
profile model does the work.

**A page shares nothing with nib.** Different profile, different renderer,
different origin, no capability, no injected channel.

**An extension sees what an extension sees, and no more.** Every page in the `web`
profile it matches - that is what installing an extension means, and
`chrome://extensions` shows each one's permissions in Chromium's own words. It does
not see nib's interface, because it is not in that profile. It does not see the
vault, because the vault is not a web origin and nothing mounts it into one.

**Site permissions are Chromium's prompt**, per site, with `chrome://settings/content`
behind them, and the dots menu's "what this site is allowed" opens that page for the
site in the tab rather than drawing a second answer.

**A private tab is an off-the-record profile**, in memory, destroyed with the tab.
Not a flag on a shared profile: a context of its own, which is why it gets no
extensions and no cookies and leaves nothing behind.

**Remote debugging is off**, and off at the preference as well as at the switch -
`tauri-runtime-cef` pins `devtools.remote_debugging.allowed` off so a stray
`--remote-debugging-port` is refused rather than honoured. A DevTools port is
full control of every page in the process to anything that can reach it.

**Only `http` and `https` for what somebody types**, plus the `chrome://` pages nib
itself opens, and the rule lives in the crate because it judges every link inside
the page and not only what was typed. `file:` would read this machine, a scheme the
system knows would hand the page to another application, and `tauri://localhost`
would put nib inside a tab with the site's script beside it.

**Deleting browsing data is Chromium's page**, which knows what there is to delete;
signing out of the nib account still empties the vault, and the two are separate on
purpose - somebody may well want one without the other.

---

## 7. Keeping up with Chromium

**The pin is one line.** `cef = "152.2.0+152.0.6"` in one `Cargo.toml`. The crate's
version carries the CEF version, `cef-dll-sys` fetches the matching distribution,
and CEF's own minor number only moves when the C API does - so a bump that keeps the
minor is source-compatible by construction.

**A scheduled workflow does the bumping.** Weekly:

1. Read `https://cef-builds.spotifycdn.com/index.json` and work out the newest true
   stable, sorting by version and not by date, and the current LTS branch - this is
   `spike/browser/scripts/fetch-cef.py --newest-stable`, which exists.
2. Ask crates.io what the newest `cef` is. cef-rs publishes within about a week of
   each CEF release - 152.0.6 was cut on 2026-09-07 and `152.2.0+152.0.6` was
   published on 2026-09-12 - so this is usually the same answer.
3. If nib is behind, change the one line, run the spike's tests against the new
   engine, run the app's own tests, and open a pull request that says what moved
   and what the numbers did.
4. A person presses merge. Nobody edits a URL, and nobody reads a release note to
   find out a version number.

**Which branch to track: stable.** A browser's value is that it is current, and the
alternative is shipping a known-vulnerable engine on purpose. CEF's LTS branch -
every sixth, with about eight more months of security fixes, which is Chromium 144
today - is the fallback for a release that has to slip, not the default.

**And the consequence to state out loud: nib's release cadence becomes Chromium's.**
Under B the engine is linked into the app, so an engine update is an app update, and
Chromium ships a security release roughly every two to four weeks. That is the real
recurring cost of this decision. It is bearable because the bump is automated end to
end and the app already ships its own updates through `tauri-plugin-updater` - but it
is a change in how often this project releases, and it should be a decision rather
than a discovery.

The alternative, and it is worth naming because it is the WebView2 Evergreen model:
ship the engine as **its own signed artefact**, downloaded on first use and updated
on its own schedule, so a Chromium security fix does not need an app release and
somebody who never opens a web tab never downloads 300 MB. It is the better answer
on both counts and it is out of reach under B, because a linked library cannot be
swapped under a running process - it is B′'s to have, and it is the strongest
argument B′ has after the sandbox. If the release treadmill turns out to be the
thing that hurts, that is the reason to revisit the shape.

---

## 8. The plan

Eight batches, in order, each with what it proves and an honest size. "Large" here
means a week of one agent's attention, not an afternoon.

| | what it does | what it proves | size |
| --- | --- | --- | --- |
| **1** | **The gate.** Build nib against `tauri-runtime-cef` behind a Cargo feature, both runtimes selectable, no product change. Run every test the app has under both, on all three desktops. Measure launch, memory and the installer delta against today | that the app runs on Chromium at all, and what it costs. This batch is allowed to end in "not yet" | large |
| **2** | **Web tabs on the new engine.** `web_tabs.rs` onto CEF webviews: place, show, hide, navigate, real back and forward, the `.url` file untouched, the bar untouched. Delete the address trail and the guard's permission half; keep the globals half. The two profiles | that a web tab is the same three calls, that one browser process serves them all, and that nothing about the file or the bar changed | large |
| **3** | **Chromium's own pages.** `chrome://settings`, `extensions`, `history`, `downloads`, `password-manager` as tabs, with the gear and puzzle marks, never files in the space. The ⋮ menu's twenty-one rows into nib's menus. The search engine through the preference tree | that Emil's *"chrome://settings will work for us"* is true, and that no new surface was needed to reach any of it | medium |
| **4** | **Extensions.** The CRX fetch, the external-extension declaration, install, enable, disable, remove, and `chrome://extensions` as the management surface. The puzzle glyph in the tab's bar for an extension's action | that a reader can install any MV3 extension and take it away again, which is the ask with the least documented support behind it | large |
| **5** | **The list on the account.** One key in `users.settings`, validated; reconcile on sign-in and on change; a row in Settings ▸ Web. Say plainly that an extension's own settings do not follow | that the nib account replaces the Google account for the thing Emil named, and only for that thing | medium |
| **6** | **The rest of the rows.** Private tabs as off-the-record profiles, downloads, print, find over Chromium's find, zoom, DevTools, per-site permissions, delete browsing data. Ctrl+T, Ctrl+W, Ctrl+L, Ctrl+Shift+N and Ctrl+F through the keyboard handler, in the registry, in `docs/keyboard.md` | that the keys work over a page that has the keyboard, and that every row of section 3 has somewhere to be | medium |
| **7** | **The two ship gates.** Chromium's sandbox on Windows through the DLL host - upstream in `tauri-runtime-cef`, which is a contribution and not a wait. H.264 and AAC: either a CEF build with the licensing settled or #3559. Linux packaging with the setuid helper, deb, rpm, AppImage, and the Flatpak and Snap sandboxes. macOS signing and notarisation of the framework and every helper bundle | that it is shippable. Nothing before this batch is, and calling any of it done earlier would be the mistake this row exists to prevent | large |
| **8** | **The new tab page, and the polish.** nib's own new tab - a search field and the space's `.url` files. The share sheet. The clipper's extractor moved into `packages/markdown` and the read-out over the DevTools Protocol. Motion, the blink, and nib's own chrome in all thirty-nine languages | that it feels like nib rather than like Chromium in a nib-coloured window, which is the only thing the reader will actually notice | medium |

Batches 1 and 7 are the ones that can say no. Everything between them is ordinary
work on a foundation those two either give or withhold, and sequencing it any other
way would mean discovering in batch 7 that batch 2 was built on sand.

---

## 9. What the spike measured

`spike/` holds three crates, built by `.github/workflows/spike-cef.yml` and by
nothing else in this repository. They are a proof, not a product, and they exist so
that nothing above rests on a plausible sentence.

| | |
| --- | --- |
| `spike/browser` | a CEF application on cef-rs: two browsers in one process, Chromium's own pages one after another, an unpacked MV3 extension whose content script renames the page title so the program can tell it ran, DevTools, print, find and zoom. `src/mac.rs` is the `NSApplication` requirement written as an assertion |
| `spike/shell` | a Tauri window on `tauri-runtime-cef` with nib's own webview and two web tabs beside it, one of them on `chrome://settings`. The shape section 2 recommends, reduced to one file |
| `spike/nocef` | the control: the same program with no Chromium linked into it, so the cost of linking can be subtracted rather than guessed |
| `scripts/fetch-cef.py` | resolves a pin or the newest true stable out of `index.json`, verifies the sha1, unpacks. The version-not-date sort and the percent-encoded `+` are both bugs it had first |
| `scripts/measure.py` | counts the processes by their `--type=` switch, sums the tree's resident set, weighs the staged tree file by file, photographs the screen, and fails the job if more than one browser process served two tabs |
| `scripts/stage.py` | the layout a release needs, including the macOS app bundle with its framework and five helper bundles - the part of shipping CEF that has nothing to do with Rust |

_The numbers are in the report from the run; see the pull request's artefacts._
