<script lang="ts">
  /** What a chip or an `@` row is, by its shape: a page, a folder, a hash, a globe, a
   *  caret in words, a pad, a speech mark, a picture. The chip says nothing else about
   *  its kind. */
  import type { MentionKind } from './mentions'

  const { kind }: { kind: MentionKind } = $props()

  const PATHS: Record<MentionKind, string> = {
    note: 'M7.5 1.8H3.6a1 1 0 0 0-1 1v7.4a1 1 0 0 0 1 1h5.8a1 1 0 0 0 1-1V4.7zM7.5 1.8v2.9h2.9',
    folder:
      'M1.8 3.4a1 1 0 0 1 1-1h2.4l1.2 1.3h3.8a1 1 0 0 1 1 1v4.9a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z',
    tag: 'M5 2.2L4 10.8M9 2.2l-1 8.6M2.3 4.8h8.6M2 8.2h8.6',
    tab: 'M6.5 11.2a4.7 4.7 0 1 0 0-9.4 4.7 4.7 0 0 0 0 9.4zM1.8 6.5h9.4M6.5 1.8c-2.4 2.6-2.4 6.8 0 9.4M6.5 1.8c2.4 2.6 2.4 6.8 0 9.4',
    selection: 'M3 3.5h7M3 6.5h4.5M3 9.5h6M10 5.2v5.6M9 5.2h2M9 10.8h2',
    scratchpad:
      'M3.2 2.2h6.6a1 1 0 0 1 1 1v6.6l-2 2H3.2a1 1 0 0 1-1-1V3.2a1 1 0 0 1 1-1zM4.5 5h4M4.5 7.5h2.5',
    thread:
      'M2.2 3.4a1 1 0 0 1 1-1h6.6a1 1 0 0 1 1 1v4.4a1 1 0 0 1-1 1H5.6l-2.4 2v-2h0a1 1 0 0 1-1-1z',
    web: 'M5.8 9.8a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM8.7 8.7l2.6 2.6',
    picture:
      'M2.2 3.2a1 1 0 0 1 1-1h6.6a1 1 0 0 1 1 1v6.6a1 1 0 0 1-1 1H3.2a1 1 0 0 1-1-1zM2.4 9.4l2.7-2.8 2 2 1.3-1.3 2.3 2.3M8.3 5a.6.6 0 1 0 0-1.2.6.6 0 0 0 0 1.2z',
    words: 'M3 3.2h7M3 5.6h7M3 8h5M2 10.6c.8-.8 1.6-.8 2.4 0s1.6.8 2.4 0',
  }
</script>

<svg class="mark" viewBox="0 0 13 13" aria-hidden="true"><path d={PATHS[kind]} /></svg>

<style>
  .mark {
    flex: none;
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
