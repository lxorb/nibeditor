/** Which files are being worked in together, and by how many devices.
 *
 *  A file joins its room when it is open, signed in, and the account holds a copy
 *  of it for the room to be about; it leaves when the last tab holding it closes.
 *  Nothing asks for any of that: the list of what is open is one the app already
 *  keeps, and this follows it. One room per file however many panes show it,
 *  because a note in two panes is one note - the same reason there is one document.
 *
 *  Notes and canvases both. A note's room holds its words as one text; a canvas's
 *  holds the objects on the plane, one entry each, so two people drawing keep both
 *  drawings whole. A canvas also has to wait for its surface: a plane is what the
 *  room is about, and a plane exists once a tab is showing one, so whichever of the
 *  two arrives second joins them.
 *
 *  What joining one room means is next door, in rooms/room.ts and rooms/plane.ts. */

import { type EditorView, sharedOf } from '@nib/editor'
import { account } from './account.svelte'
import type { PlaneSurface } from './canvas/shared'
import { busy } from './busy.svelte'
import { without } from './records'
import { roomKind } from './rooms/kind'
import type { PlaneRoom } from './rooms/plane'
import type { Room } from './rooms/room'
import { deviceAccent, deviceName, personName } from './rooms/who'
import { t } from './i18n.svelte'
import { type Scheme, theme } from './theme.svelte'
import type { NoteDoc } from './workspace/documents.svelte'

/** A file the app has open and the account has a copy of. What this store is
 *  handed; it holds nothing about tabs or panes. */
interface Open {
  /** Which document this is within this run of the app; see NoteDoc.key. */
  key: string
  /** The file's id on the account, which is what names its room. */
  noteId: string
  note: NoteDoc
  /** The account's hash of this file as of the last sync, or null for one it has
   *  never handed over. */
  hash: string | null
  /** And the version the account holds, for the row in the sync pane when the two
   *  copies disagree. Zero for a file with no copy here to disagree with. */
  version: number
}

/** One file in a room: the room, which file the room is about - so a document that
 *  has moved on to another file is noticed and rejoined - and which shape of room it
 *  is, so a file whose name crossed the two is noticed the same way.
 *
 *  The two shapes together, because the kind says which room this is: a plane's room
 *  is about the objects on a surface and a note's is about one text, and only the
 *  second of them has a caret to carry. That used to be asked with `instanceof`,
 *  which is a question only code holding the class can ask - and the classes arrive
 *  when the first room is joined now. The kind was already here and answers it
 *  exactly; see `join`. */
type Joined = {
  noteId: string
  note: NoteDoc
  /** The hash the room was joined against, so a file whose copy on the account has
   *  moved since - a pass settled a disagreement about it, say - is joined again
   *  rather than left in a room that is not carrying it; see `follow`. */
  hash: string | null
} & ({ kind: 'words'; room: Room } | { kind: 'plane'; room: PlaneRoom })

/** The two kinds of room, once they are here.
 *
 *  Collaborating costs yjs, the awareness protocol and lib0 under both of them, which
 *  between them were a tenth of everything the window evaluated before it drew
 *  anything - and none of it means a thing until somebody is signed in, because a room
 *  is only ever joined for a file the account holds. So the engine arrives with the
 *  account rather than with the app; see `reach`. */
interface Engine {
  Room: typeof import('./rooms/room').Room
  PlaneRoom: typeof import('./rooms/plane').PlaneRoom
}

