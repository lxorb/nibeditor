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
build: the code that exists is under `spike/`, which is a proof and is not
wired into the app.

The short version. **nib's desktop app becomes a Chromium app: one CEF engine in
nib's own process, through Tauri's own `tauri-runtime-cef`, with nib's interface and
every web tab as webviews in it.** Every web tab is a view in one browser process,
exactly as every tab in Chrome is. Chromium keeps everything Chromium is good at,
`chrome://settings` and `chrome://extensions` included, and nib keeps the account,
the files and the shell. Windows, macOS and Linux get the same engine and therefore -
for the first time, including for nib's own editor - the same product. A phone gets
the phone's browser, as it did before.

Two things in that sentence are not what this design set out to write, and both are
argued rather than assumed in section 2. **The engine cannot start lazily on the
first web tab** - CEF refuses to be initialised late, and the maintainer says so in
as many words - so it starts when nib does, and the spike measures what that costs.
And **the engine goes in nib's own process rather than a helper beside it**, because
the alternative means nib owning a cross-process window embedding on three platforms
forever, which is the opposite of *"integrate Chromium properly"*.

There are also **two gates this cannot ship through yet**, both in section 2 and both
upstream: Chromium's sandbox on Windows, and H.264.

The spike in `spike/` is what turns the paragraph above from a plan into a
measurement. On Windows and macOS runners it opened two browsers, counted **one
browser process** between them, loaded `chrome://settings`, `chrome://extensions`,
`chrome://history`, `chrome://downloads` and `chrome://version`, ran an unpacked
Manifest V3 extension, and opened DevTools, the print preview and the find bar - all
of it inside a window with no Chrome toolbar and no Chrome tab strip. Section 9 has
the numbers, including the one that could still change the answer: an initialised
engine costs **170 ms** on Windows and **1006 ms** on a macOS runner.

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
| a security fix without an app release | on Windows, yes, once the DLL host lands - CEF's own installer manages a shared engine. On macOS and Linux, no | the same on Windows, and on Linux a downloaded engine *loses* the sandbox (section 7) |
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
that has ever needed a note saying "on a Mac" traces back to it. B deletes that whole
class of bug and replaces it with a single engine nib pins and tests. "ONE consistent
design on every device" stops being a thing to chase and becomes a property of the
build.

**The work above the engine is identical either way.** Everything in sections 3, 4
and 5 - the `chrome://` tabs, the extension list on the account, the new tab page,
the clipper as a built-in extension, the keyboard, the privacy model - is the same
code under B and B′. The only thing B′ adds is a transport, and the only thing it
saves is a lazy start.

### What that costs, said plainly

**The laziness goes, and that is the one place this recommends against the brief.**
CEF cannot be initialised on the first web tab; the maintainer's answer is
unambiguous. So every launch starts Chromium, and somebody who never opens a web
tab pays for one.

The spike measured exactly this, three ways, on two platforms, and the answer differs
enough between them to matter. On **Windows**: 0 ms for the same program with no
Chromium linked in, **1 ms** for one that links it and never initialises it - CEF
delay-loads `libcef.dll`, so a launch with no web tab never maps it - and **170 ms**
to an initialised engine. On **macOS**: 0, **276** and **1006 ms**. Under B nib's own
interface is a CEF webview, so the last figure is the floor before anything is on
screen.

170 ms is a price worth paying. A second is not, and section 9 has the caveats - a CI
runner with no GPU, and Windows doing the same work six times faster on the same class
of machine, which says the gap is the platform rather than the engine. **Re-measuring
this on real hardware is the first thing batch 1 does.** If a real Mac still costs
most of a second, that is the moment to take B′ seriously.

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

**Linux changes toolkit, and that is its own piece of work.** `tauri-runtime-cef` is
GTK 4 through `winit-gtk4`, where wry is GTK 3, and the two cannot share a process.
nib's Linux build is not only wry: the tray is `libayatana-appindicator3`, and the
crate pulls `libxdo` and `librsvg` beside it. Every one of those is a GTK 3 library
that either has a GTK 4 counterpart or has to go. None of it is hard; all of it is
work nobody has costed, and it belongs in batch 1's answer rather than in batch 7's
surprise.

**And `tauri-runtime-cef` is unpublished, and today it does not build - on any of the
three.** This is measured, not guessed: `spike/shell` was pointed at revision
`c8c75b1` and the branch failed to compile on macOS with eleven type errors and on
Linux with thirty, all from one cause. `tauri` takes `dpi` from crates.io while
`tauri-runtime-cef` takes `winit` from the `winit-gtk4` fork, which vendors a `dpi`
of its own, so `platform/mod.rs` hands a `winit::dpi::PhysicalPosition<i32>` to
something that wants `tauri::PhysicalPosition<i32>` and the compiler says in as many
words that there are *"multiple different versions of crate `dpi` in the dependency
graph"*.

**One line repairs that one**, and the spike proves it: a `[patch.crates-io]` pointing
`dpi` at the fork's copy unifies the two, and Windows and Linux then compile. That is
worth sending upstream - it is a dependency the branch should be declaring for itself
rather than a thing every consumer discovers.

**And then macOS fails again, differently.** `window_builder.rs` calls
`WindowAttributesMacOS::with_accepts_first_mouse`, which the `winit-gtk4` revision
that resolves today does not have - so the branch is pinned in spirit to a winit it
does not name, and an outside consumer gets whatever `master` happens to be. Two
independent breakages in one afternoon, both from being a consumer of a branch rather
than of a release.

Neither is deep and neither is nib's to fix alone, but together they are the honest
measure of how ready this is: **`tauri-runtime-cef` is not yet something a product
can depend on, and batch 1 is the batch that finds out when it is.** That is not an
argument against the recommendation - the engine itself is proven, four times over,
in section 9 - it is an argument for the gate being real.

**What batch 1 found, a day later, in one paragraph.** Both of those breakages are
fixed upstream, in a release: `tauri-runtime-cef 3.0.0-alpha.0` was published on
2026-09-13 against `tauri 3.0.0-alpha.0` and a published `tauri-winit`, so no
duplicated `dpi` and no unnamed winit. nib cannot use that release, because no Tauri
plugin has one on the 3.x line. And on the branch itself, the blocker turned out not
to be `dpi` at all but the plugins: every Tauri plugin that supports iOS asks for a
`tauri` feature the branch removed, so Cargo will not resolve a graph that contains
one. Sections 7 and 8 have both, and the second one is the reason batch 1's answer is
"yes, with a patch nib carries" rather than "yes".

That is what an unreleased branch is like, and it is the argument for the shape of
batch 1: **a gate, not a migration.** Build nib against a pinned revision behind a
Cargo feature, keep wry the default, run every test the app has under both, and move
the default only when the crate has a release and all three desktops are green. A
batch that is allowed to answer "not yet" is a batch that can be attempted now.

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
directories inside it - CEF accepts a profile as a **direct child** of the user data
directory and refuses anything deeper, which is where that shape comes from. One
consequence to know: Chromium takes a **process singleton lock** on the user data
directory, so two installations pointed at one directory need
`OnAlreadyRunningAppRelaunch`, which is the same problem
`tauri-plugin-single-instance` already solves for nib.

**Batch 1 found the API, and it is the call `web_tabs.rs` already makes.** This
paragraph used to say no upstream API had been found and that batch 2 would have to
add one; that is no longer true. `tauri-runtime-cef` maps the portable
`WebviewAttributes::data_directory` onto a `CefRequestContext` per webview: a path
inside `root_cache_path` becomes a named profile, a path outside it becomes a hashed
one, and `incognito` leaves the cache path empty, which is CEF's own off-the-record
profile. So the two profiles and the private tab are both expressible today, through
attributes the app already sets. Section 8's batch 1 notes have the two consequences:
which profile has to be the *primary* one, and why nib's own window then has to be
built in Rust.

What settles it is a screenshot. In `spike/shell`, with one profile for everything,
the test extension's content script ran in **nib's own interface** as well as in the
two web tabs - an `<all_urls>` extension reading the application's own document, in a
picture, on the first try (section 9). So this is not a precaution any more.
**So batch 1 shipped the second profile rather than leaving it to batch 2**, because
most of section 6 rests on it and the alternative is an app whose own interface is
readable by anything a reader installs. `engine::web_store` is where a web tab's
profile is chosen and `engine::open_ui_window` is where the interface's is, and the
gate checks both directions on every platform: the extension's content script has to
reach a web tab and has to not reach the interface.

### Where it starts

