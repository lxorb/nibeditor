# Import

Somebody has four years of notes in another app. This is the hour that decides
whether they ever use nib: not the editor, not the sync, but whether the notes
they already have arrive whole, once, without being asked forty questions on the
way in.

So: one row in File called Import, one sheet, and one rule behind all of it.

## One door

The sheet takes what the reader has. A zip out of Notion, a `.enex` out of
Evernote, a Takeout folder out of Google Keep, a Logseq graph, a Roam JSON, a
TextBundle out of Bear or Craft, a folder of markdown out of anything, a CSV out
of Airtable, a `.note` out of Tomboy, an HTML export out of OneNote, an
`AppleJournalEntries` zip out of Apple Journal, the folder an Apple Notes
exporter wrote, and a Word file or an ePub for pandoc to read. Drop it in, or
press the same panel to pick it.

On a Mac there is one more row, because Apple Notes has no export at all: the
sheet reads the database Notes keeps, and nothing is dropped.

**Nobody picks a format.** A reader who exported their notes yesterday knows what
they exported; what they have in front of them is a file, and every one of these
formats says what it is if you look at it. A `.enex` can only be Evernote. A
32-character id on the end of every file name can only be Notion. A `journals/`
folder beside a `pages/` folder is a Logseq graph. A TextBundle's `info.json`
names the app that wrote it. So the sheet looks, and says what it found; a format
menu in front of that is a question with one right answer, asked of the person
least able to answer it.

What the sheet then shows is what it is **about to make**: how many notes, how
many other files, where they go, and what is not coming with them. Not the
folders: a note that holds notes is a note here, so they are already counted
among the notes. Counts rather than a list, because a reader importing four thousand notes
cannot read a list of four thousand notes.

## Where it lands

Two rows. `Into` is the space and folder, through the same picker that moving a
note uses, so it is a list the reader already knows how to read. `Under` is the
row below it, which names what the import makes for itself inside that - not
"folder", because a row that holds notes is a note here and the word is gone
from the interface. It is named after the
file that was picked - `Travel.enex` becomes `Travel` - or after the app it came
out of when the file's name is one an exporter made up, which `Export-9f1c2d3e`
is.

Everything is written through `write_note` and `write_bytes`: the two commands
saving and pasting already use. So sync sees the files, the link index sees them,
version history has them, the file list has the rows before the sheet closes, and
none of it knows whether it is running on a desktop, in a browser or on a phone.

**Nothing is written over.** A name that is taken steps aside the way a new note's
does - `Plan 2.md` - and the links inside the import follow it, so an import that
landed beside notes of the same name still points at its own notes.

**The whole import is one thing to undo.** However many thousand files it wrote,
what somebody did was import once. Undoing takes the files away outright rather
than into Recently deleted: what an import wrote was never a note anybody kept,
and three thousand rows in the trash would bury whatever is actually in there.

## What a link becomes

A link to another note becomes a wikilink. That is nib's own way of pointing at a
note, it survives the reader renaming it afterwards where a path does not, and it
is what the graph, the backlinks and the unlinked mentions read.

A link to anything else - a picture, a paper, a spreadsheet - stays a markdown
link with a relative path, which is what the app writes when a picture is pasted
and what keeps the folder readable in another editor.

A link to something that was not in the export is left exactly as it was. An
address into the app it came from is a fact about where the note used to live.

## What each format becomes

**Notion.** A folder per page that has pages under it, a file per page, and an id
on the end of every name. Take the ids off and that is exactly nib's own shape, a
note and a folder of the same name, so a Notion workspace arrives as the tree it
looked like in Notion. A page's properties, which Notion writes as lines under
the title, become front matter. A database is a CSV beside a folder of its rows'
pages: the CSV becomes the folder's note, holding the table, and the rows come in
as the notes they already were. Notion writes the table twice, once as the view
that was on screen and once as every row; the second is the one that is read,
because a filtered view is a question somebody asked on a Tuesday and the rows
are the data.

**Evernote.** One `.enex` per notebook, holding a note each: title, body, dates,
tags, and every attachment as base64 in the same file. Two notebooks become two
folders; one becomes none, since one file is the import itself. `<en-media>`
points at an attachment by the MD5 of its bytes, which is why nib computes MD5:
without it, a note with two pictures gets them in whatever order they were
stored. `<en-todo>` becomes a task list, because that is what it was drawn as.
`<en-crypt>` is text encrypted with a passphrase nib does not have and never
will: those are marked with an ellipsis and counted out loud.

