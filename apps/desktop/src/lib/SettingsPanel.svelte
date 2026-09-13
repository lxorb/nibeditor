<script lang="ts">
  import { closeOnBack } from './backstack.svelte'
  import { overlays } from './overlays'
  import { fade, fly, scale, slide } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import type { EditorView } from '@nib/editor'
  import { account } from './account.svelte'
  import { exportCommands } from './commands'
  import { arrive, segmented } from './slide'
  import Hint from './Hint.svelte'
  import { i18n, message, plural, t } from './i18n.svelte'
  import AiPane from './AiPane.svelte'
  import McpSetup from './McpSetup.svelte'
  import Security from './Security.svelte'
  import SyncPane from './SyncPane.svelte'
  import RecentlyDeleted from './RecentlyDeleted.svelte'
  import { scrollbar } from './scrollbar'
  import Select from './Select.svelte'
  import { settings, type Section } from './settings.svelte'
  import { CATEGORIES, SHORTCUTS, shortcuts } from './shortcuts.svelte'
  import { runnable } from './shortcuts/registry'
  import { markFor, nameFor, toolbar } from './toolbar.svelte'
  import { NOTHING, pull } from './pull.svelte'
  import { PRESETS } from './shortcuts/presets'
  import { showCombination } from './keys'
  import { prompt } from './prompt.svelte'
  import { Rebind } from './settings/rebind.svelte'
  import { ICONS, sectionGroups } from './settings/sections'
  import { type Place, search } from './settings-search'
  import { sync } from './sync.svelte'
  import { isDesktop, openExternal } from './tauri'
  import { theme } from './theme.svelte'
  import ThemeStore from './ThemeStore.svelte'
  import { store } from './themes/store.svelte'
  import { type Field, preferences, resetPane, resettable } from './preferences'
  import { glassesKey } from './even/key.svelte'
  import { EFFORT_WORDS, Offered } from './even/offered.svelte'
  import { modes } from './modes.svelte'
  import { readableSize, usage } from './usage.svelte'
  import { pageHeight, viewport } from './viewport.svelte'
  import { workspace } from './workspace.svelte'
  import { dur } from './motion'
  import { trap } from './trap'

  const { view }: { view?: EditorView | undefined } = $props()

  /** Which models the account's own key may choose, asked of the API. Built here
   *  rather than in `preferences.ts` because the list arrives after the pane does. */
  const offered = new Offered()

  /** Whether the key field is open over a key that is already set. There is no
   *  editing a key nothing can read, so replacing one is typing a whole new one. */
  let replacingKey = $state(false)

  const GROUPS = $derived(sectionGroups())

  const SECTIONS = $derived(GROUPS.flat())
  const titleOf = (id: Section) => SECTIONS.find((one) => one.id === id)?.label ?? ''

  let query = $state('')

  /** The generated panes, rebuilt as things change so every control shows the
   *  value it actually has. */
  const panes = $derived(preferences(view))
  const current = $derived(panes.find((one) => one.id === settings.section))

  /** Page setup is only worth anything next to the buttons that use it. */
  const exportActions = () =>
    exportCommands().filter((command) => command.id !== 'page-setup' && command.id !== 'import')

  /** What the hand-written panes show, so search can land on those too. */
  const places = $derived.by((): Place[] => {
    const all: Place[] = [
      { section: 'account', label: t('Display name'), text: [] },
      { section: 'account', label: t('Email'), text: [account.user?.email ?? ''] },
      { section: 'account', label: t('Storage'), text: [] },
      { section: 'account', label: account.user ? t('Sign out') : t('Sign in'), text: [] },
      {
        section: 'account',
        label: t('Signing in'),
        text: [t('Ask for a code from an app'), t('Recovery codes left')],
      },
      { section: 'account', label: t('Signed in on'), text: [t('End every other session')] },
      {
        section: 'sync',
        label: t('When the same note was written twice'),
        text: [t('Keep both copies'), t('Let the newest win'), t('Ask me each time')],
      },
      {
        section: 'sync',
        label: t('History on the account'),
        text: [t('Keep versions'), t('A month'), t('A year')],
      },
      { section: 'sync', label: t('What synced'), text: [] },
      { section: 'sync', label: t('Go back'), text: [t('This space, as it was')] },
      { section: 'appearance', label: t('Themes'), text: [t('Browse'), t('Install')] },
      { section: 'editor', label: t('Reset to defaults'), text: [] },
      // Modal editing sits with the keyboard rather than with the editor, so
      // this is where searching for it lands.
      { section: 'shortcuts', label: t('Vim keys'), text: ['vim'] },
      // Every shortcut by name, so searching the settings for "Bold" lands on
      // the key that runs it as well as on the button that does.
      ...SHORTCUTS.map((one): Place => ({
        section: 'shortcuts',
        label: one.label(),
        text: [shortcuts.hint(one.id) ?? '', t('Shortcuts')],
      })),
      { section: 'markdown', label: t('Reset to defaults'), text: [] },
      ...exportActions().map((action): Place => ({
        section: 'export',
        label: action.label,
        text: [],
      })),
    ]

    if (!theme.accentIsTheme) {
      all.push({
        section: 'appearance',
        label: t('Accent'),
        text: theme.accents.map((one) => t(one.name)),
      })
    }

    if (isDesktop) {
      all.push({
        section: 'appearance',
        label: t('Reload themes and custom CSS'),
        text: [t('Custom')],
      })
    }

    if (account.user) {
      all.push({
        section: 'llm',
        label: t('LLM access'),
        text: ['MCP', 'Claude', 'ChatGPT', 'token', t('Connect'), t('Create a token')],
      })
    }

    // The pane's own name counts as a word on everything in it.
    return all.map((place) => ({ ...place, text: [...place.text, titleOf(place.section)] }))
  })

  /** Searching looks across every pane at once: nobody knows which one holds
   *  the thing they are after, which is the reason for the box. */
  const found = $derived(search(query, panes, places))

  // Signing out while one of them is open would leave a pane with nothing in it.
  $effect(() => {
    if (!SECTIONS.some((one) => one.id === settings.section)) settings.section = 'account'
  })

  // The theme store is a sheet over this one, so closing this one closes it too:
  // it would otherwise be waiting there the next time the settings opened.
  $effect(() => {
    if (!settings.open) store.close()
  })

  /** Opens a pane: from the list, from the search results, from anywhere. */
  function go(section: Section) {
    query = ''
    settings.section = section
    settings.listing = false
  }

  /** The entry goes in Windows Explorer's own registry, so a browser cannot
   *  offer it however Windows the machine running the browser happens to be. */
  const isWindows = isDesktop && navigator.userAgent.includes('Windows')

  async function rename(name: string) {
    settings.error = null
    try {
      await account.rename(name)
    } catch (error) {
      settings.error = message(error, 'that did not work')
    }
  }

  /** Where a slider's thumb sits, for the filled part of its track. */
  const fraction = (field: Extract<Field, { kind: 'slider' }>) =>
    ((field.get() - field.min) / (field.max - field.min)) * 100

  // ── Shortcuts ───────────────────────────────────────────────────

  const rebind = new Rebind()
  let keyFilter = $state('')

  const shown = (key: string | null) => (key ? showCombination(key, shortcuts.platform) : null)

  /** The keyboards to choose from. Custom is in the list only while it is what
   *  the map is: it is arrived at by rebinding a key, never chosen, and an
   *  option that does nothing is worse than one that is not there. */
  const presetChoices = $derived([
    ...PRESETS.map((one) => ({ value: one.id, label: one.label() })),
    ...(shortcuts.preset === 'custom' ? [{ value: 'custom', label: t('Custom') }] : []),
  ])

  /** Handing the whole keyboard over throws away a map somebody made by hand,
   *  so that one case asks first. Choosing between two presets replaces
   *  nothing anybody wrote and goes straight through. */
  async function choosePreset(id: string) {
    if (shortcuts.preset === 'custom') {
      const sure = await prompt.confirm({
        title: t('Replace your own keys?'),
        detail: t('The keys you changed go back to what this keyboard says.'),
        confirmLabel: t('Replace'),
      })
      if (!sure) return
    }

    shortcuts.choose(id)
  }

  /** The list, grouped the way the menus group the same commands, and cut
   *  down to what was typed in the box above it. A shortcut is looked for by
   *  its name or by the key it is on, so both count. */
  const keyGroups = $derived.by(() => {
    const needle = keyFilter.trim().toLowerCase()
    const has = (text: string | null) => !!text && text.toLowerCase().includes(needle)

    return CATEGORIES.map((category) => ({
      id: category.id,
      label: category.label(),
      rows: SHORTCUTS.filter((one) => one.category === category.id).filter(
        (one) =>
          !needle ||
          has(one.label()) ||
          has(shown(shortcuts.keyFor(one.id))) ||
          has(category.label()),
      ),
    })).filter((group) => group.rows.length)
  })

  // ── Mobile ──────────────────────────────────────────────────────

  /** What is typed into the box over the commands the bar can hold. */
  let barFilter = $state('')

  /** Which row is being dragged along the bar, while one is, and where it would
   *  land. The same shape the outline's sections use; see Sidebar.svelte. */
  let dragging = $state<number | null>(null)
  let dropAt = $state<number | null>(null)

  /** Everything the bar could hold that it does not already, grouped the way the
   *  shortcuts list groups the same commands - because it is the same list.
   *  Panel and fixed entries are left out: a panel key means nothing outside the
   *  file list, and a fixed one is a fact about the keyboard. */
  const barOffers = $derived.by(() => {
    const needle = barFilter.trim().toLowerCase()
    const held = new Set(toolbar.ids)

    return CATEGORIES.map((category) => ({
      id: category.id,
      label: category.label(),
      rows: SHORTCUTS.filter(
        (one) =>
          one.category === category.id &&
          runnable(one.id) &&
          !held.has(one.id) &&
          (!needle ||
            one.label().toLowerCase().includes(needle) ||
            category.label().toLowerCase().includes(needle)),
      ),
    })).filter((group) => group.rows.length)
  })

  /** What the pull may be set to: nothing at all, then every command the bar
   *  could hold, grouped the way the shortcuts list groups them. One choice, so
   *  it is a select rather than a second list of rows - and on a phone the app's
   *  select is the platform's own picker, which handles a long list better than
   *  anything drawn here would. */
  const pullChoices = $derived([
    { value: NOTHING, label: t('Nothing') },
    ...CATEGORIES.flatMap((category) =>
      SHORTCUTS.filter((one) => one.category === category.id && runnable(one.id)).map((one) => ({
        value: one.id,
        label: `${category.label()}: ${one.label()}`,
      })),
    ),
  ])

  function takeBar(event: DragEvent, at: number) {
    event.dataTransfer?.setData('text/plain', String(at))
    dragging = at
  }

  function overBar(event: DragEvent, at: number) {
    if (dragging === null || dragging === at) return

    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    dropAt = at
  }

  function dropBar(event: DragEvent, at: number) {
    event.preventDefault()
    if (dragging !== null) toolbar.move(dragging, at)
    dragging = null
    dropAt = null
  }

  /** The next keystroke goes to whichever row is listening.
   *
   *  On the way down rather than up, and before anything else sees it: the
   *  app's own keys are on the window too, and Ctrl+S while recording is a key
   *  being chosen, not a note being saved. */
  $effect(() => {
    if (!rebind.listening) return

    const record = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      rebind.record(event)
    }

    window.addEventListener('keydown', record, true)
    return () => window.removeEventListener('keydown', record, true)
  })

  // Nothing is left listening behind a closed panel or a pane that moved on.
  $effect(() => {
    if (!settings.open || settings.section !== 'shortcuts') rebind.forget()
  })

  /** A window that grows into place on a desktop; a page that rises from the
   *  bottom on a phone. */
  function appear(node: Element) {
    return viewport.touch
      ? fly(node, { y: 40, duration: dur(240), easing: cubicOut })
      : scale(node, { duration: dur(200), start: 0.97, easing: cubicOut })
  }

  /** The list and the pane slide past each other on a phone; a desktop shows
   *  both and has nothing to slide. */
  const enter = (x: number) =>
    viewport.touch ? { x, duration: dur(200), easing: cubicOut } : { duration: dur(0) }

  // Back closes this before it leaves the app: the pane first, then the sheet.
  // Escape closes it, like everything else the app puts over a note; see
  // overlays.ts.
  $effect(() => (settings.open ? overlays.show(() => (settings.open = false)) : undefined))
  $effect(() => closeOnBack(settings.open, () => (settings.open = false)))
  $effect(() => closeOnBack(settings.open && !settings.listing, () => (settings.listing = true)))
