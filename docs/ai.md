# AI

nib asks models. It does not sell you one.

Every provider is yours: you add it, you give it a key, an address or your own
plan, and the requests go from your device straight to it. The account is not in
the path, the question is not logged, and the key never leaves the machine it was
typed on.

Four surfaces use it, and they all go through one module:

- the ```` ```ai ```` block in a note, whose answer is written under it,
- the four rewrites on a selection,
- the Ask panel on the right side of the window, which answers questions about
  your notes and says where each answer came from,
- and a meeting's summary, written under its transcript.

Each asks the default provider unless Settings > AI > **Used for** gives it one of its
own: a plan for questions about the notes and a fast model on this machine for
rewrites, say. `ai.providerFor(feature)` in `store.svelte.ts` is that choice, and
`complete()` is the one request; together they are the seam, and nothing else asks a
model.

A fifth surface asks a different question of the same providers: a recording, as words.
See **Sound, as words** below.

## Your own plan

A Claude or ChatGPT plan you already pay for can answer all four, on the desktop app,
by the roads their makers allow and no other. What each maker says, and so what nib
does and does not do. **Read this before changing any of it**: the obvious "improvement"
- reusing the token a CLI keeps, or pasting a setup token into nib - is the one thing
both of these pages rule out.

### Claude: the reader's own Claude Code

Anthropic, [Legal and compliance, "Authentication and credential
use"](https://code.claude.com/docs/en/legal-and-compliance), checked 2026-09-30:

> Anthropic does not permit third-party developers to offer Claude.ai login into their
> own applications, or to route requests through Free, Pro, or Max plan credentials on
> behalf of their users. Moreover, developers may not collect, store, or intermediate
> Claude.ai credentials or session tokens - sign-in to a Claude account must complete
> through Anthropic's own flow.

The same page does "not prevent an end user from signing in to the unmodified Claude
Code binary with their own Claude subscription", and running Claude Code inside a
product ("Can customers offer Claude Code in their products?") asks three things: the
product's maker agrees to Anthropic's Commercial Terms, the binary is unmodified with no
auth method removed, and every end user signs in with their own credentials.

So nib runs the Claude Code **the reader installed**, as it is, headless (`claude -p
--output-format stream-json`), with the question on stdin. The reader signs in through
Claude Code's own login (`claude auth login`), which **Sign in** types into a nib
terminal tab for them. nib never reads `~/.claude`, the keychain entry or any token, and
knows whether somebody is signed in only because `claude auth status --json` says so.
What OpenClaw and others did - reuse the CLI's stored token, or take a `claude
setup-token` and keep it - is exactly the collecting and intermediating the quote
forbids, and is not built. OpenCode had its Claude Pro and Max support taken out after
Anthropic's lawyers asked.

The first of the three conditions is a decision about the release, not the code: the
Claude Code row is behind a build switch, on by default, off with `NIB_CLAUDE_CODE=off`
(read by `vite.config.ts` as `__CLAUDE_CODE__` and by the crate in `ai_cli.rs`).

### ChatGPT: Sign in with ChatGPT, or the reader's own Codex

OpenAI, [ChatGPT plan usage](https://developers.openai.com/siwc/token-sharing-open-source),
checked 2026-09-30: an open-source app may "request permission to use the user's ChatGPT
plan for eligible Responses API requests"; "If you're interested in offering it in a paid
or remotely hosted app, complete the interest form." nibeditor is open source and free,
and the desktop app is hosted on the reader's own machine, so the desktop app offers
**ChatGPT**: **Continue with ChatGPT** opens the browser on OpenAI's own sign-in, which
registers this installation the documented way (`client_id=dynamic_agent_client`, the
installation's `ext_agent_host_id`, `agent_name_hint=nibeditor`, PKCE, a loopback
callback on `127.0.0.1`), and questions go to `api.openai.com/v1/responses` with the token
it hands back - [sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in),
[models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference),
[preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
The web app at nibeditor.com is remotely hosted and does not offer it. Never the Codex
CLI's own client id, and never `chatgpt.com/backend-api`: that is the route tools used
before this existed, and it is somebody else's identity.

The refresh token is kept in the keychain under a name the page's own `secret_read`
refuses, so the webview only ever holds the hour's access token; the crate refreshes it,
one refresh at a time, and **Sign out** revokes it. See `src-tauri/src/chatgpt.rs`.

**Codex** is the other road, and the same shape as Claude Code: the reader's own Codex
CLI, `codex exec --json` with the question on stdin, signed in with `codex login` in a
terminal tab, its state from `codex login status`. It answers a message at a time rather
than word by word, which is how `exec` prints.

### What a program is run with

Fixed in the crate (`src-tauri/src/ai_cli/args.rs`); the page names a tool, a model and a
question, never an argument:

- **Claude Code**: no tools (`--tools ""`), none of the reader's MCP servers
  (`--strict-mcp-config`), nothing written to its history (`--no-session-persistence`),
  and where the installed version has them, `--safe-mode` (no hooks, plugins or
  `CLAUDE.md`, sign-in and model as always) and `--permission-prompts none`. nib's own
  one-line system prompt replaces the coding agent's.
- **Codex**: `--sandbox read-only`, the shell tool, web search and MCP servers off,
  `AGENTS.md` unread, `--ephemeral` and `--ignore-user-config` where it has them.
- Both: started with no console window and none of nib's handles, in an empty folder of
  the app's own (never a space), for at most five minutes, and ended with everything
  they started - a job object on Windows, a process group elsewhere - on a stop, when
  their window goes and when nib quits. A reload leaves a running answer to finish or
  time out unread.

The Ask panel hands a question the passages it found itself, so no feature needs a
program to read the notes. One that ever does gets nib's own MCP server (`nib mcp`) with
the grant Settings > Agents gives it, never a folder.

### Honest about whose plan it is

The row says which plan the program or OpenAI says it is signed in with (Max, Pro,
ChatGPT), and **Using ChatGPT plan** under the ChatGPT one, as OpenAI's guidelines ask. A
plan near its limit says so on its row; one at its limit is said in nib's words wherever
the question was asked - "Your Claude plan is at its limit until 15:05." - with when it
resets where Claude Code's `rate_limit_event` or Codex's message said, and **Manage
usage** on the row goes to the plan's own page.

## Providers

Settings > AI. Six kinds, the three plans on a desktop only:

| Kind | What it needs | Where the models come from |
| --- | --- | --- |
| Claude Code | Claude Code installed and signed in | the program's own default, or a name typed |
| ChatGPT | Continue with ChatGPT | the plan's own catalogue, `api.openai.com/v1/models` |
| Codex | Codex installed and signed in | the program's own default, or a name typed |
| Claude | An Anthropic API key | `api.anthropic.com/v1/models` |
| OpenAI | An OpenAI API key | `api.openai.com/v1/models` |
| OpenAI-compatible | A base URL, and a key if the server wants one | `<base>/v1/models` |

One of each but the last, because there is one of each API, key, program and plan.
As many compatible ones as you have servers: Ollama on this machine,
LM Studio beside it, OpenRouter behind both, a gateway at work. Each gets a name
so the list reads as what they are.

Claude Code and Codex are found where their installers put them - the `PATH`,
`~/.local/bin`, npm's global folder, Homebrew, Bun, Volta, mise, and on a Mac and Linux
the `PATH` of the reader's login shell, asked once - because an app opened from the Dock
does not have the terminal's `PATH`, which is where other apps doing this lose people.
Not found, the row offers **Install**, the maker's own page, and **Check again**.

The base URL is forgiving about `/v1`. `http://localhost:11434`,
`http://localhost:11434/v1` and `http://localhost:11434/v1/` are the same
server; nib adds exactly one `/v1` and never two.

