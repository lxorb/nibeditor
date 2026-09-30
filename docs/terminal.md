# The terminal

A shell in a tab, beside the notes: run the build a note is about, `git` the space, try
the command a note describes, without leaving the window. Emil, 2026-09-30: *"add
terminal as a new type of thing that you can open when creating a new tab (e.g. like page
note, canvas, ...). if there are different kinds of terminals (e.g. cmd, powershell or
whatever there is), then you should be able to choose"*.

It is built to what Windows Terminal, VS Code's terminal, iTerm2, Warp and JetBrains'
terminal already taught everybody's hands, and where they disagree it says which it
follows and why. A desktop's alone: a phone has no shell to give an app, a page in a
browser has no machine under it, and the glasses' plugin never carries any of it.

## Where one comes from

- **The plus** in the tab strip: *New terminal*, the last row. The chevron at the end of
  the row, or the right arrow on it, lists every shell instead, with the default ticked -
  VS Code's `+ ˅` in one row.
- **Ctrl+T**: the fifth card, on **R** (T is the chord's own step, and R is what Run has
  been on Windows for thirty years). The chevron in the card's corner, or Shift held with
  R, Enter or a click, lists the shells.
- **An empty pane**: the same card.
- **The palette**: *New terminal*.
- **A row of the file list**: *Open in terminal*, in the row's folder - VS Code's *Open
  in Integrated Terminal*, Explorer's *Open in Terminal*.
- **A terminal's own tab**: *Open another*, beside it in the same folder; the chevron
  lists the other shells.
- **Split right, Split down** on a terminal's tab: another shell in the new pane, in the
  same folder, since the panes are nib's own.

## Which shell

Found once, the first time a chooser needs them - never at launch, because finding the
WSL distributions costs a process - and the same list after that
(`src-tauri/src/terminal/shells.rs`):

| Windows | PowerShell 7 when it is installed, Windows PowerShell, Command Prompt, Git Bash where Git for Windows is, each WSL distribution (Docker's own two left out, as VS Code does), and the Developer Command Prompt and Developer PowerShell of every Visual Studio, for this machine's own architecture |
| --- | --- |
| macOS, Linux | the reader's own `$SHELL`, then everything else `/etc/shells` lists that is really there, named by the program and by the whole path where two share a name. A Mac starts them as login shells, as Terminal does, for the PATH |

The first is the platform's default and what a new terminal opens with, until
**Settings, General, Terminal, Shell** says otherwise. The same group has the **Text
size**, which Ctrl+=, Ctrl+- and Ctrl+0 change from inside a terminal too. Both are this
machine's and never go to the account: a shell is a program on one computer.

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
it with no field of their own.

**After a restart** it comes back in its place, with its shell, in **the folder it was
last in**, with **its last hundred lines** above a fresh prompt: VS Code's revive, Warp's
restoration. The folder is the one people miss when it is lost (Warp and JetBrains both
have the complaint), so the shells nib starts are taught to say it, each in the sequence
a terminal already understands, and only where the reader has not set one up themselves:
Command Prompt through `PROMPT` (Windows Terminal's own recipe, OSC 9;9), PowerShell
through a prompt function wrapped around the profile's own, bash through
`PROMPT_COMMAND` (OSC 7), carried into WSL by `WSLENV`. Linux is also asked through
`/proc`. The lines are kept for the dozen terminals written most recently
(`lib/terminal/lines.ts`); a hundred is VS Code's number, and enough to read what failed
without every command anybody typed sitting in the app's storage.

**The shell starts when the tab is first on screen**, never before: a window put back
with ten terminals in it starts none of them until one is looked at, which keeps the
launch what it was.

## Closing

- **A tab closing** asks only when something besides the idle shell is running - VS
  Code's rule for a terminal in the editor, iTerm2's *jobs besides*. Windows lists the
  shell's descendants and discounts shells and console hosts; a Mac and Linux ask the pty
  for its foreground process group. A WSL distribution's programs are in the Linux kernel
  and not on Windows' list, so a WSL tab closes without asking. Several busy tabs closing
  together ask once. See `src-tauri/src/terminal/process.rs` and
  `lib/terminal/closing.ts`.
- **The window closing, or the app quitting**, never asks, which is VS Code's default:
  the next launch puts every terminal back.
- **The shell exiting** by itself: cleanly (`exit`, Ctrl+D) and the tab goes with it; with
  an error and it stays, with a dim line saying the code, and Enter starts it again -
  Windows Terminal's `graceful`.

Nothing outlives its window: a shell ends when its tab goes (whichever way - closed,
closed with others, carried off by a space switch; the sessions watch the tabs rather
than being told), when its window's page loads again, when the window is destroyed, and
when the app exits. On Windows closing the pseudo console sends every console program
still attached to it the close a console window's cross does.

## Keys, copying, links, finding

The keys are in docs/keyboard.md, under *A terminal*, and the rule is
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
- **No verb and no `nib://` link** reaches a terminal. *New terminal* is a row the
  command line may not run (`ownWindow` in `apps/desktop/src/lib/commands.ts`, refused by
  `runCommand` in `apps/desktop/src/lib/automation/acts.ts` on both roads), and it is left
  out of the list the command line is given.
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
next, so a paste is one call and nothing overtakes anything. A process's *ignore Ctrl+C*
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
- **Shell integration** past the folder: marks by each command, sticky scroll, command
  decorations.
- **Titles the shell sets.** Command Prompt sets its own path as the title; the tab says
  the shell's name, as VS Code's does by default.
- **Paths as links**, and the screen reader mode.
- **A shell that survives a restart**, which is VS Code reconnecting to a process it kept
  in a host of its own. A restart here starts a fresh shell where the old one was.

## Where the code is

| | |
| --- | --- |
| `apps/desktop/src-tauri/src/terminal.rs` | the commands, who may call them, and every way a session ends |
| `apps/desktop/src-tauri/src/terminal/shells.rs` | which shells there are, how each starts and how it says its folder |
| `apps/desktop/src-tauri/src/terminal/session.rs` | one shell in one pty, and its four threads |
| `apps/desktop/src-tauri/src/terminal/process.rs` | whether anything besides the shell runs, and where it is |
| `apps/desktop/src/lib/new-kinds.ts` | the terminal as a kind a new tab can be, and its chevron |
| `apps/desktop/src/lib/terminal/open.ts` | making one: which shell, which folder, where in the strip |
| `apps/desktop/src/lib/terminal/spec.ts` | what a terminal tab's words say, and where one starts |
| `apps/desktop/src/lib/terminal/sessions.svelte.ts` | the screens and their shells |
| `apps/desktop/src/lib/terminal/TerminalTab.svelte` | the surface in a pane |
| `apps/desktop/src/lib/terminal/keys.ts` | which keys the app has |
| `apps/desktop/src/lib/terminal/paste.ts` | what a paste becomes |
| `apps/desktop/src/lib/terminal/look.ts` | the colours and the type |
| `apps/desktop/src/lib/terminal/lines.ts` | the last lines, between runs |
| `apps/desktop/src/lib/terminal/shells.svelte.ts` | the shells found, and the two settings |
| `apps/desktop/src/lib/terminal/closing.ts` | the question before a busy tab closes |
| `scripts/terminal-probe.py` | the packaged app driven: Command Prompt and PowerShell answer, a resize reaches the shell, Ctrl+C interrupts, Ctrl+T and Ctrl+W go where they should, a restart puts the terminal back, and no shell outlives its tab or the app |