**Google Keep.** Takeout writes a JSON, an HTML copy and the attachments per
note. The JSON is read. A list becomes a task list with the boxes in the state
they were left in, labels become tags, and the dates come over. Colours do not: a
colour is how a note was found on the Keep wall, and the wall is what nib's
search, tags and picture of the space are for. What was in the bin stays in the
bin - Keep would have thrown it away within the week - and the count is said.
Archived notes go to a folder called Archive, because an archive is a place
rather than a property.

**Bear.** Markdown already, so almost nothing happens. The one thing that is
Bear's own is a tag with a space in it, `#two words#`, closed with a second hash,
which nothing else reads as a tag at all. Those become `#two-words`.

**Logseq.** A graph folder: `pages/`, `journals/`, `assets/`, and `logseq/` for
the app's own settings, which are not notes. `key:: value` becomes front matter.
`((a-uuid))` is a reference to one block: nib has block links of its own, but they
point at a block by a name that note carries, and a Logseq uuid is not that name,
so a reference is replaced with what the block said and the count is given. `TODO`
and `DONE` in front of a bullet become boxes. A journal is renamed to the date it
is, so a year of them sorts in the file list.

**Roam.** One JSON holding the whole graph. A page becomes a note whose words are
a nested list, which is what the tree looked like on screen. `((uid))` is written
out the same way Logseq's is, `{{[[TODO]]}}` becomes a box, `^^text^^` becomes
`==text==`, and a daily page called `September 11th, 2026` becomes `2026-09-11`,
in a folder of its own.

**Craft**, **Ulysses**, **iA Writer**, **Obsidian** and anything else that writes
markdown are read as what they are: files in folders, some notes and the rest the
pictures those notes point at. A TextBundle is unwrapped on the way past, so
`Iceland.textbundle/text.md` is the note `Iceland.md` with its assets beside it.

**OneNote** only through an HTML export, and it says so: the words are kept and
the look is not. Which is the honest summary of every HTML import.

**Tomboy** and Gnote: one `.note` file each, XML, with a markup of their own that
the HTML converter would drop on the floor, so it is walked here instead.
`<link:internal>` is a link to another note by its title, which is exactly a
wikilink, so a Tomboy notebook arrives with its links still working. A notebook
is a tag of the form `system:notebook:Work`, which becomes a folder.

**Airtable**, and any other bare CSV, is the one import with a real choice in it,
because the same file is honestly two things. A recipe list is a table. A reading
list where every row has a page of notes behind it is forty notes, and a table of
their titles is worse than useless. So the sheet asks, once, with the answer that
is right more often already chosen.

**Apple Journal.** Journal's own export, which the app writes under Settings:
`AppleJournalEntries`, holding `Entries/` with one HTML document per entry and
`Resources/` with the photos, videos and recordings, plus a JSON per file saying
when it was taken and where. The HTML goes through the same converter every other
HTML export does, and the two things the document says about itself are lifted out
first: the day, which becomes `date`, and the title, which becomes the note's name
and its heading. So an entry arrives as one note named `2026-09-04 Evening on the
lake`, a year of them sorts in the file list, and the media land in `assets/`
beside them, which is where a picture pasted into a note goes.

The day comes from the entry's own file name rather than from the line Journal
draws above it, because that line is written in the language of the phone it came
off and `Freitag, 5. Dezember 2025` is a date nothing in here is going to read.

A mood, a walk and a place are cards Journal draws: whatever they say in words
comes over with the words, and the drawing does not come over at all. The count is
given. Photos are HEIC, which only Apple's own software shows, and that is said
too rather than left as a file that opens nowhere.

**Apple Notes** arrives two ways, because Notes has no export. What it offers is a
PDF per note, which is a picture of a note rather than a note.

The first way is a folder somebody else's exporter wrote - the `Exporter` app, a
Shortcut, a script - which is a folder per notebook and a file per note with the
attachments beside them. Those are read as what they are, and what says the folder
came out of Notes is Apple's own HTML: every one of those exporters asks the
system for the note's rich text, and macOS writes rich text the same way wherever
it is asked. An exporter that wrote markdown instead says nothing about where the
markdown came from, so that folder is read as a folder of markdown, which is what
it is. An attachment that Notes pointed at by its address on the old machine -
`file:///Users/…` - is found among the files that came with the export and pointed
at where it landed; one that did not come with the export is left as it was, like
every other address into the app a note came from.

