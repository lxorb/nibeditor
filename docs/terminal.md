# The terminal

A shell in a tab, beside the notes: run the build a note is about, `git` the space, try
the command a note describes, without leaving the window. Emil, 2026-09-30: _"add
terminal as a new type of thing that you can open when creating a new tab (e.g. like page
note, canvas, ...). if there are different kinds of terminals (e.g. cmd, powershell or
whatever there is), then you should be able to choose"_.

It is built to what Windows Terminal, VS Code's terminal, iTerm2, Warp and JetBrains'
terminal already taught everybody's hands, and where they disagree it says which it
follows and why. A desktop's alone: a phone has no shell to give an app, a page in a
browser has no machine under it, and the glasses' plugin never carries any of it.

## Where one comes from

- **The plus** in the tab strip: _New terminal_, the last row. The chevron at the end of
  the row, or the right arrow on it, lists every shell instead, with the default ticked -
  VS Code's `+ ˅` in one row.
- **Ctrl+T**: the fifth card, on **R** (T is the chord's own step, and R is what Run has
  been on Windows for thirty years). The chevron in the card's corner, or Shift held with
  R, Enter or a click, lists the shells.
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

## Closing

- **A tab closing** asks only when something besides the idle shell is running - VS
  Code's rule for a terminal in the editor, iTerm2's _jobs besides_. Windows lists the
  shell's descendants and discounts shells and console hosts; a Mac and Linux ask the pty
  for its foreground process group. A WSL distribution's programs are in the Linux kernel
  and not on Windows' list, so a WSL tab closes without asking. Several busy tabs closing
  together ask once. See `src-tauri/src/terminal/process.rs` and
  `lib/terminal/closing.ts`.
- **The window closing, or the app quitting**, never asks, which is VS Code's default:
  the next launch puts every terminal back. A tab closing takes its lines with it; see
  above.
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
- **Links**: an address in the output is underlined under the pointer, and Ctrl+click
  (Cmd on a Mac) opens it in a web tab beside the terminal by `new-tab.ts`'s rule - behind,
  and in front with Shift. A plain click is the terminal's own: it is how a line is
  selected.
- **A row of the file list** dropped on a terminal is its path at the prompt, spelled for
  the shell: quoted where it has a space, `/mnt/c/...` in WSL and `/c/...` in Git Bash -
  VS Code's drop into its terminal. See `spokenPath` in `lib/terminal/paste.ts`.
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
paint, and the plus's list itself left the first paint to make room for the kind (see
test/weight.test.ts).

## Not done, and why

- **Profiles of one's own**, with arguments, variables and icons. The shells found are
  the profiles; Windows Terminal's settings file is a product of its own.
- **Running as Administrator.** Elevated and unelevated consoles cannot share a window on
  Windows; Windows Terminal opens a second one.
- **OSC 52**, a program writing the clipboard. Useful over SSH, and a way for anything
  printed to a terminal to put text on the clipboard.
- **Shell integration** past the folder and the prompt mark: marks by each command, sticky
  scroll, command decorations.
- **Titles the shell sets.** Command Prompt sets its own path as the title; the tab says
  the shell's name, as VS Code's does by default.
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
| `apps/desktop/src/lib/terminal/open.ts`            | making one: which shell, which folder, where in the strip                                                                                                                                                                        |
| `apps/desktop/src/lib/terminal/spec.ts`            | what a terminal tab's words say, and where one starts                                                                                                                                                                            |
| `apps/desktop/src/lib/terminal/sessions.svelte.ts` | the screens and their shells                                                                                                                                                                                                     |
| `apps/desktop/src/lib/terminal/TerminalTab.svelte` | the surface in a pane                                                                                                                                                                                                            |
| `apps/desktop/src/lib/terminal/keys.ts`            | which keys the app has                                                                                                                                                                                                           |
| `apps/desktop/src/lib/terminal/paste.ts`           | what a paste becomes                                                                                                                                                                                                             |
| `apps/desktop/src/lib/terminal/modes.ts` | what a program left on, switched off where the prompt begins |
| `apps/desktop/src/lib/terminal/look.ts`            | the colours and the type                                                                                                                                                                                                         |
| `apps/desktop/src/lib/terminal/history.ts`         | the last lines, between runs: how much, when, and a closed tab's                                                                                                                                                                 |
| `apps/desktop/src-tauri/src/terminal/history.rs`   | where they are kept, a file per terminal, and how many                                                                                                                                                                           |
| `apps/desktop/src/lib/terminal/shells.svelte.ts`   | the shells found, and the two settings                                                                                                                                                                                           |
| `apps/desktop/src/lib/terminal/closing.ts`         | the question before a busy tab closes                                                                                                                                                                                            |
| `scripts/terminal-probe.py`                        | the packaged app driven: Command Prompt and PowerShell answer, a resize reaches the shell, Ctrl+C interrupts, Ctrl+T and Ctrl+W go where they should, a restart puts the terminal back, and no shell outlives its tab or the app |
| `scripts/terminal-restore-probe.py` | a restart driven: the lines written as the window goes and read back by the next launch, the fresh shell in the folder the old one was in, the tab in its place, and a closed tab leaving nothing on the disk |
| `scripts/terminal-modes-probe.py` | a program that leaves the mouse reported: the prompt after it, and the one a restart put back, get nothing typed at them when the mouse moves |
