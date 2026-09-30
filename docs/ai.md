# AI

nib asks models. It does not sell you one.

Every provider is yours: you add it, you give it a key or an address, and the
requests go from your device straight to it. The account is not in the path, the
question is not logged, and the key never leaves the machine it was typed on.

Three surfaces use it, and they all go through one module:

- the ```` ```ai ```` block in a note, whose answer is written under it,
- the four rewrites on a selection,
- and the Ask panel on the right side of the window, which answers questions about
  your notes and says where each answer came from.

A fourth surface asks a different question of the same providers: a recording, as words.
See **Sound, as words** below.

## What nib cannot offer

Neither Anthropic nor OpenAI lets a third-party app sign you in with a Claude or
a ChatGPT subscription. There is no such API, for anybody, and no amount of
wanting one changes that. So a subscription you already pay for cannot be spent
here, and the honest options are the two nib offers: your own API key, or a model
running on your own machine.

That is not a hedge about a feature that is coming. It is the shape of the
market, and it is written here so nobody has to find out by looking for a button
that is not there.

## Providers

Settings > AI. Three kinds:

| Kind | What it needs | Where the models come from |
| --- | --- | --- |
| Claude | An Anthropic API key | `api.anthropic.com/v1/models` |
| OpenAI | An OpenAI API key | `api.openai.com/v1/models` |
| OpenAI-compatible | A base URL, and a key if the server wants one | `<base>/v1/models` |

One Claude and one OpenAI, because there is one of each API and one key for
each. As many compatible ones as you have servers: Ollama on this machine,
LM Studio beside it, OpenRouter behind both, a gateway at work. Each gets a name
so the list reads as what they are.

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

If a provider refuses a request - a key that has expired, a model that has gone,
a quota that has run out - what it said is what the line across the top of the
window says. Its words, not ours: "this key cannot use that model" is a thing
only the provider knows.

## Where the code is

| File | What it owns |
| --- | --- |
| `packages/editor/src/ai/block.ts` | What the block looks like in the file |
| `packages/editor/src/ai/run.ts` | The fence, the answer's span, the stream, the stop |
| `apps/desktop/src/lib/ai/providers.ts` | The three kinds, and their wire |
| `apps/desktop/src/lib/ai/stream.ts` | Server-sent events, split safely |
| `apps/desktop/src/lib/ai/complete.ts` | The one request nib makes |
| `apps/desktop/src/lib/ai/keys.ts` | Where a key lives, per platform |
| `apps/desktop/src/lib/ai/store.svelte.ts` | The providers, and the default |
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

The drive is `apps/desktop/test/e2e/ai.py`. It serves a fake
OpenAI-compatible provider that answers deterministically, so the block, the
streaming, the re-run and the rewrite can be driven end to end without a key and
without a network.

The panel's own drive is `apps/desktop/test/e2e/ask-panel.py`: the right side's homes
and keys, the panel with no provider, a question answered against the same kind of fake
provider with the archive left out and the citation opening its passage, a stop, an
insert, and the Properties panel writing a note's front matter.