It is also forgiving about how you spell this machine. `http://127.0.0.1:11434`
and `http://[::1]:11434` are rewritten to `http://localhost:11434`, which is the
same server to every network stack and a different host to a content security
policy. nib's policy names `http://localhost:*` and no other plain-http origin,
on purpose: plain http to this machine is what a local model is, and plain http
to anywhere else is what the policy exists to forbid. Without the rewrite, an
address typed with digits would be refused by the webview before it left, and the
only trace would be a line in a console nobody typing into a settings field would
think to open. See `src/csp.ts`.

The model list is fetched, never written down. A table of model names in the
source is wrong within weeks, and a model on your own machine has a name only
your machine knows. Press **List models** and nib asks. That press is also the
first thing that tells you a key works.

One provider is the default. It is the one a block and a rewrite use without
being asked; the others are there to be switched to.

### The account's OpenAI key

The AI pane shows one thing it does not own: the OpenAI key on your account,
under **Used by the glasses**, as "set, ends in …abcd" and never as a key.

That key is a different key for a different thing. The glasses ask their
question through nib's own Worker, because a pair of glasses has no keyboard to
type a key on and no store to keep one in; the Worker holds the key sealed and
`api.openai.com` is the one origin the plugin's manifest lets it reach. See
`services/sync/src/ask` and `docs/even.md`. It is set in Settings > Glasses, and
the AI pane only says that it exists.

