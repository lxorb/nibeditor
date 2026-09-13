# The clipper

The Chrome extension. A page, a selection or a link becomes a note in a space:
the article is found the way Firefox's reader mode finds it, converted by
`@nib/markdown/from-html` - the same converter a paste into the editor uses - and
saved through the same sync API the app writes notes with, with every picture moved
onto the account so the note stops depending on the site.

Three ways to ask for one, all of them the same clip: the popup, which previews the
note before it is saved; the page's own right-click menu; and `Alt+Shift+K`, `S` or
`L`.

```sh
node apps/clipper/scripts/build.js          # dist/ for "Load unpacked", and the store's zip
pnpm --filter @nib/clipper test             # the unit tests
python apps/clipper/test/e2e/clip.py        # the reader, in a real Chrome
python apps/clipper/test/e2e/interpret.py   # the interpreter, against a fake provider
python apps/clipper/test/e2e/locales.py     # both pages, in five hard languages
```

The drives need Playwright's Chromium and run headed, because an extension does not
load in the headless shell. `CHROMIUM` names a browser to use instead of the one
Playwright registered.

## Its words

**Thirty-nine languages**, the same list the app offers and chosen the same way:
`src/locales/` holds one catalogue per language, the English string is its own key,
and `src/lib/translate.ts` is the whole mechanism. The catalogue is fetched when it
is asked for, so a popup opens with one of them rather than all of them. German is
the reference every other catalogue is held to; `src/lib/i18n.test.ts` fails the
build when one is short of a row, carries a row nothing asks for, has the wrong
count forms for its language, loses a placeholder or holds an em dash.

The words Chrome itself draws - the tile on `chrome://extensions`, the listing in
the store, the shortcut list - are `public/_locales`' business instead, because
Chrome's own mechanism is the only one those surfaces have and it picks by the
browser's interface language. Thirty-one of the thirty-nine are languages Chrome
has an interface in; the rest get the whole of the extension in their own language
and Chrome's tile beside it in English. The same test holds the two halves to the
same languages.

See docs/conventions.md, *Words the reader sees*, for the glossary both products
share and what to do when a string or a language is added.

## The interpreter

A clip always carries four properties: where it came from, what it is called, when
it was clipped, and the tags the page publishes about itself. **The interpreter
fills in the rest** - an author, a date, a summary, a recipe's servings, a paper's
DOI - by asking a model about the article the clip already is.

It is off until somebody chooses a provider, and with nothing chosen the clipper is
exactly what it was without it: no row in the popup, no request, nothing sent
anywhere.

### Providers

Chosen in the options page, one at a time.

| | |
| --- | --- |
| **Claude** | An Anthropic API key. `POST /v1/messages`, with the header the API asks a browser for. |
| **OpenAI** | An API key. `POST /v1/chat/completions`. |
| **Another server** | An address, and a key where the server wants one: Ollama, LM Studio, OpenRouter, anything that answers chat completions. |

The model is picked from what the provider lists, and typed where it lists nothing.

That address is the one field here that decides where the key goes, so it has to be
`https:` or this machine - `localhost`, `127.0.0.1`, `[::1]` - and has to parse as an
address at all. Anything else is read as a provider that is not set up yet, and
nothing is sent: plain `http:` to somebody else's host is the key and the page in the
clear, and a typo is both handed to whoever owns the name. Typing in the field asks
nothing either; the models are looked up when the key is committed or a provider is
chosen, because a field being typed into is half an address for as long as that
lasts.

**Local first.** The options page looks for Ollama on `localhost:11434` as it opens
and offers it where it finds it: one press sets the address, the key to nothing and
the first model it has. A model on the machine costs nothing per clip and sends the
page nowhere. If the suggestion never appears while Ollama is running, Ollama is
refusing the extension's origin; start it with
`OLLAMA_ORIGINS=chrome-extension://*`.