At the top of `main`, and nowhere else. `cef_entry_point` runs
`execute_process` before anything - so the same binary serves as Chromium's
renderer, GPU and utility processes - and returns; then the builder takes the
runtime:

```rust
tauri::Builder::default()
    .runtime(Cef::default()
        .root_cache_path(web_dir)
        .sandbox(SandboxPolicy::Required)
        .profile_preference_value("default_search_provider_data", ...))
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

**The pin is one line, and batch 1 built it.** It is `[package.metadata.cef]` in
`apps/desktop/src-tauri/cef/Cargo.toml`: a repository, the branch it follows and one
forty-character revision. Nothing else in the repository names an upstream revision,
and a test holds it to being one.

Note what the pin is *not*: nib does not pin `cef` itself. The engine's CEF version
is whatever `tauri-runtime-cef` pins at that revision - `=151.8.1` today, which is
Chromium 151 - so the chain is Chromium to CEF to `cef-rs` to `tauri-runtime-cef` to
nib, and nib's own job is only to follow the last link and re-measure. The bump
reports the whole chain so nobody has to hold it in their head: which `cef` the
revision pins, and what CEF's own index says is newest.

**A scheduled workflow does the bumping**, and it exists:
`.github/workflows/cef-bump.yml`, weekly on a Monday morning and whenever somebody
asks. `apps/desktop/src-tauri/cef/bump.py` is what it runs.

1. Resolve the head of the branch the pin follows, and read which `cef` crate that
   revision pins - straight out of the manifest at that commit.
2. Read `https://cef-builds.spotifycdn.com/index.json` for the newest *true* stable,
   sorting by version and not by date, because the index is ordered by modification
   time and LTC branches are labelled stable too. That is
   `spike/browser/scripts/fetch-cef.py --newest-stable`, which already knows.
3. Ask crates.io whether `tauri-runtime-cef` is a release yet. **On 2026-09-13 it
   became one**, as `3.0.0-alpha.0`, which matters enough to have its own paragraph
   below.
4. If the pin has moved: build the flagged app on all three desktops, run the same
   gate `.github/workflows/cef.yml` runs, and open a **draft** pull request carrying
   the moved pin, the lock file the new revision resolved to, and the three gate
   tables in the body.
5. A person presses merge, or does not. Nobody edits a URL, and nobody reads a
   release note to find out a version number.

**One hand step remains, and it is upstream's fault rather than a design choice.**
The pin is turned into a checkout by `apps/desktop/src-tauri/cef/upstream.py` instead
of being a plain git dependency, because one line has to be repaired between the
fetch and the build: the branch removed `tauri`'s `wry` feature, and every Tauri
plugin that supports iOS still asks for it, so Cargo refuses to resolve. Section 8's
batch 1 notes have the whole of it. The repair is three lines the script carries, the
bump workflow reports when it stops applying - which is the good outcome - and the
day the plugins are republished the script goes away and the pin becomes a version
number.

**And the pin will want to become a version.** `tauri-runtime-cef 3.0.0-alpha.0`,
`tauri 3.0.0-alpha.0` and `tauri-runtime-wry 3.0.0-alpha.0` were published on
2026-09-13, and the alpha fixes upstream both of the things the spike had to work
round: `winit` is published as `tauri-winit`, so there is no duplicated `dpi`, and
the macOS `with_accepts_first_mouse` mismatch goes with it. What has *not* been
published is a single plugin for that line - `tauri-plugin-opener`, `-dialog`,
`-updater`, `-os`, `-process`, `-deep-link` and `-single-instance` are all still 2.x
and all ask for `tauri ^2` - so nib cannot use the alpha without moving the whole app
to Tauri 3, which is a decision rather than a bump. It is the cleanest door and it is
not open yet.

