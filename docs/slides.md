# Slides

A note with horizontal rules in it is a deck. There is nothing to turn on and no
front matter to write: put a rule between two things you want on two screens and
press F5.

That is Obsidian's own convention, which is why it is Nib's: a deck written here
presents in Obsidian's Slides plugin, and one written there presents here.
Everything Nib reads on top of it had to survive being opened in another editor,
so every mark below is either ordinary markdown or nothing at all.

## The format

| You write | You get | Elsewhere it is |
| --- | --- | --- |
| `---`, with a blank line above it | the next slide | a horizontal rule |
| `***`, with a blank line above it | the next slide, entered from above | a horizontal rule |
| `Note:` at the start of a block | the rest of the slide, for the presenter only | a paragraph beginning "Note:" |
| `+ item` instead of `- item` | an item that waits for a click | an ordinary bulleted item |
| a slide of headings and nothing else | a title, centred | a heading |
| a slide of one picture and nothing else | the picture, filling the screen | a picture |
| `___` | an ordinary rule inside a slide | a horizontal rule |
| a single newline | a line break | a space |

### The blank line above a rule is not optional

CommonMark reads a line of dashes directly under a line of text as the underline
of a heading, and says that reading takes precedence over a rule. So this:

```markdown
The last line of a slide
---

# The next one
```

is not a slide break anywhere: it is an `<h2>`. Nib reads it the same way every
other renderer does, which is why the rule needs the blank line. Write a deck the
way you would write a note and this never comes up.

### A line break on a slide is a line break

A slide is a poster. Its lines are placed rather than flowed, and CommonMark's
rule that a single newline is a space turns three placed lines into one running
sentence, which is not the slide anybody wrote. So inside a deck a single newline
is a line break:

```markdown
Ship it
Read it
Keep it
```

is three lines on the slide and one sentence on the published page of the same
note. A blank line is still a paragraph gap, and the two-space hard break still
works - this is a superset of it, not a replacement. The speaker notes take the
rule too: they are lines of the same file, typed the same way.

Nothing else changes. The reading view, an export, a document and the published
page of a note that is not being presented all keep CommonMark's space, so the
file still reads the way every other renderer reads it. The flag is `breaks` on
`RenderOptions` in `@nib/markdown`, set in one place per surface: `deckHtml` in
`apps/desktop/src/lib/slides/render.ts` for the app and both exports, and
`publishedDeck` in `services/sync/src/blog.ts` for `?slides`.

### Why `***` and not `--`

reveal.js and the Obsidian community plugins use `--` for a slide that continues
the one before it. In CommonMark `--` is too short to be a rule, so it renders as
a paragraph containing two hyphens; written without a blank line above it, it
turns the line above into a heading. `***` is a real thematic break, immune to
that, and it draws a rule in any editor. A deck of Nib's sub-slides presented in
Obsidian is the same deck with a rule where the break was.

### Why `+` and not a comment

Every other tool marks a revealed item with an HTML comment, which Nib publishes
as visible text: a published page shows a note's raw HTML rather than running it.
A `+` bullet is one of CommonMark's three bullet markers, so the list renders
byte for byte as a `-` list would anywhere else. A deck is the only place it
means anything.

### Front matter

Not used, and not needed. The first two rules of a file are its front matter, as
they are in Obsidian, Marp and Slidev; the ones after it are slide breaks.
`title` and `author` are the deck's, the same as for any export.

## Presenting

**F5** (⌥⌘P on a Mac, Keynote's), or Present in the View menu and the palette. The key everyone's hand
already knows, and it sits with the app's other view keys along the F row.
Obsidian's Slides plugin ships no key at all, so no preset takes it back; a
browser keeps F5 for reloading, so on the web the palette is the way in.

The deck opens full screen over the app with the note still open behind it. The
slides are the note through the renderer the reading view uses, with one thing
changed, laid out on a fixed 1280 by 720 stage and scaled to the screen: the words never reflow between
the laptop they were written on and the projector they end up on, and the text is
shrunk until a slide fits so a slide never scrolls.

| Key | |
| --- | --- |
| `→` `↓` `PageDown` `Space` `Enter` | on |
| `←` `↑` `PageUp` `Backspace` | back |
| `Home` `End` | the first slide, the last |
| a number then `Enter` | that slide |
| `N` | the speaker notes, as a sheet |
| `P` | the presenter's own window |
| `Esc` | leave, with the caret on the slide that was up |

A click or a tap on the right half goes on, the left half goes back, and a swipe
does the same on a phone. Swipe up for the notes.

### The presenter's window

On a machine with a screen the audience is not looking at, it opens on that
screen by itself: the slide that is up, the one after it, the notes and a clock.
The arrows work in it, so the deck can be moved from the notes. `P` asks for it
anywhere else, including in a browser, where it is a window of its own.

It is a page of its own (`presenter.html`) rather than the app again, so it holds
no workspace, no sync and no editor. The two windows talk over a broadcast
channel; see `apps/desktop/src/lib/slides/presenter.ts`.

## Writing a deck

The rules that break a deck are drawn in the accent colour while the note is a
deck, so the breaks are visible as they are written. The colour and nothing
else: there used to be a bead of accent in the margin beside them and it read as
a list bullet, so a test now refuses anything drawn in front of a rule line.
An `___` rule is left alone, because that is the one that does not break a slide.

The palette has New slide, Next slide and Previous slide. New slide writes the
rule with the blank line above it and leaves the caret on the empty slide after
it; the other two move the caret. There is no second editor: a deck is a note.

## Out of the app

- **Export slides as HTML** writes one file that holds the whole talk - the
  slides, the theme, the fonts the maths needs and the pictures - and turns its
  own pages. Nothing is fetched, so it can be emailed.
- **Export slides as PDF** is the same file with no script in it: every slide is
  on the page and the print rules give each of them a sheet the size of the
  stage.
- A **published** note that is a deck offers Present, which serves it at
  `?slides`. The same renderer and the same markup rules as the page itself; the
  page's own stylesheet rather than the app's, like everything else a blog
  serves.

## Where it lives

| File | |
| --- | --- |
| `packages/markdown/src/slides.ts` | a note read as slides. Pure |
| `packages/markdown/src/deck.ts` | a deck as a page that stands on its own: the markup and the script an exported file and a published one share |
| `apps/desktop/src/lib/slides/stage.ts` | the stage arithmetic and the navigation. Pure |
| `apps/desktop/src/lib/slides/render.ts` | the slides through the app's renderer |
| `apps/desktop/src/lib/Slides.svelte` | the stage on screen |
| `apps/desktop/src/lib/slides/Presenter.svelte` | the second window |
| `apps/desktop/src/lib/slides/file.ts` | the two exports |
| `packages/themes/src/slides.css` | one stylesheet, three places |
| `services/sync/src/blog.ts` | `?slides` on a published note |