Nothing in this document goes through the Worker.

## Where the keys live

Per platform, because the platforms differ and pretending otherwise would be the
lie:

| Build | Store | What guards it |
| --- | --- | --- |
| Desktop app, Windows | Credential Manager | The account you are signed in as |
| Desktop app, macOS | Keychain | The same, plus whatever you set on the item |
| Desktop app, Linux | Secret Service (gnome-keyring, KWallet) | The keyring, which may be locked |
| Phone app, Android | `EncryptedSharedPreferences` | A key in the hardware Keystore, per app |
| Phone app, iPhone and iPad | Keychain | The device's passcode, per app |
| Browser | IndexedDB | Nothing but the origin |

The desktop side is `apps/desktop/src-tauri/src/secrets.rs`, three commands over
the `keyring` crate. The Android side is the `Secrets` bridge in
`MainActivity.kt`, which is where the activity already hands the page the things
a page cannot see. The browser side is `web/commands.ts`, answering the same
three command names out of the same store the themes live in.

One seam in front of all of it: `apps/desktop/src/lib/ai/keys.ts`.

The browser row is the honest one. A tab has no keychain and no hardware store,
and the alternatives are worse: a key held only in memory is a key retyped on
every reload, and a key on the account is a key that has left the device. So it
goes in IndexedDB and the pane says, in one line, that the browser is holding
it. The app keeps them in the secure store instead.

On Linux with no keyring daemon running, writing a key fails and the pane says
so. nib does not fall back to a file: a key in a file that the pane called
secure would be worse than a key that could not be saved.

Keys are read back, because the request is made by the page. They are never
cached in a variable, never written to a note, never synced, never logged, and
never put in an error message.

## The block

The prompt is the body of a ```` ```ai ```` fence. The answer is ordinary
markdown under it. That is the whole format, and it was chosen so a note written
in nib reads in Obsidian with no plugin at all: the question is a code block,
and the answer below it is prose.

````markdown
```ai
Summarise @note in three bullets.
```

<!--nib:ai-->
*answered by claude-sonnet-4-5, 2026-09-12*

- Herons stand still for a long time.
- Then they do not.
- That is most of it.
<!--/nib:ai-->
````

What each part is for:

- **The fence.** ```` ```ai ````, with the question inside it. nib leaves it as a
  code block everywhere: in the editor, in the reading view, in an export, on a
  published page, and in Obsidian. Nothing renders a question as prose.
- **The glyph.** A triangle on the fence's header row, the same one a runnable
  `js` block wears, because it is the same gesture. While an answer is arriving
  it is a square, which stops it.
