<script lang="ts">
  import { tooLongToParse, type VimMode } from '@nib/editor'
  import { countNote, countText } from './counts'
  import { amount, t } from './i18n.svelte'
  import { modes, VIM_WORDS } from './modes.svelte'
  import { pages } from './pages/showing.svelte'
  import { views } from './views.svelte'

  const {
    doc = '',
    reading = false,
    vimMode = null,
  }: { doc?: string; reading?: boolean; vimMode?: VimMode | null } = $props()

  /** Which page of how many, for a page note, or null for anything else. Read off the
   *  surface's own store rather than pushed here by it: which page somebody is looking at
   *  changes on every frame of a scroll, and a write per frame into what this bar has
   *  already read is an update loop. See pages/showing.svelte.ts. */
  const paper = $derived.by(() => {
    const store = pages.current?.store
    return store ? { at: store.showing, count: store.pages.length } : null
  })

  /** Whether this note is long enough that the editor leaves the parse out of it,
   *  which is what colours the syntax and draws the live preview. Said here because
   *  a note that suddenly reads as plain source is a reader wondering what broke -
   *  and said quietly, beside the other things that are true of the note, because
   *  nothing is wrong: the words are all there and typing at the end of it lands in
   *  the frame it was typed in, which is the whole of why. See `PARSED_AT_MOST` in
   *  packages/editor/src/modes.ts. */
  const plain = $derived(!paper && tooLongToParse(doc.length))

  /** Whether the pointer is on the numbers. They are invisible until then, and
   *  counting the words of a large note is not something to do on the way past:
   *  reading them is what asks for them. */
  let looking = $state(false)

  /** Or whether the keyboard is. The bar is a region of the window, so F6 reaches
   *  it, and arriving on it is the same question as pointing at it: a reader who
   *  has no pointer could not ask for the numbers at all before this. */
  let held = $state(false)

  /** Whether the numbers are on screen at all, by either road. */
  const asked = $derived(looking || held)

  const counts = $derived(asked ? countNote(doc, modes.properties) : null)

  /** What is selected, counted. Only while the numbers are on screen and only
   *  while there is a selection at all: reading the words out of the view is as
   *  expensive as the selection is long, and a caret has none. */
  const chosen = $derived(asked && views.chosen > 0 ? countText(views.selectedText()) : null)

  /** A count on its own, or as a part of the whole. */
  const said = (part: number | undefined, whole: number) =>
    part === undefined ? amount(whole) : `${amount(part)}/${amount(whole)}`
</script>

<!-- Which mode the keyboard is in, on the left, and only while modal editing is
     on. It shows unasked because that is the whole of its job: whether the next
     keystroke is a letter or a command is the one thing a reader cannot guess.
     Muted while a keystroke is a command, in the accent while it is text. -->
{#if vimMode}
  <span class="mode" class:writing={vimMode !== 'normal'}>{t(VIM_WORDS[vimMode])}</span>
{/if}

<!-- The one place the app says what is true of the note it is showing, so the
     word for a note nobody can type into goes here rather than into a banner
     over the text. It is the only thing in the bar that shows unasked. -->
<!-- The bar is a region of the window rather than a control, and a region a key
     walks to has to be able to hold the keyboard: with nothing in it to stand on,
     the bar itself is what F6 lands on, which is what the ARIA practices say to do
     with a region whose contents are not interactive. See focus.ts. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<footer
  class:looking={looking || held || reading || !!paper}
  class:paper={!!paper}
  data-region="status"
  tabindex="0"
  aria-label={t('What this note is')}
  onpointerenter={() => (looking = true)}
  onpointerleave={() => (looking = false)}
  onfocus={() => (held = true)}
  onblur={() => (held = false)}
>
  {#if reading}
    <span class="reading">{t('Read-only')}</span>
  {/if}
  {#if plain}
    <span
      class="reading"
      title={t('Shown as plain text, so typing stays instant in a note this long')}
      >{t('No preview')}</span
    >
  {/if}
  <!-- Which page of how many, for a page note, and it shows unasked: a reader
       scrolling a stack of paper needs to know where they are, which is not something
       they can guess, and it is the same fact the two words beside it are.
       Nothing at all for anything else, so the bar reserves no room for it. -->
  {#if paper}
    <span class="page">{t('{at} / {count}', { at: paper.at, count: paper.count })}</span>
  {/if}
  {#if counts}
    <!-- With something selected the words and the characters read as "this many
         of that many". No word for it and nothing to turn on: the second number
         is the note, which is what the bar said a moment ago, so the pair says
         what changed and what it is a part of. -->
    <span>{said(chosen?.words, counts.words)}w</span>
    <span>{said(chosen?.characters, counts.characters)}c</span>
    <span>{amount(counts.lines)}l</span>
    <span>{counts.minutes}m</span>
  {/if}
</footer>

<style>
  /* Opposite corner from the numbers, on the same line, and floated the same
     way so it reserves nothing while modal editing is off. */
  .mode {
    position: absolute;
    inset-inline-start: 0;
    bottom: 0;
    padding: 4px var(--space-4);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    color: var(--muted);
    transition: color var(--dur-base) var(--ease-out);
    user-select: none;
    pointer-events: none;
  }

  .mode.writing {
    color: var(--accent);
  }

  /* Numbers only, and only when looked for. Floated rather than laid out, so
     an invisible bar never reserves a strip of empty space. */
  footer {
    position: absolute;
    inset-inline-end: 0;
    bottom: 0;
    display: flex;
    gap: var(--space-3);
    /* Room to aim at even while there is nothing in it yet. */
    min-width: var(--space-7);
    min-height: 1.4em;
    padding: 4px var(--space-4);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--muted);
    opacity: 0;
    transition: opacity var(--dur-slow) var(--ease-out);
    user-select: none;
    pointer-events: auto;
  }

  footer.looking {
    opacity: 1;
  }

  /* Said once and quietly; the numbers come in beside it on hover. */
  .reading {
    letter-spacing: 0.03em;
  }

  /* Which page of how many. A little stronger than the counts beside it, because it
     is the one number here nobody had to ask for. */
  .page {
    color: var(--muted-strong);
  }

  /* There is no hover on a phone, so the numbers never appear - and the corner
     would still sit there catching taps meant for the button under it. Nor is there
     a keyboard with modes on one. */
  :global([data-touch]) footer,
  :global([data-touch]) .mode {
    display: none;
  }

  /* Except over a page note, where the bar holds the one thing that shows unasked.
     A page note is a pen and a tablet more often than it is anything else, and
     which page of how many is drawn in no other place. It catches nothing: there
     is nothing in it to press, and the pen's own bar is what the thumb is aiming
     at down there. */
  :global([data-touch]) footer.paper {
    display: flex;
    pointer-events: none;
  }
</style>
