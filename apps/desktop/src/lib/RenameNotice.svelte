<script lang="ts">
  /** The app's new name, said once, to the people who knew the old one.
   *
   *  Said to an install that was used before the rename, and never to a fresh one:
   *  somebody who has only ever known Orden has nothing to be told. Every version
   *  writes its settings under `nib:` in the webview's storage, so an install that
   *  holds any of them before this run has written a thing is one an earlier version
   *  wrote to. renamed.svelte.ts asks that as it is evaluated, which `main.ts` sees to
   *  before anything else of the app's, and writes the answer down at once - for a
   *  fresh install too, so its own settings are never read as an earlier version's on
   *  the next run. The glasses' plugin never says it, since its storage is new every
   *  launch, and neither does the clipper, an app of its own.
   *
   *  Twitter's rename said nothing and people were lost for years; Element's and
   *  Shortcut's said one line. This is one line: the update notice's card, fetched only
   *  to be shown (surfaces.svelte.ts), in the middle of the notices row rather than its end,
   *  so the two never sit on each other: one line and the new mark easing in beside
   *  it, nothing to press. Any press, anywhere, or a few seconds of nothing puts it
   *  away, because there is nothing to do about it but read it; a press on the card
   *  itself lands on what is under it. */
  import { onMount } from 'svelte'
  import { fly, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from './i18n.svelte'
  import { dur } from './motion'
  import { renamed } from './renamed.svelte'

  /** Long enough to read six words twice. */
  const STAYS = 6000

  const said = $derived(t('nibeditor is now Orden'))

  onMount(() => {
    const gone = () => renamed.dismiss()
    const timer = setTimeout(gone, STAYS)
    window.addEventListener('pointerdown', gone, { capture: true })
    window.addEventListener('keydown', gone, { capture: true })

    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointerdown', gone, { capture: true })
      window.removeEventListener('keydown', gone, { capture: true })
    }
  })
</script>

<div class="notice" role="status" transition:fly={{ y: 12, duration: dur(220), easing: cubicOut }}>
  <img
    class="mark"
    src="/icon-256.png"
    alt=""
    draggable="false"
    in:scale={{ start: 0.6, delay: dur(120), duration: dur(320), easing: cubicOut }}
  />
  <p>{said}</p>
</div>

<style>
  /* The update notice's card (UpdateNotice.svelte), in the row's middle track. */
  .notice {
    grid-column: 2;
    justify-self: center;
    max-width: 22rem;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--surface-3);
    box-shadow: var(--shadow-lg);
  }

  /* Nothing on it to press, so a press goes through it to whatever it is over, and
     still puts it away on the way (the listener is the window's). Above the row's own
     `pointer-events: auto` for its cards, which is App.svelte's. */
  :global(.notices) > .notice {
    pointer-events: none;
  }

  .mark {
    flex: none;
    width: 1.5rem;
    height: 1.5rem;
  }

  p {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--text);
  }

  :global([data-touch]) .notice {
    grid-column: 1;
    justify-self: stretch;
    max-width: none;
  }
</style>