**The keys are in `chrome.storage.local`, and Chrome does not encrypt it.** An
extension has no keychain: MV3 gives a service worker and two pages, and storage is
the only place all three can look - the session's own token is in there too. A key
is sent to the provider it belongs to and nowhere else, and each provider keeps its
own, so trying another and coming back does not lose one.

### Templates

A template is a name, the addresses it claims, and the properties to fill in with a
sentence each saying what the property is. Those sentences are the prompt.

Six ship - Recipe, Product, Paper, Thread, Article, Generic - and the options page
edits them as the text they are written in:

```yaml
- name: Recipe
  when: '*/recipe/*, */recipes/*, *allrecipes.com/*'
  fields:
    title: The dish, as the page names it
    servings: How many people it serves
    tags[]: Three to six topics, lowercase
```

- **`name:`** is its identity. The picker shows it as written, untranslated, and the
  Interpret switch is remembered under it.
- **`when:`** is a comma list of addresses. `*` stands for any run of characters and
  is the only character that is not itself; both ends are anchored. The **first**
  template whose address claims the page is the one offered, so order is priority: a
  template with no `when:` is only ever chosen by hand, and Article's `*` is the
  fallback.
- **`fields:`** are the properties, in the order they are written into the note. A
  name written `tags[]` takes a list.
- A template may not name `source` or `clipped`: the clip writes those itself.

The reader is a deliberately small subset of YAML - a list of maps, one nested map,
single-line values - and is not a YAML parser. A line it cannot read is reported
under the box with its number rather than skipped, and until it reads, the clipper
falls back to the six that ship: a half-typed edit costs the interpreter its extra
properties, never the clip.

### What happens to a clip

1. The popup reads the page, converts it and draws the note. That part never waits
   on a provider.
2. The address picks a template. The **Interpret** switch beside it is remembered
   per template, and turning it on is what sends anything: the article, trimmed to
   twelve thousand characters at a paragraph break, with the count shown under the
   row so you can see how much of the page is going.
3. The properties arrive and appear in the preview, in the note that Save will
   write. Closing the popup, flipping the switch back or picking another template
   aborts the request.
4. A clip from the right-click menu or a shortcut asks the same question for the
   same page, with the same switch, and saves whatever comes back. A provider that
   cannot answer costs that note its extra properties and nothing else.

**A model's answer is not trusted with a file.** The template says which properties
exist, and one it did not name does not exist however confidently the model named
it. A value is made one line and cut to three hundred characters; a list keeps at
most eight members, each once; anything that is not a line where a line was asked
for is dropped. Then `writeFrontMatter` quotes whatever YAML would misread, so an
author called `Rowan Keld\n---\ntags: [taken over]` lands as one quoted scalar and
the note still has exactly one front matter block. `test/e2e/interpret.py` drives
that case against a fake provider, end to end, in a real Chrome.

### Where the code is

| | |
| --- | --- |
| `src/lib/interpret/templates.ts` | The templates, their format and its reader, and which one an address claims |
| `src/lib/interpret/prompt.ts` | The prompt a template makes, and how much of the article goes in it |
| `src/lib/interpret/providers.ts` | The three request shapes, and how each answer is read |
| `src/lib/interpret/values.ts` | A model's loose JSON, read strictly enough to put in a file |
| `src/lib/interpret/setup.ts` | What is remembered: the provider, the keys, the switches |
| `src/lib/interpret/index.ts` | `interpret(page, template, setup, signal)`, and the only file here that sends a request |
| `src/lib/interpreting.ts` | The seam: a `Clip` turned into the question, for the popup and the worker |

Everything under `interpret/` but `index.ts` is pure and knows nothing about this
extension, which is what makes it the part to share. **The app is growing its own ai
module under `apps/desktop/src/lib/ai/**`; when both exist, those five files are
what moves into a `packages/ai` between them.** Nothing here depends on the app's
half, deliberately, so neither waits for the other.
