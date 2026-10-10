# The terminal

A shell in a tab, beside the notes: run the build a note is about, `git` the space, try
the command a note describes, without leaving the window. Emil, 2026-09-30: _"add
terminal as a new type of thing that you can open when creating a new tab (e.g. like page
note, canvas, ...). if there are different kinds of terminals (e.g. cmd, powershell or
whatever there is), then you should be able to choose"_.

It is built to what Windows Terminal, VS Code's terminal, iTerm2, Warp and JetBrains'
terminal already taught everybody's hands, and where they disagree it says which it
follows and why. A desktop's alone: a phone has no shell to give an app, a page in a
browser has no machine under it, and the glasses' plugin never carries any of it. The one
exception is an online terminal, whose shell is a machine of the reader's in the cloud (below).

## Where one comes from

- **Ctrl+T, and the plus** in the tab strip: a new tab, whose cards start their second line
  with _New terminal_, on **R** (T is the new tab's own key, and R is what Run has been on
  Windows for thirty years). The chevron in the card's corner, or Shift held with R or a
  click, lists every shell instead, with the default ticked - VS Code's `+ ˅` in one card.
  See docs/keyboard.md, _Ctrl+T is a new tab_.
- **An empty pane**: the same card.
- **The palette**: _New terminal_.
- **A row of the file list**: _Open in terminal_, in the row's folder - VS Code's _Open
  in Integrated Terminal_, Explorer's _Open in Terminal_.
- **A terminal's own tab**: _Open another_, beside it in the same folder; the chevron
  lists the other shells.
- **Split right, Split down** on a terminal's tab: another shell in the new pane, in the
  same folder, since the panes are nib's own.

## Which shell

Found once, the first time a chooser needs them - never at launch, because finding the
WSL distributions costs a process - and the same list after that
(`src-tauri/src/terminal/shells.rs`):

