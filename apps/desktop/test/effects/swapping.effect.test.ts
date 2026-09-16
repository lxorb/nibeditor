import { flushSync, untrack } from 'svelte'
import { expect, test } from 'vitest'
import {
  documentOf,
  editorState,
  EditorState,
  HeldState,
  SharedDoc,
  StateEffect,
  type StateView,
  type TransactionSpec,
} from '@nib/editor'
import { EditorStates, type NoteTab } from '../../src/lib/editor-states'
import { computed, reactive, root, watch } from './runes.svelte'

/** Editor.svelte's effects, run by Svelte rather than by hand.
 *
 *  What a store test cannot ask is what an effect *reads*, and reading one thing
 *  too many here is expensive in a way nothing else in the app is: the effect that
 *  builds the pane's editor tears it down when it runs again, and takes every
 *  other tab's state in that pane with it. It used to read how many notes the
 *  tab's document had held - the key the pane kept its states under was spelled
 *  out of it - so every single click in the file list threw the pane's editor away
 *  and built another.
 *
 *  Only the two effects and what they read are copied here, with a view that has
 *  no DOM. CodeMirror is not the thing under test; when the effects run, and on
 *  what, is. */

const scrolledTo = StateEffect.define<number>({ map: (at, changes) => changes.mapPos(at) })

class Surface implements StateView {
  state = EditorState.create({})
  at = 0
  readonly scrollDOM = { scrollTop: 0 }

  setState(next: EditorState) {
    this.state = next
  }

  dispatch(spec: TransactionSpec) {
    this.state = this.state.update(spec).state
    for (const effect of [spec.effects ?? []].flat()) {
      if (effect.is(scrolledTo)) this.at = effect.value
    }
  }

  scrollSnapshot() {
    return scrolledTo.of(this.at)
  }
}

/** A tab, as much of one as the editor reads. Its own proxy, the way a `$state`
 *  field on the real `Tab` is: how many notes its document has held is reactive
 *  wherever the tab is held. */
function tab(text: string): NoteTab & { adopt(next: string): void } {
  const note = reactive({ live: new SharedDoc(text), arrivals: 0 })
  return {
    note,
    adopt(next: string) {
      note.arrivals++
      note.live.takeOn(next)
    },
  }
}

/** How many views the pane has built. One per pane per sitting is the promise. */
let built = 0
/** How many times a note was swapped into one, which is what a switch costs. */
let switches = 0

/** Editor.svelte: the effect that builds the view, and the effect that shows the
 *  note. Only the reads matter, so only the reads are here. */
function editor(props: { tab: () => NoteTab; kept: () => NoteTab[] }) {
  const states = new EditorStates()
  const box = reactive<{ view: Surface | undefined }>({ view: undefined })

  watch(() => {
    const first = untrack(() => props.tab())
    const created = new Surface()
    created.setState(editorState({ shared: first.note.live }))
    first.note.live.join(created)
    built++

    // Not untracked, exactly as Editor.svelte has it: whatever this reads of the
    // tab, this effect follows - and this effect running again is the pane's
    // editor thrown away. It is `EditorStates` that has to read nothing.
    states.started(first, created, null)
    box.view = created

    return () => {
      states.releaseAll(created)
      box.view = undefined
    }
  })

  watch(() => {
    const view = box.view
    const showing = props.tab()
    if (!view) return

    // The one read that follows the note, exactly where Editor.svelte has it.
    if (!states.shows(showing)) switches++

    untrack(() => {
      states.show(view, showing, () =>
        HeldState.waiting(showing.note.live, editorState({ shared: showing.note.live })),
      )
    })
  })

  watch(() => {
    const view = box.view
    if (view) states.keepOnly(props.kept())
  })

  return { view: () => box.view, states }
}

/** A window: the tabs, which one is up, and which of them are websites. The list
 *  is plain and only the number is reactive, because a tab put into a `$state`
 *  list comes back out as a proxy of itself and would not be the tab any more. */
interface World {
  readonly tabs: NoteTab[]
  readonly websites: Set<NoteTab>
  active: number
}

