<script lang="ts">
  /** Who is at this device, and the two switches that belong to the app rather
   *  than to any note.
   *
   *  The bottom of the panel, in the same row height its head has, so the list
   *  of notes sits between two bars that match. Three things and no more: the
   *  account at the left, where a sidebar names its owner in every app that has
   *  one; the theme and the settings at the right, where a switch goes. The
   *  source link is not here - it is a row in the Help menu.
   *
   *  One component on every device. A drawer is the sidebar, so a phone gets
   *  this row at the bottom of the drawer, clear of the gesture bar, and it is
   *  the same three controls in the same order. */
  import { fade } from 'svelte/transition'
  import { account } from './account.svelte'
  import { BASE } from './api'
  import { arriving } from './arriving.svelte'
  import { initial } from './icons'
  import { longPress } from './longpress'
  import { dur } from './motion'
  import { settings } from './settings.svelte'
  import { startup } from './startup.svelte'
  import { t } from './i18n.svelte'
  import { theme } from './theme.svelte'
  import { shortcuts } from './shortcuts.svelte'

  /** What to call whoever is here. Null while the stores are still being asked,
   *  which is a third state and not the same as being signed out. */
  const who = $derived(account.name)
  /** Their face, where they chose one: the small picture; see people/face.ts. */
  const face = $derived(account.user?.avatar && `${BASE}/i/${account.user.avatar.s}.webp`)

  /** Every theme, each shown on the whole app while it is pointed at: a right click
   *  on the switch, or a finger held on it. Fetched then; see theme-picker/. */
  const pick = (event: MouseEvent) =>
    void import('./theme-picker/picking.svelte').then((one) => one.pickTheme(event))
</script>

<!-- A region of the window, so F6 reaches the account, the theme and the settings
     without a pointer; see focus.ts. -->