- **The two comments.** `<!--nib:ai-->` and `<!--/nib:ai-->` mark where the
  answer begins and ends, so asking again replaces it instead of stacking a
  second one under it. They are HTML comments, which every renderer hides;
  nib strips both spellings of a comment before rendering anything, so they show
  on no surface at all. See `withoutComments` in `@nib/markdown`.
- **The italic line.** Which model answered and on what day. A date and not a
  timestamp: a re-run should not change a line for no reader's benefit. It is
  written in whatever language the app was set to at the time and then left
  alone, because it is file content and not interface.

An answer belongs to the fence directly above it. Nothing is keyed and nothing is
registered: the binding is the position, which is the only one a person editing
the file by hand can see and keep. Prose between the fence and a marked answer
means that answer belongs to something else, and a new one is inserted.

Asking again replaces the answer. Stopping keeps what arrived. A question that
was refused writes nothing at all: the answer's span is only created when the
first words arrive, so a key that has expired leaves the note exactly as it was
and the line across the top of the window says why.

### @note

A prompt that says `@note` is sent the note it is written in, fenced and
labelled, as a second system message. A prompt that does not is not: no provider
is ever handed a note nobody mentioned.

`@note` anywhere in the prompt does it. `me@notebook.ch` does not.

### What the model is told

Three sentences, in `ai/ask.ts`: that the answer is going into a markdown note,
that it should reply in the language the question was written in, and that it
should not wrap the whole reply in a code fence. Not translated, because nobody
reads it.

## The Ask panel

The right side's last tab, or **Ctrl+Shift+A**, which puts the keyboard in its field.
A question typed there is answered from your notes, beside the note you are reading,
and every claim the answer makes from a note is cited: a small number after it that
opens that note at that passage and lights it. An answer that cannot be checked in one
press is a rumour, which is why the number is the passage itself rather than a name to
look up. Under the answer, the notes it cited, each a press away.

Obsidian's assistants, Notion's Q&A, Mem and Reflect all answer from your notes with
sources; what nib does differently is what it does not do first.

### No index

Obsidian Copilot and Smart Connections embed the whole vault before they can answer,
and that is what their readers complain about: a launch that hangs while it builds, a
bill for embedding notes nobody asked about, an index stale the moment a note changes.
nib builds nothing. A question asks the app's own search - the crate's walk over the
bodies it already holds, the browser build's worker - once, when it is asked, and never
before. Nothing is indexed at start and nothing is sent in the background.

1. The question is reduced to the words that say which note: English and German
   grammar go, single characters go, the longest eight stay.
2. The space is asked for any of them. Archived and excluded notes are skipped before
   they are read, by the same list the Search panel skips them by; see docs/archive.md.
3. What answers is ranked by which of the words each note says, each weighted by how
   rare it is among the notes that answered, a word in the note's own name counting
   twice; ties by lines, then path, so one question of one space picks the same notes.
4. The best six are read, and out of each come the lines that matched with three either
   side, runs that touch joined into one passage.

Bounded three ways - at most four hundred matching lines, a deadline of a second and a
half after which the question goes with what has arrived, and a token budget - so a
space of ten thousand notes costs a question what a space of ten does.

### What a question is sent with

| What | How much | Why |
| --- | --- | --- |
| The rules | six lines | Cite by number, say so when the notes do not answer, reply in the question's language |
| The note in front | the whole of it up to 1,500 tokens, else its passages about the question | "This" in a question means it. A chip over the field names it, and a press takes it off - out of the search as well |
| What is selected in it | 800 tokens | If anything is |
| The space's passages | 3,000 tokens, at most six notes and ten passages | The retrieval above |
| The conversation so far | 2,000 tokens, oldest dropped first, citations taken out | What makes it a conversation |

Every passage is numbered and labelled with its note and line. Only these leave the
machine, and only to the provider you set up.

### What an answer is drawn as

Markdown, with the model's raw HTML escaped - a model's words are nobody's markup - and
every picture, frame and player taken out, so a note that talked a model into writing
`![](https://somewhere/?what-you-wrote)` loads nothing from anywhere. Links in it are
followed the way the reading view follows them.