The second way is the Mac itself. `~/Library/Group Containers/group.com.apple.notes/NoteStore.sqlite`
is where Notes keeps everything, and reading it is what Obsidian's importer does;
the crate does the same, behind a macOS gate, and the sheet offers it as one row
where a reader will see it. A note's body on that row is a gzipped protobuf: the
note's plain text once, and a run per stretch of it saying what that stretch is.
Headings, boxes, lists, quotes, code, bold, links and highlights all come over;
the highlight arrives as `==marked==` without the coloured circle Obsidian writes,
because nib has one highlight. A link from one note to another becomes a wikilink
the way every other export's links do. A tag or a mention is a run of its own in
Notes, and arrives as the words it drew.

What does not come over is said before anything is written: notes behind a
password, which are encrypted with a passphrase nobody here has; notes in Recently
Deleted, which stay there, the same rule Keep's bin gets; drawings and scanned
pages, which are a picture Notes draws itself; tables inside notes; and
attachments that are in iCloud rather than on the disk.

macOS keeps that folder behind Full Disk Access, so the first read is refused by
the system. The sheet says so in a line and opens the setting, rather than leaving
a reader to find the pane themselves.

## Dates and tags

Every one of these exports knows when each note was written, and the moment it is
imported every file on disk says it was written today. So what the export knew
goes into the note: `date` for the day it was made, which is the key nib already
reads, and `updated` only where the export knew a different last-edited day.

Tags come over as `tags` in front matter, which is where nib's search reads them,
tidied to something a tag can be: no spaces, no punctuation on the ends, and the
slashes kept, because a nested tag is nested in both apps.

## Attachments

A picture, a paper or a recording arrives beside the notes, and the note points at
it with a relative path. In the browser build the bytes go to the same store a
pasted picture goes to; showing a note-relative picture there is a separate matter
that the browser build does not do for a pasted picture either.

## Pandoc

A Word file, an ODT, an ePub, a LaTeX paper: pandoc reads those, and pandoc is a
program on the machine rather than a reader in here. The sheet recognises them,
says so, and offers the one button that can work - which asks for the file once
more, because a program takes a path where a drop zone took bytes. Where pandoc
is not installed it says that instead of pretending.

## Convert syntax

The import reads an export, which is one moment. The palette's `Convert syntax`
is for the notes that arrived some other way: a folder copied across, a space
synced out of Bear, a note pasted from a friend. Same rewrites, run on demand,
in this note or in the whole space, with the count shown before anything is
written and one thing to undo afterwards.

Three rewrites, which are the ones that actually break something. Bear's closed tags
become tags. A Zettelkasten id link, `[[202201011200]]`, points at a note by the
timestamp it was made at; nib names such a note `202201011200 The title.md`, the
way its own unique-note command does, so a link to the bare id points at nothing
until it is written out in full.

And Roam's own markup, with the importer's own rules: `{{[[TODO]]}}` and
`{{[[DONE]]}}` become `- [ ]` and `- [x]`, `^^text^^` becomes `==text==`, and
whatever else a `{{[[…]]}}` wrapped becomes the word it wrapped. A line that is
already a list item gets the box and no second marker; a line that is not becomes a
task, marker and all. Nothing inside a fence, where braces and carets are code. And
`((block-ref))` is left exactly as it was: outside a Roam graph nothing knows what
that block said, and a converter that dropped it would be a converter that lost
words - which is the same thing the importer does with a uid it has never seen.

Roam's `[[page]]` is deliberately not in the list: it is already a wikilink and
already means what it says here. Which is worth writing down, because it is the
one people ask about.

## The limits, said plainly

An import is held whole in memory so it can be counted before it is written,
which puts a ceiling on it: half a gigabyte. The count is of what has already
been read, so the ceiling is a refusal to write rather than a guard on the way
in: over it, the sheet says so and Import is not offered. An `.enex` of a decade of clipped web pages can
be larger than that, and the answer there is Evernote's own option to export a
notebook at a time.

A note's own formatting survives as far as markdown goes, and no further. What
was a coloured table cell in Notion is a table cell; what was a Keep note's
colour is nothing. This is the trade markdown makes everywhere else in nib too.
