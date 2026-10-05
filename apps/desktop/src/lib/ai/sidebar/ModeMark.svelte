<script lang="ts">
  /** A mode's mark beside its name under the composer, Codex's: a hand raised for
   *  Approve (it stops and asks), a bolt for Agent (it goes on its own), a list for Plan
   *  (it writes one). */
  import type { Mode } from '../modes'

  const { mode }: { mode: Mode } = $props()

  const PATHS: Record<Mode, string> = {
    approve:
      'M4.4 7.2V3.6a.8.8 0 0 1 1.6 0v2.8V2.8a.8.8 0 0 1 1.6 0v3.6V3.4a.8.8 0 0 1 1.6 0v4.4l.5-.9a.8.8 0 0 1 1.4.8l-1.6 2.7a2.4 2.4 0 0 1-2.1 1.2H6.6a2.2 2.2 0 0 1-2.2-2.2z',
    agent: 'M7.4 1.6L3.2 7.4h3.2l-.8 4 4.2-5.8H6.6z',
    plan: 'M2.4 3.5h.01M2.4 6.5h.01M2.4 9.5h.01M4.6 3.5h6M4.6 6.5h6M4.6 9.5h4',
  }
</script>

<svg class="mark" viewBox="0 0 13 13" aria-hidden="true"><path d={PATHS[mode]} /></svg>

<style>
  .mark {
    flex: none;
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