function window(tabs: NoteTab[], active: number, websites: NoteTab[] = []): World {
  const at = reactive({ active })
  return {
    tabs,
    websites: new Set(websites),
    get active() {
      return at.active
    },
    set active(to: number) {
      at.active = to
    },
  }
}

/** Pane.svelte's branch chain, as much of it as matters: the editor is drawn for a
 *  note and for nothing else, so a website takes the pane and the editor goes. */
function pane(world: World) {
  const showing = computed(() => world.tabs[world.active] ?? null)
  const writing = computed(() => {
    const one = showing()
    return one !== null && !world.websites.has(one)
  })

  const box = reactive<{ editor: ReturnType<typeof editor> | null }>({ editor: null })
  watch(() => {
    if (!writing()) {
      box.editor = null
      return
    }

    untrack(() => {
      box.editor = editor({ tab: () => showing()!, kept: () => world.tabs })
    })
  })

  return { view: () => box.editor?.view() ?? undefined, showing }
}

test('the pane builds its editor once, whatever the notes in it do', () => {
  const preview = tab('First')
  const kept = tab('Kept')
  const world = window([preview, kept], 0)

  built = 0
  switches = 0
  const seen: { view: Surface | undefined } = { view: undefined }
  const stop = root(() => {
    const it = pane(world)
    watch(() => {
      seen.view = it.view()
    })
  })

  flushSync()
  expect(built).toBe(1)

  // Every switch between the two, and every click in the file list that moves the
  // preview tab on to another note: one editor throughout.
  world.active = 1
  flushSync()
  world.active = 0
  flushSync()
  preview.adopt('Second')
  flushSync()
  preview.adopt('Third')
  flushSync()

  expect(built).toBe(1)
  // And the pane noticed every one of them: the two switches, and the preview tab
  // moving on twice. Not the note it opened on, which the view was built holding
  // and never had to be swapped into it.
  expect(switches).toBe(4)
  expect(seen.view?.state.doc.toString()).toBe('Third')
  stop()
})

test('the note in the pane is the note its tab names, switch after switch', () => {
  const note = tab('# The note')
  const site = tab('[InternetShortcut]\nURL=https://a.example\n')
  const world = window([note, site], 0, [site])

  const seen: { view: Surface | undefined } = { view: undefined }
  const stop = root(() => {
    const it = pane(world)
    watch(() => {
      seen.view = it.view()
    })
  })

  const holds = (one: NoteTab) => {
    const view = seen.view
    expect(view).toBeDefined()
    expect(documentOf(view!)).toBe(one.note.live)
    expect(view!.state.doc.toString()).toBe(one.note.live.text.toString())
  }

  flushSync()
  holds(note)

  // A website takes the pane: there is no editor while it is up.
  world.active = 1
  flushSync()
  expect(seen.view).toBeUndefined()

  world.active = 0
  flushSync()
  holds(note)

  // The reading in the website moved on, so its shortcut is rewritten under its
  // own name. Nothing of it may reach the note that is up.
  site.note.live.replace('[InternetShortcut]\nURL=https://b.example\n', false)
  flushSync()
  holds(note)
  expect(seen.view?.state.doc.toString()).toBe('# The note')

  stop()
})

test('a click in the file list moves the preview on without disturbing the others', () => {
  const preview = tab('First')
  const kept = tab('Kept')
  const world = window([preview, kept], 1)

  const seen: { view: Surface | undefined } = { view: undefined }
  const stop = root(() => {
    const it = pane(world)
    watch(() => {
      seen.view = it.view()
    })
  })

  flushSync()
  expect(seen.view?.state.doc.toString()).toBe('Kept')

  // The preview tab, which is not the one on show, takes another note on.
  preview.adopt('Second')
  flushSync()

  // The pane is still on the note it was on, holding its own words.
  expect(documentOf(seen.view!)).toBe(kept.note.live)
  expect(seen.view?.state.doc.toString()).toBe('Kept')

  world.active = 0
  flushSync()
  expect(documentOf(seen.view!)).toBe(preview.note.live)
  expect(seen.view?.state.doc.toString()).toBe('Second')

  stop()
})