Under each answer, as glyphs: copy, insert at the caret, save as a new note, and ask the
last question again. Copied, inserted or saved, every citation becomes the wikilink to
the note it cited, so where the answer came from stays one press away in the note too.
Stop keeps what arrived; a refusal is the provider's own words, with Ask again.

### Conversations

One per space: switching space switches it, and an answer still arriving lands in the
space it was asked in. Kept on this device and nowhere else - `localStorage`, never
the account, never a note, never sync - and only the words and where each citation
points; the passages themselves are not written down. The pen at the top of the panel
starts again.

### With no provider

One line, the one the fence says, and a link that opens Settings > AI. No field: a
field that cannot be asked anything is a field that lies.

## Rewriting a selection

Select something, right-click, **Rewrite…**. Four verbs:

- **Shorter** - the same thing in fewer words.
- **Longer** - more about the same thing.
- **Fix grammar** - spelling, grammar and punctuation, and nothing else.
- **Translate** - into the language the interface is set to, or one you pick.

The answer arrives in a sheet as a diff against what you selected, in the same
rows the version history draws. **Replace** writes it over the selection;
**Discard** leaves the note alone.

A diff and not a replacement with an undo behind it. A model rewriting a
paragraph is the one AI gesture in nib that can lose work, and by the time you
have read what an undo would put back, the paragraph is off the screen.

Only on a selection. The row is not in the menu otherwise, because four verbs
greyed out in every other menu in the app is four rows of nothing.

## Sound, as words

A recording is transcribed by whichever road the reader has, and their own comes first.

`POST /v1/audio/transcriptions` is OpenAI's route and the one every OpenAI-compatible
transcriber serves under the same name - whisper.cpp's server, faster-whisper, LM Studio -
so a transcriber on this machine is the same two fields in the same pane as a model on it,
and nothing leaves the machine at all. That is the whole reason somebody runs one.

The model is not the chat model. OpenAI is asked for `gpt-4o-mini-transcribe` and then
`whisper-1`; a server on this machine is asked for `whisper-1` and then for whatever model
the provider itself names, so somebody whose server wants
`Systran/faster-whisper-small` has a way to say so. A name the server has never heard of
is the one refusal worth trying the next name for - the list is a guess about somebody
else's server - and whichever answered is remembered, because a meeting sends a piece
every twenty seconds and must not spend a request finding that out again. A key refused
is said out loud rather than walked past.

`whisper-1` also says which language it heard, under `verbose_json`; the newer models
answer plain JSON and say nothing about it, which is a transcript heading with no language
in it rather than a failure.

**Claude is never this.** There is no audio route to ask, so a reader who has set up only
Claude has no transcriber, and the Transcribe row stays out of the menu rather than
appearing and failing.

**The account is the other road**, and the one most readers are on: `POST /v1/ask/heard`,
Whisper on Workers AI with the account's own OpenAI key behind it. It is what transcribing
does when no provider is set up. A provider that *is* set up and refuses is a failure
rather than a reason to send the recording somewhere else - the reader chose that server.

The note says which of them wrote it: the model's own name, or `whisper` for the account's
road. See `apps/desktop/src/lib/recorder/transcribe.ts`, and `docs/mobile.md` for what
this means with no signal.

## Costs

nib charges nothing and knows nothing about your bill. What it does do is make
the size of a request visible rather than surprising:

- A block sends the prompt, and the whole note when the prompt says `@note`. A
  long note asked a short question is a long request.
- A rewrite sends the selection and nothing else.
- A question in the Ask panel sends the bounded things in the table above: a few
  hundred tokens for a short question with no notes behind it, and about 8,000 at the
  most, with a long note in front and a long conversation behind it.
- Answers are capped at 4096 tokens, which is a page of prose. Anthropic
  requires a number; OpenAI-shaped providers are left to their own default.
- Nothing is sent in the background. Every request in this document is one
  somebody pressed a button for.