<div class="foot" data-region="foot">
  <!-- Notes on this device alone until somebody signs in, which nothing on screen
       says: the one hint that is about not losing anything, so the first a session
       offers. Not in the glasses' plugin, which signs in through the phone. -->
  {#if !__EVEN_PLUGIN__ && startup.settled}
    {#await import('./HintCard.svelte') then card}
      <card.default
        hint="sign-in"
        text={t('Sign in to keep your notes safe and on every device.')}
        when={!account.restoring && !account.signedIn}
        onpress={() => settings.show('account')}
      />
    {/await}
  {/if}
  <!-- The account, which is a row rather than a glyph: a name is what says whose
       notes these are. Signed in or not, it opens the same pane - signing in,
       the name the others in a shared space see, storage and signing out are all
       there, so there is one place for who you are instead of a sheet here and a
       pane there.

       It waits while the stores are still being asked: signed out and not known
       yet are different states, and on a phone the difference is the seconds the
       app takes to answer. -->
  <button
    class="who"
    class:looking={account.restoring}
    title={who ?? t('Sign in')}
    aria-label={who ?? t('Sign in')}
    disabled={account.restoring}
    onclick={() => settings.show('account')}
  >
    <span class="nib-badge" class:person={!!who} aria-hidden="true">
      {#if face}
        <img src={face} alt="" draggable="false" />
      {:else if who}
        {initial(who)}
      {:else}
        <svg viewBox="0 0 14 14"
          ><circle cx="7" cy="4.6" r="2.8" /><path d="M1.6 13a5.4 5.4 0 0 1 10.8 0" /></svg
        >
      {/if}
    </span>
    <span class="nib-row-label">{who ?? t('Sign in')}</span>
  </button>

  <!-- What an account's first pass has left to bring down, while it has any. The
       list above is already right - the names arrive a request in - so this is the
       whole of what is left to say, and it says it here instead of over the app.
       It goes as soon as the pass does. See arriving.svelte.ts. -->
  {#if arriving.showing}
    <span class="coming" transition:fade={{ duration: dur(160) }} role="status" aria-live="polite">
      {arriving.said}
    </span>
  {/if}

  <div class="acts">
    <!-- Off while the theme in force has only the one scheme: there is no other
         side of it to show, and swapping it for a built-in is not the switch
         anybody pressed. See theme.svelte.ts. Said rather than `disabled`, which
         would swallow the right click that offers another theme. -->
    <button
      class="nib-glyph act"
      title={theme.current === 'dark' ? t('Light') : t('Dark')}
      aria-label={theme.current === 'dark' ? t('Light') : t('Dark')}
      aria-disabled={!theme.switchable}
      onclick={() => theme.toggle()}
      oncontextmenu={pick}
      use:longPress={pick}
    >
      {#if theme.current === 'dark'}
        <svg viewBox="0 0 14 14"
          ><circle cx="7" cy="7" r="3" /><path
            d="M7 0v2M7 12v2M0 7h2M12 7h2M2.5 2.5l1.4 1.4M10.1 10.1l1.4 1.4M11.5 2.5l-1.4 1.4M3.9 10.1l-1.4 1.4"
          /></svg
        >
      {:else}
        <svg viewBox="0 0 14 14"
          ><path d="M12 8.6A5.6 5.6 0 1 1 5.4 2a4.4 4.4 0 0 0 6.6 6.6z" /></svg
        >
      {/if}
    </button>

    <!-- No mark of syncing on it: a pass blinking in the corner was noise (#206). -->
    <button
      class="nib-glyph act"
      title={shortcuts.tooltip(t('Settings'), 'app.settings')}
      aria-label={t('Settings')}
      onclick={() => settings.show()}
    >
      <!-- An actual gear: eight teeth around a hub. -->
      <svg class="gear" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3.2" />
        <path
          d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.1 4.7a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z"
        />
      </svg>
    </button>
  </div>
</div>

<style>
  /* The same height as the head at the other end of the panel, and set apart by
     the same hairline the head's menu is. */
  .foot {
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-height: var(--header-height);
    padding: 0 var(--space-1);
    border-top: 1px solid var(--line);
  }

  /* The account row only: a bare scoped `button` out-specifies `.nib-glyph`. */
  .who {
    display: flex;
    align-items: center;
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);

    /* The one part of the row that gives way: a long name is cut, the switches
       at the other end are not. */
    flex: 1;
    min-width: 0;
    gap: var(--row-gap);
    min-height: var(--row-height);
    padding: 0 calc(var(--row-pad) - var(--space-1));
    font-size: var(--text-row);
    text-align: start;
  }

  button:focus-visible {
    outline-offset: -1px;
  }

  /* The switches wear `.nib-glyph`'s own hover and press; this is the row's. */
  @media (hover: hover) {
    .who:hover:not(:disabled) {
      background: var(--surface-hover);
      color: var(--text-strong);
    }
  }

  .who:active:not(:disabled) {
    background: var(--surface-press);
    color: var(--text-strong);
  }

  /* The name starts beside its mark, the way a name in the list above starts
     beside its own; only the room it is given differs. */
  .who .nib-row-label {
    flex: 0 1 auto;
  }

  /* Whoever is here, round as every face is (people/Avatar.svelte): their picture,
     or the letter they are known by. */
  .person {
    overflow: hidden;
    border-radius: 50%;
  }

  .person img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* Still asking the stores whether there is a session. Not a spinner and not a
     sentence: the row that would sign you in simply waits, and breathes while
     it does. */
  .looking {
    animation: looking 1.6s var(--ease-in-out) infinite;
  }

  @keyframes looking {
    0%,
    100% {
      opacity: 0.4;
    }

    50% {
      opacity: 0.85;
    }
  }

  /* The count, between the name and the switches: quieter than either, in the
     tabular figures every number in the app is set in so the width does not
     flicker as it counts. It takes no room when it is not there, which is nearly
     always. */
  .coming {
    flex: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    user-select: none;
    -webkit-user-select: none;
  }

  .acts {
    flex: none;
    display: flex;
    gap: 2px;
  }

  /* The two switches are `.nib-glyph` in the themes package, which says why its
     padding is none. */
  .act .gear {
    stroke-width: 1.6;
  }

  @media (prefers-reduced-motion: reduce) {
    .looking {
      animation: none;
    }
  }

  /* Above whatever the system keeps at the bottom of the screen, so the last
     row of the panel is not under the gesture bar - which the keys cover while
     they are up, and then the room kept for it was an empty band above them. */
  :global([data-touch]) .foot {
    padding-bottom: max(0px, calc(var(--inset-bottom) - var(--keyboard, 0px)));
  }
</style>
