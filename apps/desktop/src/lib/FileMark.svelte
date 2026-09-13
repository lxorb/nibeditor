<script lang="ts">
  /** The mark in front of a row in the file list: one small icon per kind of file
   *  and, where the file chose one of its own, that instead.
   *
   *  Which icon a kind wears is `file-mark.ts`; how any icon is drawn is
   *  `Icon.svelte`. What is here is how big it is drawn and how heavy. All of the
   *  marks come off Lucide's 24 unit grid, which is drawn for 24px and read here at
   *  half that, so the weight is set rather than taken: a stroke scaled with the box
   *  would come out at half a pixel and the whole list would read as grey. Just under
   *  a pixel at either size instead, which is a hairline that still has a shape, and
   *  the same weight on both so a phone and a desktop draw one family.
   *
   *  Every row wears the same box, so every name in the list starts at the same
   *  place whatever the row holds.
   *
   *  A note that says `icon:` in its front matter wears that, in the same box - and
   *  so does a canvas that says it under `nib.icon`, and a folder the space's own map
   *  names, which is how a folder out of somebody's vault wears one before it has a
   *  note to keep it in. A website wears the site's own favicon, the mark the tab
   *  strip and the address bar show, out of its `.url`'s cached `Nib-Icon` - so the
   *  row is the site and not a plain globe, before the page has loaded and on a
   *  machine that has never opened it. All of it is read here rather than passed in,
   *  from the path the row already knows, so every list that draws a mark shows the
   *  chosen icon and the favicon without knowing that anything has either: the tree,
   *  the tab strip, a search result, a bookmark, the Move sheet. See chosen-icon.ts
   *  and link-index for where the values come from and icons.ts for what an icon may
   *  say.
   *
   *  What a row holds is said at the far end of it and by the indentation of what
   *  follows, never by the mark: the mark says what the row is. */
  import { chosenIcon, chosenTint, faviconFor } from './chosen-icon'
  import { type FileMark, MARKS } from './file-mark'
  import Icon from './Icon.svelte'
  import { readIcon } from './icons'

  const { mark, path }: { mark: FileMark; path?: string } = $props()

  /** What the file or folder at this path chose, or null for a row that chose
   *  nothing - and for a caller that knows a name but no path, which gets its kind's
   *  mark. */
  const chosen = $derived(path === undefined ? null : readIcon(chosenIcon(path)))
  const tint = $derived(path === undefined ? null : chosenTint(path))

  /** The site's own mark for a website, out of its `.url`'s `Nib-Icon`. Only a
   *  website has one, and only when a page has found one; the globe stands in until
   *  then. Read from the path through the same façade the chosen icon is, so this
   *  names no store of its own; see chosen-icon.ts and TabMark.svelte. */
  const favicon = $derived(mark === 'web' && path !== undefined ? faviconFor(path) : null)

  /** Whether the picture refused to arrive: a mark whose address has moved, or one
   *  the content policy will not fetch. The globe reads better than a broken picture,
   *  and the bar over the page falls back the same way; see TabMark.svelte. */
  let broken = $state(false)

  // A different favicon is another picture worth trying.
  $effect(() => {
    if (favicon) broken = false
  })
</script>

{#if favicon && !broken}
  <span class="mark picture" aria-hidden="true">
    <img src={favicon} alt="" onerror={() => (broken = true)} />
  </span>
{:else}
  <span class="mark" class:quiet={chosen === null || chosen.kind === 'lucide'}>
    <Icon icon={chosen} {tint} fallback={MARKS[mark]} />
  </span>
{/if}

<style>
  /* Quieter than the name beside it: the mark is there to be glanced at, not read.
     As big as the words, though - `--icon-md` is 16px against a 13.5px name and 20px
     against a 17px one, which is the proportion a file list is read at. A phone and a
     desktop take the same rule; the token is what differs, and it differs once, in
     the themes package.

     `font-size` as well as the box, because an emoji is type: see Icon.svelte. */
  .mark {
    display: block;
    width: var(--icon-md);
    height: var(--icon-md);
    font-size: var(--icon-md);
    flex: none;
    stroke: currentColor;
    stroke-width: 1.6;
  }

  /* A stroke is held back; a picture is not. Fading an emoji or a coloured drawing
     reads as a mistake rather than as a quiet mark - it is already a picture in its
     own colours, and somebody chose it. On the box rather than on the glyph, so a
     list can still say the row it is on wears the accent at full strength. */
  .quiet {
    opacity: 0.8;
  }

  /* A favicon is somebody's finished picture in its own colours, so it is drawn at
     full strength and cropped square to the box every other mark keeps - the same
     rule TabMark draws it by, because it is the same mark in the same size. */
  .picture img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
