<script lang="ts">
  /** An agent's mark: the badge a person wears in the Share sheet, in the colour the
   *  agent's caret wears in a note (agents/docs/presence.ts asks `accentFor` of the
   *  same name), so the agent in the list and the flag in the note read as one. */
  import { accentFor } from '../../accents'
  import { initial } from '../../icons'
  import { theme } from '../../theme.svelte'

  const { name }: { name: string } = $props()
</script>

<span
  class="nib-badge"
  style:--badge-fill={accentFor(name, theme.current)}
  style:--badge-ink="var(--accent-ink)"
  aria-hidden="true">{initial(name)}</span
>
