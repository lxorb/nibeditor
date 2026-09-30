<script lang="ts">
  /** Not only yours: the mark on anything somebody else can reach.
   *
   *  One glyph, one word, one place it is drawn, because a space and a note are the
   *  same fact said about two things and two drawings of it is how one design
   *  becomes two. Lucide's `users`, which is the shape every app uses for this.
   *
   *  It replaces a dot. A dot in the accent said "shared" on a space's row, and the
   *  same dot says "not written down yet" on a tab, so the one shape the app had for
   *  a fact about a file was saying two unrelated things at once. The dot is the
   *  saving dot now and nothing else; anything about other people is this.
   *
   *  Small and quiet, at `--icon-sm`, which is the size of a mark inside a row that
   *  is not the row's own - the same slot a tab's kind and a bookmark's kind sit in;
   *  see docs/design.md. */
  import type { IconNode } from 'lucide'
  import Users from 'lucide/dist/esm/icons/users.mjs'
  import { t } from './i18n.svelte'

  const { label = t('Shared'), icon = Users }: { label?: string; icon?: IconNode } = $props()
</script>

<span class="shared" title={label} aria-label={label} role="img">
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {#each icon as [tag, attrs], index (index)}
      <svelte:element this={tag} {...attrs} />
    {/each}
  </svg>
</span>

<style>
  /* The row's trailing slot, where every list in the app puts what it has to add
     about a name. Never gives way: the name is what is cut. */
  .shared {
    flex: none;
    display: grid;
    place-items: center;
    margin-inline-start: var(--space-1);
    color: var(--muted);
  }

  .shared svg {
    /* Block for the same reason Icon.svelte's glyph is: an inline svg sits on the
       text baseline and the line box under it pushes the mark off centre. */
    display: block;
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.9;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
