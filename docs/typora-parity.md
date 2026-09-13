# Typora parity checklist

Every feature Typora ships, tracked to done. Sourced from Typora's own docs
(Markdown Reference, How-Tos index, Shortcut Keys, Export, File Management,
Draw Diagrams, release notes through 1.14).

Legend: `[x]` done · `[~]` partial · `[ ]` todo · `[-]` deliberately skipped

## 1. Block elements

- [x] Paragraphs (blank-line separated)
- [x] Line break with `Shift+Enter`
- [x] Line break via two trailing spaces
- [x] Line break via `<br/>`
- [x] Headings `#` … `######`
- [x] Setext headings (`===`, `---` underlines)
- [x] Blockquotes `>`, arbitrarily nested
- [x] Unordered lists (`*`, `+`, `-`)
- [x] Ordered lists (`1.`), custom start numbers
- [x] Nested lists, indent/outdent with `Tab` / `Shift+Tab`
- [x] Loose vs tight list rendering
- [x] Task lists `- [ ]` / `- [x]`, clickable checkboxes, a menu row that makes
      one and `Ctrl+Enter` to tick the one under the caret
- [x] Fenced code blocks with language identifier
- [x] Indented code blocks
- [x] Math blocks `$$`
- [x] Tables with alignment (`:---`, `:---:`, `---:`)
- [x] Footnote definitions `[^id]:`
- [x] Horizontal rules (`***`, `---`, `___`)
- [x] YAML front matter, drawn as the rows it says; see section 17
- [x] Table of contents `[toc]`
- [x] Callouts: GitHub's alerts and Obsidian's syntax in one. Thirteen types and
      the other names for them (`tldr` and `summary` are `abstract`, `hint` is
      `tip`), each with its own icon and colour, a title of your own after the
      type, and a `-` or `+` after it saying whether it opens shut. A type
      nothing knows is still a callout, under its own name, so a theme can dress
      it with one rule and nothing has to be registered anywhere first
- [x] Comments, hidden in the editor, in the reading view, in every export that
      renders the note - plain text, RTF, HTML, Word, ePub, a picture, a printed
      page - and on a published page and the glasses: a note to the writer stays
      one. The one export that keeps it is Markdown, which is the note itself
      byte for byte with its wikilinks resolved, and the comment is already in
      the file on disk; see export/markdown.ts. Both spellings, the HTML one and
      Obsidian's `%%like this%%`, read by one scan that leaves code exactly as
      written
- [x] Page breaks for export
- [x] Definition lists (Pandoc)
- [x] Abbreviations (Pandoc)

## 2. Span elements

- [x] Inline links `[text](url "title")`
- [x] Reference links `[text][id]` + `[id]: url`
- [x] Shortcut reference links `[text][]`
- [x] Internal heading links `[text](#heading)`
- [x] Autolinks `<url>` and bare `www.` / `http(s)://`
- [x] Images `![alt](path "title")`
- [x] Emphasis `*` / `_`
- [x] Strong `**` / `__`
- [x] Combined strong + emphasis
- [x] Inline code with backtick runs
- [x] Strikethrough `~~`
- [x] Escaping with `\`
- [x] Emoji shortcodes `:smile:`
- [x] Inline math `$…$`
- [x] Subscript `H~2~O`
- [x] Superscript `X^2^`
- [x] Highlight `==text==`, in six colours: a colour emoji at the start of the
      highlight, which is exactly what Obsidian 1.14.0 writes - "Add a color emoji
      (🔴, 🟠, 🟢, 🔵, 🟣) to the start of a highlight to change its color".
      Five colours, because five is what the emoji say, and the plain highlight is
      the sixth answer; Obsidian has no yellow emoji because a plain highlight is
      already its yellow. The six sit behind one word in the Format menu - a
      Highlight colour row under the Highlight row that keeps the shortcut - and
      behind one dot beside the highlight button on the formatting bar, where they
      are the row of dots the app asks every other "which colour" with. The last
      colour chosen sticks: that button, the shortcut and the table's own `h` all
      write it from then on. Drawn from `--canvas-1` and its
      neighbours, the six tones the canvas and the charts already use, so the
      editor, the reading view, every export and a published page all tint one
      highlight the same. The emoji itself never reaches a page, an export, a
      search or the glasses: it is the colour, not a word of the note
- [x] Underline via `<u>`
- [x] Smart punctuation (curly quotes, en/em dashes, ellipsis), off by default
- [x] Ligatures: `->`, `<=`, `!=` and the like shown as arrows and signs, in prose and code, text untouched (off by default; the choice follows the account)

## 3. HTML support

- [x] Inline HTML spans with styles
- [x] Block-level HTML passthrough
- [x] `<iframe>` embeds, as the click-to-load card a provider's address becomes:
      the domain and a play mark, the room the tag asked for, and nothing fetched
      until it is pressed. Then the page in a frame sandboxed without
      `allow-same-origin`, with no forms and no way to move the window. The same
      card in the editor, in the reading view and on a published page, where it
      is a link out; only `https`. Typora loads the frame the moment the note
      opens, which tells whoever is behind the address that the note was read
- [x] `<video>` / `<audio>` embeds with relative paths
- [x] HTML escaping in image attributes (XSS-safe)
- [x] HTML preserved through export
- [x] HTML escaped when publishing (blogs share a domain)
- [x] HTML escaped for a document that is not the reader's own: one in a space
      somebody else can reach, one being typed in by a peer in a room, anything
      a guest's session can see, and anything markup has been pasted into. The
      passthrough above is a feature of a local document, and this is where a
      document stops being local; the rule is `apps/desktop/src/lib/trust.ts`
- [x] A block with a script in it runs, which neither Typora nor Obsidian does:
      both render the markup and drop the script. In a document of the reader's
      own it is a card that runs the block, once pressed, in a frame with an
      opaque origin; in a note anybody else can reach it is escaped like the
      rest. Raw HTML and not an ` ```html ` fence, so the same file still shows
      its markup in the other two
- [x] A content policy the app runs under, which Typora has none of: no element
      on any page may carry an event handler, nothing may be loaded from a third
      party, and a note cannot post anywhere but over https. One copy, in
      `apps/desktop/src/csp.ts`; see docs/conventions.md

## 4. Math and academic

- [x] KaTeX rendering, inline and block
- [x] Auto-numbering for headings (CSS counters, toggleable)
- [x] Footnote rendering + back-links
- [x] Auto-numbering for equations
- [x] Cross references to numbered equations (`\label` / `\eqref`)
- [x] Chemical equations (mhchem)

## 5. Diagrams

- [x] ` ```mermaid ` - every Mermaid type, lazily loaded
- [x] ` ```flow ` (flowchart.js legacy)
- [x] ` ```sequence ` (js-sequence legacy syntax, drawn by Mermaid)
- [x] Diagram export in HTML/PDF
- [x] Mermaid syntax highlighting inside the fence
- [x] ` ```chart ` - bar, line, pie and donut, drawn without a library, so a
      published page gets one too. See section 17
- [x] A diagram on a published page, which Typora has no notion of and Obsidian
      Publish draws in the reader's browser out of a megabyte of library. nib
      draws it in the app instead - the side that has a DOM, which is what mermaid
      needs to measure text in - and sends the SVG up as a blob named by a hash of
      the fence, the way the favicon and the author's theme already travel. The
      page writes a picture where the fence stood; an unchanged diagram is the same
      hash and costs nothing, and a fence nothing has drawn yet stays the code
      block it was. Two pictures per diagram, one per scheme, because an `<img>` is
      a document of its own that the page's colours never reach into and because
      `prefers-color-scheme` inside one would answer the reader's system rather
      than the theme button on the page. A reader fetches it from the site itself
      and nothing from anybody else. See docs/publishing.md

## 6. Code fences

