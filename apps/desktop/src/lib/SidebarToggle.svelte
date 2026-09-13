<script lang="ts">
  /** The one button that opens and shuts the file list.
   *
   *  It lives at the left end of the title bar, where every desktop app puts it,
   *  and in the drawer's own head on a phone and a tablet - where a drawer over the
   *  note covers the bar the button usually sits in, so the drawer needs the same
   *  button to shut itself with. One component because it is one control: the same
   *  glyph, the same words, the same movement, whichever of the two it is drawn
   *  in.
   *
   *  One glyph, always, and the same one: a panel with an edge down its left side.
   *  It is not redrawn, not faded and not moved between the two states - what says
   *  which state it is in is `aria-pressed`, the words in the tooltip, and the
   *  panel itself being there or not.
   *
   *  Both of the other answers have been tried and both turned one glyph into two.
   *  Fading the edge away left a plain window when the list was shut. Sliding the
   *  edge into the frame did the same thing more quietly: three and a half units of
   *  a fourteen-unit box put it on top of the frame's own border, so the shut state
   *  read as a window with a thick left edge - a different icon, which is what it
   *  was reported as. A button that redraws itself is a button you have to read
   *  twice, and the state is already said three ways. */
  import { t } from './i18n.svelte'
  import { type PanelSide, workspace } from './workspace.svelte'

  const { side = 'left' }: { side?: PanelSide } = $props()

  const open = $derived(!!workspace.openOn(side))
  const label = $derived(open ? t('Hide sidebar') : t('Show sidebar'))

  /** The one on the right shuts whatever is open there and opens whatever was
   *  last open - which, on a side that holds one panel, is that panel. That rule
   *  is `nextRight` on the workspace, because the thumb drag that pulls the same
   *  drawer out follows it too. The left one keeps the method it has always
   *  called. */
  function press() {
    if (side === 'left') {
      workspace.toggleSidebar()
      return
    }

    const first = workspace.nextRight
    if (first) workspace.showPanel(first)
  }
</script>

<!-- The glyph is mirrored for the right side and nothing else about it changes:
     the edge it draws is the edge between the panel and the note, which is on the
     other side over there. -->
<button
  class="nib-glyph toggle"
  class:is-on={open}
  class:right={side === 'right'}
  title={label}
  aria-label={label}
  aria-pressed={open}
  onclick={press}
>
  <svg viewBox="0 0 14 14">
    <rect x="1" y="2.5" width="12" height="9" rx="1.5" />
    <path class="edge" d="M5.5 2.5v9" />
  </svg>
</button>

<style>
  /* The button itself is `.nib-glyph` in the themes package: the square every
     icon button in the app is, the row's corner, the row's own hover and press,
     and a mark that a browser's own button padding cannot squash. This used to
     be a hard-coded 38px wide with no height and no corner at all, so it
     stretched to the whole bar and lit a sharp-edged block where the three bars
     beside it lit a rounded one. What is left here is only its own edge. */
  .toggle {
    align-self: center;
  }

  .toggle svg {
    stroke-width: 1.2;
  }

  .toggle.right svg {
    scale: -1 1;
  }

  /* The panel's edge. Drawn in one place, in both states, on every device: no
     transform, no transition and no opacity of its own, because each of those is a
     second drawing of the same button. The mark is constant and the state is said
     in words; see the note at the top. */
</style>
