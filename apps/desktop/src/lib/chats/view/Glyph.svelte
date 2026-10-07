<script lang="ts">
  /** One of a chat's marks, stroked in the current colour; see glyphs.ts. */
  import { GLYPHS, type GlyphName } from './glyphs'

  const { name, filled = false }: { name: GlyphName; filled?: boolean } = $props()
</script>

<svg viewBox="0 0 24 24" aria-hidden="true" class:filled><path d={GLYPHS[name]} /></svg>

<style>
  svg {
    width: var(--glyph-size, var(--icon-md));
    height: var(--glyph-size, var(--icon-md));
    flex: none;
    display: block;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  svg.filled {
    fill: currentColor;
  }
</style>