- [x] Syntax highlighting for ~150 languages
- [x] Auto-pair brackets and quotes
- [x] Tab/indent behaviour inside fences
- [x] Language selector on the fence
- [x] Line numbers (toggle)
- [x] Copy button
- [x] Code block themes independent of app theme
- [x] What the block is, written after the language: ` ```ts src/main.ts `. The
      first word is the language and the rest is the caption, which is what every
      other markdown reader already ignores, so a note with captions in it opens
      unchanged anywhere else. `title="setup.js"`, which some editors write, is
      read as the same thing. It sits on the block's own top row, on the left,
      level with the language on the right, and steps aside while the caret is in
      the block and the fence's own line is showing. On a page and in an export it
      is a caption over the block

## 7. Tables

- [x] Insert via `Ctrl+T`
- [x] Editable cells, written straight back as pipe-aligned markdown
- [x] Reorder rows and columns
- [x] Insert/delete row and column
- [x] Per-column alignment controls
- [x] Keyboard navigation (`Tab`, `Enter`)
- [x] Columns sized to content, CJK-aware
- [x] Resize columns by dragging
- [x] Paste TSV/CSV as a table
- [x] Sort by a column, from the button on it. Numbers sort as numbers and dates
      as dates, so 9 comes before 10 and a column of prices reads as money; blank
      cells go last whichever way the column runs, and rows that tie stay in the
      order they were written. It is an edit and not a way of looking: the rows
      really are reordered in the file, so the sort survives being read anywhere
      else
- [-] Merged cells - a pipe table has no way to say it, and writing an empty cell
      after a filled one would be a file that says something the table does not
      mean. Coloured header rows are a theme's business: `#write th` already
      carries a tint and a rule

## 8. Images

- [x] Drag-and-drop insertion
- [x] Paste from clipboard, persisted to an `assets/` folder
- [x] Relative and absolute paths
- [x] Rendered inline in the editor
- [x] `typora-root-url` front matter
- [x] Resize handles, written back as `style="zoom:N%"`
- [x] Zoom / preview on click
- [x] `![[shot.png]]` is a picture wherever it is written, and a bare file name
      is looked for anywhere in the space. Sound and film go the same way; see
      section 17
- [-] Custom image uploader integration - a hook for third-party upload CLIs
      (PicGo, uPic). Sync already carries images; a second upload path would be
      a second place for them to live.

## 9. File management

- [x] Open folder as a space
- [x] File tree panel
- [ ] Articles (flat file list) panel - not built, on purpose: the file list
      shows one kind of thing and a note that holds notes is a note, so a second
      flat list of every note would be a second answer to the same question.
      See docs/tree.md
- [x] Outline panel, with the note's footnotes under its headings, and a heading
      draggable to move its whole section; see section 17
- [x] Create, rename, duplicate, delete files and folders
- [ ] Reveal in Explorer / Finder - not built, on purpose: nib is a notes app
      rather than a file manager, and the folder a note sits in is how the app
      finds it rather than something the reader is asked to hold. What still
      reaches the file manager is an export the reader just made, which is
      revealed where they put it
- [ ] Copy file path - the same, for the same reason
- [x] Tabs, `Ctrl+Tab` switching
- [x] Reopen last files on start
- [x] Drag to move
- [x] Sort by name, modified, created
- [x] Show hidden files toggle
- [x] Recent files, and pinning notes and folders
- [x] Undo move/rename/delete
- [x] Auto-save, for a note in a space, where it is not an option but the way the
      note works. A file opened from the computer is saved when asked.
- [x] A file opened from outside every space is watched: it reloads quietly when
      another program writes it, and keeps what is in the editor when there is
      something unsaved to lose
- [x] The line endings a file already had are the ones it is written back with
- [x] Version history and recovery

## 10. Search

- [x] Find `Ctrl+F`, find next/previous. nib's own bar rather than CodeMirror's
      panel: one `.nib-field` under the tab strip with the three flags inside it,
      a live count beside it, the two steps and a cross, at the row scale so a
      thumb gets a finger-sized target. The same component the reading view and a
      PDF already used, which is what makes finding one thing wherever you are
      reading. See FindBar.svelte and find.ts in @nib/editor
- [x] Replace `Ctrl+H`, replace all, on a second row the chevron opens
- [x] Regex, case-sensitive and whole-word toggles, inside the field
- [x] Quick open / fuzzy finder `Ctrl+P`
- [x] Global search across the space `Ctrl+Shift+F`
- [x] `#tag` search, with the space's tags listed by use

## 11. Editing modes and view

- [x] Source code mode `Ctrl+/`
- [x] Focus mode `F8`
- [x] Typewriter mode `F9`
- [x] Fullscreen `F11`
- [x] Zoom in/out/reset
- [x] Toggle sidebar `Ctrl+Shift+L`
- [x] Outline and file tree panels, plus Search and Links, which is the four
      the sidebar has; no Articles - see section 9
- [x] Word count (words, characters, lines, reading time), and with something
      selected the words and the characters read as `3/47w` - this many of that
      many. No word for it and nothing to turn on: the second number is what the
      bar said a moment ago. Every cursor's range counts, not only the first
- [x] Custom context menus everywhere
- [x] Floating editor toolbar
- [x] Writing area width control
- [x] Line and paragraph spacing controls
- [x] RTL support

## 12. Editing behaviour

- [x] Auto-pair brackets, quotes, markdown symbols
- [x] Smart punctuation, toggleable, and off out of the box. Typora has it on;
      nib would rather hand back the characters that were typed, because a note
      is a file other tools read. It never touches a line that is a thematic
      break, a setext underline or a front-matter fence: `---` typed on its own
      line stays `---`, so a rule, a slide break and a metadata block can all be
      written from the keyboard
- [x] Select the word `Ctrl+D`, select the line `Ctrl+L`. A second `Ctrl+D` takes
      the next one like it, which is where the extra cursors come from
- [x] Clear formatting `Ctrl+\`
- [x] Change list type via shortcut and context menu
- [x] Spellcheck (native, in the editor), on out of the box, with one switch to
      turn it off and the dictionary the machine is set to
- [x] A dictionary of your own. See section 17: it is not the system's
- [x] Every shortcut from Typora's table
- [x] A row in Paragraph for each of the blocks that had none: a task list, a
      callout, a footnote, a table of contents, front matter and a picture
- [x] Copy as Markdown / paste as plain text, and a plain copy that carries the
      note as HTML as well, so a paste into Word or mail keeps its formatting
- [x] Strict mode
- [x] One switch for what a single newline is. Off, which is CommonMark and what
      every other reader does with the same file: a paragraph hard wrapped over two
      lines is one paragraph. On, a note reads the way it was typed. Obsidian asks
      the same question the other way round and calls it strict line breaks, which
      is what the sentence under the switch says. The one renderer answers it, so
      the reading view, every export, a card on a canvas, the clipboard HTML
      flavour, a hover preview and a published page cannot disagree about the same
      note - a published page reads its author's answer off the account. A deck
      keeps its single breaks whatever the switch says, because a slide is a poster
      and its lines are placed rather than flowed
- [x] One setting for how a link to a note is written: `[[wikilinks]]`, which is
      what nib has always written and the default, or markdown links with the
      shortest name, a path from this note's folder, or a path from the top of the
      space - the same four answers Obsidian gives across two settings. It decides
      only what is written: both spellings are read whatever it says, so a space
      may hold both and nothing already written changes. Every writer in the app
      goes through one function, so a split, a passage lifted out, a block's Copy
      link, a page cited out of a PDF and an import that has just moved a note all
      write the same spelling
- [x] Text snippets
- [x] Convert and reformat markdown

## 13. Themes and appearance

- [x] CSS theme files loaded from a themes folder
- [x] Theme switching without restart
- [x] Dark mode + light mode
- [x] Follows system appearance on first run
- [x] One built-in theme, in a dark and a light state, and a store to install
      more from
- [x] Typora CSS variable compatibility (`--bg-color`, `--md-char-color`, …)
- [x] `#write` container contract
- [x] Custom fonts (via a theme)
- [x] Custom CSS injection separate from themes
- [x] Code block themes
- [x] More contrast, as a theme. Asking for more contrast asks for a different
      look, so it is the `contrast` theme in the store rather than a switch beside
      the mode: one palette per look, measured against the page it is read on,
      with text at 21:1 in both schemes, the muted words and the hairlines far
      enough up to be read and seen, and an accent of its own. It is installed,
      updated and taken off like any other theme. A theme states the four
      `--syntax-*` tokens as well, so the syntax in a fence is a theme's to answer
      too. A system asking for more contrast is shown that theme once, on a fresh
      install, and never asked again

## 14. Export

Ten formats, in one fixed order in the File menu, the palette and the shortcut
settings. None of them needs anything installed.