**Which branch to track: CEF stable, and it will never be Chrome's stable.** This
is the least comfortable fact in this document and it gets its own paragraph.
Chromium's
[release cycle](https://chromium.googlesource.com/chromium/src/+/main/docs/process/release_cycle.md)
now reads *"Chrome ships a new milestone... to the stable channel **every two
weeks**"* - M152 on 2026-08-12, M153 on 08-26, M154 on 09-09 - while CEF's own
document says *"updating CEF branches is currently a manual process so there will
likely be a delay"*. On 2026-09-13 CEF's stable is **M152**, Chromium's is M153 or
M154, there is **no CEF branch for M153 at all**, and CEF's M151 branch is already
marked unsupported. So a non-LTS CEF branch now lives about four to six weeks, and
**an app on CEF stable is permanently one to two Chromium milestones behind
Chrome.** That is the price of embedding Chromium rather than being Chromium, it is
not a thing nib can fix, and it is a thing a reader deserves to have decided
knowingly.

What that is worth in numbers: the milestones between 2026-06-13 and 2026-09-13
carried on the order of 1,500 CVE-numbered fixes and two exploited-in-the-wild
zero-days, and Chromium's
[severity guidelines](https://chromium.googlesource.com/chromium/src/+/main/docs/security/severity-guidelines.md)
promise Critical fixes to users *"in under 30 days"* with in-the-wild exploits on a
*"SLO of 7 days or faster"*. So the two honest positions are **follow CEF stable
within days of each branch** - which is what the workflow above is for - or **sit on
an LTS branch** (every sixth, ~8 further months of platform-agnostic security fixes,
Chromium 144 today) and accept a known gap on purpose. Follow stable. LTS is for a
release that has to slip, not a policy.

**And the consequence to state out loud: nib's release cadence becomes Chromium's.**
Under B the engine is linked into the app, so an engine update is an app update. It
is bearable because the bump is automated end to end and the app already ships its
own updates through `tauri-plugin-updater` - but it is a change in how often this
project releases, and it should be a decision rather than a discovery.

### The engine as its own artefact, which CEF already built

The alternative is the WebView2 Evergreen model: the engine as **its own signed
artefact**, updated on its own schedule, so a Chromium security fix does not need an
app release and somebody who never opens a web tab never downloads 300 MB.

**CEF ships this upstream, from 151.1, and only on Windows.** Its bootstrap
*"downloads, installs, updates, and uninstalls CEF from a shared installation
directory so that multiple applications can share a single managed copy"*, and
[its threat model](https://github.com/chromiumembedded/cef/blob/master/libcef_dll/bootstrap/installer/SECURITY.md)
is the one anybody building this would have had to write: HTTPS only, a streaming
SHA-256 against a sidecar hash, publication gated on a **signed catalogue with a
pinned certificate thumbprint**, a compiled-in revocation baseline with a CDN delta,
and launch-health tracking that rolls back a version that keeps crashing. Its
[admin policy](https://github.com/chromiumembedded/cef/blob/master/libcef_dll/bootstrap/installer/ADMIN_POLICY.md)
has `DisableDownloads`, a UNC mirror and *"Managed applications should ship a
bundled fallback"*. There is no Linux or macOS equivalent.

**And it is the same mechanism as the Windows sandbox.** The installer is part of
the `bootstrap.exe`-loads-your-DLL pattern, tied to `chrome_elf.dll` and the sandbox
ABI. So shutting ship gate 1 - making nib's Windows build the DLL that
`bootstrap.exe` hosts - buys **both** Chromium's sandbox **and** out-of-band engine
updates, on the platform most of nib's users are on. That makes gate 1 the highest-value
piece of work in the whole plan, and it is why batch 7 does it upstream rather than
around it.

**On Linux, on-demand delivery is actively worse, and this was the surprise.** A
downloaded engine cannot be installed `root:4755` and cannot be given an AppArmor
profile, because an unprivileged application process cannot do either - so an
on-demand engine on Linux depends entirely on the host's unprivileged user
namespaces, which is exactly what Ubuntu 24.04 turns off by default for unlisted
paths. Downloading the engine there **removes the one robust sandbox path**. Add
that Fedora's guidelines refuse software that *"downloads code bundles from the
internet in order to be functional"* and Debian puts such wrappers in `contrib`, and
the answer is settled: **bundle on Linux and macOS, and let Windows use CEF's own
installer once gate 1 is shut.**

Worth knowing about the precedents, because they are sobering: Steam has shipped its
CEF as a separately-updated 125 MB package for years and sat on Chromium 126 for
some twenty-one months; JetBrains fetches a 246 MB JCEF runtime on demand and runs
about three milestones behind. Separating the engine does not by itself buy a
cadence. Only automation does, which is what the workflow above is.

### Signing on macOS, which is five bundles and a framework

A CEF application on macOS is not one signable thing. CEF's own documentation is
plain that *"the single executable structure is supported on Windows and Linux but
not on MacOS"*: the app bundle holds `Chromium Embedded Framework.framework` and a
set of helper bundles - the renderer, the GPU, the plugin host, the alerts helper
and a plain one - *"because it needs to have a separate app bundle and Info.plist
file so that, among other things, it doesn't show dock icons."* Every one of those
has to be signed **separately and inside-out**: the framework and its nested
libraries first, then each helper, then the outer app. `codesign --deep` is Apple's
own deprecated shortcut for this and produces a bundle that notarises and then fails
to launch, so it is not the answer.

Each of them also needs the hardened runtime with entitlements Chromium cannot run
without, because a JavaScript engine is a program that writes code and then executes
it: `com.apple.security.cs.allow-jit` for the renderer, and
`com.apple.security.cs.allow-unsigned-executable-memory` plus
`com.apple.security.cs.disable-library-validation` for the helpers that load the
framework out of another bundle. This is the same set every Electron and CEF
application on macOS ships, and `tauri-macos-sign` and Tauri's bundler are where it
has to be taught - `tauri-runtime-cef` carries a `macos-application-bootstrap` test
of its own, which is a sign the branch is already thinking about it.

Two consequences worth stating before batch 7 rather than during it: the notarisation
upload becomes a few hundred megabytes rather than a few, which lengthens every
macOS release; and `LSUIElement` must be true on every helper, or five icons appear
in the Dock and the app steals focus each time a tab opens.
`spike/browser/scripts/stage.py` writes that layout, including the flag, which is
why it exists at all.

### Packaging, which on Linux is the sandbox question again

Chromium's Linux sandbox has two possible first layers and the choice is made at run
time by `ZygoteHostImpl::Init`: the **namespace sandbox** if the host allows
unprivileged user namespaces, otherwise the **setuid helper** `chrome-sandbox`, and
if neither, `LOG(FATAL) "No usable sandbox!"` and the application does not start.
The helper must be `root`-owned with mode `4755` - executable, uid 0, setuid bit,
and the other-execute bit, so `4750` fails - and Chromium says so in the abort
message.

The complication is that **Ubuntu 24.04 turns unprivileged user namespaces off by
default** for unconfined binaries, and allowlists by path with root-owned AppArmor
profiles; Chrome's own deb now installs one. So on the distribution most Linux
readers are on, a CEF application at an unlisted path gets no namespace sandbox and
must either ship the setuid helper or ship its own profile - and both need root at
install time.

| | what a CEF app gets |
| --- | --- |
| **deb, rpm** | the good case, and the only one. Ship `chrome-sandbox` and set `4755` in `postInstallScript`, and install an AppArmor profile granting `userns` for Ubuntu 24.04+. Tauri's bundler supports both scripts. **One trap:** Tauri's deb writer normalises every file to 0755/0644, so the setuid bit cannot be baked into the payload and *has* to be set in the post-install |
| **Flatpak** | works, through [zypak](https://github.com/refi64/zypak), which redirects Chromium's sandbox onto Flatpak's own - *"actively used by the majority of the Electron and Chrome-based Flatpaks on Flathub"*. For CEF specifically it needs `ZYPAK_CEF_LIBRARY_PATH` pointing at `libcef.so`, which is what Zoom's Flatpak does. And there is a Tauri-plus-CEF application on Flathub already - [Readest](https://github.com/flathub/com.bilingify.readest) - which is the template rather than a guess. `--allow=devel` is **not** needed, and `--talk-name=org.freedesktop.portal.*` is a linter error rather than a requirement |
| **AppImage** | no sandbox. libfuse mounts the image `nosuid` unconditionally, so a setuid helper cannot work, and there is no root to install a profile with. `--no-sandbox` is what every Electron AppImage falls back to, and for a *browser* that is not acceptable - so nib's AppImage should either not offer web tabs or not be the recommended download |
| **Snap** | no sandbox in practice. `browser-support` with `allow-sandbox: true` is what would give it, and it is *"limited to trusted publishers only"*: the base declaration denies the connection outright, so it takes a store-side override and human review, and Canonical's position on the record is that it is *"reserved for major browsers... not electron apps"*. Without it there is no `unshare` in the profile either, so the namespace sandbox is gone too |

So the recommendation for batch 7: **deb and rpm are the sandboxed Linux builds, and
Flathub through zypak is the third**. The AppImage and the snap either ship without
web tabs or ship with a plain statement that the browser in them is unsandboxed, and
of the two, not shipping the feature there is the more honest choice.

---

## 8. The plan

Eight batches, in order, each with what it proves and an honest size. "Large" here
means a week of one agent's attention, not an afternoon.

| | what it does | what it proves | size |
| --- | --- | --- | --- |
| **1** | **The gate. Done, and its answer is "not yet, and here is exactly why".** nib builds against `tauri-runtime-cef` behind a Cargo feature on all three desktops and starts on none of them; the download cost is measured and inside what Emil was told. See below | that the app can be built on Chromium at all, what it would cost, and which four upstream things stand between the build and a window | large |
| **2** | **Web tabs on the new engine.** `web_tabs.rs` onto CEF webviews: place, show, hide, navigate, real back and forward, the `.url` file untouched, the bar untouched. Delete the address trail and the guard's permission half; keep the globals half. The two profiles | that a web tab is the same three calls, that one browser process serves them all, and that nothing about the file or the bar changed | large |
| **3** | **Chromium's own pages.** `chrome://settings`, `extensions`, `history`, `downloads`, `password-manager` as tabs, with the gear and puzzle marks, never files in the space. The ⋮ menu's twenty-one rows into nib's menus. The search engine through the preference tree | that Emil's *"chrome://settings will work for us"* is true, and that no new surface was needed to reach any of it | medium |
| **4** | **Extensions.** The CRX fetch, the external-extension declaration, install, enable, disable, remove, and `chrome://extensions` as the management surface. The puzzle glyph in the tab's bar for an extension's action | that a reader can install any MV3 extension and take it away again, which is the ask with the least documented support behind it | large |
| **5** | **The list on the account.** One key in `users.settings`, validated; reconcile on sign-in and on change; a row in Settings ▸ Web. Say plainly that an extension's own settings do not follow | that the nib account replaces the Google account for the thing Emil named, and only for that thing | medium |
| **6** | **The rest of the rows.** Private tabs as off-the-record profiles, downloads, print, find over Chromium's find, zoom, DevTools, per-site permissions, delete browsing data. Ctrl+T, Ctrl+W, Ctrl+L, Ctrl+Shift+N and Ctrl+F through the keyboard handler, in the registry, in `docs/keyboard.md` | that the keys work over a page that has the keyboard, and that every row of section 3 has somewhere to be | medium |
| **7** | **The two ship gates.** Chromium's sandbox on Windows through the DLL host - upstream in `tauri-runtime-cef`, which is a contribution and not a wait. H.264 and AAC: either a CEF build with the licensing settled or #3559. Linux packaging: strip `libcef.so` first (CEF ships it unstripped at 1362 MB), then the setuid helper and the AppArmor profile in deb and rpm, zypak for Flathub, and a decision about the AppImage and the snap. macOS signing and notarisation of the framework and every helper bundle, inside-out, with the JIT entitlements | that it is shippable. Nothing before this batch is, and calling any of it done earlier would be the mistake this row exists to prevent | large |
| **8** | **The new tab page, and the polish.** nib's own new tab - a search field and the space's `.url` files. The share sheet. The clipper's extractor moved into `packages/markdown` and the read-out over the DevTools Protocol. Motion, the blink, and nib's own chrome in all thirty-nine languages | that it feels like nib rather than like Chromium in a nib-coloured window, which is the only thing the reader will actually notice | medium |

Batches 1 and 7 are the ones that can say no. Everything between them is ordinary
work on a foundation those two either give or withhold, and sequencing it any other
way would mean discovering in batch 7 that batch 2 was built on sand.

### What batch 1 delivered

The flag, the seam, the workspace with the pin in it, the gate that measures the two
builds against each other, the workflow that runs it on three desktops and the
workflow that follows upstream. Eight files and one feature:

| | |
| --- | --- |
| `apps/desktop/src-tauri/Cargo.toml` | `[features] cef = []` - a name with **nothing behind it**. The crate has no default features at all, which is what keeps the flag off in every build nobody typed it into |
| `apps/desktop/src-tauri/src/engine.rs` | the seam. Which engine, where its profiles are, and `web_store`, which is the one call `web_tabs.rs` makes for a web tab's storage on either engine |
| `apps/desktop/src-tauri/src/engine/gate.rs` | the measuring gate, behind the feature: it opens a web tab through the app's own command, opens `chrome://settings` and `chrome://extensions`, says what each step cost as JSON, and quits |
| `nib_lib::run_on` | the whole of what the app's own source gives up to be portable between engines: one function that takes an already-configured builder, and `nib_lib::Engine`, the runtime every other signature in the crate means when it says none |
| `apps/desktop/src-tauri/cef/` | its own Cargo workspace: the pin, `upstream.py` that turns it into a checkout, `gate.py` that runs the pair and writes the table, `bump.py` that follows upstream, and a `main.rs` that links CEF and hands it in |
| `.github/workflows/cef.yml` | the gate on `windows-latest`, `macos-latest` and `ubuntu-latest`. Gated to branches named `ci-check-cef*` and to being asked for by hand, like the spike |
| `.github/workflows/cef-bump.yml` | weekly, and a draft pull request with the table. Section 7 |
| `apps/desktop/test/cef.test.ts` | the promise, held: no default features, no patch in the app's manifest, and no workflow, script or bundle config that ships anything ever naming the flag |

**Six things were found, and two of them change what a later batch has to do.**

**1. The engine cannot be a feature of the app's own crate, and that is a fact about
Cargo.** `tauri-runtime-cef` is built against the `tauri` beside it in Tauri's
repository, where the runtime is chosen by the application instead of compiled in - so
the whole `tauri` ecosystem has to come from that revision, which is a
`[patch.crates-io]`, and a patch applies to **every** build of the workspace it is in.
In the app's manifest, the app that ships would be built against an unreleased Tauri.
So the flagged build is a workspace of its own that depends on the app's crate by
path, carries the patch, and hands the engine in through `run_on`. The app's own
manifest gains four words and a comment.

**2. Nothing else in the crate had to change, because the branch's default runtime is
type-erased.** This was the pleasant surprise. On `feat/cef`, `tauri::Builder::default`
is a `Builder<DynRuntime>` and `AppHandle`, `Window` and `Webview` with no type
argument mean the type-erased runtime rather than `Wry` - so every signature in
thirty-four modules is correct under both builds and the only place that names a
runtime at all is one `pub type Engine`. The two exceptions are named below.

**3. No Tauri application that uses `tauri-plugin-opener` or `tauri-plugin-dialog` can
build against `tauri-runtime-cef` today.** This is the finding, it is upstream, and it
has nothing to do with Chromium. Every Tauri plugin that supports iOS carries
`[target.'cfg(target_os = "ios")'.dependencies.tauri] features = ["wry"]`, and the
branch removed that feature; Cargo resolves a dependency's target-specific
dependencies whatever platform it is building for, so the missing name is a hard
resolution failure. It is not one an application can work round: both plugins are in
nib's graph, nib's capabilities name their permissions, and **every** published
version of either asks for it. The repair is one empty feature, carried as three lines
in `apps/desktop/src-tauri/cef/upstream.py` rather than a fork nib would have to host,
and it is worth sending upstream - either the branch keeps `wry` as an empty name
until the plugins are republished, or the plugins stop naming it.

**4. A per-webview Chromium profile does exist, and it is the call `web_tabs.rs`
already makes.** Section 5 said this had no API found for it and that batch 2's first
job was to add one upstream. It does not have to: `tauri-runtime-cef` maps the
portable `WebviewAttributes::data_directory` onto a `CefRequestContext` per webview -
a path inside the root cache path becomes a named profile, anything else becomes a
hashed one, and `incognito` leaves the cache path empty, which is CEF's own
off-the-record profile. So private tabs and the two profiles are both already
expressible, and `engine::web_store` is where the choice is made.

**5. Which profile is the *primary* one is a decision, and section 5 had it the wrong
way round.** An extension installed by Chromium's command line or by its policy
mechanisms lands in the primary profile - so the browsing profile has to be the
primary one and **nib's own interface has to be the named profile beside it**, which
is the reverse of the `app` and `web` sketch. (Batch 1.5 measured the first half of
that sentence and it is *wrong about the command line*: `--load-extension` is read as
each profile's extension service starts, so it lands in **every** profile, nib's
interface included. The layout below is still the right one, for the policy half; the
consequence is below in batch 1.5.) The layout is now
`<config>/web/Default` for the web and `<config>/web/app` for the interface, and it
has one consequence worth knowing before batch 2: the interface's window has to be
built in Rust rather than by `tauri.conf.json`, because a window in the config cannot
ask for a profile. `engine::take_ui_window` and `engine::open_ui_window` are that,
behind the feature, and the config still says what the window looks like.

**6. Two copies of `tauri-utils`, on purpose.** The patch is `tauri` and
`tauri-build` and nothing else, and that is a finding rather than an omission: the
branch moved `tauri-utils` to `schemars` 1 without moving its version number, and
every plugin's build script is written against the 0.8 API - patch it and
`tauri-plugin-fs` fails to build with *"expected `Schema`, found `RootSchema`"*. So
the graph holds `tauri-utils 2.9.3` twice, once per source, which is allowed because
neither copy declares a native library and because no plugin hands one of its types to
`tauri`. It is the kind of thing that only a build finds, and it is why the patch list
has a test over it.

**What the crate gave up in `web_tabs.rs`, once it was rebased onto the browser
rework.** Two things, both small. The closure that answers a page asking for a new
window named its own argument's type - `NewWindowFeatures` - and on the branch that
type carries two type parameters where the system engine's carries none; the
annotation is redundant in both, so it is gone and the closure infers it. And
`web_open`'s two per-platform storage blocks - `data_directory` on Windows and Linux,
`data_store_identifier` on a Mac, with the `store()` helper and the `STORE_ID`
constant behind them - collapse into one call, `engine::web_store(builder, &app)?`,
which is the seam: byte-identical on the system engine, the browsing profile under
nib's own Chromium. Nothing else of the app's own product code changed.

**One good surprise about this machine.** `cef-dll-sys` resolved
`cef_binary_151.3.24+g2384915+chromium-151.0.7922.174_windowsarm64_minimal` when the
flagged workspace was built on Emil's own ARM64 Windows box - so CEF publishes a
native arm64 Windows distribution and a nib on Chromium is not an x64-only product.
What it could not do is finish: `cef-dll-sys` builds a C wrapper with CMake, and CMake
would not configure clang for arm64 there. So the flagged build is provable on CI and
not on that machine, which is what this batch was written expecting - the runners are
x64, and every number below is theirs.

**And two places where the flagged build is deliberately less than the app.** PDF
export talks to `WebView2`'s print engine directly, which is not the engine any more,
so under the flag `pdf_supported` says no and the window falls back to the system's
print panel exactly as it does on a Mac; Chromium's own `PrintToPDF` is batch 6's.
And on Linux `tauri-plugin-dialog` brings `rfd` with GTK 3 while the runtime is GTK 4,
and GTK 4 aborts when it finds GTK 3 in the process - the plugin has an `xdg-portal`
feature that would fix it, and turning it on is a change to the *shipping* Linux build
and therefore Emil's to make. It is in batch 7's Linux row now rather than a surprise.

### What batch 1.5 did: three causes, named, and two of them shut

Batch 1's answer was *"it compiles, it links, its tests pass on all three desktops and
it starts on none of them"*, with three reasons it could not name. Batch 1.5 is the
naming and the repair. **Windows and macOS now start**, which is criterion 1 below;
Linux does not, and its reason has an owner.

**Windows: one missing entry point, and it was never CEF's.** The loader refused the
binary with `STATUS_ENTRYPOINT_NOT_FOUND` before nib's first line, with all
thirty-nine imported `cef_*` symbols present. The hole is one entry point:
**`TaskDialogIndirect`, imported from `COMCTL32.dll`** - and it was reproduced in
isolation rather than inferred, both ways, on a machine with no Chromium on it at all.
A twelve-line Rust binary that imports that one symbol the way `windows-sys` does and
carries no manifest dies with exactly `0xC0000139` and no output; the same binary with
the manifest this batch embeds prints its line and exits 0. The chain of five facts
behind it, each one checkable:

1. `tauri-plugin-dialog` takes `rfd` with `features = ["common-controls-v6"]`, and nib
   depends on that plugin on all three desktops.
2. Under that feature `rfd`'s Windows message dialog calls `TaskDialogIndirect`, which
   is a *static* import of `COMCTL32.dll` in whatever binary links it.
3. `TaskDialogIndirect` exists only in version 6 of the common controls.
   `C:\Windows\System32\comctl32.dll` is 5.82 and exports 119 names, not that one; the
   version 6 assembly in `WinSxS` exports 150 names, including it. `rfd`'s own
   documentation says so: *"It is only provided by ComCtl32.dll v6 but Windows use v5
   by default... Add an application manifest"*.
4. The only thing that makes a process load version 6 is an application manifest with
   that dependency in it. **A plain rustc MSVC executable has none** - built one and
   read its resources: no `RT_MANIFEST` at all.
5. `tauri_build::build()` does embed one, and it does not reach this binary.
   `tauri-winres` compiles its resource through `embed-resource`, which emits
   `cargo:rustc-link-arg-bins` - and cargo applies that **only to the binary targets of
   the package whose build script emitted it**. The app's crate is a path *dependency*
   of the flagged workspace, so its manifest and its icon go into the app's own binary
   next door and into nothing else.

So the flagged binary was the app, linked without the manifest the app ships with, and
the loader gave it `comctl32` 5.82. The repair is four lines in
`apps/desktop/src-tauri/cef/build.rs`: the compatibility list and the common-controls
dependency out of CEF's own `cefsimple` manifest, written into `OUT_DIR` and embedded
with `/MANIFEST:EMBED /MANIFESTINPUT:`, which the linker merges with anything else it
was given. **With it, the window is on screen in 1.4 seconds.** It is not a Chromium
problem, it was never the sandbox, and `gate.py` now prints the manifest a binary has
beside the entry point the loader could not bind, so the next one is a paragraph rather
than a week.

**macOS: the bundle, and the helpers in it.** CEF loaded and then died on
`icudtl.dat not found in bundle`, which is Chromium asking `NSBundle` for the main
bundle and being handed an executable in a folder. Three things are needed and all
three are packaging rather than code: the framework in `Contents/Frameworks`, which
batch 1 already staged; a real `Contents/Info.plist` with `CFBundleExecutable`, which
is what makes the folder a bundle at all and therefore what makes Chromium able to
find `icudtl.dat`, the `.pak` files and the locales inside the framework; and the
helper apps at `Contents/Frameworks/<app> Helper.app`, because with
`browser_subprocess_path` unset - and `tauri-runtime-cef` does not set it - that is
where CEF looks for the executable it launches for every renderer, the GPU process and
every utility process, and on that platform it will not re-launch the main executable
the way it does on the other two. `gate.py` builds all of it now, from the same recipe
the `cef` crate's own bundler writes (`src/build_util/mac.rs`), including
`LSEnvironment`'s `MallocNanoZone=0` - the framework replaces the process's malloc zone
and the nano zone has to be off before the first allocation - which the gate also sets
in the environment, because `LSEnvironment` only reaches a launch made through the
system. **With it, the window is on screen in 1.6 seconds and one browser process
serves two web tabs.**

**Linux: both toolkits are in the process, and that is Emil's decision rather than a
repair.** The flagged binary dies with `SIGSEGV` about 290 ms in, having printed its own
first line and nothing else - and *"nothing else"* was itself a measurement error:
`tauri-runtime-cef` defaults CEF's log into the cache directory, so batch 1 read an
empty stderr as an empty answer. There is no `cef.log` either, which places the crash
before CEF initialised its logging at all. What `ldd` says about the binary is the
finding:

```text
libgtk-3.so.0 => /lib/x86_64-linux-gnu/libgtk-3.so.0
libgdk-3.so.0 => /lib/x86_64-linux-gnu/libgdk-3.so.0
libgtk-4.so.1 => /lib/x86_64-linux-gnu/libgtk-4.so.1
libcef.so     => .cef/libcef.so
```

**GTK 3 and GTK 4 in one process**, which GTK does not support and which the runtime's
own comment says cannot be shared. And the backtrace out of `gdb` is the mechanism
itself, frame by frame:

```text
Thread 1 "nib-cef" received signal SIGSEGV, Segmentation fault.
#0  g_option_context_parse ()  from /lib/x86_64-linux-gnu/libglib-2.0.so.0
#1  gtk_parse_args ()          from /lib/x86_64-linux-gnu/libgtk-3.so.0
#2  gtk_init_check ()          from /lib/x86_64-linux-gnu/libgtk-3.so.0
#3  nib-cef
...
#11 __libc_start_main ()
```

The runtime calls `gtk_init_check`, and **GTK 3's** answers it, because GTK 3 was bound
first and the two libraries export the same names. GTK 4's `gtk_init_check` takes no
arguments where GTK 3's takes `argc` and `argv`, so GTK 3 reads two arguments nobody
passed and dies parsing them. That is symbol interposition, demonstrated rather than
asserted. `spike/shell`, which links no GTK 3 at all, brought the same engine up on the
same runner in 264 ms.

GTK 4 is the runtime's, through `winit-gtk4`. GTK 3 is `tauri-plugin-dialog`'s: that
plugin's default feature is `gtk3`, which is `rfd/gtk3`. **It cannot be turned off from
the flagged workspace**, and that is a fact about Cargo rather than something nobody
tried: features are additive, so `cef = ["tauri-plugin-dialog/xdg-portal"]` would add the
portal backend *beside* GTK 3 rather than instead of it, and only
`default-features = false` on the plugin removes it - in the app's own manifest, which
is the build that ships. So Linux is exactly where batch 1 left it and now with the
evidence attached: it is **the GTK 3 → 4 change in batch 7's Linux row**, it is Emil's
to make because it changes the shipping Linux build's file dialogs to the XDG portal,
and criterion 1 needs Windows and a Mac rather than all three.

**And the gate's own contract changed, which is why the colour of the job is worth
reading now.** Batch 1's `gate.py` returned non-zero on every "not yet" and wrote no
table when it stopped the binary early - so the workflow was red on all nine runs, a
broken build looked exactly like a measured no, and the artefact worth having was the
one thing the run threw away. It now **exits 0 whenever it wrote a table, with the
verdict in the table**: the six criteria as rows, each with the measurement that
answers it and "not measured" where nothing did. A red `cef` job means the gate could
not run at all. And a run that never got a window now says why, because a diagnosis is
the second half of a gate: the Windows loader's whole import chain against what each
module in it exports plus the manifest the binary carries, a Mac's bundle and its crash
report, Linux's `ldd` and a backtrace out of `gdb`, and on all three **the log CEF
itself wrote** - which `tauri-runtime-cef` defaults into the cache directory rather
than onto stderr, and is why batch 1 read three silences as nothing at all.

**Three findings that change what a later batch has to do.**

1. **`--load-extension` is not profile-scoped, and batch 1's finding 5 was wrong about
   the consequence.** The two profiles are real - Chromium's own user-data layout is
   there with `Default` and `app` beside each other - and the extension's content script
   still renamed **nib's own interface**: the mark arrived in the interface's title, on
   a Mac, with both profiles on disk. Chromium reads that switch as each profile's
   extension service starts, so a command-line extension is installed into *every*
   profile in the process, the primary one and nib's alike. Two profiles are therefore
   necessary and not sufficient: **the install has to be profile-scoped too**, which
   makes batch 4's route the per-profile preference tree rather than a switch, and makes
   this one of the two criteria still answered no.
2. **`chrome://settings` is refused in a webview inside nib's own window on macOS, and
   the refusal segfaults.** This is the one that touches what Emil asked for by name.
   CEF has two browser styles and only Chrome style has Chromium's own pages; the
   runtime's own comment says the rest: *"on macOS a browser given a native parent view
   - which is how every webview here is hosted - is forced to Alloy style whatever the
   application asked for, because Chrome style does not support a native parent there"*
   (upstream issue #3294). So the log says
   `Navigation to chrome://settings/ is blocked in Alloy-style browser`, a
   `blink.mojom.Widget` message is rejected, and the process dies with `SIGSEGV` -
   which is also why batch 1.5's first run measured criterion 3 as "2 of 2" and meant
   only "two webviews were created". A window of its own is Chrome style even on macOS,
   so the page is reachable there; putting `chrome://settings` in a pane of nib's own
   window is not, on that platform, until #3294 moves. **Criterion 3 is therefore a
   platform row rather than a yes**, the gate reads CEF's refusal off the log rather
   than trusting the creation, and it opens the engine's own pages last so the crash
   costs one row instead of the table.
3. **A second web tab hangs on Windows.** The first opens; the second never comes back
   from the app's own command, with CEF logging *"Timeout of new browser info response
   for frame"* and a Mojo `blink.mojom.WidgetHost` rejection first - and that timeout is
   CEF's browser process failing to answer a renderer within two seconds, which is a
   blocked UI thread. The gate now gives a tab ninety seconds, says so, carries on to
   everything else, and round-trips the main thread at each step so that "the runtime is
   waiting" and "the main thread has stopped" are told apart in the table - and the
   answer is that the main thread stops, from that call onwards, which is why every
   later step reports "the window never answered" rather than a refusal. It is
   upstream's either way: the same runtime opens nib's interface and two web tabs in one
   window on a Mac and keeps answering.

**And one open question the gate now prints rather than hides.** On Windows a *third*
profile appears beside `Default` and `app` - `Profile-ezIV5moIbrEKA5IkfSkz2g`, with
Chromium's own fourteen files in it - and nothing in nib asks for it by name. The
runtime derives a name like that only when a webview's `data_directory` does not
resolve under the cache root, and the only `data_directory` under the flag is the
interface's `<config>/web/app`; a webview with none uses the global request context,
which is `Default`, so a web tab's storage is where the design says it is. It does not
happen on a Mac. Attributing it is batch 2's first hour rather than a guess here, and
`gate.py` puts the row in the table so the next run cannot lose it.

**What batch 1.5 changed, in eight files and no new ones.**

| | |
| --- | --- |
| `apps/desktop/src-tauri/cef/build.rs` | the Windows application manifest, written into `OUT_DIR` and embedded with `/MANIFEST:EMBED`. The reason it cannot come from the app's own build script is in the file |
| `apps/desktop/src-tauri/cef/gate.py` | the layout Chromium looks for (a real bundle on a Mac), the diagnosis of a build that never got a window, the six criteria as rows, and the exit code that is now 0 whenever a table was written |
| `apps/desktop/src-tauri/cef/src/main.rs` | `NIB_CEF_ARGS`, so a run can ask Chromium for `--enable-logging=stderr` without a rebuild |
| `apps/desktop/src-tauri/src/engine/gate.rs` | a website in a window of its own for criterion 4, ninety seconds of patience per web tab, a round trip to the main thread after each step, everything inside a 1024 by 768 screen, and the engine's own pages last because that step can take the process with it |
| `apps/desktop/src-tauri/cef/bump.py`, `upstream.py` | the pin job's own fault: a report that ended without a newline, a null that could mean either "no answer" or "nobody could ask", and a one-line edit that rewrote every line ending on Windows |
| `.github/workflows/cef.yml`, `cef-bump.yml` | the sandbox said out loud, `pefile` and `gdb` for the diagnosis, a temporary spaces folder, and a `propose` job that only opens a pull request from the default branch |

### The gate table

Every number below is `.github/workflows/cef.yml` on GitHub's own runners, from
`apps/desktop/src-tauri/cef/gate.py` reading what the flagged build says about
itself. The launch figures are the app's own launch trace - `NIB_TRACE_STARTUP`, the
same instrument on both builds, counting from before our first line - and the memory
figures are the resident set of the whole process tree, so Chromium's browser, GPU,
network and renderer processes are all in them. The engine is CEF 151.3.24, which is
Chromium 151.0.7922.174, because that is what the pinned revision pins.

**What a release would have to carry, measured rather than estimated.** The engine's
own files, weighed where the gate stages them beside the binary, and then compressed
with LZMA - which is what an NSIS installer and a deb use, and close enough to a dmg's
zlib to be worth saying in one row.

| | `windows-latest` | `macos-latest` (arm64) | `ubuntu-latest` |
| --- | --- | --- | --- |
| the app's own binary | 5.38 MB | 6.06 MB | 7.27 MB |
| the flagged binary | 11.32 MB | 11.97 MB | 13.75 MB |
| the engine beside it, unpacked | 394.6 MB | 316.6 MB | **1443.1 MB** |
| the engine beside it, compressed | 127.9 MB | 96.2 MB | 234.1 MB |
| **what the download grows by** | **133.8 MB** | **102.1 MB** | 240.5 MB |

Two things to read off that. The Windows and macOS figures are **inside** the band
Emil was told - 150 to 170 MB on Windows and 120 to 140 on macOS - so the download
cost of a nib on Chromium is now a measured number rather than a ratio, and both are
better than the estimate: 134 MB and 102 MB. And the Linux row is the unstripped `libcef.so` the
research warned about: 1.4 GB of it, where a release has to strip the library first.
That is packaging work in batch 7 and not an engine cost.

**One thing a Mac's row does not include yet**, said here rather than found later: a
CEF application there carries five helper bundles, and the gate makes each of them a
copy of the flagged binary because that binary's own entry point already answers as a
helper. Five copies of twelve megabytes is sixty megabytes a release must not pay - so
a release carries one small helper that does nothing else, which is what the `cef`
crate's own bundler builds and what batch 7 owns. The engine row above is the engine;
the helper question is a binary layout, and the answer is known.

**What the app itself costs on the engine it ships with**, for the control every
flagged number is read against - batch 1's run, kept because it is the first
measurement and because the spread against batch 1.5's control row below is what a
runner's noise looks like. The launch is the app's own trace, which counts from before
nib's first line - so the Windows figure is mostly a runner loading a binary it has
never seen, and none of the three is a number to compare between platforms.

| | `windows-latest` | `macos-latest` (arm64) | `ubuntu-latest` |
| --- | --- | --- | --- |
| launch to the window on the system's engine | 7135.9 ms | 2195.1 ms | 680.8 ms |
| resident with no web tab, the whole tree | 302.8 MB | 87.6 MB | 524.5 MB |

**And the row batch 1.5 turned: the flagged app starts on Windows and on macOS.** The
build rows were batch 1's and still hold - Cargo resolves the graph with the `wry`
repair, `tauri-runtime-cef` compiles with the winit repair, nib's own crate compiles
against it, the binary links with the static CRT and the flagged package's tests pass,
on all three. What changed is the row under them:

| | `windows-latest` | `macos-latest` (arm64) | `ubuntu-latest` |
| --- | --- | --- | --- |
| **it starts** | **yes**, with the manifest | **yes**, with the bundle | **no** |
| launch to the window, the flagged build | 1676.6 ms | 1928.3 ms | - |
| the same app on the system's engine, same runner | 5230.0 ms | 2881.8 ms | 1563.2 ms |
| resident, no web tab, the whole tree | 477.6 MB | 849.9 MB | - |
| resident, one web tab | 688.3 MB | 1049.2 MB | - |
| resident, two web tabs | - | 1250.0 MB | - |
| **browser processes for two web tabs** | - | **1** | - |
| the tree with two web tabs | - | 1 browser, 1 GPU, 2 utility, 6 renderers | - |
| a second web tab | never came back, and the main thread stopped answering from that call on | opened, 166 ms | - |
| `chrome://settings` in a pane of nib's own window | not reached | **refused: Alloy style** (run `34858474457`, which caught CEF saying so) | - |
| an extension's content script in nib's own interface | **reached it** | **reached it** | - |
| how far it got | two web tabs asked for, one opened | every row above, then the main thread stopped after the `chrome://` pages | `SIGSEGV` in GTK 3's `gtk_init_check`, 290 ms in |

The Windows column is run `34858474457` and the other two are run `34863736033`. Three
things to read carefully. **The browser-process row is the design's premise and it
holds**: one browser process, one renderer per web tab, on a Mac - a renderer arrived
with each tab and the browser count never moved off one. **The launch rows are the same
instrument on the same runner minutes apart**, and the flagged build coming up *faster*
than the app on the system's own engine on both is a statement about a cold runner
loading `WebView2` and `WKWebView` for the first time rather than a promise about
anybody's machine; Emil's own is where that number will mean something. And **no remote
page has been seen to paint on a runner yet**: every title the gate was told about came
from nib's own document, the tabs' titles arrive through an event that carried none on
either engine, and the screenshots show blank panels behind a system permission dialog.
A renderer per tab is what the process tree proves; a rendered page is not, and the two
should not be confused.

What each of the three meant, and what became of it: the three paragraphs above - the
manifest, the bundle, the two toolkits. Batch 1 named none of them and guessed wrong
about one (Windows was never the sandbox), which is what a gate is for: the guesses are
cheap and the measurements are not.

**So three of the six rows batch 2 needs are now filled, one is refused and two were
never in doubt.** That is the gate working as intended. It is allowed to say "not yet",
the reasons are precise, every one of them is upstream's or Emil's rather than nib's
own code, and none of them is evidence against the design - but criterion 3 and
criterion 4 are the two that section 8 calls the premise, and one of each is now a
measured no rather than an empty cell.

### Go or no-go for batch 2

Batch 2 is web tabs on the new engine with the two profiles, and it is the one batch
whose shape depends on where the engine lives - so it is the one batch that must not
start on a guess. These are the criteria, and every one of them is a row the gate
already prints, so the answer is a workflow run and not a conversation.

**Go needs all six. Batch 1 got none of them; batch 1.5 got the first one and three
more.**

1. **The flagged build starts on Windows and on macOS**, from a clean runner, with
   `--locked`, and stays up long enough to show a window. **Met.** A window on both,
   from a clean runner, with `--locked` - the manifest on Windows and the bundle on a
   Mac, both in batch 1.5 above. Linux still does not start and its reason is named and
   owned: GTK 3 and GTK 4 in one process, which is the plugin feature Emil has to
   change. That is the known lag this criterion allows, rather than a red square nobody
   read.
2. **One browser process serves two web tabs**, counted off `--type=` on the process
   tree rather than asserted. **Met on macOS: one.** Two tabs and one browser process,
   which is the question Emil asked first, answered with a process list. Not yet
   answered on Windows, where the second tab does not come back from the runtime.
3. **`chrome://settings` and `chrome://extensions` both load** in a webview inside
   nib's own window, with no Chrome toolbar and no Chrome tab strip. **Refused on
   macOS**, and by CEF rather than by nib: a webview given a native parent view is
   forced to Alloy style there and Chromium's own pages are Chrome style's (upstream
   #3294). A window of its own is Chrome style even on a Mac, so the page is reachable -
   in a window rather than in a pane. Windows and Linux use Chrome style for a child
   browser and are expected to load it; neither has got that far in one run yet.
4. **An extension's content script runs in a web tab and not in nib's interface.**
   Both halves. **Not met**, and this is the one to read twice: the two profiles are
   real - `web/Default` and `web/app`, fourteen of Chromium's own files in each - and
   the extension still renamed nib's own interface, because `--load-extension` is read
   by *every* profile's extension service. So the profile boundary is not what failed;
   the only install mechanism available today ignores it. Batch 4's install has to be
   the per-profile preference tree, and until something can put an extension in one
   profile only, this criterion cannot be answered yes by any run.
5. **The launch stays inside what Emil was told.** The flagged build's time to a
   window, on the same runner as the control: no more than **+250 ms on Windows** and
   no more than **+1.2 s on macOS**. **Met, and by a distance that should be read with
   suspicion rather than pleasure**: −3283 ms on Windows and −298 ms on macOS, which is
   to say the flagged build came up *faster* than the app on the system's own engine on
   both. On a cold runner the system engine is the slow one; the number that matters is
   a real machine's, and it is still unmeasured.
6. **The download grows by no more than 170 MB on Windows and 140 MB on macOS**,
   measured as the compressed size of what a release would have to carry rather than
   estimated from a ratio. **Met: 133.9 MB and 102.2 MB**, the same figures batch 1
   measured, with the caveat below about what a Mac's five helper bundles would add if
   a release copied the whole binary into each of them instead of carrying one small
   one.

**No-go, and what each one means.** Any of 2, 3 or 4 failing is a reason to stop and
reconsider the shape, not to work round it: they are the premise. 5 or 6 outside the
band is Emil's call rather than a technical block - the engine works, it simply costs
more than he was told it would, and he should be told again before batch 2 spends a
week on it. 1 failing on both desktops means the branch is not ready and the pin
waits: `cef-bump.yml` will ask again every Monday, and that is exactly what it is for.

**So where batch 1.5 leaves it: 1, 2, 5 and 6 are met and 3 and 4 are the two that are
not - and both of them are refusals with a named owner rather than mysteries.** Neither
is a reason to doubt B: one browser process serves two tabs, which was the premise, and
both profiles are real on disk. What the two noes change is the *route* to two rows of
the design:

- **`chrome://settings` in a pane of nib's own window does not work on a Mac**, and
  cannot until CEF's #3294 lets a Chrome-style browser take a native parent. Emil asked
  for `chrome://settings` by name; a window of its own is the shape that is available
  today, and whether that is acceptable is his call rather than the gate's. Batch 3 is
  where it lands either way, and the same question does not arise on Windows or Linux.
- **An extension has to be installed into one profile rather than onto a command
  line**, because a switch reaches every profile in the process. That is batch 4's
  design changing shape, before batch 4 starts, which is the cheapest moment for it.

Everything else batch 2 was waiting on is measured. Batch 2's own shape - web tabs as
webviews in one window, two profiles, one browser process - is what these runs show
working.

**And one criterion that is not the gate's.** The plugin repair in `upstream.py` is a
patch nib carries against somebody else's branch, and a batch 2 built on it inherits
that. Before batch 2 ships anything, the repair should be an upstream pull request
(the empty `wry` feature, or the plugins' iOS dependencies) or a published
`tauri-runtime-cef` that needs neither - otherwise the first upstream force-push is a
build nib cannot make.

**And if batch 1 stays shut.** The honest contingency, because an unreleased branch
can stay unreleased. Batch 2 is the only batch whose shape depends on where the
engine lives; batches 3 to 6 and 8 are the same work either way, because they are
about `chrome://` pages, an extension list, a new tab page and a set of menu rows,
none of which cares which process Chromium is in. So if the gate does not open,
**B′ replaces batch 2** - a `nib-browser` helper, built as the DLL `bootstrap.exe`
hosts on Windows, with its views parented into nib's window - and the plan is one
batch longer and one engine less consistent. That is a worse product, which is why B
is the recommendation; it is not a dead end, which is why waiting on the gate is
safe.

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
| `spike/browser/scripts/fetch-cef.py` | resolves a pin or the newest true stable out of `index.json`, verifies the sha1, unpacks. The version-not-date sort and the percent-encoded `+` are both bugs it had first |
| `spike/browser/scripts/measure.py` | counts the processes by their `--type=` switch, sums the tree's resident set, weighs the staged tree file by file, photographs the screen, and fails the job if more than one browser process served two tabs |
| `spike/browser/scripts/stage.py` | the layout a release needs, including the macOS app bundle with its framework and five helper bundles - the part of shipping CEF that has nothing to do with Rust |

`spike/` is outside the app's Cargo workspace, outside `pnpm-workspace.yaml`,
ignored by `eslint.config.js` and by `knip.json`, and built by no workflow that runs
on main or on a pull request. That is deliberate and worth keeping: the moment a
300 MB download is on the path of an ordinary check, every contribution gets slower.

### What it said

CEF 152.0.6 / Chromium 152.0.7977.83, on GitHub's runners, 2026-09-13. **Every check
green on Windows and on macOS, four runs each.** Linux is below the table and did not
answer through `spike/browser` at all - it answered through `spike/shell` instead,
which is the better proof anyway. The reports and the screenshots are the run's
artefacts.

| | `windows-latest` | `macos-latest` (arm64) |
| --- | --- | --- |
| **browser processes for two tabs** | **1** | **1** |
| the rest of the tree | 1 GPU, 2 utility, 5 renderers | the same |
| Chrome style | confirmed | confirmed |
| `chrome://settings`, `extensions`, `history`, `downloads`, `version` | all five loaded | all five loaded |
| an unpacked MV3 extension | loaded, injected, ran | loaded, injected, ran |
| DevTools, print preview, find, zoom | all four | all four |
| **what a release ships** | **429 MB**, 945 files. `libcef.dll` 271.7, `dxcompiler.dll` 24.6, `resources.pak` 20.7, `icudtl.dat` 10.4 - and 19 MB of `CREDITS.html`, which a release would not carry | **319 MB**, 244 files. The framework binary alone is 218.8 |
| memory, two tabs, DevTools open | **565 MB** | **892 MB** |
| **launch with no web tab** | **1 ms** | **276 ms** |
| the same with no Chromium linked at all | 0 ms | 0 ms |
| **CEF initialised** | **170 ms** | **1006 ms** |
| first load finished | 1037 ms | 2426 ms |

**The headline is the first row.** Two browsers, one browser process, on both
platforms - which is the question Emil asked first, answered with a process list
rather than a paragraph. And the settings screenshots are Chromium's own settings UI
inside a window with no Chrome toolbar and no Chrome tab strip, which is the
configuration this whole design depends on being possible.

**The second headline is the launch row, and it is better than feared.** On Windows
linking Chromium costs **1 ms** - CEF's own link flags delay-load `libcef.dll`, so a
launch that never opens a web tab never maps it - and an initialised engine costs
**170 ms**. That is a price worth paying for what it buys. macOS is six times worse
at **1006 ms**, of which 276 ms is just `dlopen` on a 219 MB framework, and that is
the number to be nervous about.

Three things to hold against the macOS figure before it decides anything. A CI runner
is the worst hardware this will ever run on, with no GPU and a software rasteriser.
Windows, on the same class of runner, did it in 170 ms, so the gap is the platform
and not the engine. And it is exactly what batch 1 exists to re-measure on a real
machine. **If a real Mac still costs most of a second, that is the moment to take B′
seriously** - and section 2 has the shape of the alternative ready.

**Linux, and three findings, none of which is about the engine.** `spike/browser`
never got a browser there at all. The first run blocked looking for a D-Bus session
bus a runner does not have and printed *"Failed to connect to the bus"* several
hundred times; `dbus-run-session` beside `xvfb-run` fixed that, and the second run
still hung inside `cef_initialize` without ever reaching `on_context_initialized`.

The interesting part is that **`spike/shell` initialised CEF on the same runner in
264 ms** - so it is not the engine, it is the host. CEF's own Linux sample calls
`gdk_set_allowed_backends("x11")` and `gtk_init` *after* `CefInitialize`, with a
comment that the sandbox needs a single thread during initialisation;
`tauri-runtime-cef` does that work and a good deal more, and a hand-rolled host that
skips it hangs. **Which is an argument for the recommendation rather than against
it**: on Linux the platform glue is most of the job, and B is the option where
somebody else maintains it.

The third is the size: CEF's Linux distribution ships `libcef.so` **unstripped at
1362 MB**, so the staged tree weighed 1487 MB. A release must strip it before any
Linux number here means anything; the research says a stripped one lands in the same
285-350 MB band as the other two.

**The size rows are unpacked bytes, not an installer.** What a reader actually
downloads is that tree compressed, and the spike does not build an installer, so the
honest thing is an estimate with its basis: CEF's own `minimal` archive is 164 MB of
bzip2 over roughly 404 MB of Windows `Release` and `Resources`, a ratio near 2.5 to
1, and NSIS's LZMA does at least as well - so **expect the installer to grow by
something like 150-170 MB on Windows and 120-140 MB on macOS.** Against an installer
that is a few tens of megabytes today, that is the single biggest thing a reader will
notice about this change, and pinning it down is batch 1's, not a guess's.

**Every number above was taken with `--no-sandbox`**, because a CI runner cannot give
Linux's `chrome-sandbox` the setuid bit and Windows has no sandbox on this path at
all. That is stated rather than buried: a sandboxed build spends a little more at
startup and a little more per renderer, so the launch figures are if anything
optimistic, and a shipping build must have the sandbox on - which is ship gate 1.

One honest note about the screenshots: `spike/browser` makes two *top-level* windows,
so they overlap and a picture shows whichever is in front. The checks are what fail
the job; the pictures corroborate.

### And the shape itself, which `spike/shell` did prove

On Linux, `spike/shell` built against `tauri-runtime-cef` and ran. **One Tauri
window, three webviews in it - nib's own interface and two web tabs, one of them on
`chrome://settings` - and one browser process.** CEF was up 264 ms after the process
started and the window was on screen at 354 ms.

That is the recommendation, running: not a helper process, not a transport, not a
window handle passed between programs. `Window::add_child` with bounds, which is the
call `web_tabs.rs` already makes.

**And the picture found a bug in this document.** The extension's content script ran
in *all three* webviews - including nib's own interface, which is the green bar
across the top-left pane in `tauri-window.png`. An extension with `<all_urls>` read
the application's own document. That is exactly what section 5's two-profile model
exists to prevent, and it had been written there as a precaution; it is now a
demonstrated requirement with a screenshot attached. **Batch 2 does not ship one
profile.**

`spike/shell` did not build on macOS (the winit mismatch above) and, on Windows,
`tauri-build` wants an `icons/icon.ico` the first version of the crate did not carry -
fixed in the tree, not re-run, and said here rather than left as a green tick nobody
earned.

Two smaller findings from the Linux run. The shell exited with a segmentation fault
*after* its work was done and `exit(0)` was called - a shutdown path in an unreleased
runtime, worth reporting upstream rather than worrying about. And `--no-browser`
there took 2.3 s to an initialised engine, because under this runtime there is no
such thing as not starting Chromium - which is section 2's trade, measured in the
shape that will actually ship rather than in a standalone program.

---

## 10. What is left

- **The engine is one to two Chromium milestones behind Chrome, always.** Section 7.
  Nothing in this design fixes it; CEF's branch cadence is upstream and manual.
- **H.264 and AAC**, until CEF is built with them or
  [#3559](https://github.com/chromiumembedded/cef/issues/3559) lands. A ship gate.
- **Chromium's sandbox on Windows**, until nib's build is the DLL `bootstrap.exe`
  hosts. A ship gate, and the same work buys out-of-band engine updates.
- **The Chrome Web Store's own install flow is unproven.** The CRX-and-policy route
  is the plan and batch 4 proves it; if the store's own button works in a
  Chrome-style browser, better.
- **An extension's own settings do not follow the account.** Chrome syncs them
  through a Google account and there is no second door.
- **Translate depends on Google keys a CEF build does not have.** nib's own
  providers are the substitute, and the row is not drawn if it would fail.
- **The page still blinks while something is over it.** Chrome style rules out
  off-screen rendering, so a native view over the pane is the only shape and an
  overlay means hiding the page. `web-tabs.md` already says this; CEF does not
  change it.
- **No sandbox in an AppImage or a snap**, so the browser should not be offered in
  those builds. Section 7.
- **The flagged build starts on Windows and on macOS, and not on Linux.** Batch 1.5:
  the Windows loader wanted an application manifest the app's own build script cannot
  give this binary, a Mac wanted a real bundle with the framework and the helpers in
  it, and Linux has GTK 3 and GTK 4 in one process. The first two are fixed and
  measured; the third is the row below and Emil's.
- **An extension installed on the command line lands in *every* profile**, so two
  profiles are necessary and not sufficient. It is the one batch 2 criterion still
  answered no, and it makes batch 4's install the per-profile preference tree rather
  than a switch. Section 8.
- **A webview's own title handler is never called under `tauri-runtime-cef`**, where a
  window's is. To report upstream; the gate reads titles off a window because of it.
- **A second web tab hangs on Windows under the flag.** The first opens; the second
  never returns from `add_child`, with CEF's *"Timeout of new browser info response for
  frame"* before it. Upstream's, and the same runtime opens five webviews in one window
  on a Mac.
- **Tauri's plugins cannot be resolved against the branch's `tauri`**, because every
  one that supports iOS asks for a `wry` feature the branch removed. One empty
  feature repairs it and batch 1 carries the repair in
  `apps/desktop/src-tauri/cef/upstream.py`; until it is upstream, nib's flagged build
  depends on a patch against somebody else's branch. Section 8.
- **`tauri-runtime-cef 3.0.0-alpha.0` is published, and nib cannot use it**: the
  alpha is built against `tauri 3.0.0-alpha.0` and no plugin has a release on that
  line. Moving nib to Tauri 3 is the clean door and it is a decision, not a bump.
  Section 7.
- **The engine is CEF 151 and CEF's own stable is 152.** The branch pins
  `cef = "=151.8.1"`, so the flagged build is one CEF milestone behind CEF and two or
  three behind Chrome. It moves when the branch moves, which is what `cef-bump.yml`
  watches.
- **PDF export does not work under the flag.** It talks to `WebView2`'s print engine,
  which is not the engine any more; `pdf_supported` says no and the window falls back
  to the system's print panel. Chromium's own `PrintToPDF` is batch 6.
- **On Linux the flagged build has GTK 3 in it**, through `tauri-plugin-dialog` and
  `rfd`, beside the runtime's GTK 4 - `ldd` says both, and the process dies with
  `SIGSEGV` 290 ms in and before CEF has a log to write to. The plugin has an
  `xdg-portal` feature that would fix it and only `default-features = false` in the
  app's own manifest can remove `gtk3`, which changes the *shipping* Linux build's file
  dialogs. Emil's, section 8, batch 7.
- **The shell spike segfaults on exit** after its work is done - a shutdown path in
  an unreleased runtime, to report upstream.
- **Android and iOS get the system browser**, because CEF has no build for either.
- **The saved-website format is `.url`**, which is a decision being made next door
  rather than here; this design reads it and does not change it. See
  `docs/web-tabs.md`.