function hex(digest: ArrayBuffer): string {
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

class Rooms {
  /** How many other devices are in each open file, by document key. Where the tab
   *  gets its dots. */
  present = $state<Record<string, number>>({})

  /** The engine, once it is here, and the one fetch of it. Plain fields rather than
   *  state: nothing on the page draws either of them, and `follow` works the pairing
   *  out again when the engine lands. */
  private engine: Engine | null = null
  private reaching: Promise<void> | null = null

  private readonly held = new Map<string, Joined>()
  /** The canvas surfaces on screen, by document key; see `drawing`. */
  private readonly planes = new Map<string, PlaneSurface>()
  /** What was last followed, so a surface arriving after its file can be joined
   *  without the app being asked what is open all over again. */
  private open: readonly Open[] = []

  /** Whether a room now holds the truth of this file, by its id on the account. What
   *  the file sync asks before it writes anything about a note, so it can leave the
   *  ones a room is carrying to the room; see sync/mirror.ts.
   *
   *  One note at a time rather than the whole list at once, because the answer keeps
   *  changing while a pass runs: a room settles the moment somebody stops typing, and
   *  a pass over a space is seconds of round trips. A list taken at the top of one
   *  said nothing about the note whose room settled halfway through, and that note was
   *  pushed as a file against a version the room had just moved past - which the
   *  account refuses, and which the pass read as a second writer.
   *
   *  A room that has been opened but has not yet said what it holds answers no. Until
   *  that moment nothing has been settled and the file is still the best answer
   *  anybody has, so a pass carries on exactly as it did before. */
  carries(noteId: string): boolean {
    for (const one of this.held.values()) {
      if (one.noteId === noteId && one.room.settled) return true
    }

    return false
  }

  /** The open files, as the app now has them. Rooms are joined and left to match:
   *  nothing here is called for a particular file, so no call site can forget one.
   *
   *  Called on every change to what is open, which is rare, and does nothing at all
   *  when the list says what it said the last time. */
  follow(open: readonly Open[]) {
    this.open = open
    const token = account.token
    const wanted = new Map(token ? open.map((one) => [one.key, one]) : [])

    for (const [key, joined] of this.held) {
      // Still open, still the same file, and still the same shape of file: leave it
      // alone. A preview tab that has moved on is another note in the same document
      // and wants another room; a file renamed from a note into a canvas, or back, is
      // the same file wanting another kind of room, and a document of the shape it
      // now is - which is a new one, because the two shapes are not the same
      // document. What is not a reason to rejoin is a path that changed and nothing
      // else: that is a space somebody renamed, and it is the same room.
      const still = wanted.get(key)
      if (
        still?.noteId === joined.noteId &&
        roomKind(still.note.path) === joined.kind &&
        this.ready(still) &&
        !this.answered(joined, still)
      ) {
        continue
      }

      joined.room.leave()
      this.held.delete(key)
      this.present = without(this.present, key)
    }

    if (!token) return

    // The engine comes with the account. Signing in and having a note open can be the
    // same moment, so the first pass through here with a token fetches it and is
    // answered by this same method when it lands - by which time nothing has changed
    // except that the classes are in hand. Nothing is joined in the meantime, which
    // is a file carried by the file sync exactly as it is for a note nobody else has
    // open.
    if (!this.engine) {
      void this.reach()
      return
    }

    for (const [key, one] of wanted) {
      if (!this.held.has(key) && this.ready(one)) this.join(key, one, token)
    }
  }

  /** The collaboration engine, on its way, once.
   *
   *  Reached through `follow` above, which is the app's way of saying that somebody is
   *  signed in and something is open - the only circumstances in which a room is ever
   *  joined. Nothing waits for the answer: what it is for is that by the time a file
   *  is open and tracked the classes are already here, so joining a room is as
   *  immediate as it was when they came with the window. */
  reach(): Promise<void> {
    return (this.reaching ??= Promise.all([import('./rooms/room'), import('./rooms/plane')]).then(
      ([words, planes]) => {
        this.engine = { Room: words.Room, PlaneRoom: planes.PlaneRoom }
        this.follow(this.open)
      },
    ))
  }

  /** A canvas surface arriving, or going.
   *
   *  A note's room is about a text the app holds either way, but a canvas's room is
   *  about the plane a tab is showing, and the tab and the account's list of files
   *  arrive at their own moments. So the surface says when it is there and the rooms
   *  are worked out again, which means neither side has to be second. */
  drawing(key: string, surface: PlaneSurface | null) {
    if (surface) this.planes.set(key, surface)
    else this.planes.delete(key)

    this.follow(this.open)
  }

  /** Everything goes: signing out, or the app closing. */
  clear() {
    this.follow([])
  }

  /** A pane reporting that its caret moved, on its way to the other devices. Which
   *  document the view is showing says which room to tell; see shared.ts in the
   *  editor package. */
  moved(view: EditorView) {
    const shared = sharedOf(view.state)
    if (!shared) return

    for (const joined of this.held.values()) {
      if (joined.note.live !== shared || joined.kind !== 'words') continue

      const at = view.state.selection.main
      joined.room.moved(at.anchor, at.head)
    }
  }

  /** A caret's colour depends on the scheme, so a theme change reaches every
   *  room. */
  repaint(scheme: Scheme) {
    for (const joined of this.held.values()) joined.room.repaint(scheme)
  }

  /** And so does the name over it, which can change while a file is open: a guest
   *  a link let in renaming themselves, or an account choosing a name. */
  rename(person: string | undefined) {
    for (const joined of this.held.values()) joined.room.rename(person)
  }

  /** Whether there is anything for a room to be about yet. Always, for a note; for
   *  a canvas, once the surface has said it is there.
   *
   *  A canvas by its name, not by what the tab holding it was opened as. Those two
   *  can disagree - a session restored from before there were canvases, a file
   *  renamed underneath an open tab - and the name is the one the service also asks,
   *  so it is the one that decides; see rooms/kind.ts. Where they do disagree this
   *  waits for a plane that is never coming, which is a file that collaborates in no
   *  room at all rather than one that joins the wrong shape of room and writes the
   *  wrong thing into it. The file sync carries it in the meantime, exactly as it
   *  does for a note nobody else has open. */
  private ready(open: Open): boolean {
    return roomKind(open.note.path) === 'words' || this.planes.has(open.key)
  }

  /** Whether a room that was waiting on a reader may be joined again.
   *
   *  A note the room and this device disagreed about is out of its room until somebody
   *  answers, and the file sync carries it meanwhile; see rooms/apart.ts. Nothing in a
   *  room can hear the answer - it is given in the sync pane and it touches files - so
   *  what says so is the account's copy of this file moving on, which is what settling
   *  it looks like from out here. Without this the note would stay out of its room
   *  until its tab was closed.
   *
   *  Only for a room that is waiting, so nothing else is ever rejoined for a hash: a
   *  pass lands whenever it lands, and a room in the middle of its own round trip is
   *  not something to throw away and start again. */
  private answered(joined: Joined, still: Open): boolean {
    return joined.kind === 'words' && joined.room.waiting && still.hash !== joined.hash
  }

  /** The room for this file was thrown away by the service and another will be built
   *  out of the file; see `REBUILT` in rooms/door.ts. So this one is let go and the
   *  pairing worked out again, which joins a room with a document of its own. */
  private rebuild(key: string) {
    if (!this.letGo(key)) return
    this.follow(this.open)
  }

  /** Lets one room go: left, forgotten, and nobody in it. Answers whether there was
   *  one, so a caller that goes on to join another does not do it twice. */
  private letGo(key: string): boolean {
    const joined = this.held.get(key)
    if (!joined) return false

    joined.room.leave()
    this.held.delete(key)
    this.present = without(this.present, key)
    return true
  }

  private join(key: string, open: Open, token: string) {
    // Called from `follow`, which does not reach here until the engine has landed.
    const engine = this.engine
    if (!engine) return

    const onPeers = (count: number) => {
      this.present = count ? { ...this.present, [key]: count } : without(this.present, key)
    }

    // Both names, because a caret and a pointer answer a different question
    // depending on who else is there; which one is drawn is decided by whoever is
    // looking. See rooms/peers.ts.
    const who = { name: deviceName(t('Browser')), accent: deviceAccent(), person: personName() }
    const gone = () => this.rebuild(key)

    // The room will take no more keystrokes. Its own sentence is wire text for a
    // client with nothing better; what a reader is shown is the app's own words, said
    // once - the room is let go rather than rejoined, so there is no second keystroke
    // to say it again. The note carries on as a file: what it holds is still this
    // device's, and the file sync still writes it, which is where a note too large to
    // save says so. See `refused` in rooms/door.ts.
    const refused = () => {
      this.letGo(key)
      busy.failed(t('This note is as large as a note in a room may get.'))
    }

    // Whether this document is still on the file this room is about. A document
    // outlives the file in it: the one tab that previews a note takes another note on
    // rather than being swapped for another document, and `follow` above is an
    // effect, so it hears about that a beat after the click. For that beat the room
    // is joined to a file these words are no longer, and this is how it knows.
    //
    // `arrivals` is how many notes the document has held, which is exactly the
    // question - documents.svelte.ts keeps it to tell "the same note, renamed" from
    // "another note in the same tab". The path used to be compared beside it and
    // that was the bug: renaming a space rewrites the path of every open note and
    // keeps every id, so a room in perfectly good order read it as the document
    // having moved on and refused everything in both directions - while still
    // telling the file sync it held the file, which left the note mute on both
    // channels until its tab was closed.
    //
    // Worked out once, for either shape of room. Nothing hands a canvas tab another
    // canvas today, so a plane room is never asked anything but yes; the guard is the
    // room's rather than the note's, and a room that refuses what is not its file is
    // not a thing to remember to add later. See rooms/plane.ts.
    const arrivals = open.note.arrivals
    const holds = () => open.note.arrivals === arrivals

    const shape = {
      noteId: open.noteId,
      token,
      who,
      scheme: theme.current,
      onPeers,
      gone,
      refused,
      holds,
    }

    // Which shape of room this file wants is its name, and nothing about the tab; see
    // rooms/kind.ts, and `ready` above, which is what promises the plane is there.
    const kind = roomKind(open.note.path)
    const surface = this.planes.get(key)
    if (kind === 'plane' && surface) {
      this.held.set(key, {
        room: new engine.PlaneRoom({ ...shape, surface }),
        noteId: open.noteId,
        note: open.note,
        hash: open.hash,
        kind,
      })
      return
    }

    // The words themselves are not handed over: the room reads them from the
    // document when it has something to compare them with, which is a round trip
    // later and may be several keystrokes later. See rooms/room.ts.
    const room = new engine.Room({
      ...shape,
      note: open.note.live,
      hash: open.hash,
      digest: sha256,
      // The one thing a room cannot settle: this device and the room have each
      // written since the words they shared. What happens then is the reader's
      // conflict rule, which is a store's to know and not a room's; see
      // rooms/apart.ts.
      //
      // Both arrive when it comes up rather than with this module. It comes up for
      // one note in a thousand, the rule is a setting and the copy is a file write,
      // and nothing about joining a room should pull either in - this store is the
      // one every launch with a note open evaluates.
      apart: async (theirs) => {
        const [{ apart }, { modes }] = await Promise.all([
          import('./rooms/apart'),
          import('./modes.svelte'),
        ])

        return await apart(
          modes.conflicts,
          { path: open.note.path ?? '', id: open.noteId, version: open.version },
          theirs,
        )
      },
    })

    this.held.set(key, {
      room,
      noteId: open.noteId,
      note: open.note,
      hash: open.hash,
      kind: 'words',
    })
  }
}

export const rooms = new Rooms()
