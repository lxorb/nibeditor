<script lang="ts">
  /** A chat's mark where the chats draw one: the icon its pointer wears, in its colour,
   *  or the `#` every chat wears that chose none. Asked of the path through the door
   *  every mark in the app asks (chosen-icon.ts), so the panel and the chat's head show
   *  what the file list and the tab show; see docs/icons.md. */
  import { chosenIcon, chosenTint } from '../../chosen-icon'
  import Icon from '../../Icon.svelte'
  import { readIcon } from '../../icons'
  import Glyph from './Glyph.svelte'

  const { path }: { path: string | null | undefined } = $props()

  const chosen = $derived(path ? readIcon(chosenIcon(path)) : null)
  const tint = $derived(path ? chosenTint(path) : null)
</script>

{#if chosen}
  <span class="worn" aria-hidden="true"><Icon icon={chosen} {tint} /></span>
{:else}
  <Glyph name="hash" />
{/if}

<style>
  /* The box a glyph is drawn in, so a chosen icon takes the `#`'s place to the pixel.
     `font-size` as well, because an emoji is type; see Icon.svelte. */
  .worn {
    display: block;
    flex: none;
    width: var(--glyph-size, var(--icon-md));
    height: var(--glyph-size, var(--icon-md));
    font-size: var(--glyph-size, var(--icon-md));
    stroke: currentColor;
    stroke-width: 2;
  }
</style>