</script>

{#if settings.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="nib-scrim scrim"
    transition:fade={{ duration: dur(140) }}
    onclick={() => (settings.open = false)}
  ></div>

  <div
    class="nib-screen sheet"
    class:phone={viewport.touch}
    style:height={pageHeight()}
    use:trap
    role="dialog"
    aria-modal="true"
    aria-label={t('Settings')}
    transition:appear
  >
    {#if viewport.touch}
      <header class="bar">
        {#if !settings.listing}
          <button class="icon" aria-label={t('Back')} onclick={() => (settings.listing = true)}>
            <svg class="nib-mirror" viewBox="0 0 16 16"><path d="M10 3L5 8l5 5" /></svg>
          </button>
        {/if}

        <h1 class:inset={settings.listing}>
          {settings.listing ? t('Settings') : titleOf(settings.section)}
        </h1>

        <button class="icon" aria-label={t('Close')} onclick={() => (settings.open = false)}>
          <svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </header>
    {/if}

    {#if !viewport.touch || settings.listing}
      <nav data-scrolls use:scrollbar in:fly={enter(-24)}>
        {#if !viewport.touch}
          <h1>{t('Settings')}</h1>
        {/if}

        <label class="search">
          <svg viewBox="0 0 16 16"
            ><circle cx="7" cy="7" r="4.5" /><path d="M10.4 10.4L14 14" /></svg
          >
          <input bind:value={query} placeholder={t('Search settings')} spellcheck="false" />
        </label>

        {#if viewport.touch && query}
          {@render results()}
        {:else}
          {#each GROUPS as group, index (index)}
            <div class="group">
              {#each group as item (item.id)}
                <button
                  class="item"
                  class:active={!viewport.touch && !query && settings.section === item.id}
                  onclick={() => go(item.id)}
                >
                  <svg class="glyph" viewBox="0 0 16 16"><path d={ICONS[item.id]} /></svg>
                  <span class="text">{item.label}</span>
                  <svg class="chevron nib-mirror" viewBox="0 0 16 16"><path d="M6 3l5 5-5 5" /></svg
                  >
                </button>
              {/each}
            </div>
          {/each}
        {/if}
      </nav>
    {/if}

    {#if !viewport.touch || !settings.listing}
      <div class="body" data-scrolls use:scrollbar={settings.section} in:fly={enter(24)}>
        {#if query && !viewport.touch}
          <div class="pane">
            <h2>{t('Search settings')}</h2>
            {@render results()}
          </div>
        {:else}
          <!-- The pane that has just been chosen comes up from below and fades
               in, which is the movement every other swap in the app makes; see
               slide.ts. The one before it goes at once rather than crossing with
               it: a pane is a page of controls, and keeping a second copy of all
               of them alive to fade one out is a cost the eye is not paid for
               here. On a phone this is now a movement too - the list and the
               pane already slide past each other, and this is what happens once
               the pane is the thing on screen. -->
          {#key settings.section}
            <div class="pane" in:arrive>
              {#if !viewport.touch}
                <h2>{titleOf(settings.section)}</h2>
              {/if}
              {@render pane()}
            </div>
          {/key}
        {/if}

        {#if settings.error}
          <p class="hint bad" transition:slide={{ duration: dur(160) }}>{t(settings.error)}</p>
        {/if}
      </div>
    {/if}
  </div>

  <!-- The theme store, over this sheet and only ever reached from it. -->
  <ThemeStore />
{/if}

<!-- What search turned up: each setting with its own control, captioned with
     the pane it lives in, and the things search can only point at. -->
{#snippet results()}
  {#if found.length}
    <div class="card">
      {#each found as hit, index (index)}
        {#if hit.kind === 'field'}
          {@render row(hit.field, hit.pane.label)}
        {:else}
          <button class="nib-setting setting link" onclick={() => go(hit.section)}>
            <span class="name">{hit.label}<small>{titleOf(hit.section)}</small></span>
            <svg class="chevron nib-mirror" viewBox="0 0 16 16"><path d="M6 3l5 5-5 5" /></svg>
          </button>
        {/if}
      {/each}
    </div>
  {:else}
    <p class="note">{t('Nothing matches.')}</p>
  {/if}
{/snippet}

<!-- What every row says about itself: the setting's name, the `i` that explains
     it where the name is not enough, and the pane it lives in when search is
     showing it out of context. One snippet, so the glyph lands in the same slot
     after the label on every kind of row and a row without one does not shift. -->
{#snippet named(field: Field, where?: string)}
  <span class="name">
    <span class="what"
      >{field.label}{#if field.hint}<Hint text={field.hint} />{/if}</span
    >
    {#if where}<small>{where}</small>{/if}
  </span>
{/snippet}

<!-- One row per setting, whatever kind it is. -->
{#snippet row(field: Field, where?: string)}
  {#if field.kind === 'switch'}
    <!-- What the setting says now, read once. `get` reaches into a store - the
         modes, the preferences, the theme - and this row asked it twice, the slider
         three times, and a segmented control twice per option. Inside the branch
         rather than above it, so each kind's answer is that kind's own type. -->
    {@const held = field.get()}
    <!-- The whole row is the switch, so there is nothing to miss. A switch and
         not a button, because a row may carry the `i` that explains it and a
         button may hold nothing else anybody can press. -->
    <div
      class="nib-setting setting pressable"
      role="switch"
      tabindex="0"
      aria-checked={held}
      onclick={() => field.set(!field.get())}
      onkeydown={(event) => {
        if (event.key !== ' ' && event.key !== 'Enter') return
        event.preventDefault()
        field.set(!field.get())
      }}
    >
      {@render named(field, where)}
      <span class="nib-switch" class:on={held} aria-hidden="true"></span>
    </div>
  {:else if field.kind === 'slider'}
    {@const held = field.get()}
    <div class="nib-setting setting sliding">
      {@render named(field, where)}
      <span class="value">{held}{field.unit ?? ''}</span>
      <input
        class="slider nib-slider"
        type="range"
        min={field.min}
        max={field.max}
        step={field.step}
        value={held}
        aria-label={field.label}
        style:--fill="{fraction(field)}%"
        oninput={(event) => field.set(Number(event.currentTarget.value))}
      />
    </div>
  {:else if field.kind === 'segmented'}
    <!-- Two or three short words, all of them in view. The app's one segmented
         control; see .nib-segmented in the themes package. A choice the setting
         cannot honour right now is disabled rather than left out, so the row does
         not change shape as themes are chosen. -->
    {@const held = field.get()}
    <div class="nib-setting setting">
      {@render named(field, where)}
      <div class="nib-segmented" role="radiogroup" aria-label={field.label} use:segmented>
        {#each field.options as one (one.value)}
          <button
            type="button"
            role="radio"
            aria-checked={one.value === held}
            class:on={one.value === held}
            disabled={one.disabled}
            onclick={() => field.set(one.value)}
          >
            {one.label}
          </button>
        {/each}
      </div>
    </div>
  {:else if field.kind === 'text'}
    <!-- A line somebody types. The placeholder is what the app answers to with
         nothing typed, so an empty field is the default put back and the reset is
         a field that is already there rather than a button beside it. -->
    <label class="nib-setting setting">
      {@render named(field, where)}
      <!-- `live` writes as it is typed; see the kind in preferences.ts. The other
           kind waits for the field to be left, because half a word is a phrase
           that matches nothing. -->
      <input
        class="inline"
        type="text"
        value={field.get()}
        placeholder={field.placeholder}
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        oninput={field.live ? (event) => field.set(event.currentTarget.value) : undefined}
        onchange={field.live ? undefined : (event) => field.set(event.currentTarget.value)}
      />
    </label>
  {:else}
    <div class="nib-setting setting">
      {@render named(field, where)}
      <div class="pick">
        <Select
          value={field.get()}
          options={field.options}
          onchange={(value: string) => field.set(value)}
          label={field.label}
          plain={viewport.touch}
        />
      </div>
    </div>
  {/if}
{/snippet}

<!-- The words the reader has said are words. Written out here rather than as
     another kind of generated field, because there is one list like this in the
     whole app and a new kind would be a new shape every other reader of a field
     has to learn. Adding is mostly done where the words are met, in the menu
     over one in the text; this is where they are read and taken back. -->
{#snippet dictionary()}
  <h3>{t('Your words')}</h3>
  <div class="card">
    <div class="nib-setting setting words">
      <span class="name"><span class="what">{t('Words')}</span></span>
      {#if modes.spellWords.length}
        <div class="chips">
          {#each modes.spellWords as word (word)}
            <button
              class="chip"
              title={t('Remove')}
              onclick={() => modes.toggleSpellWord(word, view)}
            >
              {word}<span aria-hidden="true">×</span>
            </button>
          {/each}
        </div>
      {/if}
      <input
        class="inline"
        type="text"
        placeholder={t('Add a word')}
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        onchange={(event) => {
          modes.toggleSpellWord(event.currentTarget.value, view)
          event.currentTarget.value = ''
        }}
      />
    </div>
  </div>
{/snippet}

{#snippet pane()}
  {#if current}
    {#each current.groups as group (group.title)}
      <h3>{group.title}</h3>
      <div class="card">
        {#each group.fields as field (field.label)}
          {@render row(field)}
        {/each}
      </div>

      <!-- What no control on the card can say about itself. A link where the
           words lead somewhere outside the app, plain words where they do not. -->
      {#if group.caption}
        {#if group.caption.url}
          {@const url = group.caption.url}
          <p class="hint caption">
            <button class="link" onclick={() => void openExternal(url)}>
              {group.caption.text}
              <svg class="nib-mirror" viewBox="0 0 16 16" aria-hidden="true"
                ><path d="M6 3h7v7M13 3L5 11" /></svg
              >
            </button>
          </p>
        {:else}
          <p class="hint caption">{group.caption.text}</p>
        {/if}
      {/if}
    {/each}

    {#if settings.section === 'export'}
      {@render exportExtras()}
    {/if}

    {#if settings.section === 'appearance'}
      {@render appearanceExtras()}
    {/if}

    {#if settings.section === 'spelling'}
      {@render dictionary()}
    {/if}

    {#if settings.section === 'glasses'}
      {@render glassesExtras()}
    {/if}

    <!-- Everything above, back to how it came. -->
    {#if resettable(current)}
      <div class="card">
        <button class="action" onclick={() => resetPane(current)}>{t('Reset to defaults')}</button>
      </div>
    {/if}
  {:else if settings.section === 'account'}
    {#if account.user}
      <h3>{t('Account')}</h3>
      <div class="card">
        <label class="nib-setting setting">
          <span class="name">{t('Display name')}</span>
          <input
            class="inline"
            value={account.user.name ?? ''}
            placeholder={t('Your name')}
            spellcheck="false"
            onchange={(event) => void rename(event.currentTarget.value)}
          />
        </label>
        <div class="nib-setting setting">
          <span class="name">{t('Email')}</span>
          <span class="text">{account.user.email}</span>
        </div>
      </div>

      <!-- Notes and images together, which is what the limit counts. Having
           an account is what syncing means, so there is nothing to switch:
           the pane only says where things stand. -->
      <h3>{t('Storage')}</h3>
      <div class="card">
        <div class="stack">
          <div
            class="meter"
            class:full={usage.nearlyFull}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={usage.limit}
            aria-valuenow={usage.used}
          >
            <div class="fill" style:width="{Math.min(100, usage.fraction * 100)}%"></div>
          </div>
          <p class="hint">
            {t('{used} of {limit} used.', {
              used: readableSize(usage.used),
              limit: readableSize(usage.limit),
            })}
          </p>
          <p class="hint">
            {plural(workspace.spaces.length, {
              one: '{count} space syncs to your account.',
              other: '{count} spaces sync to your account.',
            })}
            {#if sync.lastSyncedAt}
              {t('Last synced {time}.', {
                time: i18n.when(sync.lastSyncedAt, { timeStyle: 'medium' }),
              })}
            {/if}
          </p>
        </div>
      </div>

      <!-- What makes the account yours: a second code when signing in, and the
           devices signed in now. Its own component, because the pane is two small
           reports rather than a list of settings. -->
      <Security />

      <div class="card">
        <button class="action danger" onclick={() => account.signOut()}>{t('Sign out')}</button>
      </div>
    {:else if account.guest}
      <!-- A guest a link let in. There is no account here to show, and the one
           thing they own is the name the others in the space see. -->
      <h3>{t('Account')}</h3>
      <div class="card">
        <label class="nib-setting setting">
          <span class="name">{t('Your name')}</span>
          <input
            class="inline"
            value={account.guest.name}
            placeholder={t('Your name')}
            spellcheck="false"
            onchange={(event) => void rename(event.currentTarget.value)}
          />
        </label>
      </div>
      <p class="hint caption">{t('What the others in this space see.')}</p>

      <button
        class="primary"
        onclick={() => {
          settings.open = false
          account.open = true
        }}
      >
        {t('Sign in')}
      </button>
    {:else}
      <p class="lead">{t('Not signed in')}</p>
      <button
        class="primary"
        onclick={() => {
          settings.open = false
          account.open = true
        }}
      >
        {t('Sign in')}
      </button>
    {/if}
  {:else if settings.section === 'shortcuts'}
    {@render keyboard()}
  {:else if settings.section === 'mobile'}
    {@render phone()}
  {:else if settings.section === 'sync'}
    <!-- Its own component, for the same reason as the connector's: what syncing
         is doing is a small report with two decisions in it. -->
    <SyncPane />
  {:else if settings.section === 'ai'}
    <!-- Its own component: a provider is two or three fields and a list fetched
         from a server, not a row of settings. -->
    <AiPane />
  {:else if settings.section === 'llm'}
    <!-- Its own component: the pane is a small guide, not a list of settings. -->
    <McpSetup />
  {:else if settings.section === 'trash'}
    <RecentlyDeleted />
  {/if}
{/snippet}

<!-- The settings on this pane only matter once something is exported, so the ways
     of doing it belong here rather than in the palette. Commands rather than
     settings, which is why they are not fields. -->
{#snippet exportExtras()}
  <h3>{t('This note')}</h3>
  <div class="card">
    {#each exportActions() as action (action.id)}
      <button class="action" disabled={action.disabled} onclick={action.run}>
        {action.label}
      </button>
    {/each}
  </div>
{/snippet}

<!-- Every shortcut there is, grouped the way the menus group the same
     commands. A row is its name, the key it is on, and a way back to the key
     it started on; the ones that cannot be changed say why instead. -->
{#snippet keyboard()}
  <!-- Whose keyboard this is, before the list of what is on it. -->
  <div class="card">
    <div class="nib-setting setting">
      <span class="name">{t('Shortcuts')}</span>
      <div class="pick">
        <Select
          value={shortcuts.preset}
          options={presetChoices}
          onchange={(value: string) => void choosePreset(value)}
          label={t('Shortcuts')}
          plain={viewport.touch}
        />
      </div>
    </div>

    {@render row({
      // Modal editing, under the keyboard it belongs with rather than in the
      // editor: choosing the Vim preset turns it on, and this is how it is on
      // over the Obsidian or the Notion map instead.
      kind: 'switch',
      label: t('Vim keys'),
      get: () => modes.vim,
      set: (on) => modes.setVimKeys(on, view),
    })}
  </div>

  <label class="search">
    <svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" /><path d="M10.4 10.4L14 14" /></svg>
    <input bind:value={keyFilter} placeholder={t('Search shortcuts')} spellcheck="false" />
  </label>

  {#each keyGroups as group (group.id)}
    <h3>{group.label}</h3>
    <div class="card">
      {#each group.rows as entry (entry.id)}
        {@const key = shortcuts.keyFor(entry.id)}
        {@const warning = entry.scope === 'fixed' ? null : shortcuts.warning(key)}
        <div class="nib-setting setting shortcut">
          <span class="name">
            {entry.label()}
            {#if entry.alias}<small>{t('Second key')}</small>{/if}
            {#if entry.why}<small>{entry.why()}</small>{/if}
            {#if warning}<small class="caution">{warning}</small>{/if}
            {#if rebind.turnedDown?.id === entry.id}<small class="warn"
                >{rebind.turnedDown.reason}</small
              >{/if}
          </span>

          {#if entry.scope === 'fixed'}
            <span class="key held">{shown(key) ?? '–'}</span>
          {:else}
            <button
              class="key"
              class:listening={rebind.listening === entry.id}
              class:none={!key}
              onclick={() => rebind.listen(entry.id)}
            >
              {rebind.listening === entry.id ? t('Press a key…') : (shown(key) ?? t('Not set'))}
            </button>
            <button
              class="revert"
              disabled={!shortcuts.changed(entry.id)}
              title={t('Reset')}
              aria-label={t('Reset')}
              onclick={() => shortcuts.reset(entry.id)}
            >
              <svg viewBox="0 0 16 16">
                <path d="M3.2 8a4.8 4.8 0 1 0 1.5-3.5M4.4 2.6v2.6h2.6" />
              </svg>
            </button>
          {/if}
        </div>

        {#if rebind.clash?.id === entry.id}
          <div class="clash" transition:slide={{ duration: dur(160) }}>
            <span>
              {t('{key} already runs {name}.', {
                key: shown(rebind.clash.key) ?? '',
                name: rebind.clash.holders.map((one) => one.label()).join(', '),
              })}
            </span>
            <button class="take" onclick={() => rebind.takeOver()}>{t('Take it over')}</button>
            <button class="give" onclick={() => (rebind.clash = null)}>{t('Cancel')}</button>
          </div>
        {/if}
      {/each}
    </div>
  {:else}
    <p class="note">{t('Nothing matches.')}</p>
  {/each}

  <p class="hint">{t('Esc stops recording, Backspace takes the key away.')}</p>

  <div class="card">
    <button class="action" onclick={() => shortcuts.resetAll()}>{t('Reset all shortcuts')}</button>
  </div>
{/snippet}

<!-- The bar over the keyboard on a phone: which commands it holds and in what
     order. The rows are the shortcuts pane's rows - a name, and the controls that
     act on it - because they are rows about the same commands.

     Dragging orders them where there is a pointer, and the two arrows order them
     everywhere: a thumb has no drag and a keyboard has no drag either, and one
     pair of buttons answers both. -->
{#snippet phone()}
  <p class="lead">{t('The bar sits over the keyboard on a phone.')}</p>

  <h3>{t('On the bar')}</h3>
  <div class="card">
    {#each toolbar.ids as id, at (id)}
      <div
        class="nib-setting setting button"
        class:landing={dropAt === at}
        role="group"
        aria-label={nameFor(id)}
        draggable={!viewport.touch}
        ondragstart={(event) => takeBar(event, at)}
        ondragover={(event) => overBar(event, at)}
        ondragleave={() => (dropAt = null)}
        ondragend={() => {
          dragging = null
          dropAt = null
        }}
        ondrop={(event) => dropBar(event, at)}
      >
        <span class="mark">{markFor(id)}</span>
        <span class="name">{nameFor(id)}</span>
        <button
          class="revert"
          disabled={at === 0}
          title={t('Move up')}
          aria-label={t('Move up')}
          onclick={() => toolbar.move(at, at - 1)}
        >
          <svg viewBox="0 0 16 16"><path d="M4.5 9.5L8 6l3.5 3.5" /></svg>
        </button>
        <button
          class="revert"
          disabled={at === toolbar.ids.length - 1}
          title={t('Move down')}
          aria-label={t('Move down')}
          onclick={() => toolbar.move(at, at + 1)}
        >
          <svg viewBox="0 0 16 16"><path d="M4.5 6.5L8 10l3.5-3.5" /></svg>
        </button>
        <button
          class="revert"
          title={t('Take it off')}
          aria-label={t('Take it off')}
          onclick={() => toolbar.remove(id)}
        >
          <svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </div>
    {:else}
      <p class="note">{t('Nothing on the bar.')}</p>
    {/each}
  </div>

  <div class="card">
    <button class="action" disabled={!toolbar.changed} onclick={() => toolbar.reset()}>
      {t('Reset the bar')}
    </button>
  </div>

  <h3>{t('Pulling down')}</h3>
  <div class="card">
    <div class="nib-setting setting">
      <span class="name">
        {t('A pull past the top runs')}
        <small>{t('On the note, and on the list of them.')}</small>
      </span>
      <div class="pick">
        <Select
          value={pull.id}
          options={pullChoices}
          onchange={(value: string) => pull.choose(value)}
          label={t('A pull past the top runs')}
          plain={viewport.touch}
        />
      </div>
    </div>
  </div>

  <h3>{t('Everything else')}</h3>
  <label class="search">
    <svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" /><path d="M10.4 10.4L14 14" /></svg>
    <input bind:value={barFilter} placeholder={t('Search commands')} spellcheck="false" />
  </label>

  {#each barOffers as group (group.id)}
    <h3>{group.label}</h3>
    <div class="card">
      {#each group.rows as entry (entry.id)}
        <div class="nib-setting setting button">
          <span class="mark">{markFor(entry.id)}</span>
          <span class="name">{entry.label()}</span>
          <button
            class="revert"
            title={t('Put it on the bar')}
            aria-label={t('Put it on the bar')}
            onclick={() => toolbar.add(entry.id)}
          >
            <svg viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9" /></svg>
          </button>
        </div>
      {/each}
    </div>
  {:else}
    <p class="note">{t('Nothing matches.')}</p>
  {/each}
{/snippet}

<!-- The key, the model and how hard it thinks. Written out rather than declared
     with the rows above it because a key is a text field and the settings
     vocabulary has none: it has a switch, a slider and a select, which is three
     more than most panes need and one fewer than this one does.

     The key is written and never read back, so the field has two faces. With no
     key it is a field to paste one into. With a key it is a sentence saying which
     key it is - "set, ends in ...4f2a" - and two buttons, because those are the
     only two things anybody can do to a key they cannot see. Replace puts the
     field back; there is no editing four characters into a key. -->
{#snippet glassesExtras()}
  <h3>{t('Questions')}</h3>
  <div class="card">
    {#if glassesKey.set && !replacingKey}
      <div class="nib-setting setting">
        <span class="name">{t('OpenAI key')}</span>
        <div class="row">
          <span class="hint">{t('set, ends in …{tail}', { tail: glassesKey.tail })}</span>
          <button class="action" onclick={() => (replacingKey = true)}>{t('Replace')}</button>
          <button class="action danger" onclick={() => void offered.remove()}>{t('Remove')}</button>
        </div>
      </div>
    {:else}
      <!-- svelte-ignore a11y_autofocus -->
      <label class="nib-setting setting">
        <span class="name">{t('OpenAI key')}</span>
        <input
          class="inline"
          type="password"
          value=""
          placeholder="sk-"
          spellcheck="false"
          autocomplete="off"
          autofocus={replacingKey}
          onchange={(event) => {
            replacingKey = false
            void offered.take(event.currentTarget.value)
          }}
        />
      </label>
    {/if}

    {#if offered.models.length}
      <div class="nib-setting setting">
        <span class="name">{t('Model')}</span>
        <div class="pick">
          <Select
            value={modes.glassesModel}
            options={offered.models.map((one) => ({ value: one, label: one }))}
            onchange={(value: string) => modes.setGlassesModel(value)}
            label={t('Model')}
            plain={viewport.touch}
          />
        </div>
      </div>
      <div class="nib-setting setting">
        <span class="name">{t('Reasoning')}</span>
        <div class="pick">
          <Select
            value={modes.glassesEffort}
            options={EFFORT_WORDS.map((one) => ({ value: one.value, label: t(one.label) }))}
            onchange={(value: string) => modes.setGlassesEffort(value)}
            label={t('Reasoning')}
            plain={viewport.touch}
          />
        </div>
      </div>
    {/if}
  </div>

  <!-- Said in one line, because it is the one thing somebody typing a key here
       wants to know: where it goes, and that it does not come back. -->
  <p class="hint caption">
    {#if offered.said}{offered.said}{:else}{t(
        'Kept encrypted on your account, and never shown again.',
      )}{/if}
  </p>
{/snippet}

{#snippet appearanceExtras()}
  <!-- Under the theme it belongs to, without a heading of its own: it is another
       way of choosing the same thing. Nowhere else in the app says there is a
       store, so nobody who never opens it ever hears about it. -->
  <div class="card">
    <div class="nib-setting setting">
      <span class="name">{t('Themes')}</span>
      <button class="pill" onclick={() => store.show()}>{t('Browse')}</button>
    </div>
  </div>

  <!-- A theme that brought an accent of its own keeps it, so the row would be a
       row of swatches that change nothing. Left out rather than left dead. -->
  {#if !theme.accentIsTheme}
    <h3>{t('Accent')}</h3>
    <div class="card">
      <div class="accents">
        {#each theme.accents as swatch (swatch.id)}
          <button
            class="swatch"
            class:active={theme.accent === swatch.id}
            title={t(swatch.name)}
            aria-label={t(swatch.name)}
            aria-pressed={theme.accent === swatch.id}
            style:--swatch={swatch[theme.current]}
            onclick={() => theme.setAccent(swatch.id)}
          ></button>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Theme files and custom.css live in a folder, which only a desktop has. -->
  {#if isDesktop}
    <h3>{t('Custom')}</h3>
    <div class="card">
      <button class="action" onclick={() => theme.reload()}
        >{t('Reload themes and custom CSS')}</button
      >

      {#if isWindows}
        {@render row({
          kind: 'switch',
          label: t('Show in Explorer’s New menu'),
          get: () => settings.newMenu,
          set: (on) => void settings.setNewMenu(on),
        })}
      {/if}
    </div>
  {/if}
{/snippet}

<style>
  /* The layer behind it; see .nib-scrim in packages/themes. */
  .scrim {
    --scrim-z: 40;
  }

  /* The shape is `.nib-screen` in the themes package - the surface, the corner,
     the shadow and the centring every panel of this kind wears. What is left
     here is what this one alone is: how wide, how tall, how far down, and the two
     columns inside it. */
  .sheet {
    --screen-width: 56rem;
    top: 10vh;
    height: 76vh;
    z-index: 41;
    /* Two columns: the list of panes, and the pane. */
    display: grid;
    grid-template-columns: 14rem 1fr;
    overflow: hidden;
  }

  /* ── The list of panes ─────────────────────────────────────────── */

  nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-4) var(--space-3);
    border-inline-end: 1px solid var(--line);
    background: var(--bg);
    overflow-y: auto;
  }

  /* Everything in the list keeps its own height. As flex items the groups may
     shrink, and a card that clips what overflows it - which is what gives a
     phone's group its rounded corners - may shrink to nothing: on a screen too
     short for the whole list they were squeezed until they fitted, which cut
     each row in half and left the list with nothing to overflow and so nothing
     to scroll. A list too long for its box overflows it and is scrolled. */
  nav > * {
    flex: none;
  }

  nav h1 {
    margin: 0 0 var(--space-3);
    padding: 0 10px;
    font-family: var(--font-ui);
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    margin-bottom: var(--space-3);
    padding: 0 10px;
    height: 32px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--bg);
    transition: border-color var(--dur-fast) var(--ease-out);
  }

  .search:focus-within {
    border-color: var(--accent);
  }

  .search svg {
    width: 13px;
    height: 13px;
    flex: none;
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.4;
  }

  .search input {
    flex: 1;
    min-width: 0;
    border: none;
    background: none;
    outline: none;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .group + .group {
    margin-top: var(--space-2);
  }

  .item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 8px 10px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: start;
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .item:hover {
      background: var(--surface-2);
      color: var(--text);
    }
  }

  .item.active {
    background: var(--accent-soft);
    color: var(--accent);
  }

  /* Whatever a row is named, placed as one piece: a pane's own name is the app's
     word, but the rows below hold an address, a folder, a font and a key, and
     one of those in the other direction would otherwise take the row's
     punctuation with it. See .nib-row-label in base.css. */
  .item .text,
  .setting .name .what,
  .setting .value {
    unicode-bidi: isolate;
  }

  .item .text {
    flex: 1;
    min-width: 0;
  }

  .item .glyph {
    width: var(--icon-md);
    height: var(--icon-md);
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* A chevron means "there is a page behind this", which only a phone has. */
  .item .chevron {
    display: none;
  }

  /* ── The pane ──────────────────────────────────────────────────── */

  .body {
    padding: var(--space-5) var(--space-6);
    overflow-y: auto;
  }

  .pane {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .pane h2 {
    margin: 0 0 var(--space-2);
    font-family: var(--font-ui);
    font-size: 1.15em;
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  .pane h3 {
    margin: var(--space-3) 0 calc(-1 * var(--space-2));
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--muted-strong);
  }

  .pane h3:first-child,
  .pane h2 + h3 {
    margin-top: 0;
  }

  /* A run of rows. Plain on a desktop; a phone draws the box around it. */
  .card {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 100%;
  }

  /* Name on the left, control on the right, one line each. */

  .setting .name {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  /* The name and the `i` beside it on one line, so the glyph reads as belonging
     to the word rather than to the row. */
  .setting .name .what {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
  }

  .setting .name small {
    font-size: var(--text-xs);
    color: var(--muted);
  }

  /* Wide enough for three words and no wider: the control sits at the right of
     its row like every other value on the pane. */
  .setting .nib-segmented {
    flex: none;
    width: 14rem;
  }

  .setting .text {
    color: var(--muted-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .setting .value {
    flex: none;
    width: 4.5rem;
    text-align: end;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .setting .chevron {
    flex: none;
    width: 14px;
    height: 14px;
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* Wide enough for the longest choice any pane offers, so a value is read
     rather than guessed from its first half. */
  .pick {
    flex: none;
    width: 14rem;
  }

  /* A row that is itself a control: it shows what it does when pointed at. */
  @media (hover: hover) {
    button.setting:hover,
    .setting.pressable:hover {
      color: var(--text-strong);
    }
  }

  button.setting:focus-visible,
  .setting.pressable:focus-visible {
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  /* An action in a card: full width, quiet until pointed at. */
  .action {
    display: flex;
    align-items: center;
    width: 100%;
    min-height: 34px;
    padding: 6px 0;
    border: none;
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-row);
    text-align: start;
    cursor: default;
    transition: color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .action:hover:not(:disabled) {
      color: var(--text-strong);
    }

    .action.danger:hover:not(:disabled) {
      color: var(--danger);
    }
  }

  .action:disabled {
    opacity: 0.5;
  }

  /* A small action at the end of a row, where the control would be. Quiet
     until pointed at, like every other action in a pane. */
  .pill {
    flex: none;
    padding: 5px 12px;
    border: 1px solid var(--line-strong);
    border-radius: 99px;
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-row);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .pill:hover {
      border-color: var(--accent);
      color: var(--accent);
    }
  }

  .pill:active {
    background: var(--accent-soft);
  }

  /* ── A button on the phone's bar ───────────────────────────────── */

  .setting.button {
    gap: var(--space-2);
  }

  /* The character the button wears, drawn as the bar draws it: a small square of
     the writing face, so the row shows what will be on the keyboard rather than
     only what it does. */
  .setting .mark {
    flex: none;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text-strong);
    font-size: var(--text-sm);
  }

  /* Where a dragged row would land, drawn as the line the outline's sections
     use rather than as a moved row: nothing jumps until the drop. */
  .setting.button.landing {
    box-shadow: inset 0 2px 0 var(--accent);
  }

  /* ── A shortcut and its key ────────────────────────────────────── */

  .setting.shortcut {
    gap: var(--space-2);
  }

  /* The key itself is the button that changes it: nothing else to aim at,
     and what it shows now is what it will show after. */
  .key {
    flex: none;
    min-width: 7rem;
    padding: 5px 9px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--muted-strong);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.02em;
    text-align: center;
    cursor: default;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    button.key:hover {
      border-color: var(--line-strong);
      color: var(--text-strong);
    }
  }

  button.key:focus-visible {
    outline-offset: 2px;
  }

  /* Listening: the ring says the next keystroke goes in here rather than
     wherever it usually goes. */
  .key.listening {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .key.none {
    color: var(--muted);
  }

  /* A key that cannot be changed is written down but is not a button. */
  .key.held {
    background: none;
    color: var(--muted);
  }

  /* Back to the key it came with. Present only once it is not on it, so the
     row stays quiet until something was actually changed. */
  .revert {
    flex: none;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted);
    cursor: default;
    transition: color var(--dur-fast) var(--ease-out);
  }

  .revert:disabled {
    visibility: hidden;
  }

  @media (hover: hover) {
    .revert:hover:not(:disabled) {
      color: var(--text-strong);
    }
  }

  .revert svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* What is in the way, and the two ways out of it. Nothing is written until
     one of them is pressed. */
  .clash {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: 10px 0;
    font-size: var(--text-sm);
    color: var(--muted-strong);
    line-height: 1.5;
  }

  .clash span {
    flex: 1;
    min-width: 12rem;
  }

  .clash button {
    flex: none;
    padding: 5px 10px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-row);
    cursor: default;
  }

  .clash .take {
    border-color: transparent;
    background: var(--accent);
    color: #fff;
  }

  /* A key that may never arrive. Quiet rather than red: on a browser several of
     the defaults carry one of these, and a column of alarms about something
     nobody has done yet reads as breakage. Quiet is `--muted-strong`, which is a
     colour somebody can read; the mix it used to be came out at 1.2:1 against
     the surface, which is a warning nobody can. */
  .setting .name small.caution {
    color: var(--muted-strong);
  }

  /* A key that was turned down, which is an answer to something the reader
     just did and belongs in the colour of a refusal. */
  .setting .name small.warn {
    color: var(--danger);
  }

  /* The dial's shape is `.nib-slider` in the theme, which every dial in the app
     wears; what is left here is how wide this one is in a row of settings. */
  .slider {
    width: 11rem;
  }

  .lead {
    margin: 0;
    font-size: var(--text-base);
    color: var(--text-strong);
    font-weight: var(--weight-row);
  }

  .note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted-strong);
    line-height: 1.6;
  }

  .hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
    line-height: 1.5;
  }

  /* Under the card it explains, closer to it than the next group. */
  .hint.caption {
    margin-top: calc(-1 * var(--space-2));
  }

  /* A caption that leads somewhere outside the app: the same sentence, in the
     accent, with the arrow every other outward link in the app carries. */
  .hint.caption .link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0;
    border: none;
    background: none;
    font-family: var(--font-ui);
    font-size: inherit;
    line-height: inherit;
    color: var(--accent);
    text-align: start;
    cursor: default;
    transition: color var(--dur-fast) var(--ease-out);
  }

  .hint.caption .link svg {
    flex: none;
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  @media (hover: hover) {
    .hint.caption .link:hover {
      color: var(--accent-hover);
    }
  }

  .hint.bad {
    color: var(--danger);
  }

  button.primary {
    align-self: flex-start;
    padding: 9px 14px;
    border: none;
    border-radius: var(--radius-md);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-row);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-spring);
  }

  button.primary {
    background: var(--accent);
    color: #fff;
  }

  @media (hover: hover) {
    button.primary:hover:not(:disabled) {
      background: var(--accent-hover);
      transform: translateY(-1px);
    }
  }

  button:disabled {
    opacity: 0.5;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
  }

  /* A list of words is as long as it is, so it runs down the card rather than
     across it and the field for another one sits under the last of them. */
  .words {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-2);
  }

  .words .inline {
    width: 100%;
    text-align: start;
    border-color: var(--line);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  /* One word, and the way to take it back. The whole chip is the button, so
     there is no small cross to aim at. */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
    padding: 0.1em 0.55em;
    border: none;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .chip span {
    color: var(--muted);
  }

  @media (hover: hover) {
    .chip:hover {
      background: var(--danger-soft);
      color: var(--danger);
    }

    .chip:hover span {
      color: inherit;
    }
  }

  /* An input in a row: the value at the right, no box until it is typed in. */
  .inline {
    flex: none;
    width: 12rem;
    padding: 6px 9px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: end;
    outline: none;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);
  }

  .inline::placeholder {
    color: var(--muted);
  }

  @media (hover: hover) {
    .inline:hover {
      border-color: var(--line);
    }
  }

  .inline:focus {
    border-color: var(--accent);
    background: var(--bg);
  }

  .accents {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
  }

  .swatch {
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--swatch);
    cursor: default;
    /* Only the swatch under the pointer moves, and it moves plainly. The ring
       marking the chosen one is a state rather than a movement, so it is left
       out of the transition: it should appear, not grow. */
    transition: transform var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .swatch:hover {
      transform: scale(1.12);
    }
  }

  /* A ring rather than a tick: the colour is the whole point of the control. */
  .swatch.active {
    box-shadow:
      0 0 0 2px var(--surface),
      0 0 0 4px var(--swatch);
  }

  .meter {
    height: 8px;
    border-radius: 99px;
    background: var(--surface-3);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    border-radius: 99px;
    background: var(--accent);
    transition: width var(--dur-base) var(--ease-out);
  }

  .meter.full .fill {
    background: var(--danger);
  }

  /* ── On a phone ────────────────────────────────────────────────── */

  /* A page, not a window: the list of panes first, and the pane chosen from
     it sliding in over it, with its own header to come back by. Everything
     is grouped into inset cards and sized for a thumb.

     Written against the class rather than a width, because the width is not
     what decides it. The phone app is a phone whatever the screen measures
     (see viewport.svelte.ts), so held sideways it is wider than any breakpoint
     a stylesheet would pick: the markup showed the page, the media query did
     not match, and the header ended up as an unstyled block in a column of a
     window that was never meant to be there. One flag, read by both. */
  .sheet.phone {
    inset: 0;
    top: 0;
    left: 0;
    translate: none;
    width: 100%;
    /* The last resort, for the frame before the visual viewport is measured;
       the height the page is actually given is set from the store. */
    height: 100dvh;
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
    border: none;
    border-radius: 0;
    box-shadow: none;
    background: var(--bg);
  }

  .sheet.phone .bar {
    display: flex;
    align-items: center;
    gap: 2px;
    height: calc(var(--touch-row) + var(--inset-top));
    padding: var(--inset-top) 6px 0;
    border-bottom: 1px solid var(--line);
    background: var(--bg);
  }

  .sheet.phone .bar h1 {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--touch-text);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Without a back button before it, the title lines up with the cards. */
  .sheet.phone .bar h1.inset {
    padding-inline-start: 10px;
  }

  .sheet.phone .bar .icon {
    flex: none;
    width: var(--touch-target);
    height: var(--touch-target);
    display: grid;
    place-items: center;
    padding: 0;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--text);
    cursor: default;
  }

  .sheet.phone .bar .icon:active {
    background: var(--surface-2);
  }

  .sheet.phone .bar .icon svg {
    width: var(--touch-icon);
    height: var(--touch-icon);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .sheet.phone nav {
    gap: 0;
    padding: var(--space-3) var(--space-4) calc(var(--space-5) + var(--touch-bottom));
    border-inline-end: none;
    background: none;
  }

  .sheet.phone .search {
    height: var(--touch-target);
    margin-bottom: var(--space-4);
    padding: 0 var(--touch-pad);
    border-color: var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .sheet.phone .search svg {
    width: 16px;
    height: 16px;
  }

  .sheet.phone .search input {
    /* Past sixteen pixels, which is where iOS stops zooming into a field on
       focus, and the same size as the rows the search leads to. */
    font-size: var(--touch-text);
  }

  .sheet.phone .group {
    gap: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    overflow: hidden;
  }

  .sheet.phone .group + .group {
    margin-top: var(--space-4);
  }

  .sheet.phone .item {
    position: relative;
    gap: var(--touch-gap);
    min-height: var(--touch-row);
    padding: 0 var(--touch-pad);
    border-radius: 0;
    color: var(--text);
    font-size: var(--touch-text);
  }

  /* A hairline between rows, starting where the text does: past the row's own
     padding, the glyph in front of it and the gap after that. */
  .sheet.phone .item + .item::before {
    content: '';
    position: absolute;
    top: 0;
    inset-inline-start: calc(var(--touch-pad) + var(--touch-icon) + var(--touch-gap));
    inset-inline-end: 0;
    height: 1px;
    background: var(--line);
  }

  .sheet.phone .item:active {
    background: var(--surface-2);
  }

  .sheet.phone .item .glyph {
    width: var(--touch-icon);
    height: var(--touch-icon);
    color: var(--accent);
    stroke-width: 1.2;
  }

  .sheet.phone .item .chevron {
    display: block;
    flex: none;
    width: var(--touch-mark);
    height: var(--touch-mark);
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .sheet.phone .body {
    padding: var(--space-3) var(--space-4) calc(var(--space-6) + var(--touch-bottom));
  }

  .sheet.phone .pane {
    gap: var(--space-4);
  }

  .sheet.phone .pane h3 {
    margin: var(--space-3) 0 calc(-1 * var(--space-2)) 14px;
    font-size: 13px;
    color: var(--muted);
  }

  .sheet.phone .card {
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    overflow: hidden;
  }

  .sheet.phone .card > .stack {
    padding: var(--touch-pad);
  }

  .sheet.phone .card > .accents {
    padding: var(--touch-pad);
  }

  .sheet.phone .setting {
    position: relative;
    gap: var(--touch-gap);
    min-height: var(--touch-row);
    padding: var(--space-2) var(--touch-pad);
    font-size: var(--touch-text);
  }

  .sheet.phone .setting .name small {
    font-size: var(--text-base);
  }

  .sheet.phone .setting + .setting::before,
  .sheet.phone .action + .setting::before,
  .sheet.phone .action + .action::before {
    content: '';
    position: absolute;
    top: 0;
    inset-inline-start: var(--touch-pad);
    inset-inline-end: 0;
    height: 1px;
    background: var(--line);
  }

  .sheet.phone button.setting:active {
    background: var(--surface-2);
  }

  .sheet.phone button.setting:focus-visible {
    border-radius: 0;
  }

  /* Name and value on one line, the slider full width beneath them. */
  .sheet.phone .setting.sliding {
    flex-wrap: wrap;
    padding-bottom: 6px;
  }

  .sheet.phone .setting .value {
    width: auto;
    font-size: var(--text-base);
  }

  .sheet.phone .slider {
    order: 3;
    width: 100%;
  }

  .sheet.phone .pick {
    width: auto;
    max-width: 60%;
  }

  .sheet.phone .action {
    position: relative;
    min-height: var(--touch-row);
    padding: var(--space-2) var(--touch-pad);
    color: var(--accent);
    font-size: var(--touch-text);
  }

  .sheet.phone .action.danger {
    color: var(--danger);
  }

  .sheet.phone .action:active:not(:disabled) {
    background: var(--surface-2);
  }

  /* Every one of these is something a thumb has to land on, so every one of them
     clears the platform floor on a phone. `--touch-target` is that floor; see
     tokens.css. */
  .sheet.phone .key {
    min-width: 5.5rem;
    min-height: var(--touch-target);
    padding: 7px 10px;
    font-size: var(--text-sm);
  }

  .sheet.phone .pill {
    min-height: var(--touch-target);
    padding: 0 var(--space-4);
    font-size: var(--touch-text);
  }

  /* The floor, not a size of its own: three of these in a row is what a button
     on the bar carries, and a thumb has to land on each. */
  .sheet.phone .revert {
    width: var(--touch-target);
    height: var(--touch-target);
  }

  .sheet.phone .setting .mark {
    width: 34px;
    height: 34px;
    font-size: var(--text-base);
  }

  .sheet.phone .clash {
    padding: 10px var(--touch-pad);
  }

  .sheet.phone .inline {
    width: 55%;
    min-height: var(--touch-target);
    padding: 8px 10px;
    font-size: var(--touch-text);
  }

  .sheet.phone .setting .text {
    max-width: 60%;
    font-size: var(--touch-text);
  }

  .sheet.phone .hint,
  .sheet.phone .note {
    font-size: var(--text-base);
  }

  .sheet.phone .hint.caption {
    margin: calc(-1 * var(--space-2)) var(--touch-pad) 0;
  }

  .sheet.phone .lead {
    font-size: var(--touch-text);
  }

  .sheet.phone button.primary {
    align-self: stretch;
    min-height: var(--touch-target);
    padding: 12px 16px;
    font-size: var(--touch-text);
    text-align: center;
  }

  .sheet.phone .accents {
    gap: 12px;
  }

  .sheet.phone .swatch {
    width: var(--touch-target);
    height: var(--touch-target);
  }
</style>
