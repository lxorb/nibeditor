# Publishing

A published page is the note. Same renderer, same stylesheet, same colours in a
code fence. If it reads one way in the app it reads that way on somebody's blog,
and anything that cannot be that way is written down at the bottom of this page.

## Who renders what

| Where | Renderer | Stylesheet |
| --- | --- | --- |
| Reading view | `packages/markdown` through `apps/desktop/src/lib/reading/render.ts` | tokens.css, base.css, document.css, loaded by the app |
| Exported HTML | `packages/markdown` through `apps/desktop/src/lib/export.ts` | the same three, baked in, plus export.css |
| Published page | `packages/markdown` through `services/sync/src/blog.ts` | the same three, served from the Worker, plus the blog's own page.css |

One renderer, one set of sheets, three surfaces. The note body goes inside
`#write`, which is Typora's name for a rendered note and the id the writing
surface, the reading view and an exported document all carry, so every rule in
the theme lands on all of them at once.

## What was wrong before

Measured on 11.09.2026 against a fixture with every construct in it
(`services/sync/test/everything.md`), rendered three ways and diffed:

- No syntax highlighting at all. The Worker passed no `code` option, so every
  fence came out as plain grey text while the app coloured it.
- The page carried a hand-written stylesheet of about a hundred lines, which was
  a second design that looked a bit like the first. Fifteen callout colours were
  restated in it by hand, and these had no rules in it at all: `figure.code` and
  the caption over a fence, `.footnotes` and `.footnote-ref`, `.task-list-item`
  and its checkbox, `.toc`, `.math-block` and `.math-inline`, `.diagram`,
  `.properties`, `dl`/`dt`/`dd`, `abbr`, `h5`, `h6`, and every `hl-` class.
- `[toc]` was printed as the four characters `[toc]`. No heading had an id, so
  `[[note#heading]]` from another page landed at the top of it.
- The fonts, the sizes, the measure and the spacing were their own numbers rather
  than the theme's tokens, so the page was close to the app but never it.

Everything else already matched: the callouts, the folded one, the footnotes, the
tables, the task lists, the charts, the embedded notes, the media players, the
PDF and canvas cards, the web cards, the definition lists and the maths all came
out of the same renderer and were already the same markup.

## What it is now

- **One renderer.** `serveBlog` asks for what the reading view asks for:
  `footnotes`, `toc`, `escapeHtml`, a `code` fence renderer, and resolvers for
  links and embeds. The structural difference between the two is zero; see below.
  Both kinds of link are resolved here, and they have to be: a page is HTML and
  nothing else, so there is no click to read a path at. A `[[wikilink]]` names a
  note and `linkResolver` finds it; a `[words](../Other note.md)` names a path,
  which `noteHrefResolver` reads against the note it was written in and then
  looks up the same way. Either one naming a note the site does not publish comes
  out as the words rather than as a link into a 404.
- **One stylesheet for a page.** `scripts/blog-css.ts` builds it from
  `packages/themes/src/{tokens,base,document}.css` plus
  `services/sync/src/blog/page.css`, strips the comments, and writes
  `services/sync/src/blog/style.ts`. Run `pnpm blog:css` after changing any of
  those sheets; a test in `services/sync` fails if you forget. The Worker serves
  it at a path that is its own hash, cached forever, so a reader fetches 34kB
  once for a whole blog and every page after that carries no CSS at all. The
  same script writes a second sheet beside it from
  `packages/themes/src/slides.css`, another 3.5kB, which only a deck asks for.
- **Light or dark from the reader.** The app is dark until you say otherwise and
  says so with `data-theme`; a page starts from the reader's system instead. So
  the light tokens are the default, the dark ones are restated under
  `prefers-color-scheme: dark`, and print is light again because paper is. A
  reader who says which they want beats both: the button in the bar writes that
  same `data-theme`, and the two stated schemes are restated after the system's
  so they outrank it.
- **Coloured fences, server side.** `services/sync/src/blog/code.ts` carries
  thirteen Lezer grammars - the very parsers the editor loads through
  `@codemirror/lang-*` - and colours a fence with `@nib/markdown/highlight`, the
  module the export uses too. Same `hl-` classes, same tree, character for
  character. The colours are in document.css now, written with `:where(#write)`
  so a reader's chosen palette still wins in the app.
