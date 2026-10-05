<script lang="ts">
  /** One of an agent's own tabs, as a picture (docs/agent-native.md 6.6).
   *
   *  A picture because a picture takes no input: watching can never be interacting by
   *  accident, and the pointer over it is the reader's pointer over nib. The engine's
   *  own screencast, a frame at most every fifth of a second, only while the panel is
   *  open. Show makes it a tab of the reader's, beside the one in front, without
   *  loading it again (6.7); a press anywhere on the picture is the same press. */
  import type { Activity } from './activity.svelte'
  import type { Held } from './seen'
  import { stateOf } from './marks'
  import { hostOf } from './session'

  const { activity, tab }: { activity: Activity; tab: Held } = $props()

  const picture = $derived(activity.frames[tab.id] ?? null)
  const touch = $derived(activity.seen.acting[tab.id])
  const status = $derived(
    touch ? stateOf(activity.seen, touch.agent, touch.at, activity.now) : 'none',
  )
  const name = $derived(tab.title || hostOf(tab.url))
</script>

<button
  class="thumb"
  class:acting={status === 'acting'}
  class:stopped={status === 'stopped'}
  style:--agent={activity.colourOf(tab.agent)}
  title={name}
  aria-label={name}
  disabled={!activity.holds || tab.parked}
  onclick={() => void activity.show(tab.id)}
>
  <span class="picture" style:background-image={picture === null ? 'none' : `url(${picture})`}
  ></span>
  <span class="name">{name}</span>
</button>

<style>
  .thumb {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
    padding: 0;
    border: none;
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    text-align: start;
    cursor: default;
  }

  /* The page at its own proportions, 1280 by 800, drawn from the top: the picture is
     the page as an agent sees it, so it is never stretched to fill a box of another
     shape. A ring in the agent's colour while it acts, as the frame round a page of the
     reader's is. */
  .picture {
    display: block;
    width: 100%;
    aspect-ratio: 16 / 10;
    border-radius: var(--radius-sm);
    background-color: var(--surface);
    background-size: cover;
    background-position: top center;
    box-shadow: inset 0 0 0 1px var(--line);
    transition:
      box-shadow var(--dur-base) var(--ease-out),
      transform var(--dur-fast) var(--ease-out);
  }

  .acting .picture {
    box-shadow: inset 0 0 0 2px var(--agent);
  }

  .stopped .picture {
    box-shadow: inset 0 0 0 2px var(--muted);
  }

  @media (hover: hover) {
    .thumb:not(:disabled):hover .picture {
      transform: scale(1.02);
    }
  }

  .thumb:not(:disabled):active .picture {
    transform: scale(0.98);
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    unicode-bidi: isolate;
  }
</style>
