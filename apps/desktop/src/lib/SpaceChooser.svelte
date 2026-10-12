<script lang="ts">
  /** What a fresh install opens on: Obsidian's vault chooser, row for row.
   *
   *  The app's mark, its name and its version, then one row per way in - a title on
   *  the left and the button that does it on the right - and the language at the
   *  foot. The first rows are the apps somebody might be coming from (MigrateRows),
   *  which Obsidian's chooser does not have and the iPhone's setup puts first.
   *  Obsidian puts a line of description under each title; nib leaves them out,
   *  because the words on the buttons already say it and nothing on screen here is
   *  there to be read rather than pressed.
   *
   *  A card in the window rather than a window of its own, and not dismissable: with
   *  no space there is nothing behind it to go back to, which is why Obsidian's
   *  cannot be closed either. Escape and back are left alone rather than put on the
   *  overlay stack. It goes the moment a space exists; see space-chooser.svelte.ts.
   *  The browser build's first visit is the one exception, with the welcome note's
   *  space behind it and "Start fresh" the way back to it; see first-visit.svelte.ts.
   *  App.svelte fetches it only while there is no space or that visit is asking, and
   *  its transitions are global because that `{#if}` can take it away as well as
   *  this one.
   *
   *  Those rows are the one step nib needs. Once it is done the card stays for
   *  somebody new and says so - all set - with the optional questions a press away,
   *  the way Claude Design asks: one at a time, each answered or passed with Next, and
   *  Done at every one of them, which leaves the rest at their defaults. Choosing an
   *  answer applies it at once, so the app behind the card is already what was asked
   *  for. The list is setup.svelte.ts; whether the card stays is space-chooser.svelte.ts:
   *  armed while the chooser is up for somebody new, so the card stays where it is when
   *  the space it asked for arrives rather than going and coming back, and never for a
   *  reader who signs in, whose account already holds their answers (David,
   *  2026-10-12: only what nib must know is required, everything else is optional).
   *
   *  Whether this is somebody who writes code is one of them: yes keeps the terminals
   *  and markdown's marks under the caret, as Obsidian has them; no leaves the
   *  terminals out and writes the way a Notion page does, until the markdown question
   *  after it says otherwise. See `setDeveloper` in modes.svelte.ts. */
  import { cubicOut } from 'svelte/easing'
  import { fade, scale } from 'svelte/transition'
  import { i18n, t } from './i18n.svelte'
  import { languageOptions } from './language-options'
  import { LAYER } from './motion'
  import Select from './Select.svelte'
  import { firstSpace } from './first-space.svelte'
  import { migrating } from './migrating.svelte'
  import { modes } from './modes.svelte'
  import MigrateRows from './MigrateRows.svelte'
  import { account } from './account.svelte'
  import { SCHEME_CHOICES, SCHEME_NAMES } from './schemes'
  import { QUESTIONS, setup, type Question } from './setup.svelte'
  import { segmented } from './slide'
  import { spaceChooser } from './space-chooser.svelte'
  import { firstVisit } from './first-visit.svelte'
  import { isDesktop, isNative } from './tauri'
  import { theme, type SchemeChoice } from './theme.svelte'
  import { trap } from './trap'

  const version = __APP_VERSION__

  // Somebody new gets the optional questions once the required step is done; a reader
  // who signs in instead already has their answers on the account.
  if (spaceChooser.asking && !account.signedIn) setup.arm()
  $effect(() => {
    if (setup.armed && !spaceChooser.asking && account.signedIn) setup.finish()
  })

  interface Asked {
    label: string
    options: { value: string; label: string }[]
    get: () => string | null
    set: (value: string) => void
  }

  /** Each optional question: what it is called, its answers, and the setting it reads
   *  and writes - the same setters Settings uses, so an answer is saved and shared the
   *  same way. */
  function asked(question: Question): Asked {
    switch (question) {
      case 'theme':
        return {
          label: t('Theme'),
          options: SCHEME_CHOICES.map((one) => ({ value: one, label: t(SCHEME_NAMES[one]) })),
          get: () => theme.scheme,
          set: (value) => theme.setScheme(value as SchemeChoice),
        }
      case 'developer':
        return {
          label: t('Do you write code?'),
          options: [
            { value: 'yes', label: t('Yes') },
            { value: 'no', label: t('No') },
          ],
          get: () => (modes.developer === null ? null : modes.developer ? 'yes' : 'no'),
          set: (value) => modes.setDeveloper(value === 'yes'),
        }
      case 'markdown':
        // Notion's page, where a mark never shows, or Obsidian's live preview, where it
        // shows under the caret; named for what they do rather than for either app.
        return {
          label: t('Markdown'),
          options: [
            { value: 'clean', label: t('Clean') },
            { value: 'live', label: t('Live preview') },
          ],
          get: () => (modes.quietMarks ? 'clean' : 'live'),
          set: (value) => {
            if ((value === 'clean') !== modes.quietMarks) modes.toggleQuietMarks()
          },
        }
    }
  }
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
    class="nib-screen is-centred card"
    use:trap
    role="dialog"
    aria-modal="true"
    aria-label="nibeditor"
    transition:scale|global={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
  >
    <div class="head">
      <img class="mark" src="/icon-256.png" alt="" draggable="false" />
      <h1 class="title">nibeditor</h1>
      <p class="version">{version}</p>
    </div>

    {#if spaceChooser.personalizing}
      {@const question = setup.question}
      <div class="rows">
        {#if question === null}
          <div class="nib-setting">
            <span class="name">{t('All set')}</span>
            <span class="pair">
              <button
                class="nib-button is-quiet is-soft"
                type="button"
                onclick={() => setup.personalize()}
              >
                {t('Personalize')}
              </button>
              <button class="nib-button" type="button" data-lands onclick={() => setup.finish()}>
                {t('Done')}
              </button>
            </span>
          </div>
        {:else}
          {@const one = asked(question)}
          {@const held = one.get()}
          <div class="nib-setting">
            <span class="name">{one.label}</span>
            <div class="nib-segmented" role="radiogroup" aria-label={one.label} use:segmented>
              {#each one.options as option (option.value)}
                <button
                  type="button"
                  role="radio"
                  aria-checked={option.value === held}
                  class:on={option.value === held}
                  onclick={() => one.set(option.value)}
                >
                  {option.label}
                </button>
              {/each}
            </div>
          </div>
          <div class="steps">
            <span class="dots" aria-hidden="true">
              {#each QUESTIONS as step, at (step)}
                <span class="dot" class:on={at === setup.at}></span>
              {/each}
            </span>
            <span class="pair">
              <button
                class="nib-button is-quiet is-soft"
                type="button"
                onclick={() => setup.finish()}
              >
                {t('Done')}
              </button>
              <button class="nib-button" type="button" onclick={() => setup.next()}>
                {t('Next')}
              </button>
            </span>
          </div>
        {/if}
      </div>
    {:else}
      <div class="rows">
        <!-- Where the notes come from first, the way the iPhone's setup asks about
           the old phone before anything else; Create is the fresh start under them. -->
        <MigrateRows />

        {#if !migrating.vaults}
          <!-- The browser build already has its welcome note's space, so starting
             fresh there is staying on it; see first-visit.svelte.ts. -->
          {#if isNative}
            <div class="nib-setting">
              <span class="name">{t('Create a space')}</span>
              <button
                class="nib-button"
                type="button"
                data-lands
                disabled={firstSpace.working || migrating.working}
                onclick={() => void firstSpace.create()}
              >
                {t('Create')}
              </button>
            </div>
          {:else}
            <div class="nib-setting">
              <span class="name">{t('Start fresh')}</span>
              <button
                class="nib-button"
                type="button"
                data-lands
                disabled={migrating.working}
                onclick={() => firstVisit.answered()}
              >
                {t('Continue')}
              </button>
            </div>
          {/if}

          <div class="nib-setting">
            <span class="name">{t('Sign in to sync')}</span>
            <span class="pair">
              <button
                class="nib-button is-quiet is-soft"
                type="button"
                onclick={() => firstSpace.signIn('sign-in')}
              >
                {t('Sign in')}
              </button>
              <button
                class="nib-button is-quiet is-soft"
                type="button"
                onclick={() => firstSpace.signIn('create')}
              >
                {t('Create account')}
              </button>
            </span>
          </div>
        {/if}
      </div>
    {/if}

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
    --scrim-z: var(--z-screen);
    --scrim-ink: 100%;
    --scrim-blur: 0px;
  }

  .scrim.framed {
    top: var(--header-height);
  }

  /* `.nib-screen` in the themes package, in the middle of the window rather than a
     question's way down it (`is-centred`): there is nothing else on screen to leave
     room for. */
  .card {
    --screen-width: var(--screen-sheet);
    z-index: var(--z-screen);
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

  .rows .nib-button {
    flex: none;
  }

  /* Where the optional questions are, and the way on or out. */
  .steps {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .dots {
    display: flex;
    gap: var(--space-1);
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--muted);
    opacity: 0.4;
  }

  .dot.on {
    opacity: 1;
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

  :global([data-touch]) .name {
    font-size: var(--touch-text);
  }
</style>