- **No script on a page.** The CSP says `script-src 'none'`. Highlighting is
  done before the bytes leave the Worker; nothing is coloured in the browser.
  One page is not a page: a note published as a deck carries a `Present` link,
  and following it serves `deckPage`, which is the same few lines that turn the
  pages in the app under a nonce the CSP names. See `docs/slides.md`.
- **Nothing from anybody else.** KaTeX's stylesheet and the faces it names used to
  come from jsdelivr, so every reader of a page with an equation on it pinged a CDN
  that had no business knowing who was reading what, and the maths came out in the
  reader's serif offline or behind a blocker. The same generator now writes
  `services/sync/src/blog/math.ts` from the `katex` package the editor renders
  with: the sheet, and its twenty faces as base64. woff2 only - the woff and the
  ttf would treble what the Worker carries for browsers nobody reads a blog in -
  and each face is served at a path that is its own hash, cached forever, so a
  browser fetches the two or three faces a page actually sets its equations in. A
  page with no maths in it links neither the sheet nor a face. The page's own type
  was always local: the token stacks name Geist and iA Writer and fall back to
  `ui-sans-serif` and `ui-monospace`, so a reader with neither installed gets their
  system's faces rather than a download. So the policy is now `style-src 'self'
  'unsafe-inline'` and `font-src 'self'`, and a page fetches from its own domain or
  not at all.

## What still differs, and why

- **The front matter.** The reading view draws it as rows because reading a note
  is being in the app looking at it. A page is a page: its metadata became the
  title, the byline and the `<meta>` tags, so it is not also a table at the top.
  Same as an exported document.
- **A mermaid diagram.** Both surfaces show the picture, and the page shows it as
  an `<img>` rather than as the SVG itself: the app draws it, sends it up as a
  blob and the page points at it, because mermaid needs a DOM to measure text in
  and a Worker has none. What differs is only what a fence nobody has drawn yet
  looks like - a code block, which is what it was before. See below.
  Charts are fine either way: a ` ```chart ` fence is string-built SVG and always
  was.
- **A web card.** `![](https://youtube.com/watch?v=…)` is the same card in both,
  but in the app pressing it swaps in the frame and on a page it is a link out.
  Nothing a note carries may run on a published page, and that is the point of
  it: the deck's own page turner is the Worker's script and not the note's.

  An `<iframe src="https://…">` a note wrote by hand is that same card, on both
  surfaces, and this is the one thing raw HTML does that escaping does not stop:
  the card is markup `web-embed.ts` wrote out of an address it checked, so it is
  as safe to serve as a link is. Which means a page needs no `frame-src` and
  never grew one - what the reader gets is the link, and what the app gets on a
  press is the page in a frame sandboxed without `allow-same-origin`. An address
  one of the providers answers for gets that row's card instead, with the
  narrower sandbox and the permissions its player needs; anything else gets
  scripts and nothing more, and says its domain rather than a name it would have
  had to ask somebody for. The card or nothing, and never the tag: a frame at
  `javascript:`, at a page of the app's own, or at plain http is one a note may
  not have, and both halves of such a tag are dropped rather than escaped into
  four characters of text.
- **Raw HTML.** A note of your own is markup in the app, as Typora does it. A
  published note is authored content served to strangers from a domain shared
  with every other blog, so HTML in it is shown as the characters it is made of.

  A block with a whole `<script>` in it is the sharpest case of that. In the app
  such a block is a card that runs it, once pressed, in a frame with an opaque
  origin that knows nothing about the note it sits in; on a page it is escaped
  like the rest, script and all, and the reader sees the characters. Same rule,
  read twice: markup that does something is still markup, and whose note it is
  decides. See `packages/markdown/src/html-block.ts`.
- **Languages the editor has and the Worker does not.** Shell, SQL, Ruby, Swift
  and the other hundred are stream parsers that only exist inside CodeMirror. A
  fence naming one is a plain fence on a page. Adding a grammar to the table in
  `blog/code.ts` is all it takes for one more.
- **Line numbers** are the editor's gutter, not the renderer's. Neither the
  reading view nor a page has them.
- **An equation in a browser older than woff2.** The Worker serves KaTeX's faces
  as woff2 and nothing else, so a browser from before 2016 sets the maths in its
  own serif. The markup and the layout are still KaTeX's.