| Windows      | PowerShell 7 when it is installed, Windows PowerShell, Command Prompt, Git Bash where Git for Windows is, each WSL distribution (Docker's own two left out, as VS Code does), and the Developer Command Prompt and Developer PowerShell of every Visual Studio, for this machine's own architecture |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS, Linux | the reader's own `$SHELL`, then everything else `/etc/shells` lists that is really there, named by the program and by the whole path where two share a name. A Mac starts them as login shells, as Terminal does, for the PATH                                                                      |

The first is the platform's default and what a new terminal opens with, until
**Settings, General, Terminal, Shell** says otherwise. The same group has the **Text
size**, which Ctrl+=, Ctrl+- and Ctrl+0 change from inside a terminal too, and **Restore
history** (see below). All three are this machine's and never go to the account: a shell
is a program on one computer, and what was on its screen is nobody else's.

## Where it starts

In the folder of the space being worked in - VS Code's workspace root. Except beside a
file in no space - the app's own `custom.css` or `snippets.json`, the one kind nib opens
from outside its spaces - whose own folder is the one that has anything to do with it. At home where there is neither, and at home
when the folder asked for has gone, as Warp and Windows Terminal do rather than refusing
to start. See `startingFolder` in `apps/desktop/src/lib/terminal/spec.ts`.

## A session, not a file

A terminal tab writes nothing to the space and is in no list of files. What it is -
which shell, the folder it was last in, and a key for its last lines - is the tab's own
words, as a new plane's JSON is, so the session, the closed-tab stack and Duplicate carry
it with no field of their own - the one path every tab with no file comes back by. A
duplicate is given a key of its own the first time it is drawn, so two tabs never write
one file.

**After a restart** - the app quit, the window closed, the engine switched, an update
put in place, a crash - it comes back in its place in the strip, under its name, with its
shell, in **the folder it was last in**, with **its last thousand lines** above a fresh
prompt and one dim line between the two saying when they are from: VS Code's revive,
Windows Terminal's restored buffer, Warp's restoration. The folder is the one people miss
when it is lost (Warp and JetBrains both have the complaint), so the shells nib starts are
taught to say it, each in the sequence a terminal already understands, and only where the
reader has not set one up themselves: Command Prompt through `PROMPT` (Windows Terminal's
own recipe, OSC 9;9), PowerShell through a prompt function wrapped around the profile's
own, bash through `PROMPT_COMMAND` (OSC 7), carried into WSL by `WSLENV`. Linux and a Mac
are also asked through the kernel (`/proc`, `proc_pidinfo`) a moment after Enter, which is
how zsh and fish - a Mac's own shell among them, which nothing taught - come back where
they were.

The lines are xterm.js's own serialisation, colours and all, written at the width they
were drawn at and replayed at that width before the pane's fit reflows them, so a long
line that wrapped unwraps again. On a Mac and Linux they stay on the screen above the new
prompt. On Windows they go just above it, into the scrollback, and the line saying when is
the screen's first row: the pseudo console owns every row of the screen it starts on,
knows nothing of lines it did not print, and repaints its own over them the moment a
resize reflows the two apart - which is why VS Code pushes them up too. A thousand, where VS Code keeps a hundred across a
restart: a hundred is a short build log, a thousand is what VS Code keeps while it runs,
and half a million characters at most whatever the lines hold. They are written a couple
of seconds after the output rests, at least every ten seconds while it does not, when the
tab leaves its pane, and as the window goes - which waits for them the way it waits for a
note, whether it is closing, quitting, relaunching on the other engine or handing over to
an update (`lib/terminal/history.ts`).

**What was on a screen is nobody else's.** A screen can hold a token a command echoed, so
the lines are a file per terminal in the app's local data folder, under the space the tab
was opened in (`terminal/<space>/<key>.json`, `src-tauri/src/terminal/history.rs`): never
in a space, never in the webview's storage, never synced, never on the next computer. A
space keeps at most thirty-two, so terminals nobody closed properly do not pile up the way
Windows Terminal's `buffer_*.txt` files did. **Closing a tab** forgets its file at once,
and the window keeps its lines in memory until it goes, for Reopen closed tab. **Settings,
General, Terminal, Restore history** turned off writes nothing and forgets every file
there is at that moment - Warp's switch stops recording and leaves the database where it
was. The tab itself, its shell and its folder still come back, as every tab does.

**Moved to another space** (Move to space, in the tab's menu or the palette, or the tab
carried onto the space switcher; docs/chrome-tabs.md), a terminal is the same tab with the
same shell: the process goes on, its screen and scrollback with it, and its current
folder is the one it was in. What changes is which space it is in - whose set it is in,
where a restart puts it - and where its last lines are kept: read, written under the new
space and forgotten under the old, in that terminal's own turn, so a write on its way
lands first and the next goes to the new place. It is never paused there either way. See
`moveHistory` in `lib/terminal/history.ts`.

**The shell starts when the tab is first on screen**, never before, and after the lines
it had are drawn, so its prompt lands under them: a window put back with ten terminals in
it starts none of them and reads none of their files until one is looked at, which keeps
the launch what it was.

## Its name and its mark

Emil, 2026-10-03: _"I would like to be able to rename terminal tabs too. Usually, e.g. in VS
Code, they infer their name intelligently, e.g. based on the Claude session. Maybe even the
icon?"_

A tab says what runs in it, in VS Code's order (`terminal.integrated.tabs.title`):

1. **a name the reader gave it**, until they clear it;
2. **a title the program running in it set** (OSC 0 or 2) - Claude Code says its
   conversation's topic that way, vim the file it is in. The glyph Claude Code turns in front
   of it every second while it works is left off, so the name stands still;
3. **the program in front, and the folder**: `node · quaestur`;
4. at the prompt, **the shell and the folder**: `PowerShell · quaestur`, or the shell alone
   where no folder is known - which is also what a tab put back by a restart says until it is
   looked at, since nothing runs in it yet.

A title is a program's and never the shell's. Shells set titles too - Command Prompt its own
path and the command line, bash `user@host: ~` at every prompt, the console the program's
path as it starts - and PowerShell never takes a program's title back, which is why Windows
Terminal's tabs go on saying `✳ Claude Code` long after it has gone. So a title counts once a
program is known to be in front, and goes when the program does: at the next prompt mark, when
the shell is found in front again, or when the program blanks it on its way out, as Claude Code
does. In WSL, whose programs Windows cannot list, a title counts from Enter to the next prompt
mark. See `lib/terminal/naming.ts`.

**What is in front** is the crate's answer (`pty_program`, `src-tauri/src/terminal/process.rs`):
on Windows the shell's descendants, walking down through shells to the first that is not one -
VS Code's reading - with an agent a launcher started taking its place (npm's Codex is Node
starting `codex.exe`); on a Mac and Linux the pty's foreground group, named by `/proc` or
`proc_pidpath`. It is asked after Enter, after a title nobody owns yet, and once the output
rests while a program was in front - at most once a second, never per keystroke, never at a
prompt.

**Renaming** is Windows Terminal's: a double click on the tab (a terminal is never a preview,
so the double click is free), F2 on it, or Rename in its menu and the palette put a field over
the name where it is written. Enter or a click away keeps it, Escape leaves it, and an empty
name gives the tab back to whatever runs in it. A pinned tab, which shows no name, asks in the
question sheet instead. The name is in the tab's words (`name` in `lib/terminal/spec.ts`), so a
restart, Reopen closed tab and Move to space carry it; Open another and a split start a fresh,
unnamed terminal. See `lib/terminal/rename.ts` and `lib/tab-strip/TabNameField.svelte`.

**The mark** is the program in front where it has one of its own - Claude Code, Codex, Node,
Python, git, SSH, Docker, Vim and Neovim - and the shell's own otherwise: PowerShell's slanted
prompt, Command Prompt's box, a prompt for bash, zsh, fish and WSL. Lucide's where Lucide has
the thing, drawn on its grid where it has not, all at a file mark's weight and colour: a strip
of terminals reads as a strip of tabs, not a row of logos. Fetched with the first terminal in
the strip (`lib/terminal/TerminalMark.svelte`, `lib/terminal/marks.ts`).

## Another machine