- Nothing is sent to a provider with no key on this device either. A hosted
  provider without one can only answer 401, and the note is on the wire before it
  does - so the request is refused here rather than there. The check is in
  `complete()`, which is the one place a request is made, rather than only in the
  pane that offers the press: a key removed leaves the provider chosen, with its
  model still set.
- A local model through an OpenAI-compatible provider costs electricity.
- A plan costs what your plan costs, and spends its limits: a question from nib is a
  question in Claude Code or Codex, counted the same. OpenClaw's own docs say the same
  of theirs.

If a provider refuses a request - a key that has expired, a model that has gone,
a quota that has run out - what it said is what the line across the top of the
window says. Its words, not ours: "this key cannot use that model" is a thing
only the provider knows.

## Where the code is

| File | What it owns |
| --- | --- |
| `packages/editor/src/ai/block.ts` | What the block looks like in the file |
| `packages/editor/src/ai/run.ts` | The fence, the answer's span, the stream, the stop |
| `apps/desktop/src/lib/ai/providers.ts` | The six kinds, and the wire of the four that are asked over it |
| `apps/desktop/src/lib/ai/stream.ts` | Server-sent events, split safely |
| `apps/desktop/src/lib/ai/complete.ts` | The one request nib makes, down whichever road |
| `apps/desktop/src/lib/ai/keys.ts` | Where a key lives, per platform |
| `apps/desktop/src/lib/ai/chatgpt.ts` | A ChatGPT plan's token of the hour, and its refusals in nib's words |
| `apps/desktop/src/lib/ai/local/` | Claude Code and Codex: a question put, their lines read, their state, their sign-in |
| `apps/desktop/src/lib/ai/store.svelte.ts` | The providers, the default, and which one each feature asks |
| `apps/desktop/src/lib/ai/ask.ts` | What the block asks, and who answers |
| `apps/desktop/src/lib/ai/rewrite.ts` | The four verbs, and what each sends |
| `apps/desktop/src/lib/ai/rewriting.svelte.ts` | One rewrite, start to accepted |
| `apps/desktop/src/lib/ai/retrieve.ts` | What a question is sent with, and the citations read back |
| `apps/desktop/src/lib/ai/asking.svelte.ts` | The conversation, and what is kept |
| `apps/desktop/src/lib/AskPanel.svelte` | The panel it is read in |
| `apps/desktop/src/lib/recorder/transcribe.ts` | Sound as words, by either road |
| `apps/desktop/src/lib/AiPane.svelte` | Settings > AI |
| `apps/desktop/src/lib/RewriteSheet.svelte` | The diff, and the two answers |
| `apps/desktop/src-tauri/src/secrets.rs` | The desktop keychain, and the iPhone's |
| `apps/desktop/src-tauri/src/ai_cli.rs` | Claude Code and Codex run: found, argued, started, streamed, ended |
| `apps/desktop/src-tauri/src/chatgpt.rs` | Sign in with ChatGPT: the loopback, the tokens, the refresh, the sign-out |

`scripts/fake-ai-cli.mjs` stands in for both programs: the crate's tests run it through
the same spawn, stream, stop and timeout as the real ones (and through an npm-style
`.cmd` shim on Windows), and it refuses a question asked without the flags above. A
native probe points the app at it with `NIB_AI_CLAUDE_CODE` and `NIB_AI_CODEX`. The one
test that asks the real Claude Code, read-only, and only where it is already signed in,
is `cargo test real_claude -- --ignored`.

The drive is `apps/desktop/test/e2e/ai.py`. It serves a fake
OpenAI-compatible provider that answers deterministically, so the block, the
streaming, the re-run and the rewrite can be driven end to end without a key and
without a network.

The panel's own drive is `apps/desktop/test/e2e/ask-panel.py`: the right side's homes
and keys, the panel with no provider, a question answered against the same kind of fake
provider with the archive left out and the citation opening its passage, a stop, an
insert, and the Properties panel writing a note's front matter.