## What a site chooses

Publishing a space used to publish every note in it. That is the right default
for a space somebody made to be a blog, and the wrong one for the space somebody
already writes in, which is most spaces.

Both decide about the papers beside the notes as well. A PDF is asked for by the
path a link wrote - `/reading/paper.pdf` - so it goes through the folder rules the
way a note does; it carries no front matter to settle its own case, and a path is
something somebody can guess where the hash it redirects to is not.

So there are two places a decision can live, and they are not equals. Neither is
asked about a drawing: a `.canvas` and a `.pages` note are JSON Canvas rather than
prose, and a published one would be its own source - the ink's coordinates, the
cards' words, the address of every file it embeds. Both extensions are left out of
the page list whatever the rules or the front matter say.

**The note decides for itself.** `publish: true` or `publish: false` in its front
matter, which is Obsidian Publish's own key, so a vault that already has them
keeps them and a vault that leaves nib keeps working. A note that says either has
settled its own case, and no rule about its folder changes that: what the author
wrote in the file wins over a row in a pane, always. A value we do not
understand - `publish: maybe` - is read as silence rather than as a page taken
down by a typo.

**The site decides for the rest.** In `Publish`: folders that are published,
folders that are never published, and one default for everything outside both.
The deeper rule counts, so `Work` private and `Work/Notes` published reads the
way it sounds. The rows offered are the top of the tree, where somebody thinks in
folders, plus any deeper folder that already carries a rule, so a vault of four
hundred folders is not four hundred rows and nothing is hidden.

Where it is kept: one JSON column on the space's row beside the bookmarks, the
folder icons, the graph and the excluded paths, because all of those are read on
the same request and a second table would be a second read per page. See
`services/sync/src/blog/site.ts` for the column and the one decision read off it,
and `spaces/site.ts` for the route that writes it.

### What a note says about itself, and where that is kept

`publish`, `permalink`, `aliases`, `title`, `description`, `image` (or `cover`)
and `date` all live in the note. The site has to decide about a thousand notes to
answer one request, and the note bodies are in R2, so what the head of a note
says is read once - when the note is written, which is one parse of something
already in hand - and kept on the row as JSON. The note's first heading and its
first sentence ride along, because they come out of the same read and they are
what a list of pages and a feed entry want.

Every note written since this existed carries it. A vault that synced last month
does not, and a `publish: false` nobody has read is a page on the internet that
was meant to be private - so a space being published, or having its rules
changed, or being asked what those rules would do, reads its own unread notes
first, two hundred at a time, and the nightly sweep finishes anything bigger.
See `blog/front.ts` and `blog/fill.ts`.

### What a publish will change

Obsidian Publish shows an upload dialog: these files will be added, these
changed, these removed. nib has nothing to upload. A page **is** the note, served
live, so the words on a page change when the note changes and no publish is
involved.

What a publish can change is which pages exist. So that is what the sheet says,
before the button: how many pages the site will have, how many appear, how many
go away, and the names of both. Worked out by the server - the same function that
serves the pages, so the answer cannot drift from the truth - and asked again a
quarter of a second after each rule is changed.

A diff of a page's text is deliberately not offered: there is no older version on
the site to diff against, because the site is showing the note as it stands. The
note's own history is where its earlier words are; see `docs/sync.md`.

## Where a page lives

`Notes/First idea.md` is `/notes/first-idea` by default. `permalink: ideas/first`
puts it at `/ideas/first` instead, and its path no longer answers. `aliases:` -
the same key the app follows a link by - are other paths that land on it.

And then the part nobody thinks about until it has happened: a page moves. A note
is renamed, a permalink is reconsidered, an alias is dropped. The old path is
already in somebody's history, somebody's feed reader and somebody else's link,
and a 404 is the one answer that helps nobody.

So a path is remembered at the moment it stops being true, which is the moment
the note is written: what the path and the front matter were is in hand there, so
nothing has to be walked and nothing at all is written in the ordinary case. What
it becomes is a permanent redirect to wherever the page is now. Fifty paths per
note are kept, oldest let go after that. See `blog/paths.ts`.

This is the thing a static site generator makes people keep a redirects file by
hand for.

## What the head of a page says

