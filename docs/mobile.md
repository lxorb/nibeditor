# Nib on a phone

The same app, the same crate and the same notes, built as a native Android and
iOS app with Tauri 2. Nothing about it is a separate product: the phone layout,
the drawer, the sheets and the docked formatting bar are the ones the web build
already has on a small screen, and the notes are the same files under the
documents folder that the desktop reads.

## Identity

One identity across every build, from `src-tauri/tauri.conf.json`.

| | |
| --- | --- |
| Bundle identifier | `ch.emilvinu.nib`, which is also the Android package name |
| Name | Nib |
| Publisher | Emil Vinu |
| Icons | `src-tauri/icons/android` and `src-tauri/icons/ios`, from `tauri icon` |
| Minimum Android | API 24, and API 36 is what it is compiled against |
| Minimum iOS | 14, which is Tauri's default |

The launch screen on Android is the window's own background, set in
`res/values/themes.xml` to the page's `--bg` in light and dark, so a cold start
shows the colour the app is about to paint rather than a white flash.

## What is built, and where it goes

`.github/workflows/publish-mobile.yml`, on every push to main and on every tag
`v*`, the way `release.yml` builds the desktop.

- **Android**, on `ubuntu-latest`: `tauri android build --apk` for
  `aarch64-linux-android` and `x86_64-linux-android`. The APK is signed, always,
  because an unsigned one will not install.
- **iOS**, on `macos-latest`: `tauri ios init`, then a build for the simulator.
  It does not run on a phone: that needs an Apple developer account, which there
  is not one of yet. The library is compiled for the device target beside it, so
  the part that could break is still built.

A tag puts all of them on that version's own release, beside the desktop
installers. A build of main goes on a rolling pre-release called `mobile-edge`,
not the desktop's `edge`, because `release.yml` deletes and remakes that one on
every push and would take an APK uploaded beside it with it.

## Installing the APK on a phone

