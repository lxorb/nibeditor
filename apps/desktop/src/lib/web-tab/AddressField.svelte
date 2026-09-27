<script lang="ts">
  /** The field an address is typed into, finishing it the way a browser does.
   *
   *  One control with two faces, and one with a list under it. While it does not have
   *  the keyboard it reads `resting` - the site and the page's own name, whatever the
   *  caller says - and the moment it does it holds the whole address, selected so
   *  typing replaces it. Then it is Chrome's omnibox, in both halves; see omnibox.ts
   *  for what is offered and why:
   *
   *  * the rest of the best address is written into the field after the caret and
   *    selected, so typing on narrows it, Backspace or Delete drops it, Right or End
   *    takes it, and Enter goes where it says;
   *  * a few pages open before hang under the field, walked with the arrows, taken with
   *    Enter or a press, closed with Escape, and taken out of the history with
   *    Shift+Delete, which is how Chrome forgets one.
   *
   *  Nothing is offered in the middle of a composition: an input method's letters are
   *  not the reader's until the composition ends, and a completion written into them
   *  would be written into a word that is not finished being made.
   *
   *  The only field an address is typed into, so every way a tab is given one - the
   *  bar over a page, a new web note asking where it points - finishes it the same. */

  import { untrack } from 'svelte'
  import { t } from '../i18n.svelte'
  import { overlays } from '../overlays'
  import Suggest from '../Suggest.svelte'
  import { dotCom } from './address'
  import { shownAddress } from './omnibox'
  import { visited } from './visited'
  import type { Visit } from './visits'

  const {
    resting,
    address,
    book,
    onenter,
    ontyping,
  }: {
    /** What the field reads while nobody is typing in it. */
    resting: string
    /** What it holds the moment somebody starts: the address the tab is on. */
    address: string
    /** Which history it offers from, which is its space's; see web-data.ts. */
    book: string
    /** Somebody pressed Enter on something: an address, or words for the tab to make
     *  one of. */
    onenter: (said: string) => void
    ontyping: (on: boolean) => void
  } = $props()

  const id = $props.id()

  let field = $state<HTMLInputElement>()
  /** Whether the field itself has the keyboard, which is what swaps its two faces. */
  let editing = $state(false)
  /** What the reader typed, without whatever the field wrote after it. */
  let typed = $state('')
  let rows = $state<Visit[]>([])
  /** The row the arrows are on, or -1 for the field itself. */
  let active = $state(-1)
  /** Escape closed the list; the next letter opens it again. */
  let shut = $state(false)
  let composing = false

  const listing = $derived(editing && !shut && rows.length > 0)
  const titles = $derived(new Map(rows.map((one) => [one.url, one.title])))

  /** Puts the resting face back on a field nobody is typing in. Done by writing the
   *  value rather than by binding it: a bound value fights the keys somebody is
   *  pressing, and this is a field with two faces rather than one value. */
  $effect(() => {
    const box = field
    if (box && !editing && box.value !== resting) box.value = resting
  })

  // The list is over the page, and a web tab's page is a native webview that draws
  // above every pixel of the window's own: so while it is open it is on the overlay
  // stack, which is what hides the page and puts the still picture of it in its place.
  // See `covered` in WebTab.svelte.
  $effect(() => {
    if (!listing) return
    return untrack(() => overlays.show(() => (shut = true)))
  })

  /** Takes the keyboard, with the whole address selected. */
  export function take() {
    field?.focus()
    field?.select()
  }

  /** Whether this field is still the one on screen.
   *
   *  A focus and a blur both arrive from the browser rather than from the app, and a
   *  pane being swapped takes the keyboard off the field on its way out - so the last
   *  blur this field ever gets arrives *during* its own teardown, before any teardown
   *  of ours could have set a flag. The element's own `isConnected` is the only signal
   *  that does not depend on the order: a field out of the document is a field whose
   *  bar has gone, and reading this component's own `$derived` from there is a read of
   *  a graph Svelte has already marked inert. */
  function here(): boolean {
    return field?.isConnected === true
  }

  function onFocus() {
    if (!here() || !field) return

    visited.wake(book)
    editing = true
    ontyping(true)
    field.value = address
    typed = address
    rows = []
    active = -1
    shut = false
    field.select()
  }

  function onBlur() {
    if (!here() || !field) return

    editing = false
    ontyping(false)
    rows = []
    field.value = resting
  }

  /** Writes the rest of the best address after what was typed, selected. */
  function finish() {
    const box = field
    if (!box) return

    const offer = visited.complete(book, typed)
    if (!offer || offer.text.length <= typed.length) return

    box.value = offer.text
    box.setSelectionRange(typed.length, offer.text.length)
  }

  function onInput(event: Event) {
    const box = field
    if (!box) return

    typed = box.value
    active = -1
    shut = false
    rows = visited.suggest(book, typed)

    // Only a letter typed at the end: a deletion is somebody taking the offer away,
    // and offering it again would undo the key they pressed; a paste and a letter in
    // the middle are an address being edited rather than typed.
    const typing = event instanceof InputEvent && event.inputType === 'insertText'
    if (!typing || composing || event.isComposing) return
    if (box.selectionStart !== box.value.length) return

    finish()
  }

  /** Where Enter goes from what the field says: the address it was finished to, when
   *  it says exactly that - which a site typed out in full also is, so `localhost:1420`
   *  goes back to the `http:` it was on rather than to a guess - and otherwise the words
   *  themselves, for the tab to make an address or a search of. */
  function resolved(said: string): string {
    const offer = visited.complete(book, said)
    return offer?.text === said ? offer.url : said
  }

  /** The arrows, down the list and back up to the field. The field reads the row the
   *  arrows are on, which is what a browser does, and what was typed when they come
   *  back. */
  function move(step: 1 | -1) {
    const box = field
    if (!box) return

    let next = active + step
    if (next < -1) next = rows.length - 1
    if (next >= rows.length) next = -1
    active = next

    const row = rows[active]
    box.value = row ? shownAddress(row.url) : typed
    box.setSelectionRange(box.value.length, box.value.length)
    if (!row) finish()
  }

  function go(said: string) {
    onenter(said)
    field?.blur()
  }

  function onKeydown(event: KeyboardEvent) {
    const box = field
    if (!box || event.isComposing) return

    if (listing && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      move(event.key === 'ArrowDown' ? 1 : -1)
      return
    }

    const row = rows[active]
    if (listing && row && event.key === 'Delete' && event.shiftKey) {
      event.preventDefault()
      visited.remove(book, row.url)
      rows = visited.suggest(book, typed)
      active = Math.min(active, rows.length - 1)
      const next = rows[active]
      box.value = next ? shownAddress(next.url) : typed
      return
    }

    // Right and End take what the field offered: it is typed from here on.
    if ((event.key === 'ArrowRight' || event.key === 'End') && !event.shiftKey) {
      typed = box.value
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      // Ctrl+Enter is the `.com` press every browser has, and it is about what was
      // typed rather than what the field offered after it; see `dotCom` in address.ts.
      const dotted = event.ctrlKey || event.metaKey ? dotCom(typed) : null
      go(row?.url ?? dotted ?? resolved(box.value))
      return
    }

    if (event.key !== 'Escape') return

    // The layer above the bar has its own Escape; a field being typed in keeps this
    // one. The first press takes back what the field offered, the list with it, and
    // the second gives the keyboard back. See overlays.ts.
    event.preventDefault()
    event.stopPropagation()
    if (listing || box.value !== typed) {
      shut = true
      active = -1
      box.value = typed
      return
    }

    box.blur()
  }