A published page now says what it is to the machines that read pages: a title, a
description, where it lives, and the card a link pasted into a chat draws.

- The description is the note's own `description:`, or its first sentence -
  skipping the heading, the fences, the quotes and the pictures - or the site's
  own description behind both.
- The picture is the note's `image:` or `cover:`, or the first picture in the page
  itself, or the site's. `/i/<hash>` is where a picture in a note already lives,
  so that is what a note names; an address of somebody else's is taken as it was
  written. A card with a picture is a different card, so the kind is said rather
  than guessed at.
- The canonical, `og:url` and the feed link are absolute, because the machines
  that read them do not resolve a relative address.

One place writes all of it, and it writes only what it was given: a page with no
description has no description tag rather than an empty one. See `blog/head.ts`.

## What the machines read

`sitemap.xml` lists every page, the site's own front, and both feeds. No priorities
and no change frequencies: both are guesses no search engine has read since 2015, and
a wrong guess is worse than none. The feeds are in it so that a crawler which found
the sitemap has found every way of following the site.

`feed.xml` is the writing, newest first by the note's `date:` and otherwise by
when it was last written, thirty entries, each with the description the note gave
or its first words. Never the whole note: a feed is a table of contents, and a
page read in a feed reader is a page nobody visits.

`rss.xml` is the same writing as RSS 2.0: the same entries in the same order, the
same dates, the same summaries. Both, not one. Atom is the better document - it says
what a date means and what a summary is made of, where RSS leaves both to the reader
- and every reader that reads RSS reads Atom, which is why Atom was the only one here
for a while. But "RSS" is the word a reader pastes into a reader, several readers
still ask for a file by that name, and a site answering 404 at `/rss.xml` reads as a
site with no feed at all. The two are built from one list, so neither can say
something the other does not; what differs is only the spelling - RFC 822 dates
rather than ISO 8601, and `description` where Atom writes `summary`. Every page of a
site names both in its head as alternates, so a reader handed the address of a page
finds whichever of the two it reads.

`robots.txt` points at the sitemap, and says `Disallow: /` while the site has a
password - because everything a crawler would be shown then is the password form.

All of them are built per request from the same list the index is drawn from, and
cached for an hour. A blog written in twice a week does not need a build step.

## A site behind a password

What it is for: notes somebody wants a few named people to read and nobody else -
a draft with a client, a handbook for a team, a wedding page. The alternative in
the app is sharing, which is an account and a link per person; this is one word
said out loud to a room.

What it is not: security for the notes themselves. One password everybody in a
room knows is one password somebody forwards, so it keeps a site out of a search
engine and out of a stranger's hands, and that is the whole of the claim.
Anything that must not leave is not published.

How many tries: twenty an hour from one machine at one site, and five hundred an
hour at the site whatever the machine - counted before the rounds are spent, because
a guess costs the reader nothing and costs the service a hundred thousand rounds of
PBKDF2, which is both how a short password is guessed and how somebody spends
somebody else's CPU with a loop. A try past either ceiling is answered exactly as a
wrong password is: a door that said "too many tries" would have told a guesser that
the tries are being counted. See `mayGuess` in `limits.ts`.

How it is kept: PBKDF2 with a hundred thousand rounds and a salt of its own, so
the column is not a password. What a reader carries afterwards is a ticket signed
with a key made when the password was set - not the password, and not a session
anybody has to store - so setting a new password or taking it off ends every
ticket the old one handed out. A month, `HttpOnly`, `Secure`, `SameSite=Lax`.

The form is the site's own design and says nothing but the site's name: no hint,
because a hint is half the password, and no explanation of what is behind it,
because whoever sent the address said that. It is the one page in nib that may
post anything anywhere, and the policy says so in as many words:
`form-action 'self'` on that page and `'none'` on every other. It carries
`noindex`, and nothing behind it is ever cached by anything but the reader's own
browser: `private, no-store` on every answer a site with a password gives - the
pages, the feed, the sitemap, a search - set once in `serveBlog` rather than by
each page, because a page that forgot it would be a page a shared cache hands to
the next reader with no password at all.

See `blog/gate.ts`.

## The icon a tab shows

The space's own mark, served at `/favicon.svg` and linked from every page.