1. Open the [`mobile-edge` release](https://github.com/lxorb/nibeditor/releases/tag/mobile-edge)
   in the phone's browser and download `Nib_<version>_android-universal.apk`. It
   carries both architectures, so it is the right file for any phone and for an
   emulator; it is around 19 MB.
2. Tap the download. Android asks once whether this browser may install apps;
   allow it, which is the "Install unknown apps" permission for that browser
   under Settings, Apps.
3. Play Protect will say it does not recognise the app. Install anyway.

Every build of main is signed with a key the workflow generates for that run, so
Android sees each one as a different app and refuses to install it over the last.
Uninstall the old one first, or add the release keystore below, after which every
build replaces the one before it. The version code comes from the version number
rather than from the build, so two builds of the same patch share one; that is a
reinstall, which Android allows, and only a lower one is refused.

Nothing on the phone updates itself: the desktop app has an updater, the phone
app does not, because a store is what does that and there is no store account.
The desktop's Release channel row is not there either, for the same reason: the
row is only drawn where something installs what a look finds, so a phone and a
browser have no Updates group at all. See `updates.svelte.ts`.

## What device signing needs later

**Android, a key that does not change.** Make one keystore, keep it forever,
losing it means a new app identity:

```sh
keytool -genkeypair -v -keystore nib-release.jks -alias nib \
  -keyalg RSA -keysize 2048 -validity 10000
```

Then three repository secrets: `ANDROID_KEYSTORE`, the file as base64
(`base64 -w0 nib-release.jks`), `ANDROID_KEYSTORE_PASSWORD`, and
`ANDROID_KEY_ALIAS`. The workflow already uses them when they are there and
falls back to a throwaway key when they are not, and `app/build.gradle.kts`
reads them out of a `keystore.properties` the job writes and never commits.
Nothing else changes.

**iOS, an Apple developer account.** With one:

- Add the team to `tauri.conf.json` as `bundle.iOS.developmentTeam`, or pass it
  as `APPLE_DEVELOPMENT_TEAM`. The workflow passes a placeholder today, which is
  only a field being filled in for a build that signs nothing.
- Register `ch.emilvinu.nib` as an App ID, and make a distribution certificate
  and a provisioning profile for it.
- Add `APPLE_CERTIFICATE` (the `.p12` as base64), `APPLE_CERTIFICATE_PASSWORD`,
  `APPLE_PROVISIONING_PROFILE` and `APPLE_DEVELOPMENT_TEAM` as secrets, import
  the certificate into a keychain in the job, and replace the two steps that
  build for the simulator and the device with one
  `tauri ios build --target aarch64 --export-method release-testing`, which
  produces the `.ipa`.

  There is no unsigned archive today because there cannot be one. Xcode's
  archive refuses to codesign without a certificate, and running `xcodebuild`
  by hand does not work either: the project's Rust build phase asks the Tauri
  CLI that started it for its options over a local socket, so only the CLI can
  drive that build.
- TestFlight or the App Store then needs an App Store Connect API key
  (`APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH`) and an upload step.

## What is committed and what is generated

`src-tauri/gen/android` is source. What is edited by hand:

- `AndroidManifest.xml`, `app/build.gradle.kts` and `app/proguard-rules.pro`
- `MainActivity.kt`, and beside it `Shared.kt` (what another app sent), `Tiles.kt`
  (the quick settings rows), `Widgets.kt` (the home screen) and `Speech.kt` (the
  recogniser)
- `res/values` and `res/values-night` - the theme, the colours and the words the
  system reads before the app has run - plus `res/values-de`, `res/layout`,
  `res/drawable` and `res/xml`

Everything gradle writes inside it is ignored by the project's own `.gitignore`,
along with the `tauri.*` gradle files the CLI rewrites on every build.

`src-tauri/gen/apple` is not committed. The CLI only writes it on a macOS
machine, and nothing in it is edited, so there is nothing a commit would
preserve that `tauri ios init` does not produce again. The iOS job runs that
first.

Run `tauri android init` again through the package manager, as
`pnpm --filter @nib/desktop exec tauri android init`, never as `node` and a path
to the CLI. The gradle task that builds the crate is generated with whatever
command started the CLI written into it, so the second way bakes one machine's
node into the project and the build then works nowhere else. Compare
`buildSrc/.../BuildTask.kt` after, and put the hand-edited files back.

## What Android may copy out of the app

Nothing. `android:allowBackup="false"` keeps the notes out of the Google Drive
backup, and `res/xml/data_extraction_rules.xml` keeps them out of the transfer to
a new phone as well, which from Android 12 some manufacturers make whatever
`allowBackup` says. Notes are the most private thing the app holds and none of
them is state a new install needs, so the reader carries them across themselves,
by sync or by file.

`res/xml/file_paths.xml` is the other half of the same rule: it names the folders
Nib may hand another app a file out of, and those are Nib's own. Tauri's template
names the root of shared storage instead, which would offer every photo and
download on the phone under Nib's authority.

`apps/desktop/test/android.test.ts` holds both switches, and the rules resource,
so a manifest edited for something else cannot quietly turn the backup back on.

## What a frame inside the page may not reach

`addJavascriptInterface` is the whole bridge, and Android injects that object into
**every** frame of the webview - an `<iframe>` at somebody else's origin included -
while telling the activity nothing about which frame called. A note can hold such a
frame on purpose: a page it embeds, and a block of its own HTML, both of which are
sandboxed exactly so the app is out of their reach. The bridge went round the
sandbox, so an embedded page could have read every AI key on the phone or turned the
microphone on.

So `secretRead`, `secretWrite`, `secretForget` and `listen` take a word first: a
UUID the activity makes up at launch, which it will say only by running a line in
the page - and `evaluateJavascript` runs in the main frame. A framed page may call
`askForTheFrame` all it likes; the answer lands where it cannot read it. See
`frameWord` in `src/lib/mobile/bridge.ts`, `frame` in `MainActivity.kt`, and the
test in `test/android.test.ts` that holds the two sides to each other.

## What the app asks the phone for

Two permissions, and the second is only for dictation:

| | |
| --- | --- |
| `INTERNET` | sync, and the account |
| `RECORD_AUDIO` | the speech recogniser, asked for the first time somebody turns dictation on |

**Not the camera**, on purpose, and this one is load-bearing rather than tidy.
Taking a photograph into a note is `ACTION_IMAGE_CAPTURE`, which the camera app
serves and which needs no permission of ours. The webview decides whether to
offer the camera for an `<input capture>` by asking whether the app has the
CAMERA permission *or* has not declared it at all (`isMediaCaptureSupported` in
wry's `RustWebChromeClient`), so declaring it and not holding it is the one state
where the camera row silently opens a file picker instead. See
`src/lib/insert-picture.ts`.

And a `<queries>` block, which is not a permission but is the same kind of
promise. From Android 11 an app sees only the other apps it has named, and both
of the features below ask a question before they act: the webview asks whether
anything answers `IMAGE_CAPTURE` before it offers the camera, and
`SpeechRecognizer.isRecognitionAvailable` asks whether anything answers
`RecognitionService`. Without the two `<intent>` rows in `<queries>` the answer is
no on every phone from 11 on, and both features do nothing without saying why.

## What another app may share with nib

Anything, and it becomes a note.

The intent filters sit on `MainActivity` rather than on an activity of their own,
which is what puts the app's own icon and name in the share sheet's row, and what
makes the second share of the day arrive in the app that is already open -
`singleTask`, and `onNewIntent`. Three filters: `SEND`, `SEND_MULTIPLE`, and
`VIEW` for a `.md` or a `.txt` opened from a file manager, a download or a mail
attachment, which used to be the one thing on this list that could not be done at
all.

`*/*` on the share filters is deliberate. A note is where anything goes that
somebody wants to keep a word about, Android only ever offers the row to somebody
who asked to share something, and what the thing is decides what happens to it
rather than whether it is allowed in.

**How the bytes get in.** Android hands the activity a `content://` URI and a
grant that lasts as long as the activity does. The page cannot read one: it has no
file system of its own, and the crate refuses every path outside a space. So
`Shared.kt` copies what arrived into the app's own cache while the grant is good,
and hands it to the page in slices through the bridge - `shared()` for what it is,
`sharedBytes(at, offset, length)` for a quarter of a megabyte at a time, and
`sharedDone()` when the page has written it, which is when the copies go. Nothing
is decided in Kotlin beyond what the intent itself says.

**What it becomes**, in `src/lib/mobile/shared.ts`, which is one answer for every
platform:

- The words go under a heading, with `date` and, where what arrived carries an
  address, `source` in the front matter. The same two things a clip carries, and
  through the same writer the importers use.
- A picture, and any other file, lands in the folder the Attachments setting names
  - beside the note, in the space's `assets`, or in a folder named after the note
  - and the note draws the picture and links the file.
- A markdown or text file is its own note, under its own name and with its own
  bytes. That is a note arriving, not a note being written about.
- All of it goes through `applyImport`, which is the road every imported file
  already travels: `write_note` and `write_bytes`, a name that steps aside rather
  than overwriting anything, one undo for the lot, the file list reloaded and the
  sync nudged.

**Or into the note in front of you.** Where there is a note open to write in and
the share is words and pictures - the two things that can go into a note that
already exists - the app asks, with the same small sheet it asks every other
question with: a note of its own, or this one. The words land at the caret and
each picture goes through `storeImage`, which is exactly what a paste of the same
two things does. Dismissing the sheet does nothing, which is what dismissing
always means. A share carrying a file that is neither makes its own note without
asking, because a file needs a name of its own in the space and the plan is what
gives it one.

## The tiles, and the widget

Both of them carry the id of a row in the app's own registry and nothing else.
The tile is pressed, the activity holds the id, the page asks for it and looks it
up in `appCommands` - the same list the palette reads - so a tile cannot come to
mean something slightly different from the row it is named after, and an id
nothing answers to does nothing at all.

**Quick settings**: New note (`new`), Search (`search-space`), and Record
(`record`). All three are on and the picker offers all three. The recorder's was
held back while its command was another batch's - a service the picker does not
offer is a better answer than a tile that does nothing - and the command landed, so
no tile is switched off now. `test/android.test.ts` holds both halves: every tile's
id is a row the app answers to, and no tile is disabled.

**The home screen** has one widget: the space's name and two marks along the top -
search, and a new note - and then the notes last written in, one per row, each
opening that note. Five rows, because five is what the layout has; it resizes
either way and the launcher crops what it was given.

**The lock screen** is offered the same widget. `res/xml/widget_notes.xml` names
both surfaces in one `android:widgetCategory="home_screen|keyguard"`, and
`android:initialKeyguardLayout` points at `layout/widget_notes_lock.xml`: the same
card, the same heading, the same two marks, three rows instead of five, because a
lock screen offers a card a few rows tall and a row the host crops is a note nobody
reads. The row ids there are the first three of the home layout's, so the provider
serves both out of one list and a sixth note stays a row added in one place.

Which surface a copy of the widget is on is something only the host knows: it puts
its own category into that widget's options, and `onKeyguard` in `Widgets.kt` reads
`OPTION_APPWIDGET_HOST_CATEGORY` to pick the layout. `onAppWidgetOptionsChanged` is
the only notice a move between the two surfaces gives, so it redraws; a host that
says nothing at all is treated as a home screen, which is what every host before
Android 4.2 was.

Honestly, about where this actually appears. Lock screen widgets arrived in Android
4.2 (API 17, which is where `keyguard` and `initialKeyguardLayout` come from), were
taken out of the lock screen again in Android 5.0, and came back in Android 16 -
first on tablets, where the lock screen has room for a card. So on most phones
running anything between those, declaring the category changes nothing visible: the
home screen still offers the widget, the lock screen has nowhere to put one, and
nothing is broken by asking. Where a surface does exist it is the system's lock
screen or a manufacturer's - Samsung's One UI has offered its own lock screen
panel - and the reader adds the widget there rather than in the launcher. A
launcher's own widget picker never shows the keyguard variant; that picker is the
home screen's.

None of this has been seen on a device. No emulator runs on Windows on ARM and
there is no Android phone on the machine this was written on, so what is proven is
the source and the build: `test/android.test.ts` holds the two layouts, the
provider and this page to each other, and the `android-check` job assembles the
release APK with R8 over it. The one thing nobody here has done is watch it appear
on a lock screen.

A note pinned in the app comes first. That is what "open a chosen note" means
here: the app already has one gesture for keeping a note to hand, and a picker
written in Kotlin would be a second file list in a second language answering a
question the app has already answered.

A row hands back the note's path on disk, and the activity that carries it is
exported - which is what makes a widget tappable at all, and also means anything
on the phone can send that intent. So the path is a path only once
`insideAnyOf` has found it under one of this app's own space roots and the rest
of it has been through `insideOnly`, the same judgement a `nib://` link gets; what
is opened is rebuilt from the root rather than taken as it arrived, and a path
under no space is refused in the log and on screen. See
`src/lib/space-paths.ts`.

Which notes, in which order, and under what names is decided in
`src/lib/mobile/widgets.svelte.ts` and pushed across the bridge whenever it
changes; Kotlin only draws it. The words in it - the heading, and the line for a
space with nothing in it - are handed over with the rows, because Android's own
`res/values/strings.xml` cannot reach the page's dictionaries; the strings there
are what stands in a tile's label, which the system reads before the app has run,
and English and German are both there.

The widget follows the home screen's light and dark rather than the app's own
theme row. A launcher inflates our layout in its own process with its own
configuration, so `values-night` is the only switch there is, and the colours are
the app's own two levels of ink on the app's own page colour.

## A photograph into a note

`<input type="file" accept="image/*" capture="environment">`, and nothing else.

An Android webview reads `capture` and offers the camera app rather than the
picker; a phone browser does the same; a desktop browser ignores it, which is why
the row is only offered where the glass is under a finger - there it would be the
Picture row above it under another name. What comes back is a `File`, and from
there it is the road a pasted picture takes: `storeImage` puts it where the
Attachments setting says, and the embed is written at the caret.

So there is no camera code in this app at all, on any platform, and nothing to
keep working. The permission note above is the price of that.

## Dictation

The web's `SpeechRecognition` is Chrome's and not the webview's, so the phone app
has none: on Android it is the system recogniser, through `Speech.kt`, and
everywhere else it is the web's own. Same row, same words at the caret, same note.

It listens in turns, because that is what Android offers - a recogniser ends each
time the speaker pauses - and the next turn is started while dictation is still
on, so a pause between two sentences is a pause. Errors that mean "nothing was
said" are part of that rhythm; anything else stops it, rather than restarting
against the battery. Nothing is recorded and nothing is uploaded: what crosses the
bridge is words.

While it listens, the line across the top of the document sweeps and says
`Listening` - the line an export and a stored picture already use. A mark somebody
has to dismiss is not a quiet one, and there is no new overlay.

## What the mirror does while the app is in the background

Nothing, and that is the honest answer rather than a chosen one.

Wry's activity calls `WebView.onPause()` when Android pauses it, which stops the
page's timers; the sync loop is a `setTimeout` in the page (`sync.svelte.ts`), so
it does not run. From Android 14 a cached process is frozen outright, and any
process can be killed without notice. `backoff.ts` has a ten-minute poll for a
window that is not on screen, which is the truth in a browser tab and not on a
phone: there the pass simply does not happen until the app is opened again.

A `WorkManager` periodic sync is not the answer either, and not because Android
would refuse it. The mirror is JavaScript - the protocol, the content hashes, the
cursors and the conflict rules are all in the page - and the session token lives
in the webview's own storage. A worker would have to be a second implementation of
the whole thing in Kotlin, holding a copy of the credential, and two
implementations of a sync protocol is how notes get lost. The same is true of the
account's own keychain: nothing in the Kotlin process is allowed near it.

What makes it harmless is that a note is a file. Every edit is written to disk
where the desktop and the next launch can see it, the mirror is offline-first and
conflict-preserving by design, and the first pass after the app is opened pushes
everything that was written while it was away. What is lost by not syncing in the
background is time, not notes - and a phone that has not been opened is a phone
whose notes nobody has read on another machine either.

## One size for a finger

A phone is not a narrow desktop. Everything a thumb lands on is sized from one
scale in `packages/themes/src/tokens.css`, and only rules under `[data-touch]`
read it, so a desktop keeps the sizes it has always had.

| | | |
| --- | --- | --- |
| `--touch-row` | 56px | a row in a list, and the app bar |
| `--touch-target` | 48px | a square that is only a button, and a row read more than tapped |
| `--touch-text` | 17px | the words in a row |
| `--touch-icon` | 24px | an icon that is a button of its own |
| `--touch-mark` | 20px | the slot a mark beside a row's words is drawn in |
| `--touch-gap` | 12px | between a mark and the words |
| `--touch-pad` | 14px | a row's own side padding |
| `--touch-indent` | 18px | one level of a tree |
| `--touch-bottom` | | what a sheet leaves under its last row, over the gesture bar |

`apps/desktop/test/touch-scale.test.ts` holds every component to it: a touch rule
that writes a finger-sized number of its own fails.
`apps/desktop/test/e2e/touch-scale.py` measures what that comes to on a phone, a
tablet held both ways and a desktop, and photographs each light and dark.

## Which device this is

The machine decides, and the width only tells a phone from a tablet. A window is
not a device: a reader who ticks "Desktop site" is asking for the desktop app
however small their screen is, and a desktop window dragged narrow is still a
desktop. `deviceFor` in `apps/desktop/src/lib/viewport.svelte.ts` is the whole of
it, and it reads four things - the build, `navigator.userAgentData.mobile`, the
user agent, and whether the primary pointer is a finger
(`(hover: none) and (pointer: coarse)`).

A browser has to say it is a handheld *and* have the glass under a finger. Both
halves are needed: the user agent alone is what a developer's device toolbar
fakes, and a coarse pointer alone is a desktop with a touch screen.

| What is running it | Says it is mobile | Finger | Device |
| --- | --- | --- | --- |
| The Android or iOS build | not asked | not asked | `phone` under 500pt on its narrow side, else `tablet` |
| Chrome or Safari on a phone | `Mobile` in the user agent, `mobile: true` | yes | `phone` |
| Chrome on an Android tablet | only `Android`; `mobile: false` | yes | `tablet` |
| Safari on an iPad | only `Macintosh`, since iPadOS 13 | yes | `tablet` |
| A phone browser with "Desktop site" ticked | nothing: the tick rewrites the string into a desktop platform's | yes | `desktop` |
| A desktop browser, window dragged narrow | nothing | no | `desktop` |
| A desktop with a touch screen | nothing | either | `desktop` |

Where the two halves disagree - a `mobile` hint left behind by a tick that
rewrote the string, or a device toolbar faking one and not the other - the string
wins: a user agent naming a desktop platform (`Windows NT`, `X11`, `CrOS`) is a
desktop whatever the hint says. That is the half the reader's own tick rewrites,
and the half every browser has.

Two of those rows are worth saying out loud. `Macintosh` counts as a handheld
because an iPad calls itself one and no Mac ever answers the pointer query with a
finger - a Mac has a trackpad, which hovers. And because iOS says `Macintosh`
either way, a *phone* on iOS asked for the desktop site lands on the tablet
layout rather than the desktop one: Safari there leaves nothing behind to tell an
iPhone from an iPad. On Android, which is where the tick is worth having, it
works exactly as the checkbox suggests.

`data-narrow` is still the width and nothing but the width (460px and under), so
any layout that depends on how much room there is can read it. It says nothing
about the device: the rules that turn the drawer into the whole screen ask for
`[data-drawer][data-narrow]`, so a narrow desktop window keeps its columns.

`apps/desktop/src/lib/viewport.test.ts` covers every row of that table, and both
halves of the pair on their own.

## The row along the top

Three things, in the order a thumb reaches them.

| | |
| --- | --- |
| Left | The button that opens and shuts the file list - `SidebarToggle.svelte`, the same one the desktop title bar has, with the panel's edge sliding out of the window as the list arrives |
| Middle | The document's name, with the mark its kind wears in every list that shows it |
| Right | Three dots, which open the menu the desktop's menu bar holds: the same groups, the same rows, the same submenus, as one sheet - `AppMenu.svelte` with `dots` |

There is no hamburger on a phone or a tablet: the bars are the desktop's, at the
left of its title bar, and a touch screen reaches the same menu through the dots
at the other end of this row.

The sidebar button is one component and one drawing, wherever it appears. Where
the sidebar is a drawer it covers the bar this button sits in, so the drawer's
own head carries the same button at the same corner of the screen - shut it is a
plain window, open it has the panel's edge inside it, and the edge slides in from
the left as the list arrives and back out as it goes. Nothing else in the app
draws that glyph, and a tablet with the panel docked beside the note has only the
bar's. `apps/desktop/test/mobile-header.test.ts` holds all of that: one component,
one glyph, one place each.

## One document at a time

A phone and a tablet hold one document, and one pane. A strip of tabs on a
screen that narrow says less the more it holds, so opening a note, a canvas or a
paper puts away the one that was there rather than standing it beside it, and
the title bar is that document's name and mark instead of a strip. There is no
dragging a tab and no dragging a pane into being; a desktop keeps both.

The plus the strip would have carried moves rather than going: it sits at the
right of the list panel's header, and it is the only one on the screen. A press
makes a note; a held finger offers a canvas and a folder too, which is what the
desktop strip's plus does under a right click. See `docs/design.md`.

## What the drawer is headed with, and footed with

Three rows above the list, in the order identity, view, action - the shape
Discord's channel list has, at the touch scale:

| | |
| --- | --- |
| The head | The sidebar button, then the space at `--text-head` with a chevron beside the word, then the one plus. The name is what says where you are, and it is the switcher: pressing it drops the other spaces out of the header as rows inside the panel, each with its own mark, and making one is a row at the foot of that list |
| The tabs | Files, outline, search and links, as the segmented control the settings sheet uses, so the tab you are on is filled the way the note you have open is, and the fill slides between them rather than blinking |
| The search | A pill, and the door to the Search panel. Inside that panel the panel's own field stands in the same place, at the same height, in the same `.nib-field` box: one control that becomes editable rather than two that look alike |

Then the list, with a word in capitals over each group and the note you have
open filled - `.nib-row.is-on`, the same fill its tab wears on a desktop.

Under the list, `SidebarFoot.svelte`: who is at this device as a face and a name,
and the theme and the settings at the other end. It is `--header-height` tall, so
the list sits between two matching bars, and it keeps clear of the gesture bar
with `--inset-bottom`. The same component and the same three controls a desktop
has, because a drawer is the sidebar.

There is no bottom bar. Discord earns one because it has three unrelated
app-level places; nib has one - your notes - and the other two candidates are
already where they belong: search is the pill at the top of the list, and who
you are is the first thing in that foot. The reasoning is in `docs/design.md`.

Nothing is lost in the trade. What was open goes on the closed stack with its
words (`workspace/closed.svelte.ts`), so back - the gesture on Android, `Reopen
closed tab` everywhere - walks back along the line of documents, and each step
puts the one on screen on the stack in its turn. A note in a space was written
down before it was closed anyway: the account has it whatever this window shows.

`workspace.oneDocument` is where the rule is applied to an arrangement that
arrives from somewhere else - a session written on a desktop, a saved layout, a
window that has just become one of these devices - and `onlyOne` is the rule
itself, on every way a document opens. `apps/desktop/src/lib/one-document.test.ts`
holds both to it, and holds the desktop to keeping every tab it has always had.

## Full screen

The document and nothing else: the file list, the title
bar and the status bar all leave, and the panes fill the window behind whatever
the system keeps for its clock and its gesture bar. Where there is a window to
ask, it drops its frame too - the desktop's chrome, the browser's own bars.

It is one command, `app.fullscreen`, which is F11 and which the View menu and the
three dots both show. Nothing about it is written down: it belongs to the document
it was entered on and to this sitting, so closing that document brings the app
back, and so does starting the app again.

Four ways out, because a screen with nothing on it must not be a trap: the small
button in the corner the window's buttons were in, which fades to a fifth of
itself once nothing has moved for a while and lights again at the first touch;
Escape; back, on Android; and the same menu row that turned it on.

What stays is the document, so anything the document draws over itself stays with
it - the canvas keeps its floating bar. The drawer keeps its hands off while it is
on: there is no file list to drag out. `apps/desktop/src/lib/fullscreen.svelte.ts`
holds the state, `fullscreen.test.ts` holds both halves to it.

## The two things a phone needs that a desktop does not

**The keyboard.** The window draws under the system bars, so Android does not
shorten it when the keyboard opens and the line being written would sit behind
the keys. `MainActivity.onWebViewCreate` pads the webview by the keyboard's
height instead, which ends the page where the keys begin. The page reads that as
a window that has lost height rather than as a keyboard over it, which is why
`viewport.svelte.ts` has both `keyboard`, the pixels covered, and `typing`,
whether the keyboard is up at all. `keyboard` is only ever non-zero in a
browser, since that is the only place the keys are over the page; `typing` is
taken from whichever of the two says so, so it is true in both. The caret is scrolled back into sight from
`App.svelte` on each step of the keyboard's arrival.

**Back.** Every layer the app opens over a note takes a history entry
(`backstack.svelte.ts`), so back should close the newest one rather than leave
the app. `MainActivity` turns `handleBackNavigation` on, which is what makes the
webview answer a back press while it has somewhere to go back to and finish the
activity when it does not.

## The bar over the keyboard

A phone has one toolbar: the strip that arrives with the keyboard and leaves with
it. What it holds is the reader's, chosen in **Settings > Mobile**, and it goes on
the account beside the shortcuts - the phone it is for is the worst place to put a
list together.

The buttons are command ids from the one registry that holds every command whole:
the shortcuts list, which carries the app entries' own `run` and the editor
bindings' specs. `runEntry` in `shortcuts/registry.ts` presses one, so a button
presses exactly what the key for it presses rather than a second copy of the same
command. Panel and fixed entries are not offered: a panel key means nothing
outside the file list, and a fixed one is a fact about the keyboard.

Each button wears a mark rather than an icon. The bar has always drawn one
character per button, the icon set is loaded on demand and is larger than the app
around it, and a row of little pictures over the keyboard is what every other
editor's bar looks like. A command with a typographic mark of its own wears it -
`B`, `<>`, `•`, `¶` - and everything else wears the first letter of its own name,
which is what `B`, `I` and `S` already were. The table is in
`toolbar.svelte.ts`; nothing else needs one.

The default is the nine the bar has always held, in the order it held them, and a
bar nobody has touched is stored as nothing at all - on this device and on the
account. That is the shortcuts' own rule: a list written out in full would freeze
today's nine into every device that ever opened the pane, and a default that grew
later would reach nobody. `null` travels to the account for the same reason a
taken-away key does: another device has to be able to learn that this one went
back.

Ordering is a drag where there is a pointer and the two arrows on every row
everywhere else. A thumb has no drag and neither does a keyboard, so one pair of
buttons answers both rather than a gesture that only works on one kind of
machine.

## Pulling down past the top

A phone has no keyboard to hang a shortcut off and no room for a row of buttons
along the top, and there is exactly one movement a thumb can make that means
nothing else: pulling a surface that is already at its top further down. Obsidian
spends it on the command palette. Nib spends it on whichever command the reader
names in **Settings > Mobile**, and offers **Search this space** to begin with -
what a thumb reaches for on a phone is a note, and search is how a note is found.
`none` is a choice too, for somebody who pulls lists about without meaning
anything by it.

It listens on the two surfaces that scroll: the note's own scroller, attached in
`Pane.svelte` because a view is built fresh for every note, and the file list's,
as a `use:pullable`. The command is a registry id and runs through the same
`runEntry` the bar's buttons and the keys use.

While a finger is down there is one quiet mark at the top, a ring that fills as
the pull reaches and a disc once letting go would do something. It follows the
finger rather than animating - what a reader who has asked for less movement
loses is the growing, not the following - and it says the command's name to
anybody listening. The travel is rubber: the first stretch is nearly free and the
rest gets heavier, which is what tells a thumb that something is being reached
for.

**It never becomes the browser's own pull.** In a PWA a pull at the top of a
scrolling document is pull-to-refresh, which would throw the page away and
rebuild it - the one thing a note editor must never do by accident. Three things
stop it, and all three were already true here: the window is pinned so the
document itself never scrolls, `html` says `overscroll-behavior: none` and the
file list says `contain` on its own scroller, and the move handler is not passive
and prevents the default as soon as the gesture is this one. The drive dispatches
the three touch events and checks that a scroll, a sideways drag and a short pull
all leave everything where it was; see `test/e2e/phone-bar.py`.

## Capture: the microphone

A phone is the device a recording is actually made on, so the recorder is the same
code on all three builds and the phone is where its two concessions are.

**The permission.** `getUserMedia` inside a WebView asks the *app* for
`android.permission.RECORD_AUDIO`, and an app that never declared it is refused
before the reader is ever asked - so the manifest declares it, and that is the whole
of what is declared: no camera, no storage. Nothing opens the microphone until
somebody presses Record. The runtime grant is the WebView's own dialog and has not
been walked on a device yet; it is the one thing in this batch a phone has to confirm.

**Where the command is.** The plus at the top of the list panel is the only one a
thumb can reach, so a held finger on it offers `Record` beside New note and New
canvas, and `Meeting notes` where the account can transcribe. Both make a note of
their own when there is none, which is what a command pressed in a hurry has to do.
The same two rows are in the palette and in the Paragraph menu, out of one list, by
one id each - `record` and `meeting` - which is also what the Android quick settings
tile calls. See `apps/desktop/src/lib/recorder/commands.ts`.

**What it looks like while it runs.** One pill, in the middle of the bottom edge: a
red dot, the time so far, and a stop. It is not inside the status bar's own footer,
which is a hover away and so never appears on a phone at all - a red dot somebody
started has to be there to be pressed. It wears `.nib-bar`, the same shape as every
other floating bar, so its stop is a thumb's width there without a number of its own.

**What needs the network.** The recording does not: it is the platform's own
`MediaRecorder` writing a file into the space, and it works with no signal. The
transcript and the summary do, because the speech models are on the Worker and the
key they spend is the account's. See `docs/even.md` for that route and
`docs/typora-parity.md` for the whole of what the two commands write into a note.

## What the phone build does not have

Half the app is about a desktop, and none of it is compiled in: no updater, no
second window, no file dialog, no PDF printing, no pandoc, no Reveal in the file
manager, no Explorer New menu, no file associations. The Rust modules behind
those are `#[cfg(desktop)]`, their commands reach the handler only there, and
`capabilities/mobile.json` grants nothing for a plugin that is not in the build.
There is a test on that, in `test/permissions.test.ts`.

Three more are left out on purpose.

- **Sharing a note out to another app.** Tauri has no share sheet plugin, so this
  would be a plugin of our own on both platforms. Publishing a note through the
  sync service already gets it out of the app. Sharing *into* nib is built; see
  above.
- **A share target in the browser build.** The PWA could be one too, through
  `share_target` in the manifest, and the whole of what it would do afterwards is
  already written and shared with the Android side. What it needs that Android did
  not is a `POST` route inside `public/sw.js` to catch the form the browser sends,
  which is the one part of the app that is a classic service worker and is not
  this batch's to edit.
- **Export to a file.** The webview has no download handler, so the browser
  build's blob download does nothing there. Publishing is the way out for now.

## What compiles the phone's own half

`check.yml`'s `android-check` job, on every pull request that touches
`apps/desktop/src-tauri/**`. It sets up a JDK, the SDK and the NDK and assembles
the APK - which is the Kotlin compiled, the manifest merged, the resources built
and R8 run over the lot.

It exists because nothing else did it. The `rust` job builds the crate for the
runner's own platform, and `publish-mobile.yml` - the only thing that ever
assembled the Android project - runs on pushes to main and on tags, not on pull
requests. So a Kotlin file that did not compile or a manifest that would not merge
reached main and was found by a release. The two failures that led to this job -
a `MasterKey` that was not in `security-crypto:1.0.0`, and then a keep rule R8
wanted - are both things it now catches.

The release APK, and the same two targets `publish-mobile.yml` passes, because the
number of targets is what picks the flavour: two or more and the CLI builds
`universal`, which is the variant that ships. The only difference is the signing -
a runner with no `keystore.properties` produces an unsigned APK - and that is the
last step of all.

It has to be the release one. A debug assembly does not run R8, so a job that
built one proved the Kotlin and nothing about the APK anybody installs: the first
time this job ran it was a debug build, it went green, and `publish-mobile` failed
one step further on, inside R8. Both of those are now asserted in
`test/android.test.ts`, along with every `@JavascriptInterface` method the page
calls by name and the rule that keeps it through minifying.

### What R8 has to be told

`app/proguard-rules.pro`, and only two lines of it are not about our own code:
`javax.annotation.Nullable` and `javax.annotation.concurrent.GuardedBy` are
JSR-305 annotations that Tink - what `androidx.security:security-crypto` encrypts
the key file with - is annotated with. They are compile-time only, no Android
release ships them, and nothing loads them; R8 still stops while a reference
dangles, so it is told these two are meant to. They are named one at a time rather
than as `javax.annotation.**`, so the next dependency that really is missing
something still stops the build. The job prints R8's own `missing_rules.txt` on
every run, green or not, which is where the next two names would appear.

Clippy for `aarch64-linux-android` and `aarch64-apple-ios` stays in the mobile
workflow, because the Android job above already compiles the crate for the phone
and the iOS half needs a macOS runner.

## Locally

```sh
# Android, with ANDROID_HOME and NDK_HOME set and a device or emulator attached
pnpm --filter @nib/desktop exec tauri android dev

# iOS, on a Mac
pnpm --filter @nib/desktop exec tauri ios init
pnpm --filter @nib/desktop exec tauri ios dev
```

A release APK built by hand is unsigned, because there is no
`gen/android/keystore.properties` on a development machine. `tauri android dev`
signs with the debug key and installs fine.
