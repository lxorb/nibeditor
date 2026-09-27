<script lang="ts">
  /** What a fresh install opens on: Obsidian's vault chooser, row for row.
   *
   *  The app's mark, its name and its version, then one row per way in - a title on
   *  the left and the button that does it on the right - and the language at the
   *  foot. Obsidian puts a line of description under each title; nib leaves them
   *  out, because the words on the buttons already say it and nothing on screen
   *  here is there to be read rather than pressed.
   *
   *  A card in the window rather than a window of its own, and not dismissable: with
   *  no space there is nothing behind it to go back to, which is why Obsidian's
   *  cannot be closed either. Escape and back are left alone rather than put on the
   *  overlay stack. It goes the moment a space exists; see space-chooser.svelte.ts.
   *  App.svelte fetches it only while there is no space, and its transitions are
   *  global because that `{#if}` can take it away as well as this one. */
  import { cubicOut } from 'svelte/easing'
  import { fade, scale } from 'svelte/transition'
  import { i18n, t } from './i18n.svelte'
  import { languageOptions } from './language-options'
  import { LAYER } from './motion'
  import Select from './Select.svelte'
  import { firstSpace } from './first-space.svelte'
  import { spaceChooser } from './space-chooser.svelte'
  import { isDesktop } from './tauri'
  import { trap } from './trap'

  const version = __APP_VERSION__
</script>

{#if spaceChooser.showing}
  <!-- Opaque, so the empty app behind it is not a second thing to read. Below the
       title bar on a desktop, where the window's own buttons live. -->
  <div
    class="nib-scrim scrim"
    class:framed={isDesktop}
    transition:fade|global={{ duration: LAYER.fade }}
  ></div>

  <div
    class="nib-screen card"
    use:trap
    role="dialog"
    aria-modal="true"
    aria-label="Nib"
    transition:scale|global={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
  >
    <div class="head">
      <img class="mark" src="/icon-256.png" alt="" />
      <h1 class="title">Nib</h1>
      <p class="version">{version}</p>
    </div>

    <div class="rows">
      <div class="nib-setting">
        <span class="name">{t('Create a space')}</span>
        <button
          class="nib-button"
          type="button"
          data-lands
          disabled={firstSpace.working}
          onclick={() => void firstSpace.create()}
        >
          {t('Create')}
        </button>
      </div>

      <!-- A phone hands over files one at a time and never a folder; see
           import/picking.ts. -->
      {#if isDesktop}
        <div class="nib-setting">
          <span class="name">{t('Import a folder')}</span>
          <button
            class="nib-button is-quiet"
            type="button"
            disabled={firstSpace.working}
            onclick={() => void firstSpace.importFolder()}
          >
            {t('Import')}
          </button>
        </div>
      {/if}

      <div class="nib-setting">
        <span class="name">{t('Sign in to sync')}</span>
        <span class="pair">
          <button
            class="nib-button is-quiet"
            type="button"
            onclick={() => firstSpace.signIn('sign-in')}
          >
            {t('Sign in')}
          </button>
          <button
            class="nib-button is-quiet"
            type="button"
            onclick={() => firstSpace.signIn('create')}
          >
            {t('Create account')}
          </button>
        </span>
      </div>
    </div>

    <div class="foot">
      <Select
        value={i18n.choice}
        options={languageOptions()}
        label={t('Language')}
        onchange={(value: string) => i18n.select(value)}
      />
    </div>
  </div>
{/if}

<style>
  /* Under the sign-in sheet (30) and the prompt sheet (50), both of which a row here
     opens, and under the first sync's surface (40), which takes over once a sign-in
     lands. See .nib-scrim in packages/themes. */
  .scrim {
    --scrim-z: 28;
    --scrim-ink: 100%;
    --scrim-blur: 0px;
  }

  .scrim.framed {
    top: var(--header-height);
  }

  /* `.nib-screen` in the themes package, in the middle of the window rather than a
     question's way down it: there is nothing else on screen to leave room for. */
  .card {
    --screen-width: 26rem;
    z-index: 29;
    top: 50%;
    translate: -50% -50%;
    padding: var(--space-6) var(--space-5) var(--space-5);
  }

  .head {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    margin-bottom: var(--space-5);
  }

  .mark {
    width: 4rem;
    height: 4rem;
    margin-bottom: var(--space-2);
  }

  .title {
    margin: 0;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-head);
    font-weight: var(--weight-strong);
  }

  .version {
    margin: 0;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .name {
    flex: 1;
    min-width: 0;
    font-size: var(--text-row);
    font-weight: var(--weight-row);
    color: var(--text);
  }

  .pair {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  /* Obsidian's second buttons are filled a step off the card, so each row reads as
     having one thing to press. The press and the hover are the class's own. */
  .rows .nib-button.is-quiet {
    background: var(--surface-2);
    color: var(--text);
  }

  .rows .nib-button {
    flex: none;
    font-size: var(--text-row);
  }

  .foot {
    display: flex;
    justify-content: center;
    margin-top: var(--space-5);
  }

  /* Under a thumb it rises from the bottom, the way every sheet on a phone does. */
  :global([data-touch]) .card {
    top: auto;
    bottom: 0;
    left: 0;
    translate: none;
    width: 100%;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    padding-bottom: calc(var(--space-5) + var(--inset-bottom));
  }

  :global([data-touch]) .name,
  :global([data-touch]) .rows .nib-button {
    font-size: var(--touch-text);
  }
</style>