Drawn by the app rather than the Worker, and the reason is the icons: a space
wears an emoji, a Lucide stroke or a finished drawing out of a set the app fetches
when it is first asked for one. The side that has the sets is the side that can
render one, and a Worker that bundled every set to answer with half a kilobyte
would start slower for every request there is. So the app reads the mark it has
already drawn in the sheet, writes it as a small SVG document, and the account
keeps it; see `apps/desktop/src/lib/site-icon.ts`. A space with no icon yet gets
its first letter on the same ground, drawn by the Worker out of the name it
already has, so the two answers look like one.

An SVG and nothing else. Every browser still shipped draws an SVG favicon; the
PNG that one or two platforms would rather have needs a rasteriser in a Worker or
a canvas dance in the app, and a tab icon is not worth either.

It is served sandboxed, with the policy a diagram from `/i/` gets: an SVG is a
document, and an icon is the author's own markup on a host under the shared domain,
so somebody who opens `/favicon.svg` on its own is opening a page there. The two
answers say it from one place now; see `SVG_POLICY` in `blog/site.ts`.

## Getting around a site

Part one decided which notes are on a site. This is everything a reader of one
needs that a single page cannot give them, and all of it is built from the same
list of published pages - which is the reason it is safe: a navigation built from
the file tree, or backlinks built from the link index, would each be a place where
a private note could leak its name.

**The pages, down the left.** The published tree, folders as disclosures, the
folder you are inside already open, the page you are reading marked. A level
reads as its own pages first - in `order:` and then by name - and its folders
after them, which is also the order previous and next follow at the foot of a
page. `order:` is a number in the front matter; a page that says nothing is
sorted by name after the ones that do, and a folder sits where the earliest
`order:` under it puts it. On a phone there is no column for it, so the same
markup is one row under the bar that opens the whole tree - the trick the
contents use as well, described there.

**The contents, down the right.** The headings of this page, from the same list
`[toc]` writes - the renderer hands them over rather than being asked twice, so a
note with a `[toc]` in it and the column beside it cannot disagree. Fewer than
three headings is not a table of contents and gets none. It is a `<details>`,
closed in the markup, so a phone gets a row it can open; where there is a column
to put it in the stylesheet opens it and hides the summary. No script.

**What links here.** Under the note, from what each page said about itself when it
was saved: the links out of a note are on its row, so this costs no reads. Only
published pages, and an alias counts as a name for the page it belongs to.

**Previous and next.** The pages either side of this one in the order the
navigation shows, across folders, because the next thing to read is the next
thing to read.

A site of one note has none of this. A site of two has the tree and no graph. The
furniture appears as there is something for it to be about.

## Searching a site on the site

A box in the bar, `/` to focus it, and a page of answers at `/search?q=…`. No
script does the searching: the box is a form, the answers are a page, and a
reader with scripting off searches exactly as well as anybody else.

**The grammar is the part of the app's that means the same thing here**: words,
`"a phrase"`, `-not`, `tag:work`, `path:folder`. The rest of what the app speaks -
the task operators, the property comparisons, the regular expressions - is for
somebody standing in their own vault with the file tree in front of them; a
stranger reading three posts has nothing to point them at, so those are left out
rather than half-answered. `tag:` reads the note's own front matter; an inline
`#tag` is one of the page's words and is found as one.

**Answered by an index, never by reading a thousand notes.** SQLite's own
full-text index, which D1 carries, written when the note is saved from the same
parse that reads its front matter: the path, the title, and the note's prose with
the markup taken out, capped at sixteen kilobytes. Diacritics are folded, so
`cafe` finds `café`. The matched words come back marked by the index itself.

Every note of the space is in that index and every answer is joined to the pages
the site publishes, so a private note can be in the index and can never be in an
answer. That is the one thing a search on a site must not get wrong, and it is
why the join is not optional.

## The graph, on the site

`/graph` draws the published pages and the links between them, and a page with
neighbours draws a small one under it.

It is the app's own graph: `Layout` and `paint` from `apps/desktop/src/lib`,
imported into the page's script and bundled with it. Not a second implementation
and not a library - the physics, the radii, the framing and every pixel are the
ones the app draws, so a space looks like itself on both surfaces. What the page
adds is reading the graph the server wrote into the document, sizing the canvas,
and following a link when a node is pressed.

