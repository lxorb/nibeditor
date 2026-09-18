<script lang="ts">
  /** A note as it reads: rendered, not written in.
   *
   *  The same page an export writes and a published blog serves, in the same
   *  column and at the same size the editor was using, so switching between the
   *  two is one page changing its skin rather than a jump to somewhere else. The
   *  writing surface carries Typora's `#write` id and so does this, which is what
   *  puts every rule in the theme - and in a reader's own custom.css - on both
   *  faces of a note at once.
   *
   *  Nothing here writes to the note. The tab it is given is the pane's view of
   *  the document, and the document may be being typed into in another pane; when
   *  it is, the page is drawn again once the typing pauses and the place is kept.
   */

  import { tick, untrack } from 'svelte'
  import FindBar from './FindBar.svelte'
  import { t } from './i18n.svelte'
  import { menu } from './menu.svelte'
  import { modes } from './modes.svelte'
  import { inlineFiles } from './reading/drawn'
  import { paint, placesIn, rangeOf, wordsOf, type Words } from './reading/find'
  import { headingOffsets, positionOf, type Section, sectionAt } from './reading/places'
  import { readingHtml } from './reading/render'
  import { trustsHtmlIn } from './sharing.svelte'
  import { scrollbar } from './scrollbar'
  import { shortcuts } from './shortcuts.svelte'
  import { followHref, MIDDLE, opensLink } from './open-link'
  import { theme } from './theme.svelte'
  import { workspace, type Tab } from './workspace.svelte'
  import { loadEmbed, resolveFile, resolveNote, resolveRelative } from '@nib/editor'
  import { isTabFile, pageFragment } from '@nib/markdown/links'
  import { links } from './link-index.svelte'
  import { pressRow } from './query-block'

  const { tab, focused }: { tab: Tab; focused: boolean } = $props()

  /** How long after the last keystroke elsewhere the page is drawn again. Long
   *  enough that a burst of typing costs one render, short enough that the words
   *  arrive while the reader is still looking at them. */
  const REDRAW = 200

  let scroller = $state<HTMLDivElement>()
  let surface = $state<HTMLElement>()
  let html = $state('')

  /** Which render is the current one, so an older one that finishes later - the
   *  first, which waits for the diagram drawers to load - cannot overwrite it. */
  let latest = 0
  let redraw: ReturnType<typeof setTimeout> | undefined
  let drawn = false

  /** What gives back the observers watching for a paper or a plane card to come
   *  into view. The cards belong to the page that was rendered, so a page drawn
   *  again hands the old ones back before it watches the new ones; see
   *  reading/drawn.ts. */
  let undrawn: (() => void) | undefined

  /** Whether the note holds a ` ```query ` fence, which is what makes it answer
   *  again when the space changes. A scan of the words rather than a parse: the
   *  fence has to be written out to be one. */
  const asks = $derived(tab.doc.includes('```query'))

  /** The note, read outside the reactive graph: flushing brings the words forward
   *  and reading them here as a dependency would set the render off again. */
  function note() {
    return untrack(() => {
      tab.note.flush()
      return { text: tab.doc, path: tab.path }
    })
  }

  async function draw() {
    const mine = ++latest
    const source = note()
    const next = await readingHtml(source, theme.current, trustsHtmlIn(tab.note))
    if (mine !== latest) return

    html = next
    words = null

    // The page is measured only once the browser has laid it out.
    await tick()
    requestAnimationFrame(() => {
      if (mine !== latest) return
      show(untrack(() => tab.anchor) ?? 0)

      // An embedded paper or plane is drawn into the card that names it as the
      // reader reaches it. After the place is put back, so a card the reader
      // landed on is already in view and draws at once.
      undrawn?.()
      undrawn = surface
        ? inlineFiles(surface, untrack(() => workspace.activeSpace?.root) ?? null)
        : undefined
      // The matches were painted onto nodes this render has thrown away, so the
      // find bar would be counting places nothing was showing.
      if (untrack(() => finding)) reveal()
    })
  }

  // The first page, and another whenever the words change while it is up - the
  // same note being typed into in another pane - or the scheme its diagrams were
  // drawn for changes.
  $effect(() => {
    // Read, not used: these are what this effect is watching for.
    // Trust among them: a space becoming shared, or a paste landing, changes
    // whether the HTML in the note is markup or the characters it is made of.
    //
    // And the space itself, but only for a note with a query fence in it: what a
    // fence says is about the space rather than about the note, so a note saved
    // anywhere is a fence with something else to say. Only such a note, because
    // redrawing every other one whenever anything is saved is exactly the churn
    // the wait below is here to avoid. See query-block.ts.
    const reasons = [
      tab.note.revision,
      theme.current,
      trustsHtmlIn(tab.note),
      asks ? links.version : 0,
      // Whether a single newline breaks the line: the renderer's own answer rather
      // than an option passed in, so the page it built is no longer the page it
      // would build. See `setHardBreaks` in @nib/markdown.
      modes.hardBreaks,
    ]
    if (!reasons.length) return

    if (!drawn) {
      drawn = true
      void draw()
      return
    }

    clearTimeout(redraw)
    redraw = setTimeout(() => void draw(), REDRAW)
    return () => clearTimeout(redraw)
  })

  // The measure, the line height and the text size are the editor's settings, and
  // they reach a pane's editor by being written onto it; there is no editor here,
  // so they are written on straight. Zoom is at the root and needs nothing.
  const style = $derived(`--measure: ${modes.width}rem; --leading-content: ${modes.lineHeight}`)
  // The writing direction too: it is about the language a reader reads in, and a
  // note that is written right to left is read right to left.
  const direction = $derived(modes.rtl ? 'rtl' : 'ltr')

  /** The headings of the page and the offsets in the source that match them, where
   *  the two agree about how many there are.
   *
   *  They disagree over an underlined heading the renderer read differently, or one
   *  indented into code. Where they do, there is nothing to line up and both
   *  directions fall back to the top of the note, which is honest rather than
   *  wrong by a screen. */
  function headings(): { elements: HTMLElement[]; offsets: number[] } {
    const page = surface
    const offsets = page ? headingOffsets(tab.doc) : []
    if (!page) return { elements: [], offsets: [] }

    // The renderer's own headings, which are the ones with an id. A heading inside
    // an embedded note has none, and is no place in this note anyway.
    const elements = [...page.children].filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && /^H[1-6]$/.test(child.tagName) && !!child.id,
    )

    return elements.length === offsets.length
      ? { elements, offsets }
      : { elements: [], offsets: [] }
  }

  /** Puts the source at `position` at the top of the page.
   *
   *  The heading it is under is asked to bring itself into view, which is the one
   *  thing that lands exactly on a page whose blocks are laid out only as they are
   *  reached: the browser renders whatever it has to in order to put that element
   *  where it was asked for. Pixels worked out over blocks that have not been laid
   *  out are pixels worked out over estimates, and the heading that used to be
   *  reached to the pixel came out fifty-seven thousand of them adrift.
   *
   *  Then the rest of the way, for a place that is part-way through a section: that
   *  distance is between two headings the scroll has just been through, so it is
   *  measured rather than estimated. */
  function show(position: number) {
    const box = scroller
    const { elements, offsets } = headings()
    if (!box) return

    const { index, fraction } = sectionAt(position, offsets, tab.doc.length)
    const target = elements[index]
    if (!target) {
      box.scrollTop = 0
      return
    }

    target.scrollIntoView({ block: 'start' })
    if (!fraction) return

    const next = elements[index + 1]
    if (!next) return

    const from = target.getBoundingClientRect().top
    const to = next.getBoundingClientRect().top
    box.scrollTop = Math.max(
      0,
      Math.min(box.scrollTop + (to - from) * fraction, box.scrollHeight - box.clientHeight),
    )
  }

  /** Which place in the note is at the top of the page, as a section and a fraction
   *  of it.
   *
   *  Read off the block that is actually up there rather than off the scroll
   *  position, for the reason `show` scrolls an element rather than a number of
   *  pixels: the blocks above it may never have been laid out, so how far down the
   *  page this is says nothing about how far into the note it is. The block at the
   *  top is on screen by definition, and so is the heading over it wherever that
   *  heading is still in view. */
  function placeNow(): { section: Section; offsets: number[] } {
    const box = scroller
    const page = surface
    const { elements, offsets } = headings()
    if (!box || !page || !elements.length) return { section: { index: -1, fraction: 0 }, offsets }

    const edge = box.getBoundingClientRect()
    const found = document.elementFromPoint(edge.left + edge.width / 2, edge.top + 1)

    let block = found instanceof HTMLElement ? found : null
    while (block && block.parentElement !== page) block = block.parentElement
    if (!block) return { section: { index: -1, fraction: 0 }, offsets }

    // Which heading that block is under: the last one at or before it among the
    // page's own children, which is a walk of the headings and not of the blocks.
    const blocks = [...page.children]
    const where = blocks.indexOf(block)
    let index = -1
    for (let one = 0; one < elements.length; one++) {
      const element = elements[one]
      if (!element || blocks.indexOf(element) > where) break
      index = one
    }

    const target = elements[index]
    const next = elements[index + 1]
    if (!target || !next) return { section: { index, fraction: 0 }, offsets }

    // How far between the two, in the pixels of a stretch the reader is looking at.
    const from = target.getBoundingClientRect().top
    const to = next.getBoundingClientRect().top
    const span = to - from
    const fraction = span > 0 ? Math.min(1, Math.max(0, (edge.top - from) / span)) : 0

    return { section: { index, fraction }, offsets }
  }

  /** Where the page is, as a place in the note, recorded as it moves: the editor
   *  puts that place back when the note is written in again. Once a frame, since
   *  reading the layout is what costs. */
  let scheduled = 0

  function moved() {
    if (scheduled) return

    scheduled = requestAnimationFrame(() => {
      scheduled = 0
      const box = scroller
      if (!box) return

      const { section, offsets } = placeNow()
      workspace.notePlace(tab.id, box.scrollTop, positionOf(section, offsets, tab.doc.length))
    })
  }

  // On the way out: the frame that would record the place, the render that may
  // still be waiting on a diagram drawer, and the observers watching for a paper
  // to come into view - nothing in flight is current once the pane has gone.
  $effect(() => () => {
    cancelAnimationFrame(scheduled)
    latest++
    undrawn?.()
    undrawn = undefined
  })

  // The pane that is being read takes the keyboard, so Page Down, the arrows and
  // the find key all reach it the way they reach an editor.
  $effect(() => {
    if (focused) scroller?.focus({ preventScroll: true })
  })

  /** A link, as the reading view has to read it: a place on this page, a note in
   *  this space, or the web.
   *
   *  Two buttons reach here. The main one is the page's own click. The middle one
   *  arrives as `auxclick` and means one thing only - open that page and leave me
   *  here - so it is answered on the link and nowhere else: a card, a query row and
   *  a heading of this note are all the main button's, and a middle press that lands
   *  on none of them does nothing at all. */
  function follow(event: MouseEvent) {
    if (!opensLink(event)) return
    if (event.button === MIDDLE) {
      const address = (event.target as Element | null)?.closest('a')?.getAttribute('href')
      if (!address) return

      event.preventDefault()
      followHref(address, event)
      return
    }

    // A card standing in for a page somewhere else shows that page here, in the
    // frame and the sandbox the provider needs, rather than sending the reader
    // out of the app. The card is a link so that a published page - which runs no
    // script - still goes somewhere; here there is a script.
    const card = (event.target as Element | null)?.closest('.embed-web')
    if (card instanceof HTMLElement && loadEmbed(card)) {
      event.preventDefault()
      return
    }

    // A row in a query fence opens the note it found and a box in one ticks it,
    // the way the Search panel's rows do. Asked before the links, because a row is
    // a button rather than a link: a published page has no script to run and so
    // answers no query either.
    if (pressRow(event.target)) {
      event.preventDefault()
      return
    }

    const anchor = (event.target as Element | null)?.closest('a')
    const href = anchor?.getAttribute('href')
    if (!anchor || !href) return

    event.preventDefault()

    if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) {
      followHref(href, event)
      return
    }

    const hash = href.indexOf('#')
    const target = written(hash === -1 ? href : href.slice(0, hash))
    const fragment = hash === -1 ? '' : href.slice(hash + 1)

    // A `#fragment` on its own is a heading of this note, and the note is already
    // on the page.
    if (!target) {
      if (fragment) jump(fragment)
      return
    }

    // A wikilink already carries the note it resolved to; a markdown link carries
    // the path it was written as, which is read from where it was written.
    const index = links.index(tab.path)
    const wiki = anchor.classList.contains('wikilink')

    // A PDF opens in a tab of its own, at the page the link names; a canvas opens
    // in one too, and has no page to name. Both are followed the same way, since
    // `pageFragment` answers nothing for a fragment that is not a page.
    if (isTabFile(target)) {
      const file = wiki ? target : resolveFile(index, target, 'markdown')
      if (file === null) return

      void workspace.followLink({
        path: file,
        target,
        heading: null,
        block: null,
        page: pageFragment(fragment ? written(fragment) : null),
      })
      return
    }

    const found = wiki
      ? { path: target }
      : (resolveRelative(index, target) ?? resolveNote(index, target))
    if (!found) return

    void workspace.followLink({
      path: found.path,
      target,
      heading: fragment ? written(fragment) : null,
      block: null,
      page: null,
    })
  }

  /** A target as the name it stands for: what a note writes in a link is a URL. */
  function written(target: string): string {
    try {
      return decodeURI(target)
    } catch {
      return target
    }
  }

  /** Scrolls to a heading on this page, the way the browser would if it were
   *  allowed to navigate. */
  function jump(fragment: string) {
    const page = surface
    if (!page) return

    const found = page.querySelector(`[id="${CSS.escape(written(fragment))}"]`)
    found?.scrollIntoView({ block: 'start' })
  }

  /** Copying, and the way back out. What a right click on a page that cannot be
   *  written in has to offer, and nothing else. */
  function showMenu(event: MouseEvent) {
    menu.show(
      event,
      [
        {
          label: t('Copy'),
          hint: shortcuts.hint('fixed.copy'),
          disabled: (getSelection()?.toString() ?? '') === '',
          run: () => void navigator.clipboard.writeText(getSelection()?.toString() ?? ''),
        },
        {
          label: t('Leave reading'),
          hint: shortcuts.hint('app.reading'),
          run: () => workspace.toggleReading(tab.id),
        },
      ],
      { near: true },
    )
  }

  // ── Finding ────────────────────────────────────────────────────────

  let finding = $state(false)
  let query = $state('')
  let current = $state(0)

  /** The page's words, read once per render; see reading/find.ts. */
  let words: Words | null = null

  function wording(): Words {
    const page = surface
    if (!words && page) words = wordsOf(page)
    return words ?? { text: '', pieces: [] }
  }

  const found = $derived.by(() => {
    // The words come off the page rather than out of `html`, but it is `html` that
    // says the page has changed under them.
    if (!finding || !query || !html) return []
    return placesIn(wording(), query)
  })

  function step(by: number) {
    if (!found.length) return

    current = (current + by + found.length) % found.length
    reveal()
  }

  /** The frame the paint is waiting for. A range per match is real DOM work and
   *  the query changes per letter, so a burst of typing costs one paint rather
   *  than one per keystroke - and the scroll to the current match lands on the
   *  frame the browser was going to draw anyway. */
  let painting = 0

  function reveal() {
    cancelAnimationFrame(painting)
    painting = requestAnimationFrame(() => {
      painting = 0
      repaint()
    })
  }

  /** Paints the places found and brings the current one into view; see
   *  `paint` in reading/find.ts for why they are painted and not selected. */
  function repaint() {
    const words = wording()
    const ranges = found.flatMap((offset) => rangeOf(words, offset, query.length) ?? [])
    // A page drawn again can hold fewer matches than the one the reader was
    // stepping through, and a count past the end would show nothing at all.
    if (current >= ranges.length) current = 0
    const here = ranges[current]

    paint('nib-find', ranges)
    paint('nib-find-here', here ? [here] : [])

    const box = scroller
    if (!here || !box) return

    // Into the middle, and by the box's own scroll rather than scrollIntoView,
    // which would move whatever else on the page happens to be scrollable.
    const top = here.getBoundingClientRect().top - box.getBoundingClientRect().top
    box.scrollTop += top - box.clientHeight / 2
  }

  function typed(what: string) {
    query = what
    current = 0
    reveal()
  }

  function openFind() {
    finding = true
  }

  function closeFind() {
    finding = false
    query = ''
    cancelAnimationFrame(painting)
    painting = 0
    paint('nib-find', [])
    paint('nib-find-here', [])
    scroller?.focus({ preventScroll: true })
  }

  // A page that has gone has no matches to paint, and no frame to paint them on.
  $effect(() => () => {
    cancelAnimationFrame(painting)
    paint('nib-find', [])
    paint('nib-find-here', [])
  })

  /** The reader's own find key, read off the window because there is no editor
   *  here to read it: an editor binding never reaches a pane without one. */
  function onKeydown(event: KeyboardEvent) {
    if (!focused) return

    if (shortcuts.pressed('edit.find', event)) {
      event.preventDefault()
      openFind()
    } else if (finding && event.key === 'Escape') {
      event.preventDefault()
      closeFind()
    } else if (finding && shortcuts.pressed('edit.find-next', event)) {
      event.preventDefault()
      step(1)
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="read" {style}>
  {#if finding}
    <FindBar
      {query}
      count={found.length}
      {current}
      onstep={step}
      onclose={closeFind}
      onquery={typed}
    />
  {/if}

  <!-- Focusable, so the keys that move a page reach it; nothing in it is a
       field, and the caret a focused element would show is not drawn. -->
  <!-- The click is listened for here rather than on each link, since the links
       arrive with the page. Every one of them is a real anchor, so Tab reaches it
       and Enter fires the very click this reads: there is no gesture here that a
       keyboard cannot make. -->
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
  <div
    class="scroller nib-host"
    tabindex="-1"
    use:scrollbar={tab.id}
    bind:this={scroller}
    onscroll={moved}
    onclick={follow}
    onauxclick={follow}
    oncontextmenu={showMenu}
  >
    <!-- A piece of writing, and an `article` says so: everything under here is the
         note's own headings and paragraphs, and a reader landing in a `div` has
         nothing telling it where the document starts or what it is called. The id
         stays what every theme selects on; see base.css and Typora's `#write`. -->
    <article id="write" class="page" dir={direction} aria-label={tab.shown} bind:this={surface}>
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- the note's own words, rendered by the same renderer the export uses -->
      {@html html}
    </article>
  </div>
</div>

<style>
  .read {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .scroller {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }

  /* The page arrives rather than appearing, which is what makes the switch read
     as one note turning over instead of two notes swapping. */
  .page {
    animation: settle var(--dur-base) var(--ease-out);
  }

  /* A block nobody can see is not laid out.

     A note of twenty thousand lines is four thousand blocks, and the browser was
     laying out every one of them before the first was on screen: a hundred to
     three hundred milliseconds of the switch, and the part of it that came and
     went - the same note read 103ms one time and 283 the next, because what it
     costs depends on what else the machine had in its caches. Skipping what is off
     screen makes that frame 17 to 21 milliseconds, every time.

     `auto` is what keeps the scrollbar honest: a block that has been rendered once
     keeps its real size for ever after, so the page height is exact everywhere the
     reader has been and an estimate only ahead of them. The estimate is the middle
     block of a long note measured on this machine - a paragraph of two or three
     lines - so the bar is about right before they have been anywhere.

     Only here. An export and a published page are documents somebody prints or
     scrolls end to end, and neither wants a height that settles as it goes. */
  :global(.page > *) {
    content-visibility: auto;
    contain-intrinsic-size: auto 110px;
  }

  /* Containment is part of skipping a block, and containment stops the first and
     last item's margins escaping the list they are in - which made every list on
     the page 0.6em taller than it is in the editor, in an export, and on a
     published page. So the two margins that used to escape are taken off inside,
     which is what they were worth outside: they collapsed into the neighbouring
     block's own margin, which is larger. Every block on a 1.26 MB note comes out
     at the pixel it was at before; see reading-proof.py.

     Written with the id as well as the class because `#write li` in the themes
     package carries one, and a rule about the same margins has to outrank it. */
  :global(#write.page > :is(ul, ol) > li:first-child) {
    margin-top: 0;
  }

  :global(#write.page > :is(ul, ol) > li:last-child) {
    margin-bottom: 0;
  }

  @keyframes settle {
    from {
      opacity: 0;
    }
  }
</style>