Emil, 2026-10-03: a **Remote** card of its own beside Terminal, a picker of hosts built like
the space switcher, Shift Shift `ssh pi` or just `pi`, and the result a normal terminal tab
running the system's own `ssh`. Studied first: Windows Terminal 1.24's SSH profiles, VS Code's
Remote-SSH explorer, Termius, Tabby, iTerm2 and Warp. What they taught is in the choices below.

**The system's `ssh`, in the pty a shell would have.** Keys, the agent (Windows' own OpenSSH,
`System32\OpenSSH\ssh.exe`, first - the one its agent service speaks to - then the PATH), a
`ProxyJump`, a second factor's prompt and `known_hosts` all work the way they do in any other
terminal, because nothing stands between the reader and `ssh`. nib keeps no password, speaks no
SSH of its own (Termius and Tabby both do, and both differ from the system's on exactly those
four), and puts nothing on the other machine (Warp's wrapper is what its users switch off).

**Where hosts come from.** The reader's `~/.ssh/config`, read and never written - VS Code's Add
host prepends a block to the reader's own file, and the first matching block wins - and hosts
made in nib, kept in the app's local data folder (`remote/hosts.json`), never synced: which
machines a person reaches is this computer's business. The config is read again each time a
list opens, so an edit shows at once (VS Code's explorer needs a reload). What counts as a host
(`src-tauri/src/terminal/ssh_config.rs`):

- a `Host` line's names, the first of them the host and the rest other names it is found by, so
  `Host pi raspberry` is one machine and not two (VS Code lists both);
- never a pattern (`*`, `?`) or a negation (`!`) - settings for many hosts, none to connect to,
  which Windows Terminal's generator lists - and never a `Match` block;
- `Include` followed, which VS Code's explorer does not: relative to `~/.ssh`, `~` for home,
  `*` and `?` in the file's name, sorted as `glob(3)` sorts them, sixteen deep, each file once;
- `HostName`, `User` and `Port` read for the row to say where it is, the first value winning as
  it does for `ssh`.

**Groups** come out of how people already lay the file out: a heading - one comment line on its
own after a blank line, a few words that are not a setting commented out (`## Work ##`, `# Home`)
- groups the hosts under it until the next; hosts in an included file with no heading of their
own are grouped by the file's name, `config.d/work` being `work`. Settings can put any host in a
group of nib's own, which goes before the config's.

**The picker** (`lib/remote/HostPicker.svelte`) is the space switcher's shape: in the middle of
the window, no field, every host numbered, a digit connecting at once where only one host can
be meant, letters finding a host by its name, its other names or its address and waiting for
Enter, Backspace taking one back. The pinned hosts first, then the five connected to most lately
(newest first), then the rest under their groups' names, a line between; when each was last
connected to at the row's end, quietly. An address typed that no host has - `emil@10.0.0.5`,
`box:2222` - is a row of its own, and choosing it keeps it as a host made in nib, the way a
browser keeps what was typed in its history. A digit is always a host's number, so an address
that starts with one is typed into Shift Shift or Settings instead. With no hosts at all the
one row is Add host, which is Settings, Remote. A right click on a host pins it.

**Shift Shift.** Every host is a row of the palette, found by the same names; `ssh` and a
space narrows the palette to the hosts alone, and `ssh user@box` that no host is offers to
connect to it, which keeps it (`lib/palette/mode.ts`, `lib/palette/kinds.ts`).

**The tab** is a terminal tab like any other, whose words name the host as its shell:
`{"shell":"ssh:pi"}`. A host is an id to the window as a shell is: the crate finds `pi` in the
config or `n-...` among the hosts it keeps, and the program, the arguments and the destination
are its own - a host made in nib is held to what a destination can be before it is kept and
again before it is used, and handed to `ssh` after `--`, so nothing the window keeps can be read
as an option (`src-tauri/src/terminal/remote.rs`). So the strip, the session, Reopen closed
tab, Duplicate, a split, Open another and Move to space all carry it with nothing of their own.
It is called by the host's name - a rename still wins - and wears a server in the colour
Settings gave the host (`Tab.running`'s `host` and `colour`; `lib/terminal/naming.ts`). What a
remote shell titles itself and what runs there are not asked: nothing on this side can see it,
and the host is what the tab is.

**A connection that drops** - `ssh` ending with anything but 0 - leaves its lines readable and a
quiet bar at the foot, **Reconnect**, which Enter is too. Never by itself: Tabby's reconnect
loops on a machine that is down. `exit` on the other machine is `ssh` ending with 0, and the tab
closes, as a shell here does. Closing a remote tab while it is connected asks, as macOS Terminal
and iTerm2 count an `ssh` among the jobs that ask: what runs on the other machine cannot be seen
from here, and closing it ends it (`Held::busy` in `src-tauri/src/terminal.rs`).

**After a restart** a remote tab comes back with its last lines, like any terminal, and the same
Reconnect bar under them: a window that comes back should not knock on every machine it once
reached before anybody has looked. A remote tab made in this run - by Remote, a duplicate, a
split - connects as it opens (`madeNow` in `lib/remote/open.ts`).

**Settings, Remote** lists every host in the picker's order: dragged to reorder, or the two
arrows on each row. A row opens the host: its colour (the canvas's six), its group, its pin; for
a host made in nib its name and address too, and Remove; for one of the config, Open config,
which opens the file in the system's text editor (nib never writes it).

**Not now**, written down as the next steps:

- **A remote space over SFTP**: a space whose folder is on another machine, read and written
  through the same `ssh`, so a note on a server is edited where it is. It needs the file
  operations, the watcher and the trash to work through a connection that can drop, which is a
  design of its own.
- **Agent scopes per host**: an agent's `run_terminal` reaching a host the reader allowed, with
  the same list and question it has for a local shell. Until then no agent verb reaches a remote
  terminal.

## An online terminal

A shell on the reader's own machine in the cloud, which goes on when every window is closed:
the design, the machine and the server are docs/online-terminal.md; this is the tab.

**Where one comes from.** A new tab's card on **O**, after Remote, from Ctrl+T or the plus,
the same card in an empty pane, and the palette (_New online terminal_) - on the desktop, a phone and the
browser build alike, since it is the one terminal those two can have. A tab's own menu has
_Open another_ beside it. Signed out, it opens the account sheet; an account not on the list
yet is told so once, in the question sheet, and nothing is made.

**A file, not a session in the tab's words.** It makes `Terminal.term` (`Terminal 2.term`...)
in the space's folder and opens it as a terminal tab whose document is that file
(`openTerm` in `lib/online/open.ts`) - one tab per file, as a PDF has. The file starts
empty: sync gives it its id, and the terminal, as it first connects, asks the account for
the session that id names (`POST /v2/online/terms`), which the account makes on the
reader's own machine the first time, and writes it into the file
(`{"v":1,"machine":"m_...","session":"s_..."}`). So renaming the tab renames the file, Move
to space moves the file and so the session's audience, and a restart puts the tab back as
any tab with a file comes back.

**One seam.** The surface, the keys, find, copy and paste, links and the look are every
terminal's (`sessions.svelte.ts`); only what feeds the screen differs, and that is a
`Source` (`lib/terminal/source.ts`): a pty here, or the socket to the session
(`lib/online/source.ts`, `link.ts`), fetched with the first online terminal and never in
front of the first paint. The socket opens at `/v2/online/<file id>/socket` with the
account's token and the device, says `hello` with the screen's size and the first byte it
has not drawn, and is sent only what it missed - or the whole screen, serialised by the
machine's headless xterm, drawn in place of what is there. A drop comes back by itself,
sooner first and then less often (five seconds apart at most while it is on screen), and at
once when the network comes back or the window is looked at again; a socket that stops
answering is found out within seconds of a key, a wake from sleep or a return to the window
(docs/online-terminal.md 4.14). A refusal that waiting cannot change (no role, not on the
list, the month's hours used) waits for Reconnect instead.

**Its screen at once.** The last screen of the session is cached like a local terminal's
last lines (`history.ts`, under `online-<session>`), drawn dimmed the moment the tab is
looked at while the socket opens, and replaced by the session's own; dimmed again while the
socket is down. Closing the tab keeps the cache - and never asks, since nothing ends: the
session runs on, and so does whatever runs in it.

**Waking.** It connects when it is first on screen, which wakes its machine; a tab put back
by a restart and never looked at knocks on nothing, as a Remote tab does not.

**Its name and its mark.** The file's name, unless it is still the `Terminal` it was made
as: then what runs in it, by the same order as any terminal (`naming.ts`), told by the
machine rather than asked of a kernel. The mark is the program in front's - Claude Code,
Codex, Node... - with a small cloud cut into its corner, and the machine's state as a dot
over the other corner: none while awake, hollow while asleep, turning while it starts,
amber near the month's hours (`TerminalMark.svelte`, `lib/online/marks.svelte.ts`).

**Resume.** When a restart of the machine put back a screen whose program was Claude Code
or Codex, a quiet bar at the foot offers **Resume**, which types `claude --continue` or
`codex resume --last` (`lib/online/resume.ts`); Enter is Resume too. A shell that ended
leaves its screen and the line saying the code, and Enter starts a new shell in the same
session.

**Who may type** is the machine's owner, unless they let the space's writers in; a
socket told it may not type swallows the keys and still shows the screen.

**As if it were here** (docs/online-terminal.md 4.13). Pasting, copying, links and
notifications are every terminal's (below); what the machine adds:

- **A browser that is yours.** The machine has no screen, so `xdg-open`,
  `sensible-browser` and `$BROWSER` there are `nib-open`, which hands the address to the
  machine's owner's nib - on the device that typed in that session last - where it opens
  as a link from this terminal would: a web tab beside it, in front while the terminal is
  what they look at and behind otherwise; the system browser on a phone; and in the browser
  build, where a page may not open a window nobody pressed for, the site's name on the
  quiet bar, one press away. Only web addresses, six a minute. So `gh auth login --web`,
  Claude Code's `/login` and Python's `webbrowser` open the page by themselves.
- **A sign-in's way back.** A provider sends the browser back to the program's own
  listener, `http://localhost:<port>/callback` - on the machine. A tab opened for an address
  that names such a page is watched, and when it lands there, that request is made on the
  machine instead; the tab closes and the terminal is in front again, where the program
  says it is signed in. A phone and the browser build cannot watch a tab, so they leave
  such an address to the one the program prints.
- **Long pastes** go up in frames of at most 64 KB at an even pace, so a whole log pasted
  arrives whole, bracketed as one paste, rather than refused as one frame too large.
- **A picture** pasted for an agent goes up the same way and is written on the machine,
  its path pasted (_Pictures_, below).
- A watcher's clipboard is never written by somebody else's program: OSC 52 reaches only a
  window that may type in the session.

**Settings, Online terminal**: the machine's state with Start or Stop, and the month as one
bar per allowance - hours, CPU, home and the web - with the day it starts again; the hours'
bar turns amber at 80%, as the mark does (`lib/online/OnlinePane.svelte`). The palette has
_Start online machine_ and _Stop online machine_.

**Not yet**, with the seams left for them: the faces of who is watching and the typing dot
(the socket's `people` frame), the cursor in the colour of whoever typed last (`typed`), the
session scaled down to a narrower screen, a phone's pinch and the key row over its keyboard,
a `.term` opened from the file list (the desktop's list shows the kinds a tab can hold, and
`.term` is not among them yet), and Settings' sessions, audit, Download home, Reset and
Delete.

## Closing

- **A tab closing** asks only when something besides the idle shell is running - VS
  Code's rule for a terminal in the editor, iTerm2's _jobs besides_. Windows lists the
  shell's descendants and discounts shells and console hosts; a Mac and Linux ask the pty
  for its foreground process group. A WSL distribution's programs are in the Linux kernel
  and not on Windows' list, so a WSL tab closes without asking. Several busy tabs closing
  together ask once. See `src-tauri/src/terminal/process.rs` and
  `lib/terminal/closing.ts`.
- **The window closing, the app quitting, or an update's restart** asks one question when
  something runs - a busy terminal in any space's set, a connected remote one, an AI turn
  answering (Claude Code and Codex threads among them) - and names each, with its tab's
  mark; macOS Terminal's and Warp's list, Chrome's one question for every window. A row
  goes to it; Cancel stays; Quit anyway goes on; "Don't ask again" is Settings >
  Terminal > Warn before quitting's Never (Always / When something runs / Never). Nothing
  idle is asked about, and the next launch still puts every terminal back with its last
  lines: the question comes before the writes the window waits for. Quit in the tray, a
  Mac's Cmd+Q and the engine's relaunch reach it through the crate, which holds the quit
  while one window asks (`quit` in `src-tauri/src/lifecycle.rs`); the other windows send
  their rows over a broadcast channel. See `lib/quitting`.
- **The shell exiting** by itself: cleanly (`exit`, Ctrl+D) and the tab goes with it; with
  an error and it stays, with a dim line saying the code, and Enter starts it again -
  Windows Terminal's `graceful`.

Nothing outlives its window: a shell ends when its tab goes (whichever way - closed,
closed with others, carried off by a space switch; the sessions watch the tabs rather
than being told), when its window's page loads again, when the window is destroyed, and
when the app exits. On Windows closing the pseudo console sends every console program
still attached to it the close a console window's cross does.

## What a program leaves on

A full-screen program - Claude Code, vim, htop - asks the terminal to report the mouse, to
say when the window gains the keyboard, to send its own codes for the arrows and the
keypad, and to draw on a second screen, and switches all of it off as it leaves. One that
crashes, is killed or is interrupted does not, and the prompt after it had every move of
the mouse typed at it (Emil, 2026-10-01: `C"1C%0C` and on at a PowerShell prompt, after
Claude Code and a restart).

So the shells nib starts mark each prompt with OSC 133;A - FinalTerm's prompt mark, the one
Windows Terminal, iTerm2, kitty and WezTerm read; VS Code's 633;A is read too - in front of
the prompt: Command Prompt through `PROMPT` (in front of the reader's own as well, since the
mark draws nothing), PowerShell in the prompt function, bash in `PROMPT_COMMAND`, WSL through
`WSLENV`. Where a mark arrives, whatever is still on is switched off before the prompt is
drawn, read off the screen as the mark is reached: the mouse in every encoding, focus
reports, held frames, the program's cursor and keypad codes and its second screen.
Bracketed paste stays the shell's own - bash, zsh, fish and PSReadLine switch it on for
each line - and goes only in Command Prompt, which never asks for it. A shell nobody taught
to mark its prompts - zsh, a reader's own bash prompt - is asked for in the kernel instead:
once the output rests with the mouse still reported, and only the mouse and focus go when
the shell is in front again. Never in WSL, whose programs Windows cannot see. Nothing a
running program asked for is touched: the shell only prompts once it is in front. See
`lib/terminal/modes.ts`.

A screen written down for a restart is its lines and colours and never its modes, and a
screen put back starts with every mode off, whatever an older build wrote down.

## Keys, copying, links, finding

The keys are in docs/keyboard.md, under _A terminal_, and the rule is
`lib/terminal/keys.ts`: the tab, window and palette keys are the app's, as VS Code's skip
list has them, and everything else is the shell's - **Ctrl+W above all**, which deletes a
word, as it does in every terminal there is. Cmd+W closes the tab on a Mac.

- **Copy** on select, and Ctrl+Shift+C; **paste** with Ctrl+Shift+V, Shift+Insert, Ctrl+V
  on Windows (Windows Terminal's), Cmd+C and Cmd+V on a Mac. **Ctrl+C is always the
  interrupt.** A right click is the terminal's own menu: Copy, Paste, Select all, Find,
  Clear.
- A paste of **several lines asks first** when the shell has no bracketed paste - the one
  case where each line would run as it lands; VS Code's `auto`. A single line loses the
  whitespace after it, Windows Terminal's `trimPaste`, so a command copied with its line
  break does not run before anybody has looked at it. See `lib/terminal/paste.ts`.
- **A program writing the clipboard** (OSC 52: vim's and tmux's yank, Claude Code's copy,
  anything over SSH or on an online machine) puts its text on the clipboard - writing
  only, as Windows Terminal, kitty, Alacritty and WezTerm have it: a program asking to
  read the clipboard is never answered, since that would hand whatever was copied last to
  whatever printed the question. And only while the terminal is on screen in the window
  that has the keyboard. See `lib/terminal/signals.ts`.
- **A program asking to be looked at** - OSC 9 (iTerm2's), OSC 777 `notify` (Ghostty's,
  WezTerm's) or the bell - is a notification of the system's, named by the tab, while the
  terminal is not what the person is looking at, and nothing when it is; one every four
  seconds at most. Claude Code sends one when its notification channel is set to iTerm2
  or Ghostty (`/config`), Codex with `tui.notifications`. In the browser build a press on
  it brings the tab forward.
- **Links**: an address in the output is underlined under the pointer, and Ctrl+click
  (Cmd on a Mac) opens it in a web tab beside the terminal by `new-tab.ts`'s rule - behind,
  and in front with Shift. A plain click is the terminal's own: it is how a line is
  selected. An address a program broke over rows itself, as Ink does with Claude Code's
  sign-in link, is still one link: a row full to its last column runs on into the next
  when that goes on in address characters (iTerm2's right-edge heuristic), and copying
  part of it drops the breaks. A link the program marked (OSC 8) is followed the same
  way. Local and online terminals alike; see `lib/terminal/links.ts`.
- **A row of the file list** dropped on a terminal is its path at the prompt, spelled for
  the shell: quoted where it has a space, `/mnt/c/...` in WSL and `/c/...` in Git Bash -
  VS Code's drop into its terminal. See `spokenPath` in `lib/terminal/paste.ts`.
- **Pictures**, for a coding agent (Emil, issue 228: _"inserting images into claude session
  with alt + v should also work"_). Claude Code pastes an image by reading the clipboard
  itself when its key is pressed - Alt+V on Windows, through PowerShell; Ctrl+V on Linux
  and a Mac, through `xclip`, `wl-paste` or `osascript` - and Codex the same. In a terminal
  on this computer the key only has to arrive: Alt and a letter is the shell's, ESC and the
  letter, which ConPTY hands a Windows program as the Alt chord Windows Terminal's would be,
  and Ctrl+V is the shell's off Windows. On another machine, a Remote host or the online
  one, the clipboard the agent reads is that machine's, which is empty. So there the
  picture is **carried over**: written to a file in that user's cache
  (`~/.cache/nib/images`) and pasted as its path, which an agent takes as an image the way
  it takes one dragged onto a terminal - VS Code Remote's answer to the same. Three ways in,
  each one a terminal already has: the agent's key with a picture on the clipboard (with
  none, the key goes to the shell as it would have); a paste with a picture and no text
  (Ctrl+V on Windows, Ctrl+Shift+V, Shift+Insert, Cmd+V, the menu); and a picture's row of
  the file list dropped on it. PNG, JPEG, GIF and WebP, 16 MB at most. The line across the
  top of the panes sweeps while it goes and says _Could not send the image_ where it could
  not. A Remote host is reached by a second `ssh` of the tab's own, in `BatchMode`, so a
  key, the agent or a shared connection (`ControlMaster`) is enough, and a host that only
  takes a password refuses at once (`src-tauri/src/terminal/picture.rs`); the online
  machine takes it up the terminal's own socket (docs/online-terminal.md 4.13). See
  `lib/terminal/images.ts`.
- **Find**: Ctrl+F, in nib's find bar, painting what it finds the way a note's find does.
- **Scrollback**: five thousand lines. VS Code keeps a thousand and Windows Terminal about
  nine; five is a long build log at a few megabytes a terminal.

## The look

The note's ground and ink, the accent as the cursor (a bar, as the editor's caret is, an
outline while the window is elsewhere), the selection every surface draws, and the
sixteen colours out of the canvas's six and the syntax blue, in whichever scheme the app
is in, following a theme as it changes. A program that asks for white on a light ground
is rescued by a minimum contrast of 4.5 to one, WCAG's AA, VS Code's default. The type is
the app's monospace, the one a code block is set in. Wide characters and emoji are
measured by Unicode 11, and an input method composes in xterm.js's own field. The
renderer is xterm.js's DOM one: WebGL is what crashes a tab on this machine's GPU for a
big texture, and a terminal is no reason to risk it. See `lib/terminal/look.ts`.

## Who may

A shell can do anything the person at the keyboard can, so:

- **Only the app's own windows** reach the commands. The crate checks that the webview is
  the page of a document window (`main`, `nib-2`...) - never a web tab's page, never the
  presenter's window, never anything a site opened - and a remote origin is refused
  before that by Tauri. See `src-tauri/src/terminal.rs`.
- **A session belongs to the window that started it**; no other can type into it, size
  it, read it or end it.
- **A shell is an id** the crate itself found. The window cannot name a program, an
  argument or a variable of its own.
- **No verb of the command line and no `nib://` link** reaches a terminal. _New
  terminal_ is a row the command line may not run (`ownWindow` in
  `apps/desktop/src/lib/commands.ts`, refused by `runCommand` in
  `apps/desktop/src/lib/automation/acts.ts` on both roads), and it is left out of the list
  the command line is given.
- **An agent's `run_terminal`** is the one verb that does (docs/agent-native.md 8.9): a
  scope of its own that no agent holds unless the reader grants it, a question to the
  reader for any line whose program is not on the agent's own list or that starts more
  than one (`;`, `&`, `|`, `>`, a backtick, `$(`), a shell the crate found started in a
  folder of a space the agent reaches, and no tab: the line and `exit` are typed into a
  session nobody is shown, and what it printed comes back. See
  `apps/desktop/src/lib/agents/workspace/terminal.ts`.
- `eval`, which is off until the installation's own `automation.json` turns it on, is the
  window itself, and so reaches what the window reaches - a terminal included, as it
  reaches every note. That is what turning it on means; see docs/automation.md. The probe
  below drives a terminal through it.

## The engine

`src-tauri/src/terminal.rs`, over wezterm's `portable-pty`: ConPTY on Windows - on ARM as
on Intel, since it is kernel32's own - and the system's pty on a Mac and Linux. One
session per tab, and four threads each (`terminal/session.rs`):

- the **reader** takes what the shell prints into a buffer, and stops while more than a
  megabyte is out that the window has not drawn, so a flood waits for the screen;
- the **sender** hands the buffer over at most once a frame, and at once after a quiet
  frame, as raw bytes on a Tauri channel - a keystroke's echo is never held back, and a
  flood is sixty messages a second rather than one per read;
- the **writer** puts keystrokes in, in order, from a queue, so `pty_write` never waits;
- the **waiter** takes the exit code and closes the terminal, which on Windows is what
  lets the reader reach the end of what the console had left to say.

The window acknowledges what it has drawn (`pty_seen`), sends its size (`pty_resize`),
and sends keystrokes one call at a time with whatever arrived meanwhile going with the
next, so a paste is one call and nothing overtakes anything. A process's _ignore Ctrl+C_
flag is inherited on Windows, and a launcher that starts nib in a group of its own would
have handed it to every shell; nib clears its own before the first shell, which a window
with no console loses nothing by.

In the window: `lib/terminal/sessions.svelte.ts` keeps each tab's screen - xterm.js in an
element of its own - alive while its pane is taken apart and made again, so switching
back finds it running. xterm.js and its addons are fetched with the first terminal, behind
`terminalSurface` in `lib/surfaces.svelte.ts`; nothing of it is in front of the first
paint, and the list of kinds left the first paint to make room for the kind (see
test/weight.test.ts).

## Not done, and why

- **Profiles of one's own**, with arguments, variables and icons. The shells found are
  the profiles; Windows Terminal's settings file is a product of its own.
- **Running as Administrator.** Elevated and unelevated consoles cannot share a window on
  Windows; Windows Terminal opens a second one.
- **Shell integration** past the folder and the prompt mark: marks by each command, sticky
  scroll, command decorations.
- **A colour per tab.** A remote terminal wears its host's colour (above); a local shell has
  none, since nothing about it says one.
- **Paths as links**, and the screen reader mode.
- **A shell that survives a restart.** iTerm2 runs every session inside a server of its
  own and VS Code every terminal inside a pty host, so a crash or an upgrade reconnects to
  the running shell. Every restart nib has - a crash, an update (the installer takes the
  process down), the engine switch's relaunch - ends the one process that holds the
  pseudo consoles, and a console ends with its owner; keeping shells alive would be a
  second long-lived program with the rules under _Who may_ proved again across a pipe to
  it. The one event the crate outlives is the page loading again, which in a release is
  only the Reload of a pane that failed, so a reload starts fresh shells too. A restart
  here starts a fresh shell where the old one was, under what it had printed.

## Where the code is

|                                                    |                                                                                                                                                                                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src-tauri/src/terminal.rs`           | the commands, who may call them, and every way a session ends                                                                                                                                                                    |
| `apps/desktop/src-tauri/src/terminal/shells.rs`    | which shells there are, how each starts and how it says its folder                                                                                                                                                               |
| `apps/desktop/src-tauri/src/terminal/session.rs`   | one shell in one pty, and its four threads                                                                                                                                                                                       |
| `apps/desktop/src-tauri/src/terminal/process.rs`   | whether anything besides the shell runs, and where it is                                                                                                                                                                         |
| `apps/desktop/src/lib/new-kinds.ts`                | the terminal as a kind a new tab can be, and its chevron                                                                                                                                                                         |
| `apps/desktop/src/lib/terminal/two-ways.ts`        | Ctrl+T and Ctrl+N in a terminal, which are both the app's and the shell's: asked once, and the answer kept (docs/keyboard.md, _A terminal_) |
| `apps/desktop/src/lib/terminal/open.ts`            | making one: which shell, which folder, where in the strip                                                                                                                                                                        |
| `apps/desktop/src/lib/terminal/spec.ts`            | what a terminal tab's words say, and where one starts                                                                                                                                                                            |
| `apps/desktop/src/lib/terminal/sessions.svelte.ts` | the screens and their shells                                                                                                                                                                                                     |
| `apps/desktop/src/lib/terminal/TerminalTab.svelte` | the surface in a pane                                                                                                                                                                                                            |
| `apps/desktop/src/lib/terminal/keys.ts`            | which keys the app has                                                                                                                                                                                                           |
| `apps/desktop/src/lib/terminal/signals.ts` | what a program says to the terminal: the clipboard (OSC 52) and a notification (OSC 9, OSC 777, the bell) |
| `apps/desktop/src/lib/online/opening.svelte.ts` | an address the machine asked a browser for: where it opens, and a sign-in's way back |
| `services/machine/nib-open`, `services/machine/src/opener.ts` | the machine's browser: `xdg-open` and `$BROWSER`, and nibd's endpoint for them |
| `apps/desktop/src/lib/terminal/paste.ts`           | what a paste becomes                                                                                                                                                                                                             |
| `apps/desktop/src/lib/terminal/images.ts` | a picture into a terminal on another machine: carried over, and its path pasted |
| `apps/desktop/src-tauri/src/terminal/picture.rs` | a picture carried to a Remote host, through a second `ssh` |
| `apps/desktop/src/lib/terminal/modes.ts` | what a program left on, switched off where the prompt begins |
| `apps/desktop/src/lib/terminal/look.ts`            | the colours and the type                                                                                                                                                                                                         |
| `apps/desktop/src/lib/terminal/source.ts` | where a screen is fed from: a pty, or an online session's socket |
| `apps/desktop/src/lib/online/` | an online terminal: making one, its socket, its machine, Resume, Settings |
| `apps/desktop/src/lib/terminal/naming.ts` | what a tab is called and what it wears, out of what runs in it |
| `apps/desktop/src/lib/terminal/rename.ts` | a name of the reader's own, given and given back |
| `apps/desktop/src-tauri/src/terminal/remote.rs` | another machine: which host an id names, `ssh` started for it, and the hosts nib keeps |
| `apps/desktop/src-tauri/src/terminal/ssh_config.rs` | the reader's ssh config, read: hosts, includes, groups |
| `apps/desktop/src/lib/remote/hosts.ts` | the hosts as one list: the picker's order, an address typed, what Settings changes |
| `apps/desktop/src/lib/remote/HostPicker.svelte` | Remote's picker in the middle of the window |
| `apps/desktop/src/lib/remote/RemotePane.svelte` | Settings, Remote |
| `scripts/remote-probe.py` | a remote terminal driven against `scripts/fake-ssh.py`, never a real machine: the arguments `ssh` is given, the host's name on the tab, a dropped connection and Reconnect |
| `apps/desktop/src/lib/terminal/history.ts`         | the last lines, between runs: how much, when, and a closed tab's                                                                                                                                                                 |
| `apps/desktop/src-tauri/src/terminal/history.rs`   | where they are kept, a file per terminal, and how many                                                                                                                                                                           |
| `apps/desktop/src/lib/terminal/shells.svelte.ts`   | the shells found, and the four settings                                                                                                                                                                                          |
| `apps/desktop/src/lib/terminal/closing.ts`         | the question before a busy tab closes                                                                                                                                                                                            |
| `apps/desktop/src/lib/quitting/`                   | the question before the window closes or the app quits or restarts: what runs, in every window, and the sheet that names it |
| `scripts/quit-warning-probe.py`                    | quitting driven: the busy terminal named and the idle one not, Cancel and a row keep the app, Quit anyway ends it, and both terminals come back |
| `scripts/terminal-probe.py`                        | the packaged app driven: Command Prompt and PowerShell answer, a resize reaches the shell, Ctrl+C interrupts, Ctrl+T asks whose it is and Ctrl+W goes to the shell, a restart puts the terminal back, and no shell outlives its tab or the app |
| `scripts/terminal-restore-probe.py` | a restart driven: the lines written as the window goes and read back by the next launch, the fresh shell in the folder the old one was in, the tab in its place, and a closed tab leaving nothing on the disk |
| `scripts/terminal-modes-probe.py` | a program that leaves the mouse reported: the prompt after it, and the one a restart put back, get nothing typed at them when the mouse moves |
| `scripts/terminal-names-probe.py` | a tab's name driven: the shell and its folder at the prompt, `node` in front and its mark, a program's title and not after it, a name given by a double click and by F2, given back, and kept through a restart |