No dragging, no zoom, no controls: a reader of a blog is being shown how the
pages hang together and then following one. The same pages are listed as words
under the canvas, so a reader with scripting off, a screen reader and a search
engine all get the links.

A link to a note the site does not publish is dropped rather than drawn as the
hollow node the app shows: on a site that node would be the name of a private
note.

## The card a link shows

Hovering a link to another page of the site shows the page, the way the app's own
hover preview does. Fetched when the pointer has been still for a third of a
second, kept for the rest of the visit, forty pages at most. A long press is the
gesture where there is no pointer.

The page being previewed is fetched with `x-nib-preview`, which is how the Worker
knows to answer with the note and none of the furniture: no navigation to draw
inside a card the size of a paragraph.

## Light, dark, and the author's theme

A page has always followed the reader's system. Now there is a button as well:
system, light, dark, remembered for that site.

One inline line in the head puts the remembered choice on before the first paint,
because the alternative is a page that paints in the wrong scheme and corrects
itself. It is the only inline script a site carries and the policy names it by the
hash of those very characters - never `unsafe-inline`.

**The author's own theme** is one of the themes the app itself wears. The app
uploads that theme's stylesheet as a blob and the site keeps its name and hash; a
page then links it after its own sheet, from where every other blob is served. The
app is the side that has the themes installed, so the app is the side that sends
one - the same reasoning as the favicon. The reader's light-or-dark choice still
sits on top of it, because a theme is a set of tokens and both schemes are in it.

## The author's own CSS and JS

`publish.css` and `publish.js` at the root of the space, which are Obsidian
Publish's own names. They travel the way a paper does - the bytes as a blob, the
name in the space's file list - so they live in the vault, are edited in whatever
edits files, and move with it.

The stylesheet is linked after the site's own and after the theme, so it wins.
The script is the one thing on a published page that runs code somebody wrote,
and it is their own page it runs on: `script-src 'self'`, which covers the site's
own script and theirs, and nothing inline but the one hashed line above. A script
from anywhere else is still refused by the policy.

The bytes are served from `/i/<hash>` like a paper's, and a stylesheet or a script
there answers only on the site whose own pages ask for it - its theme's sheet, its
`publish.css`, its `publish.js`. Every published site is a host under one shared
domain, so a script served on all of them would be a script inside all of their
origins, and `script-src 'self'` would mean "whatever anybody has uploaded". A
picture cannot be checked that way, and src/blobs.ts says why.

Both names are the owner's alone. Everything else a space keeps beside its notes
is a file a reader opens on purpose and a writer may add, but these two are served
on every page of the site - so a collaborator naming either is ignored, and what
the owner put there stays. Whether a folder of notes is on the internet at all is
already the owner's; so is how it looks once it is. See `src/spaces/files.ts`.

The publish sheet says when the space carries either, so a name typed wrong shows
up as "no dressing" rather than as silence.

## Counting visits

A script URL in the sheet - Plausible, Umami, GoatCounter, or anything else that
installs as one tag - and the page loads it. Nothing is set until somebody types
one, and the policy names that one origin and no other.

Said plainly in the sheet and here: **the reader's visit goes to whoever serves
that script.** That is what analytics is, and a site that counts nothing tells
nobody anything.

Google Analytics is deliberately not offered. Its install is an inline script
with an id in it, which would mean either `unsafe-inline` on every page of every
site that uses one or a hash computed per request for the privilege - and of all
the providers it is the one whose whole business is the reader. Anything that
installs as a single script tag works today.

## Forms

The one thing a blog could not do without leaving somebody else's script on the
page. A note that asks "what did you think" or "tell me when you are free" wants
a form, and every way of having one meant a third party who then held the answers.

A fence in the note:

    ```form
    title: Say hello
    send: Send it
    fields:
      - Your name
      - Your email: email
      - * What you want to say: lines
      - Which day: choice Monday | Tuesday
    ```

A field is its label, and after the colon what kind it is: `text` by default,
`email`, `lines` for a paragraph, `number`, or `choice` with the choices after it.
A `*` in front means it must be answered. Obsidian has no form block, so there is
no key to borrow and this is nib's own; it is written to read as a note rather
than as a config file, and a fence that says something else is shown as the fence
it is rather than guessed at.