- [x] Plain text (headings as lines, aligned columns, links as `words (url)`)
- [x] Markdown, as written, with wikilinks turned into relative links
- [x] TextBundle (version 2), and `.textpack` where a folder cannot be handed over
- [x] RTF 1.5, with tables, footnotes, links and embedded pictures
- [x] PDF (the webview's print engine on a desktop, the print dialog elsewhere)
- [x] JPG and PNG, the whole note at two device pixels
- [x] HTML with styles, fully self-contained, and HTML without styles
- [x] Word `.docx`, with real styles, numbering, footnotes and maths as OMML
- [x] EPUB 3 (epubcheck: no errors, no warnings)
- [x] Print styles, and a page break before a second top-level heading
- [x] Print, through the platform's own dialog, off the same page an export writes
- [x] Pictures carried into every format, off the disk and off the network
- [x] Export settings (paper size, orientation, margins, header/footer)
- [x] Per-file export config in YAML front matter (`export:`)
- [x] A remembered target folder, and the finished file revealed

Still pandoc's, and offered only where pandoc is installed:

- [x] OpenOffice `.odt`
- [x] LaTeX
- [x] MediaWiki
- [x] reStructuredText
- [x] Textile
- [x] OPML
- [x] RevealJS presentation

## 15. Import

- [x] Import via pandoc (docx, odt, rst, textile, epub, …), from the File menu.
      Now one row of the sheet below rather than a row of its own: the sheet
      recognises a Word file and hands it to pandoc, and says so where pandoc is
      not installed instead of hiding the row
- [x] Notes out of another app: Notion, Evernote, Google Keep, Bear, Logseq, Roam,
      Craft, OneNote, Tomboy, Airtable and any folder of markdown, read from the
      export the reader already has, in one sheet, on every platform. See
      docs/import.md and section 17
- [x] A PDF, as pages to write on. One more row of the same sheet: the paper goes
      into the space byte for byte, so Obsidian still opens it, and a `.pages` note
      lands beside it whose pages are that paper's pages. Nothing is baked in - no
      folder of PNGs - each page names the file and the page, and the picture is
      rendered from the paper when it comes near the view. Which is also the answer
      to Samsung Notes, GoodNotes, Notability and Apple Notes, none of which
      documents its own format and all of which export PDF; see docs/pages.md for
      what can and cannot be read, and why

## 16. System integration

- [x] Multiple windows, and a window that stays over every other application
- [x] Open from shell / CLI with arguments
- [x] File association for `.md`
- [x] Taskbar Jump List - opened notes go to the shell's own recent documents
- [x] Application logs
- [x] UI translations (English, German, Swiss German, French, Japanese; falls
      back to English)
- [x] "New Markdown" in Explorer's New menu - a per-user registry entry, added
      and removed from Appearance settings
- [x] Auto-update - looks every six hours, downloads what it finds and puts it
      in place as the app closes. Which stream it follows is one setting in
      General; the updater key is in tauri.conf.json and the private half is a
      release secret.
- [x] Android share target - anything shared to nib becomes a note: the words
      under a heading with `date` and `source` in the front matter, pictures and
      files beside it in the folder the Attachments setting names, and a shared
      `.md` as itself. Through `applyImport`, which is the road every import
      already takes, so a name steps aside rather than overwriting and the lot is
      one undo. Where a note is open and the share is words and pictures, the
      same small sheet the app asks every question with asks whether it goes
      there instead, and the words land at the caret. A `.md` opened from a file
      manager or a mail attachment comes in the same way
- [x] Quick settings tiles on Android - New note, Search, and Record for the
      recorder, each carrying the id of a row in the app's own command registry
      and nothing else, so a tile cannot drift from the row it is named after.
      The recorder's service is disabled until that command exists
- [x] A home screen widget on Android - the space's name, a search and a new
      note along the top, then the notes last written in, each opening that note.
      A note pinned in the app comes first, which is how one chosen note is
      reached from the home screen. The page decides the rows and hands them
      over; the launcher only draws them, in the app's own colours, light and dark
- [x] Take a photo into a note - a `capture` file input, which is the camera app
      on Android and on a phone browser, and the photograph lands beside a pasted
      picture with the embed at the caret. Offered only where the glass is under a
      finger, since a desktop ignores `capture`
- [x] Voice dictation - the phone's own recogniser on Android and the Web Speech
      API everywhere else, inserting at the caret in turns while the line across
      the top of the document says it is listening. Nothing is recorded and
      nothing is uploaded
- [-] Syncing in the background on Android. The mirror is the page's, and Android
      stops a paused webview's timers and freezes a cached process, so it does not
      run while the app is away; a WorkManager job cannot drive it without a
      second implementation of the whole protocol in Kotlin holding a copy of the
      session token. A note is a file on disk either way and the next pass pushes
      it, so what is lost is time rather than notes. See docs/mobile.md

## 17. Beyond Typora

Features Typora does not have, which are the reason this exists.

- [x] Accounts, passwordless email sign-in
- [x] Spaces, each a folder of markdown
- [x] Cloud sync, offline-first, conflict-preserving
- [x] Publish a space as a blog, on a subdomain or your own domain
- [x] MCP server exposing notes to any LLM client
- [x] Command palette
- [x] Motion system across the whole interface
- [x] Folding: a chevron in the margin beside anything that folds, `Ctrl+Alt+[`
      for whatever the caret is in, `Ctrl+Alt+]` to open all of it, and a row in
      View for folding the note down to its headings. Headings, list items with
      children, indented blocks, fences and callouts all fold, and the caret is
      never folded out of sight: it comes up to the line that owns the fold.
      What is folded is remembered per note per device and never written into
      the note, with one exception that is not ours. Obsidian's `-` after a
      callout's type says that callout opens shut, so nib reads it, folds it on
      the way in and never rewrites it. Every chevron stands in one column beside
      the writing, never on the block it folds: a fence, a callout and a heading
      all inset their own text by different amounts, and the mark backs out by
      exactly that much. Folding moves rather than blinks - the lines shrink and
      fade together, the fold lands when they have gone and the mark that is left
      fades in, and opening runs it backwards - so nothing under the block jumps.
      Reduced motion makes all of it instant
- [x] Obsidian's Fold more and Fold less, which take a note one level at a time:
      more folds every block at the deepest level that still has something open,
      less opens the shallowest level that has something folded, and the two walk
      each other back press for press. Neither holds a number. What a level is is
      read out of the note every time - how deeply a foldable block sits inside the
      others, which is what the syntax tree already says: a subsection inside a
      section, a child item inside its item, a fence inside a callout - and what is
      folded is read out of the folds. So nothing is stored, nothing is reset by an
      edit, and there is no invisible "which level are we on?" to get out of step
      with the screen. Neither ever touches a block a fold above it has already
      taken off the screen, so every press changes something or answers no. Two
      rows in View and in the palette, on no chord, which is where Obsidian leaves
      them too
- [x] A mark in the margin beside every block. Take hold of it to move the block,
      where a heading's block is its whole section, the way folding and the
      outline already mean it; the line it would land on is drawn as it is
      dragged, and the blank lines that make two paragraphs two paragraphs travel
      with it, so a list stays a list. Press it instead and it opens the menu a
      right press already opens, with three rows about the block at the top:
      duplicate it, delete it, and copy a link to it. Above them, quietly, what
      the block is and how many words are in it. Everything there acts on every
      block a selection covers, because a selection is a selection of text and
      never a mode. Only where there is a pointer: a finger has no hover and the
      margin is a thumb wide, so a long press opens the same menu
- [x] A link to a block: `[[Note#^a1b2c3]]`, with the name written at the end of
      the block where Obsidian writes it and shown nowhere. A heading is linked by
      its own words instead - `[[Note#The plan]]` - which needs no name and
      changes nothing in the note. Wherever one of these lands, the block it
      landed on holds a tint for long enough to find and then lets go of it: a
      caret is one pixel wide and the eye was somewhere else. The same mark for a
      bookmarked heading and a search result, and it goes at the first thing you
      do. A whole block, except a heading, whose block is its section - tinting a
      chapter to say "this heading" would be shouting
- [x] A bookmark of one block, from the mark in its margin. It points the way a
      link does, so a heading is kept by its words and anything else is given the
      same `^name` a link would give it, and the row is the block's own first
      words, because `^a1b2c3` is not something to read in a list. Opening it
      lands on the block with the tint above
- [x] A tab can be pinned. It sits at the head of its strip wearing only its
      mark - the icon the note chose, where it chose one - refuses the cross,
      `Ctrl+W` and the menu row until it is let go of again, and is never the tab
      a click in the file list takes over. What somebody keeps open all day, kept
      open: the daily note, the one being written towards. Pinning keeps the note
      as well, since a tab nobody wants taken over is a tab that is being kept,
      and a pin survives a restart. There is no default key for it, because the
      tab it is done to is already in front of you
- [x] Back and forward, per tab. A tab that moves on from one note to another
      leaves a trail, and `Alt+Left` and `Alt+Right` walk back along it and on
      again - the keys every browser uses, and the mouse's own two side buttons
      as well. Two arrows appear at the head of a strip that has been anywhere,
      each saying whether it can go, and the whole trail is behind a right press
      on the back one, newest first, to jump straight to any of it. Turning off
      halfway drops what was ahead, the way it does in anything that goes back
      and forward. On a Mac it is `Ctrl+[` and `Ctrl+]`: Alt and an arrow there is
      a word at a time and has been for forty years, and Cmd and a bracket is
      indenting here. Where a trail lands is where that note was left, through the
      places the app already keeps per note, and a trail lasts the sitting
- [x] Stacking tabs as columns to scroll sideways through is deliberately not
      built. What it is for is the trail, which is the entry above and which works
      in one pane, in a split, and on a phone - where columns of tabs cannot exist
      at all, since a handheld holds one document. Two notes side by side is
      already a split, up to four with linked scrolling; a third arrangement of
      the same tabs would need a second answer to every question the first two
      have settled
- [x] The outline and the links panel can be held on one note while another is
      written in the pane beside it: an outline to read down on the left, the note
      it is about on the right. One press in the panel's own row holds it and
      lets it go, the note it is held on is named quietly over it, and pressing a
      row takes you to that note wherever it is open. It lasts the sitting - a
      panel held on a note nobody remembers holding it on is worse than one that
      simply follows - and it is not offered on a handheld, which has one document
      and so nothing to hold a panel against
- [x] Bookmarks in groups. A group is a name with a twist in front of it, holding
      whatever is dragged onto it, nested as deep as it is useful, and it opens
      and shuts on this machine while the group itself travels with the account.
      Dropping a row between two rows of a group joins the group, which is what
      the line drawn there says. Removing a group dissolves it: what was in it
      comes up to where the group was, because the bookmarks were the point and
      the group was the shelf
- [x] Several cursors. Alt and a click puts another one down, Alt and a drag adds
      a whole range to what is already selected, Alt+Shift and a drag takes a
      column of them, and Escape leaves one. `Ctrl+D` grows to the word and then
      to the next one like it; adding a cursor straight above or below is
      `Ctrl+Alt+Shift+Up` and `Ctrl+Alt+Shift+Down`, because the chord every
      other editor uses for it splits the pane here. Selecting every one like
      what is selected has no key free and is in the palette. Each cursor reveals
      the syntax it is standing in, and each selection draws its own block
- [x] A `/` at the start of a line or after a space opens the blocks a note is
      written out of, filtered as you type. Enter inserts one and takes the slash
      with it, Escape leaves it alone, and a slash that names nothing stays a
      slash, so `and/or` and `24/7` are words. The rows are the ones the
      Paragraph menu and the palette show, out of one list, in the popup that
      `[[` and `:emoji:` already open
- [x] `[[##` and `[[^^`, for the link you want to write without first remembering
      which note it is in. `##` offers every heading of the space, each row the
      heading with the note it is in muted beside it; `^^` offers every block,
      starting with the ones that already answer to a name and then the lines the
      words themselves find. Picking one writes `[[Note#Heading]]` or
      `[[Note#^id]]`, so the file is Obsidian's spelling and nothing in it is
      nib's, and a block that had no name is given one by the same writer the
      grip's Copy link uses. Neither reads a space: the headings and the names are
      already in the index, and the words are found through the app's own search -
      one question, once two characters are in, and the popup filters what came
      back rather than asking again per keystroke. In the popup `[[`, `:emoji:`,
      `/` and a snippet already open
- [x] `#` finishes a tag the space already uses, with the notes under each counted
      beside it, so one thing keeps one name: `#reading` and `#Reading` are two
      sets of notes and nothing on the screen says so until it is too late. The
      whole path is the row, so a `/` narrows to the level under it and `canvas`
      finds `work/nib/canvas` without the two levels above it being typed out.
      Where a tag can be, and nowhere else: after a hash that opens a word, never
      in the middle of one, so `C#` and a URL's fragment are left alone; never in
      code, maths or an address; and at the start of a line it waits for a letter,
      because `# ` there is a heading and a popup on the way to one is a popup in
      the way. Inside the front matter it answers under a `tags:` key as well -
      on its own line, after a comma, or under an item of the list - where a tag
      is written without the hash because YAML reads one as a comment
- [x] `aliases` in a note's front matter, whichever of the three ways YAML writes
      a list. `[[Roadmap]]` finds the note that declared it, the completion
      offers an alias under the note's own name, and backlinks and unlinked
      mentions count it. A file really called that always wins, so a note can
      never shadow a real one. A rename rewrites the links that spelled out the
      filename and never an alias: that is a name the writer chose, not a path
- [x] Files a note embeds, in Obsidian's spelling, so the note travels. A
      recording (`![[take.mp3]]`) and a film (`![[demo.mp4]]`) are the browser's
      own player, plainly, with no frame around them and nothing playing until
      somebody presses play. A paper (`![[paper.pdf#page=3]]`) and a plane
      (`![[Board.canvas]]`) are a card saying which file it is, which opens it at
      the page the link named. `![[shot.png|300]]` or `|300x200]]` is how wide to
      draw it, and anything else after the bar says what it is. The same four in
      the editor, in the reading view, in an export and on a published page; on
      the glasses each is one line, its name behind the picture mark
- [x] A page from somewhere else, written as a picture:
      `![](https://youtube.com/watch?v=…)`. Nine places are known - YouTube,
      Vimeo, X, Spotify, SoundCloud, Figma, CodePen, Loom and Google Maps - and
      everything else stays the link it was. Nothing is loaded from any of them
      until the reader asks: what the note renders as is a card the size the
      frame will be, saying whose page it stands for, and a click swaps in a
      sandboxed frame with only the permissions that provider needs. The card is
      a real link, which is what makes one piece of markup right everywhere: a
      published page runs no script of any kind, so there the same click simply
      takes the reader to the page. YouTube is framed from `youtube-nocookie.com`,
      and a frame tells the provider which site asked and never which note
- [x] ` ```chart ` fences, in the shape the Obsidian Charts plugin reads
      (`type`, `title`, `labels`, and `series` with a `title` and `data` each),
      drawn as `bar`, `line`, `pie` or `donut`. Built as an SVG out of the
      numbers with no charting library at all, which is what lets a published
      page draw one; the colours are the theme's, and the scale rounds to numbers
      somebody would have chosen. Chart.js's other hundred options are not read:
      a bar chart always starts at zero and a chart is always the width of the
      column. A fence holding no chart stays code, and on the glasses a titled
      chart is its title
- [x] A note's front matter drawn as the rows it says: the key on the left, the
      value in the control its shape asks for - a list as chips, a `true` as a
      checkbox, a date as a date - and nib's own `export:` page setup as its
      pairs. A block like every other block, so the caret going into it shows the
      YAML, and a click on a row puts the caret on that row's own line. That is
      why there is no setting for rows or source: the source is the editor, and a
      second way of editing metadata would be a second thing to keep in step with
      the file. `Add a property` at the foot writes a new key and leaves the caret
      on it. One rule for everything else: if any line of the block is a shape nib
      cannot read - a Dataview query, a comment - the **whole** block stays
      source, because half a table is a table that lies about the file. The rows
      show in the reading view too, and nowhere outside the app: front matter is
      about the note rather than part of it, and every export already leaves it out
- [x] A dictionary of your own. The menu over a word offers to add it, and from
      then on the wavy line under it is gone, wherever it appears, on every
      device: the list follows the account. Settings has it under Spelling, to
      read and to take words back from.

      What it is not, said plainly: nib does not spell-check - the webview does,
      and no browser on any platform lets a page ask which words its checker
      thinks are wrong, read its suggestions, or add one to a dictionary. So what
      this does is turn the checker off over the words you have added, which is
      the whole of what adding a word is for, and nothing more. The word is not
      learned by the system, so another app still underlines it, and nib cannot
      offer a correction for a word that really is misspelled
- [x] Dragging a heading in the Outline moves its whole section: the heading and
      everything under it, to where it was dropped. Two edits and never a
      rewrite, so a note open in a second pane keeps every caret outside the words
      that moved, and it is one thing to undo; a caret inside the section travels
      with it. Nothing is re-levelled - a `###` dragged above a `#` is still a
      `###`, because a drag is a move and rewriting the hashes answers a question
      nobody asked. The one move refused is a section dropped inside itself. On a
      touch screen a held finger opens the menu before a drag could start and a
      browser fires no drag events from a touch anyway, so there it is a `Move`
      row that asks where, the way moving a file is
- [x] The note's footnotes under its headings in the Outline: what each one says,
      with its label, and a click that goes to the mark in the words rather than
      to the definition at the bottom. In the order the words reach them, with the
      ones nothing points at after and drawn quiet - worth seeing precisely
      because nothing points at them
- [x] Recently deleted: notes and spaces wait 14 days before they are gone
- [x] Selecting several notes with Ctrl and Shift, moved or deleted together
- [x] Running a JavaScript fence from the note (`Ctrl+Enter`, or the play button
      on the block), with console output, the value of the last expression and
      errors in a panel under it. The code runs in a sandboxed iframe with an
      opaque origin and a `default-src 'none'` policy, so it reaches neither the
      app nor the network, and a run is stopped after ten seconds. Nothing of it
      is written to the note, saved or exported.
- [x] The space as a picture: every note a dot, every link between two of them a
      line, as a tab of its own from the palette, and the neighbourhood of the
      open note in the Links panel. One surface for both, since the only
      difference is which graph it is handed. A click opens a note, a second click
      keeps it, a note dragged somewhere stays there, and the view frames the
      whole thing until you pan it yourself and then never moves again
- [x] A card in the corner of that picture, folded away to one button until it is
      wanted, holding only what changes what the picture tells you. A field that
      narrows it, in the space search's own language: bare words, `"a phrase"`,
      `-` to exclude, `OR`, brackets, `path:`, `file:` and `tag:`, so a habit from
      the search carries over. What a picture can answer is narrower than what a
      search can and the placeholder says so: a note is its name, its path and its
      tags there, because reading five thousand notes off the disk to answer one
      keystroke is not a filter. `[key:value]`, `line:(a b)` and `content:` want
      the note's own lines, so they narrow nothing rather than quietly emptying the
      view.
      Then: a switch for the notes nothing links to, which in a young space are
      most of them and all of the clutter; a switch for the files the notes embed -
      pictures, PDFs, sounds, films - as nodes of their own, each joined to the notes
      that embed it and drawn as a square where a note is a dot. Off by default,
      because unlike every other switch on the card that one is a different graph
      rather than a different drawing of one: the notes have to make room for the
      pictures, so the arrangement is made again. One node per file however many
      notes embed it and by whatever path, which is how a vault names its
      attachments; a `[[shot.png]]` written without the bang is still a link to a
      file rather than a node. Then: up to six colour groups, each a query
      and one of the six colours the theme names, tapped to change; one Spread
      dial; a Gather switch; a three-step Lines dial; Arrows; Size by links; the
      space played through in
      the order it was written, with a scrub bar; and Reset. All of it kept per
      space on the account, so the picture is the way you left it on every machine
      you sign in on, which is why there is nothing to bookmark
- [x] Arrowheads that say which note reached for which, and two heads on a pair
      that link each way. The graph still answers "these two are connected",
      because that is what a picture of a space is looked at for, but it remembers
      which end wrote the link and the heads are how it says so. Off by default: a
      space where most links are read both ways is a space full of arrowheads
      saying nothing
- [x] Names that fade in as the view comes in, rather than four hundred of them
      appearing at once on one notch of the wheel. A threshold that follows the
      zoom, so there is nothing to set
- [x] One link out from the open note, two, or three, as a stepper beside the
      picture switch in the Links panel, remembered with the rest of the space's
      graph. Not four: at four most spaces answer with the space, and the space is
      a tab away
- [x] Hiding a note is not re-arranging the space. The filter, the orphan switch
      and the moment the scrub bar is at all arrive as one byte per note, so the
      notes that stay do not move and turning a switch costs one frame rather than
      the five seconds a fresh arrangement of five thousand notes takes. Only the
      two forces lay it out again, because only they change where a note goes
- [x] Sixty frames a second panning a space of five thousand notes and ten
      thousand links, which came down to one line: a link is drawn one pixel of
      the screen wide rather than one of the page's. Above one device pixel the
      graphics stack tessellates every stroke into geometry, and ten thousand of
      those measured 1200 ms a frame against 17. The notes' own dots, their names
      and the arrowheads are all free by comparison
- [x] One three-step Lines dial on the card: thin, the hairline the picture has
      always had, and thick. The cliff is at one device pixel exactly - measured
      again for the dial, on the same five thousand notes: 20 ms a frame at one
      device pixel and 3.6 seconds at one and a quarter - so thick is not a wider
      stroke. It is the same hairline stroked three times, a device pixel apart in x
      and in y, which reads as a line two device pixels wide whichever way it runs
      and measured 20.5 ms a frame against the 19.3 the cleared canvas costs on its
      own. Four strokes is where it starts to show, at 24 ms, so three is the
      brush. graph-paint.test.ts holds every step to one device pixel, and graph.py
      pans at each of the three
- [x] `task:`, `task-todo:` and `task-done:`: a task item as something to search
      for, held to one item the way `line:` is held to one line, so
      `task-todo:(ledger send)` wants both words in the one task. On its own
      `task-todo:` asks which notes have an open task at all, which is the question
      most often asked of a space and the one thing a group with nothing in it can
      mean: there is no such question about a line. A row is the task rather than
      the note's first line, with its box in front of it, and the box works -
      ticking it writes the one character into the note without opening it, through
      the same path a replacement takes, so no caret in a pane moves and it is one
      thing to undo. A space is not done and anything else is, which takes in the
      marks a theme gives a task of its own
- [x] `content:` for the note's own words. A bare word reads the whole file, front
      matter and all, so a note whose `project:` row says Nib answers `nib`;
      `content:nib` answers only for the notes that say it where a reader would see
      it, which is the question asked of a space whose notes all carry the same
      dozen keys. One narrowing of the region the word is looked for in rather than
      a second walk of the note, so it costs a bare word's search and nothing more,
      and `case:` and a nearness group reach into it like any other term. The
      picture of a space cannot hear it and says so by narrowing nothing, the way
      `[key:value]` does
- [x] Front matter held against a value rather than only read: `[pages:<200]`,
      `[due:>2026-09-01]`, `[pages:100..200]` with both ends in, `[status:=done]`
      for a value that is exactly this where the bare form takes a part of it, and
      `[due:null]` for a key the note has not got. Numbers compare as numbers and
      dates as the words they are written in, which for a date written this way
      round is the same answer and one the Rust side cannot arrive at differently;
      anything else compares as words, so a date held against a number falls back
      to something rather than comparing a clock against five
- [x] The field finishes the operators, not only their values. Typing `ta` offers
      `tag:`, `task:`, `task-todo:` and `task-done:`, in the popup that already
      finishes a path, a name and a tag. Nothing is preselected for a name, so a
      reader typing the word "task" still has Enter mean Enter. What was dropped: a
      card listing all fourteen of them. A reference card in a 300px panel is
      documentation, and the reminder belongs where the typing is
- [x] Results in the order you want to read them: relevance, which is the order
      the search answered in, or by name, modified or created. Behind a press on
      the Search tab, which is where the file list's own sorting already lives, and
      remembered per device rather than per space: the order a list is read in is a
      habit of whoever is reading it, and the file list keeps its own the same way.
      The guesses stay under the answers whatever the order
- [x] A space leaves notes and folders out of what it says about itself: the
      search does not walk them, the picture of its links does not draw them, and
      the mentions of a note do not count them. They are still there to open and
      still sync; the space has simply stopped asking them things. The way in is a
      row's own menu, and the rows say so quietly. Paths rather than patterns,
      because a row always names a note or a folder and a folder stands for
      everything under it, which is the only pattern a file tree needs; a glob
      would be a second language beside the search's own, in a settings pane
      nobody asked for. Skipped before the file is read on both builds, and asked
      of the note's own ancestors rather than of the list, so leaving a thousand
      notes out costs a search nothing
- [x] A ` ```query ` fence: a search written into a note, answered where it
      stands, in the editor and in the reading view. The Search panel's own rows, a
      word over each note, live boxes on the tasks, and a click that opens the note
      at the line. It answers again whenever a note is saved. The fence stays a
      `query` fence, which is Obsidian's own spelling, so a note carrying one opens
      there as a code block rather than as something broken - and a published page
      leaves it as code too, deliberately: a page is one file served from a cache,
      answering a query over the space would be one read per note on every view,
      and a list baked at publish time is a lie the moment another note is written
- [x] The papers in a space answer a search, at the page: a row says which page of
      which PDF, and opens it there. A page's words are taken down when the viewer
      reads them, which it does anyway for its own find bar, so opening a paper
      makes it answerable at once and no search ever waits for a PDF to be taken
      apart. They are then kept, keyed by the hash of the file's bytes, so a paper
      read last week answers today and a paper whose bytes have changed is read
      again. The papers nobody has ever opened are read one at a time in idle time
      after the notes, a breath between pages, never on the way up and not at all on
      a device that has asked to be spared. Bounded on both sides: as much of one
      paper as a thousand dense pages, as much of every paper as a shelf of them,
      the largest going first. What was refused: reading every PDF in a space when a
      search runs, which makes the first search of a space with twenty papers a
      minute long, and reading them all at launch, which spends that minute whether
      anybody searches or not
- [x] The mentions of a note - the places its name is written without a link -
      are asked the way everything else is asked: the space search, handed the
      name as a phrase. One search, so they count an alias, they skip what the
      space leaves out, and they cannot answer differently from the panel above
      them. They were asking a command that does not exist on either build, which
      is why nobody had ever seen one
- [x] A note found by something no line of it says - its path, its name, a tag, a
      front matter value - shows its own words rather than its front matter fence.
      A row saying `---` says nothing about the note it is about, and a note found
      by `[pages:>200]` is exactly the note that has one
- [x] Notes out of another app, in one sheet: a zip, a folder or a file, dropped or
      picked, on a desktop, in a browser and on a phone. Nobody picks a format,
      because the file says what it is: a `.enex` can only be Evernote, a
      32-character id on the end of every name can only be Notion, a `journals/`
      folder beside a `pages/` one is a Logseq graph, and a TextBundle's own
      `info.json` names the app that wrote it. What the sheet shows is what it is
      about to make - how many notes, how many files, how many folders, where they
      go, and what is not coming with them - in counts rather than a list, since
      somebody importing four thousand notes cannot read a list of four thousand
      notes. Twelve formats between them: Notion, Evernote, Google Keep, Bear,
      Logseq, Roam, Craft, OneNote, Tomboy, Apple Journal, Apple Notes, a bare
      CSV, and any folder of markdown, which is what half of these apps write when
      asked nicely. See docs/import.md
- [x] A Notion export arrives as the tree it looked like in Notion. Notion writes
      a folder per page that has pages under it and an id on the end of every
      name; take the ids off and that is exactly nib's own shape, a note and a
      folder of the same name. A page's properties, which it writes as lines under
      the title, become front matter. A database is the folder's own note, holding
      the table, with the rows as the notes they already were - and of the two
      tables Notion writes, the one with every row in it is the one read, because
      a saved view is a question somebody asked on a Tuesday
- [x] An import is written through the same two commands saving and pasting use,
      so sync sees the files, the link index sees them, version history has them
      and the rows are in the file list before the sheet closes. Nothing is written
      over: a name that is taken steps aside the way a new note's does, and the
      links inside the import follow it. And however many thousand files it wrote,
      the whole import is one thing to undo, because what somebody did was import
      once
- [x] A link between two imported notes becomes a wikilink, which is what survives
      the reader renaming one afterwards and what the graph, the backlinks and the
      mentions read. A link to a picture or a paper stays a markdown link with a
      relative path, which is what a paste writes. A link to something that was
      not in the export is left exactly as it was: an address into the app it came
      from is a fact about where the note used to live
- [x] What the export knew about a note goes into the note. Every file on disk says
      it was written today the moment it is imported, so the day it was made is
      written as `date`, which is the key nib already reads, and the last-edited
      day as `updated` only where the export knew a different one. Tags become
      `tags`, tidied to what a tag can be
- [x] Apple Journal, through the export Journal itself writes:
      `AppleJournalEntries`, an HTML document per entry under `Entries/` and the
      media under `Resources/`. One note per entry, named after the day it was
      written so a year of them sorts, with the day as `date` and the title as the
      heading. The day is read from the entry's file name rather than the line
      Journal draws above it, because that line is in the language of the phone it
      came off. Media land in `assets/` beside the notes, video included, which the
      HTML converter drops. HEIC pictures and the cards Journal draws itself - a
      mood, a walk, a map - are counted and said
- [x] Apple Notes both ways there are, because Notes has no export of its own and
      its "Export as PDF" is a picture of a note. A folder somebody's exporter
      wrote is read as Apple Notes by the one sign those exporters share, which is
      Apple's own rich-text HTML, and an attachment the note points at by its old
      `file:///` address is found among the files that came with it. And on a Mac,
      the database Notes keeps: `NoteStore.sqlite`, a note's body a gzipped
      protobuf, read by the crate behind a macOS gate the way Obsidian's importer
      reads it. Headings, boxes, lists, quotes, code, marks, links between notes
      and tags all come over; passworded notes, the bin, drawings, scans, tables
      and attachments still in iCloud are counted and said. Full Disk Access is
      what macOS asks for, and the sheet says so and opens the setting
- [x] A checkbox comes over as a checkbox, wherever it was one: Evernote's
      `<en-todo>`, a Google Keep list item with its tick, Logseq's `TODO` and
      `DONE`, Roam's `{{[[TODO]]}}`. A box is a box
- [x] What an import cannot carry is said before it is written rather than logged
      afterwards: the passages Evernote encrypted and nothing can read, the notes
      Keep had in the bin and leaves there, the colours a Keep note had, the block
      references written out as the words they pointed at, the saved views a Notion
      database had. One short line each, under "Worth knowing"
- [x] `Convert syntax`, for the notes that arrived some other way than through the
      sheet: a folder copied across, a space synced out of Bear, a note pasted from
      a friend. Two rewrites, which are the two that actually break something -
      Bear's `#two words#` becomes `#two-words`, and a Zettelkasten id link is
      written out as the note whose name begins with that id, which is the shape
      nib's own unique-note command writes. In this note or in the whole space,
      with the count shown before anything is written and one thing to undo
      afterwards. Roam's `[[page]]` is deliberately not in the list: it is already
      a wikilink and already means what it says here
- [x] What a note said before, kept on the account as well as on the device: a
      month of versions, one every five minutes at most, thinned to one an hour
      after the first day. The device's own history is instant and goes back
      further, and it is keyed by the note's path on that machine - so a rename
      orphans it, another machine never sees it, and a laptop that dies takes it
      with it. The account's is keyed by the note's id, which is the one name for a
      note that every device agrees on, and the history sheet shows the two as one
      list with the device beside each version the account holds. A version is a
      body the account was already sent, stored under its own hash, so nothing is
      diffed, nothing is sent twice and two notes that say the same thing cost one
      object. See docs/sync.md
- [x] A space, or one folder of it, put back to how it read at a moment, for the
      day a device syncs something wrong over everything. It says how many notes
      would change before it changes any, and what it writes is a new version of
      each - so a rollback is an edit like any other and can itself be undone
- [x] One choice about the same note being written in two places, on the account
      rather than on the device because it is a decision about the notes: keep both
      copies, which is what nib has always done and still the default; let the
      newest win, which is only safe because the words that lose are in the
      histories above; or be asked, which leaves the note alone, holds the other
      copy, and does not push until somebody answers. A canvas is none of the three
      and never was: both copies merge, because everything on one has an id. A page
      note is a canvas, so it merges too - the same function, and two devices that
      each added a page end up with both pages
- [x] Page notes: sheets of paper in a column, written on with the pen, which is
      what a tablet is for and what Samsung Notes and Apple Notes are. A4, Letter or
      a page that grows as far down as somebody keeps writing; the canvas's own four
      rulings; thumbnails in the outline panel's slot, where the shape of what is
      open already lives, with a drag to reorder and a page counter in the status
      bar. The same bar, the same ink and the same palm rejection as the canvas -
      literally the same components, because two ink engines is two places to fix
      anything. The file is JSON Canvas with a page written as a node the spec names,
      so renaming a `.pages` file to `.canvas` opens it in Obsidian and back again
      loses nothing. Out as a PDF with the ink as vector paths on the original
      paper - the text stays text - or a PNG or an SVG per page. See docs/pages.md
- [x] What synced, said quietly: the last few dozen passes, one line each, with
      what came down, what went up and what went wrong in the server's own words.
      On the device, and only for a pass that did something - a log of "nothing
      happened" every twenty seconds is a log nobody reads, and a table on the
      server would be a write per pass for something almost nobody looks at
- [x] A second code when signing in, from an authenticator app, with ten one-shot
      recovery codes shown once. Not passkeys, and the reason is written down: a
      passkey is bound to one origin, and nib runs at `tauri://localhost`, at
      `127.0.0.1` on a fresh port every launch inside the glasses plugin, and at
      its own domain on the web - so a passkey would work on the web and refuse to
      exist on the other two, which is a second class of reader rather than a
      second factor
- [x] The sessions an account has open, by the device that opened each and when it
      was last seen, with any of them endable and a row for ending every one but
      this. Which is the half that matters more: a second factor stops somebody
      getting in and says nothing about somebody already inside, and until now a
      session row said nothing but its own hash
- [x] A space pulled or pushed without the app, for a repository of notes that
      publishes from CI. No new credential and no second API: the `nib_` token that
      already exists for an LLM connector now reaches the sync routes as well, and
      `scripts/nib-sync.mjs` is forty lines of fetch over the change feed. Not a
      delete, ever - a script that can delete is a script that can empty a space on
      a bad `if`
- [x] Models, brought rather than sold: Claude, OpenAI, and anything that speaks
      OpenAI's shape, which is Ollama or LM Studio on this machine and OpenRouter
      or a gateway behind it. A key goes in the device's own store - the
      Credential Manager, the Keychain, the Secret Service, Android's encrypted
      preferences - and never on the account, in a note or in a log; a browser
      keeps it in IndexedDB and the pane says so in one line rather than
      pretending. The model list is asked for, never written down. Neither
      Anthropic nor OpenAI lets a third-party app sign anybody in with a Claude or
      a ChatGPT subscription, for anybody, so the two honest options are the two
      offered: your own key, or a model on your own machine. See `docs/ai.md`
- [x] A question as a block of the note: a ` ```ai ` fence holding the prompt, a
      triangle on its header row that asks it and becomes a square that stops it,
      and the answer streamed in as ordinary markdown underneath, under a quiet
      italic line saying which model said it and on what day. Two HTML comments
      around the answer are what a second press replaces, so asking again does not
      stack answers; every renderer hides a comment and nib strips both spellings
      before rendering anything, so they show nowhere. Which means the note opens
      in Obsidian with no plugin at all: the question is a code block and the
      answer is prose. `@note` in the prompt sends the note as context, and a
      prompt that does not say it sends nothing but itself
- [x] Four rewrites on a selection, behind one row in the editor's menu: shorter,
      longer, the grammar fixed, or translated into the interface language or one
      picked. What comes back arrives as a diff against what was selected, in the
      rows the version history already draws, and is kept or thrown away before
      anything is written - a model replacing a paragraph is the one gesture here
      that can lose work, and by the time an undo has been read the paragraph is
      off the screen
- [x] `nib://` links, the way `obsidian://` works, so a shortcut, a launcher or
      another program can open a note, a heading or a block, make a note or add to
      one, search, or run any row the palette knows. On a desktop the installer
      registers the scheme and a second launch hands the link to the window that is
      already open; on Android an intent filter on the one activity; on the web
      `web+nib://`, which is the only shape a browser lets a page register, handed
      back as `?nib=` and taken off the address once it has been followed.
      x-callback-url's `x-success`, `x-error` and `x-cancel` are all three real, so
      a link is a step in a shortcut rather than the end of one - for `nib://new`,
      the one link verb that changes anything; opening, searching and running a
      command answer no callback, because a link's outcome goes to an address the
      link itself chose. A link may ask for
      four things and nothing else, and a test pins the list: writing over a note,
      moving one, deleting one and running code are out of a link's reach, `new`
      refuses a note that is already there unless it was asked to append, and a
      callback goes to `http(s)` or back into nib and nowhere else. A row in the
      palette copies a correct link to what is open, with the heading the caret is
      in on it, which is also how anybody finds out the scheme is there
- [x] A command line that drives the app that is running, the way Obsidian's does:
      `nib files read`, `nib search`, `nib backlinks`, `nib orphans`,
      `nib properties set`, `nib outline`, `nib words`, `nib commands run`,
      `nib sync now`, `nib screenshot`, twenty-six verbs in all. Over a socket the
      app opens on 127.0.0.1 on a port the system hands out at every launch, behind
      a secret in the app's own config folder, and nothing that changes a note runs
      without `--yes` - which the app enforces rather than the script. The same
      dispatcher the links use, so neither road can grow a verb the other lacks or a
      check the other does not have, and every verb is the call the app itself makes:
      a note written this way is snapshotted, undoable and synced like any other
      edit. `eval` is there and off, behind a line in that same file, because it runs
      whatever it is sent with everything the window can reach. See
      docs/automation.md
- [x] A tab can be a website. The page is the system's own engine, placed over the
      pane as a child webview - WebView2 on Windows, which is Chromium, WKWebView on
      macOS, which is WebKit - with back, forward, reload and an address field that
      reads as the site and the page's own title when nobody is typing in it. Ctrl+L
      is the field and Alt with an arrow is the page's history, which is the same key
      a note tab walks its own trail with. The page is hidden when its tab is not
      showing and taken down after five minutes of nobody looking, so a window left
      open overnight holds no browsers
- [x] A website is a document in the space, not a bookmark in a list: a shortcut
      file, `Svelte docs.url`, which is the Windows Internet Shortcut format that
      Explorer and every browser already write and that every system already opens.
      So it is a row in the file list with a globe in front of it, renamable,
      bookmarkable, `[[linked]]` with or without its extension, searchable by its
      title and its address, and carried by the sync, the versions and the trash like
      any other document. `New web note` names it first and asks for the address in
      the bar; `Open a website` starts with the address and writes the file the moment
      the page says what it is called. macOS `.webloc` files are read too and never
      written. Websites written when a website was a note - `url:` in the front matter
      - convert on the first open, or all at once from the palette, and a note that
      had words of its own beyond the link stays a note beside its shortcut. No room
      and no collaboration: there are no words in it to share
- [x] Clip the page a tab is showing into the space, through the same converter the
      browser extension uses: the selection, or the article, as markdown under
      `source:` and `date:`. On a desktop the page is read in the document as the
      reader sees it, through the engine's own script callback rather than through the
      app's IPC, so the page is read without being given anything to call
- [x] A page in a tab gets none of the app and none of this machine: its own cookie
      store, no nib command reachable from it, and the camera, the microphone, the
      clipboard, the location and every hardware bus taken away before its first
      script runs. Two of them can be allowed by hand, per site. In a browser build the
      pane shows a card - favicon, title, origin - with a row that frames the page
      here and a row that opens it in the reader's own browser, because nothing on a
      page can tell a framed site from a refused one: `load` fires, the location
      throws and the document is null in both cases, measured. A phone opens the
      system browser, which has their logins, their blocking and their password
      manager. See docs/web-tabs.md

- [x] A note decides whether it is published: `publish: true|false` in its front
      matter, which is Obsidian Publish's own key, so a vault moves between the
      two without being rewritten. Above it, folder rules and one default in the
      publish sheet, so a space somebody already writes in can put one folder on
      the web and keep the rest. The note wins over every rule: what the author
      wrote in the file is not overridden by a row in a pane
- [x] What a publish will change, before it changes anything: how many pages the
      site will have, which appear and which disappear, by name. Not Obsidian's
      upload dialog, because there is nothing to upload - a nib page is the note,
      live - so the only thing a publish can change is which pages exist, and that
      is what the sheet shows
- [x] `permalink:` sets where a page lives and `aliases:` are the other paths that
      find it, both Obsidian Publish's keys. And the part nobody thinks about
      until it has happened: a path that used to work keeps working. A rename, a
      reconsidered permalink or a dropped alias leaves a permanent redirect
      behind, so no link anybody else wrote ever goes dead
- [x] A password for the whole site, hashed with PBKDF2 and a salt of its own,
      checked by a signed ticket in a cookie that lasts a month. One minimal form
      in the site's own design, no hint, `noindex` on it, and a robots.txt that
      says no to everything while it is on. Setting a new password ends every
      ticket the old one handed out
- [x] `sitemap.xml`, an Atom feed at `feed.xml` linked from every page, and a
      robots.txt that is honest about the site. Atom rather than RSS because it
      says what a date means and what a summary is made of, and every reader that
      reads RSS reads Atom
- [x] The title, the description, the canonical, the Open Graph and Twitter tags
      of a page, from `description` and `image` (or `cover`) in its front matter
      and the site's own defaults behind them. A page that wrote no description
      gets its own first sentence, and one that named no picture gets the first
      picture in it, so the ordinary post has a card without anybody filling in a
      form
- [x] A favicon: the space's own mark, drawn by the app - which is the side that
      has the icon sets - and served at `/favicon.svg`. A space with no icon yet
      gets its letter on the same ground, drawn by the Worker from the name it
      already has
- [x] The authenticator setup shows a square to point a phone at as well as the
      secret to paste, which is what turns thirty-two typed characters into one
      camera
- [x] `Record`: one command, from the palette, the Paragraph menu, the editor's `/`
      menu and the one plus a thumb can reach on a phone. It opens the microphone and
      writes the best container the platform gives - Opus in a WebM on Chromium, AAC
      in an MP4 on WebKit - beside the note, in the same folder a pasted picture goes
      into, through the same command and the same table of what a file name means.
      The note gets `![[recording-2026-09-12-1432.weba]]` at the caret, which draws as
      the player `![[take.mp3]]` already draws; with no note open it makes one. While
      it runs there is one quiet pill in the status bar and nothing else: a red dot, the
      time so far, and a stop. Recording needs nothing but the microphone, so it works
      on a train
- [x] `Transcribe`, on that player's own menu: the file goes through the same Whisper
      path the glasses' voice commands go through - Workers AI first, the account's own
      OpenAI key as the fallback, `POST /v1/ask/heard` - and the words come back under
      the player as one `> [!quote]` callout, headed with the language the model heard
      and with one italic line saying which model wrote it. A recording is decoded here
      and sent as the 16 kHz mono WAV that route has always taken, in pieces of a
      minute, so the file in the note stays the small modern container the platform
      wrote and the Worker needs no decoder at all
- [x] `Meeting notes`: the same recording, in a note of its own with `date` and
      `duration` in its front matter, and the transcript arriving in it every twenty
      seconds while somebody is still talking. Speakers are named only where the model
      named them: nothing on this path knows who was talking, and inventing a speaker
      is worse than not naming one. At stop, a summary - takeaways and the tasks it
      left open - is written above the transcript by whichever model the reader has:
      their own provider through `ai.complete` where there is one, the account's OpenAI
      key through the Worker where there is not. Everything a model wrote says so in
      one quiet line, and nothing else in the note is touched
- [x] Honest about what it costs: a recording stops itself at twenty-four megabytes
      and keeps what it has, a piece of a transcript that fails is tried again on the
      same curve a room rejoins on, the pill's dot says when one is, and the line at
      the top of the document says what went wrong in words. Every piece counts against
      the same hourly allowance the glasses spend, and the route holds a piece to two
      minutes and four megabytes so a Worker is never asked to hold more than it has

- [x] A search box on the site, answered by the Worker over an index written when
      the note was saved: words, a phrase, a refusal, `tag:` and `path:`, which is
      the part of the app's grammar that means the same thing to a stranger. The
      box is a form and the answers are a page, so a reader with scripting off
      searches as well as anybody; every answer is joined to the published pages,
      so a private note can be in the index and never in an answer
- [x] The published pages as a graph, on `/graph` and as a small one under a page
      that has neighbours, drawn by the app's own layout and painter - imported,
      not reimplemented, so a space looks like itself on both surfaces. The same
      pages are listed as words under the canvas for anybody the canvas is no use
      to, and a link to an unpublished note is dropped rather than drawn as the
      hollow node the app shows
- [x] The contents of a page beside it on a wide screen and collapsed on a phone,
      from the same heading list `[toc]` writes - the renderer hands them over, so
      one page cannot have two answers. A `<details>` the stylesheet opens where
      there is a column for it, which is a disclosure with no script at all
- [x] "Linked from" under each page, read off what every other page said about
      itself when it was saved rather than from a link index, and drawn from the
      published list alone: a private note that links here is not named
- [x] A navigation of the published tree with folders as disclosures, the folder
      you are inside open, the page you are reading marked, `order:` deciding
      where a page and a folder sit, and previous and next at the foot in that
      same order. A page the rules leave out is not listed and is still reachable
      by its own address
- [x] A card on hover showing the page a link points at, the app's own preview
      design, fetched when the pointer has been still and kept for the visit. The
      page being previewed is asked for with a header that says so, and the Worker
      answers with the note and none of the furniture
- [x] Light or dark from the reader's system, a button that remembers their choice
      per site, and the author's own theme - one of the ones the app wears, its
      stylesheet uploaded by the app and served from the site. One inline line
      applies the remembered choice before the first paint and the policy names it
      by its own hash; nothing else inline may run
- [x] `publish.css` and `publish.js` at the root of the space, Obsidian Publish's
      own names, travelling with the vault as files rather than living in a
      setting. The stylesheet wins over the site's own and the theme's; the script
      is the one thing on a published page that runs an author's own code, under
      `script-src 'self'` and never inline
- [x] An optional counter: one script URL in the sheet, loaded only when set, with
      that origin named in the policy and the plain sentence that the reader's
      visit goes to whoever serves it. Google Analytics is not offered, because its
      install is an inline script and of all of them it is the one whose business
      is the reader
- [x] A form in a note - a ` ```form ` fence, nib's own grammar since Obsidian has
      none - rendered as a real form that posts and comes back, with the answers on
      the account beside the note that asked, read in the publish sheet and
      exported as CSV. No third party, no captcha, nothing kept about the reader
      but the message, and spam held off by the rate limit every other route uses
- [ ] A mermaid diagram on a published page. Reconsidered rather than assumed: a
      Worker has no DOM to measure text in, the client renderer is about a megabyte
      the Worker would carry for every site including the ones with no diagram, and
      a CDN is what the KaTeX round removed. The way forward is the app drawing it
      at save time and storing the SVG, which is how the favicon and the theme
      already work

### The shell, the phone, and how far back a note goes

- [x] Ctrl and the wheel over the note - which is what a trackpad pinch arrives as
      on every platform - changes the app's own text size in steps, and says what
      it has become as a badge that goes on its own. Never the webview's zoom:
      that would scale the panel and the tab strip with the words, would not be
      remembered, and would not reach the phone or the browser build. The keys
      stay where Typora's are - Ctrl+Shift+= and Ctrl+Shift+-, with Ctrl+Alt+0 for
      actual size - because Ctrl+= and Ctrl+- are Heading up and Heading down in
      the editor and Ctrl+0 is Paragraph
- [x] The bar over the keyboard on a phone holds any command from the app's own
      registry, chosen in Settings > Mobile and kept on the account beside the
      shortcuts. The nine it has always held are the default, so nothing changes
      for anybody who never opens the pane, and a bar nobody has touched is stored
      as nothing at all - which is what lets the default change later and reach
      them. Each button wears a typographic mark where the command has one and the
      first letter of its name where it does not; a row of little pictures would
      mean loading the icon set, which is larger than the app around it
- [x] Pulling a note or the file list down past its top runs one command the
      reader names - search to begin with, and nothing at all for somebody who
      does not want the gesture - with a quiet mark that follows the thumb and
      fills in when letting go would do something. It never becomes the browser's
      own pull-to-refresh, which in a PWA would throw the page away
- [x] Any panel tab can sit on the other side of the window, chosen from its own
      menu, and the right side is empty for everybody until one is moved over:
      nothing is drawn at all, so the left column, the foot row and the tab strip
      are pixel for pixel where they were - which the drive measures rather than
      promises. One component draws both sides; the space's name and the foot row
      stay on the left, because two of either would be two switchers for one
      space. On a phone it is a drawer from the right over the note, dismissed by
      the same scrim, and F6 reaches it as one more region
- [x] A way of looking at the space's graph, kept as a bookmark: the filter, the
      colour groups, the spread, the arrows, the sizes and how far a neighbourhood
      reaches, under a name, in the row above the file list. Pressing it writes
      those settings back and shows the graph, so a space has a second way of
      being looked at without setting the card up again
- [ ] A three-step Lines dial on the graph's control card. Left out: the card
      already holds a filter, a switch for orphans, the colour groups, a spread
      dial and three more switches, and the thickness of a link is the one of
      those nobody would come looking for. The card staying quiet was the
      condition, and a ninth control is not quiet
- [x] How far back the account keeps a note: a month, or a year, chosen in Sync
      and thinned the way a backup is - everything from the last day, one an hour
      to a month, one a day to three, one a week after that. The history sheet is
      cut up by month where a year is kept, and there is a per-account ceiling in
      bytes swept oldest-first, because version bytes do not count against the
      account's own gigabyte