</script>

<div class="field">
  <input
    bind:this={field}
    class="nib-field"
    type="text"
    spellcheck="false"
    autocapitalize="off"
    autocorrect="off"
    autocomplete="off"
    placeholder={t('Address')}
    role="combobox"
    aria-label={t('Address')}
    aria-autocomplete="both"
    aria-expanded={listing}
    aria-controls="{id}-pages"
    aria-activedescendant={listing && active >= 0 ? `${id}-pages-${active}` : undefined}
    onfocus={onFocus}
    onblur={onBlur}
    oninput={onInput}
    onkeydown={onKeydown}
    oncompositionstart={() => (composing = true)}
    oncompositionend={() => (composing = false)}
  />

  {#if listing}
    <Suggest
      id="{id}-pages"
      label={t('Address')}
      values={rows.map((one) => one.url)}
      {typed}
      {active}
      shown={shownAddress}
      aside={(url: string) => titles.get(url) ?? ''}
      onchoose={go}
    />
  {/if}
</div>

<style>
  /* The field takes whatever the glyphs beside it leave, and never less than can be
     read; the list hangs from it, so it is the box the list is placed against. */
  .field {
    position: relative;
    flex: 1 1 8rem;
    min-width: 0;
    display: flex;
  }

  .nib-field {
    flex: 1;
    min-width: 0;
  }
</style>