On the page it is a real form. It posts, the page comes back saying thank you, and
a reader with scripting off is not told to enable anything. What is accepted is
what the note asked: a field the form does not have cannot be sent, a required one
that is empty is refused with one line, and an address that is not one is refused
by name.

**What the account keeps is the message and nothing else.** No address, no user
agent, no fingerprint. Spam is held off by counting - ten answers an hour from one
machine, two hundred to one site - which is the same rate limit every other route
uses, keyed by a hash that lives as long as the window. No captcha: a captcha is a
third party watching the reader.

The answers are read in the publish sheet: which page was asking, what came back,
when, and a row to delete one. `Save as CSV` writes the file the server built, so
what a column is called is decided where an answer is stored.

The one asymmetry worth naming: in the app a `form` fence is shown as a fence.
The form is a thing a page does, and the note is where the questions are written.

## What a site costs

The account's allowance is one gigabyte of notes and files, and publishing takes
none of it: a page **is** the note, so a site serves bytes the account already
holds. There is no second pile to meter, which is why there is no per-site
allowance - a site cannot hold what the account does not.

What the sheet says instead is the number that is true: how many pages the site
would have and how many bytes of notes that is. Version bytes stay outside the
quota, as they were.

What publishing does add is traffic, which is bandwidth rather than storage and is
the service's bill rather than the reader's allowance. If that ever needs a
ceiling it is a ceiling on requests, not on bytes stored, and it is a pricing
decision rather than an engineering one.

## Mermaid on a page

A `mermaid`, `flow` or `sequence` fence is a picture on a published page. The
round before this one reconsidered the two ways of getting there and refused both:
rendering on the server needs a DOM to measure text in, which a Worker has none
of, and rendering in the reader's browser means the mermaid bundle - about a
megabyte the Worker would have to carry as source, paid for on every deploy and
every cold start, on every site, for the pages that have no diagram. A CDN is what
the KaTeX round deliberately removed.

So the side that has a DOM does the drawing, which is the app, exactly as the
favicon a tab shows and the theme a site wears are drawn by the app and sent up as
blobs.

**How it works.** On Publish, the app reads its own notes, finds every diagram
fence in them and draws each one twice - once light, once dark - with the same
mermaid the reading view uses. Each drawing goes up as an SVG blob named by a hash
of the fence's contents, the language and the scheme, and the page writes

```html
<figure class="diagram"><img src="/i/<hash>.svg" alt="…" data-scheme="light">…</figure>
```

where the fence stood, once the blob is there. A fence nothing has drawn yet stays
the code block it always was, so a space published from a device that has never
seen the note still reads, and so does a diagram mermaid refuses - which is also
what the editor shows for it.

**What it costs.** An unchanged diagram is the same hash, so the second publish of
a space draws nothing and sends nothing, and a reader's browser keeps the picture
for ever because the address is the hash. A note with no fence in it costs a
substring search. The Worker costs one query per page with a diagram on it, asking
which of those names the space's owner keeps.

**Why two pictures and not one.** A diagram's colours come from the scheme it was
drawn in - mermaid writes them into a `<style>` inside the SVG - and a published
page lets the reader choose the scheme. One file with the page's own custom
properties in it cannot follow that: an `<img>` is a document of its own that
neither the page's variables nor its stylesheet reach into. One file switching on
`prefers-color-scheme` inside its own `<style>` cannot either, for a subtler
reason - that query answers the reader's *system*, and the button in the bar is a
reader saying something else, so a reader who asks for dark on a light machine
would get a light diagram on a dark page. So both are written into the figure and
the sheet shows the one for the scheme in force, stacked the same way the token
blocks are: the light one by default, the dark one under
`prefers-color-scheme: dark`, and both stated schemes again after that so the
button outranks the system. The second file is fetched as well; it is a few
kilobytes from the site's own domain, immutable for ever, and only on a page that
has a diagram at all.

**What the reader is told it says.** `accTitle` or `accDescr` in the fence, where
the author wrote one - mermaid's own words for it - and the word `Diagram` where
they did not. The fence's first line is `graph TD`, and reading that out loud is
worse than saying nothing.

**Two things about safety.** The name is derived from text a reader of the page can
see, so it would be a name a stranger could compute and write a picture under; the
space's id is in the hash, and no published page ever prints that, and the Worker
asks for the name under the space owner's own account. And an SVG is a document:
the app strips scripts, handlers and anything pointing outward before it uploads
one, and the store serves it under `default-src 'none'; style-src 'unsafe-inline';
sandbox` so the address opened on its own is a document that can do nothing. The
page's own policy needed `'self'` added to `img-src`, which is also what lets a
site read over plain http - a drive against a local Worker - show its own pictures.

**What is left.** An edited diagram leaves its old picture in the account's
storage, the way a replaced theme and a deleted picture already do; nothing in nib
sweeps unreferenced blobs yet. And a diagram added to a note that is already
published appears on the page after the next Publish rather than on the next save,
because the drawing is a publish-time pass over the space.

### Checking this part

- `services/sync/test/site.test.ts` - what a note says about itself, which notes
  the rules publish, what a preview says before anything changes, permalinks,
  aliases, the redirect a rename leaves, the head of a page, the sitemap, both
  feeds and that an XML parser reads either whole, robots, the favicon, and the
  password from both sides of the form.
- `apps/desktop/src/lib/publishing.test.ts` - the rules read off the listing, a
  folder in one list or the other, the preview asked of the server, and a password
  that is never handed back.
- `services/sync/test/site-parts.test.ts` - the search grammar, the words a note
  is indexed by, the navigation's order, a folder open where the reader is inside
  it, what links to a page, a form read from a fence and an answer read against
  it, the spreadsheet the answers become, the theme the author chose linked
  after the site's own sheet, and a form on a site behind a password: the answer is
  taken from a reader who is through the gate, a reader who is not lands back on the
  form rather than losing it, and sending one is never counted as a guess at the
  password.
- `services/sync/test/site-script.test.ts` - that the script a page runs is still
  the one the app's own modules make, which is what catches a forgotten
  `pnpm blog:js`.
- `packages/markdown/src/diagrams.test.ts` - the name a diagram's picture is
  stored under: the same one twice, one per scheme, a different one for an edited
  diagram and a different one in another space; and the figure the page writes.
- `apps/desktop/src/lib/site-diagrams.test.ts` - which fences a space has to
  draw, a drawing turned into a file that has a size and no script in it, both
  schemes or neither, and a second publish that sends nothing.
- `services/sync/test/publishing.test.ts` - the fence as a code block until
  something has drawn it, the figure once the blobs are there, the SVG served as
  `image/svg+xml` under a policy that allows nothing, and a picture named for
  another space or kept by another account that the page will not show.
- `python apps/desktop/test/e2e/site.py` - the sheet on a desktop and a phone
  against a real Worker: a folder made private, what the sheet says will change, a
  page served and a page not served, a permalink, a rename that redirects, the
  feed and the sitemap, a password typed on the site itself, the favicon, the
  search box answering, the tree and the contents beside a page, what links to it,
  the graph, and a form answered on the page and read back on the account. The
  diagram is drawn by the real mermaid in the real browser the sheet is pressed
  in, and read back off the page as two pictures the site serves itself. The last
  part of it is a real browser on the site, on a desktop and a phone: it counts
  the pixels the graph painted, presses `/` and searches, presses the theme button
  twice and reads the colour of the page each time, hovers a link for its card,
  shows the diagram with the system on light, on dark and with the button
  disagreeing with the system, says that nobody but the site was asked for
  anything, and leaves the screenshots beside the sheet's.

## How to check it

- `python apps/desktop/test/e2e/publishing.py` builds the web app, runs the
  Worker on workerd with the migrations applied, publishes the fixture through
  the real API, opens it in the reading view and as a published page, compares
  the tag and class tree of both, and writes the two pictures beside each other
  under `apps/desktop/test/e2e/shots/publishing/`. It fails on any structural
  difference that is not in the list above. It also lists every address the page
  asked its browser for and fails if one of them is somebody else's; on 12.09.2026
  that list was the page, its two stylesheets, the three KaTeX faces its equations
  are set in, and the one picture the fixture names and the space does not hold.
- `pnpm --filter @nib/sync test` covers the rest: the stylesheet is the one the
  generator writes, it is served and cached, every class the page uses has a rule
  in it, the fences are coloured, the headings have ids, nothing runs, and the
  maths sheet and its faces are served from the blog with nothing left on the page
  for anybody else to serve.
