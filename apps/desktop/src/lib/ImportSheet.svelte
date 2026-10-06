<script lang="ts">
  /** The one import.
   *
   *  Three states, in the order they happen: nothing picked yet, so a place to
   *  drop an export; picked, so what it is and what it would make; and written,
   *  so how much arrived. No format menu at any point - the file says which app
   *  it came from, and being asked to name it is being asked something the app
   *  can see for itself.
   *
   *  What it will make is shown before it makes it, in counts rather than a list:
   *  a reader importing four thousand notes cannot read a list of four thousand
   *  notes, and what they want to know is how many, where they go, and what is
   *  not coming with them. */

  import { fade } from 'svelte/transition'

  import { key, plural, t } from './i18n.svelte'
  import { importing, onMac } from './importing.svelte'
  import { droppedFiles, pickFiles } from './import/picking'
  import type { FormatId, Lost } from './import/plan'
  import { dur } from './motion'
  import { settings } from './settings.svelte'
  import { segmented } from './slide'
  import { viewport } from './viewport.svelte'
  import Sheet from './Sheet.svelte'

  /** What the sheet calls each of them. An app's name is its name in every
   *  language; the three that are not apps are words, so those are asked for. */
  const FORMATS: Record<FormatId, string> = {
    notion: 'Notion',
    evernote: 'Evernote',
    keep: 'Google Keep',
    bear: 'Bear',
    logseq: 'Logseq',
    roam: 'Roam',
    craft: 'Craft',
    obsidian: 'Obsidian',
    onenote: 'OneNote',
    tomboy: 'Tomboy',
    'apple-notes': 'Apple Notes',
    journal: 'Apple Journal',
    table: key('A table'),
    markdown: key('Markdown files'),
    pandoc: key('A document'),
    // Not an app's name: what arrived is somebody's own paper, and what the row says
    // is what the import will do with it.
    'pdf-pages': key('A PDF, as pages to write on'),
    todoist: 'Todoist',
  }

  let over = $state(false)

  const plan = $derived(importing.plan)
  const counts = $derived(importing.counts)

  /** The line that says how much: the notes first, because that is what somebody
   *  is importing, and the pictures and papers after, where there are any.
   *
   *  Not the folders. A note that holds notes is a note here, so they are already
   *  counted among the notes, and the ones that are left are a shape the reader
   *  gets rather than a thing that arrives. */
  const said = $derived(
    [
      plural(counts.notes, { one: '{count} note', other: '{count} notes' }),
      counts.files ? plural(counts.files, { one: '{count} file', other: '{count} files' }) : '',
    ]
      .filter(Boolean)
      .join(' · '),
  )

  /** What one line of "worth knowing" reads as. A line with a singular form of its
   *  own is counting something, and the count decides which form its language
   *  takes; everything else is one sentence. */
  function worthKnowing(line: Lost): string {
    const count = line.values?.count
    if (line.one === undefined || typeof count !== 'number') return t(line.text, line.values)

    return plural(count, { one: line.one, other: line.text }, line.values)
  }

  /** Where it lands, said the way the file list says it. */
  const target = $derived(
    [importing.spaceName, importing.under].filter(Boolean).join(' / ') || t('This space'),
  )

  /** Whether there is an import to ask for. An export over the ceiling reads as
   *  ready - the plan was built, it is simply too big to write - and the sheet
   *  says so above; without the error in here it said so and offered Import
   *  anyway, which is a refusal a reader can press past. */
  const ready = $derived(
    importing.stage === 'ready' && !!plan?.files.length && !!importing.root && !importing.error,
  )

  /** A Todoist token, pasted, and whether the done tasks come too. Held by the field
   *  until it is read and emptied the moment it is: the import never keeps it. */
  let token = $state('')
  let withDone = $state(false)

  async function readTodoist() {
    const pasted = token
    token = ''
    await importing.readTodoist(pasted, withDone)
  }

  async function choose() {
    await importing.take(await pickFiles())
  }

  async function drop(event: DragEvent) {
    event.preventDefault()
    over = false
    await importing.take(await droppedFiles(event.dataTransfer))
  }
</script>

<Sheet open={importing.open} title={t('Import')} onclose={() => importing.close()}>
  {#if importing.error}
    <p class="wrong">{importing.error}</p>
  {/if}

  {#if importing.stage === 'waiting' || importing.stage === 'reading'}
    <!-- The drop zone is also the button, because a finger cannot drop anything
         and a pointer should not have to find a second control. -->
    <button
      class="drop"
      class:over
      class:busy={importing.stage === 'reading'}
      ondragover={(event) => {
        event.preventDefault()
        over = true
      }}
      ondragleave={() => (over = false)}
      ondrop={(event) => void drop(event)}
      onclick={() => void choose()}
      disabled={importing.stage === 'reading'}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v10m0 0 3.5-3.5M12 13 8.5 9.5" />
        <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
      </svg>
      <!-- A finger cannot drop anything, so on a touch screen it says what the
           press does instead. The control is the same control. -->
      <span class="name">
        {importing.stage === 'reading'
          ? t('Reading')
          : viewport.touch
            ? t('Choose an export')
            : t('Drop an export here')}
      </span>
      <span class="hint">{t('A zip, a folder, or a file another app wrote')}</span>
    </button>

    <!-- Apple's own two apps, which are the two that hand over nothing to drop.
         Journal has an export; Notes has none at all, and on the Mac it is on
         there is a database to read instead of an exporter to install. -->
    {#if onMac()}
      <div class="card">
        <div class="row">
          <!-- Out of the same list the found format is named from, because an
               app's name is its name in every language. -->
          <span class="name">{FORMATS['apple-notes']}</span>
          <button
            class="nib-chip"
            onclick={() => void importing.readMac()}
            disabled={importing.stage === 'reading'}
          >
            {t('Read them from this Mac')}
          </button>
        </div>
        {#if importing.noAccess}
          <p class="hint">{t('Turn nibeditor on under Full Disk Access, then ask again.')}</p>
          <button class="nib-chip" onclick={() => void importing.openAccess()}>
            {t('Open the setting')}
          </button>
        {/if}
      </div>
    {/if}

    <!-- Todoist, from the account: a token pasted (Settings, Integrations, Developer in
         Todoist), read once and forgotten. Its CSV exports are dropped above instead. -->
    <div class="card">
      <div class="row">
        <span class="name">{FORMATS.todoist}</span>
        <input
          class="field"
          type="password"
          bind:value={token}
          aria-label={t('API token')}
          autocomplete="off"
          spellcheck="false"
          onkeydown={(event) => {
            if (event.key === 'Enter') void readTodoist()
          }}
        />
        <button
          class="nib-chip"
          onclick={() => void readTodoist()}
          disabled={!token.trim() || importing.stage === 'reading'}
        >
          {t('Read')}
        </button>
      </div>
      <button
        class="nib-row"
        role="switch"
        aria-checked={withDone}
        onclick={() => (withDone = !withDone)}
      >
        <span class="nib-row-label">{t('Done tasks too')}</span>
        <span class="nib-switch" class:on={withDone} aria-hidden="true"></span>
      </button>
    </div>

    <p class="note">
      {t(
        'Apple Journal exports itself: Journal, Settings, Export. Apple Notes has no export, so away from the Mac it is on, what to drop is a folder an exporter wrote.',
      )}
    </p>
  {:else}
    <div class="card" in:fade={{ duration: dur(130) }}>
      <div class="row">
        <span class="name">{importing.format ? t(FORMATS[importing.format]) : ''}</span>
        <span class="hint">{said}</span>
      </div>
    </div>

    {#if importing.needsPandoc}
      <!-- Pandoc reads a Word file, an ePub or a LaTeX paper, and it reads them
           off the disk itself, which is why this asks for the file once more.
           Nothing else on this branch: there is no target to choose and nothing
           to count, since what comes back is one note in a pane. -->
      {#if settings.pandoc}
        <p class="note">{t('Pandoc reads this one, from the file on your disk.')}</p>
        <button class="nib-button" onclick={() => void importing.readWithPandoc()}>
          {t('Read it with pandoc')}
        </button>
      {:else}
        <p class="note">
          {t('Only pandoc reads this one, and it is not installed on this machine.')}
        </p>
      {/if}
    {:else}
      {#if importing.format === 'table'}
        <!-- The one question a format asks, because the same file is honestly two
             things; see import/table.ts. -->
        <div class="nib-segmented" role="radiogroup" aria-label={t('Rows')} use:segmented>
          <button
            type="button"
            role="radio"
            aria-checked={importing.rows === 'table'}
            class:on={importing.rows === 'table'}
            onclick={() => importing.setRows('table')}
          >
            {t('As a table')}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={importing.rows === 'notes'}
            class:on={importing.rows === 'notes'}
            onclick={() => importing.setRows('notes')}
          >
            {t('One note per row')}
          </button>
        </div>
      {/if}

      <div class="card">
        <div class="row">
          <span class="name">{t('Into')}</span>
          <button class="nib-chip" onclick={() => void importing.chooseTarget()}>{target}</button>
        </div>
        <div class="row">
          <!-- The name everything lands under. Not "folder": a row that holds
               notes is a note here, and the word is gone from the interface. -->
          <span class="name">{t('Under')}</span>
          <input
            class="field"
            bind:value={importing.folder}
            aria-label={t('Under')}
            spellcheck="false"
          />
        </div>
      </div>

      {#if plan?.lost.length}
        <div class="card">
          <h3>{t('Worth knowing')}</h3>
          {#each plan.lost as line (line.text)}
            <!-- A line that counts something takes the form its language wants for
                 that number; one that counts nothing is one sentence. See Lost in
                 import/plan.ts. -->
            <p class="hint">{worthKnowing(line)}</p>
          {/each}
        </div>
      {/if}

      {#if importing.stage === 'done'}
        <p class="note">
          {plural(counts.notes, {
            one: '{count} note arrived.',
            other: '{count} notes arrived.',
          })}
        </p>
        {#if importing.stepped}
          <p class="hint">
            {plural(importing.stepped, {
              one: '{count} name was taken, so that file stepped aside.',
              other: '{count} names were taken, so those files stepped aside.',
            })}
          </p>
        {/if}
        <button class="nib-button" onclick={() => importing.close()}>{t('Done')}</button>
      {:else}
        <button class="nib-button" disabled={!ready} onclick={() => void importing.run()}>
          {importing.stage === 'writing' ? t('Importing') : t('Import')}
        </button>
        {#if importing.stage === 'writing'}
          <p class="hint" transition:fade={{ duration: dur(130) }}>
            {t('{at} of {count}', { at: importing.written, count: plan?.files.length ?? 0 })}
          </p>
        {/if}
      {/if}
    {/if}
  {/if}
</Sheet>

<style>
  /* The one shape this sheet adds: somewhere to drop a file, which is also the
     button that opens the picker. Tall enough to be a target for a dragged
     folder and quiet enough not to look like the primary action. */
  .drop {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-6) var(--space-4);
    border: 1px dashed var(--line);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: var(--muted-strong);
    font: inherit;
    text-align: center;
    cursor: pointer;
    transition:
      border-color var(--dur-base) var(--ease-out),
      background var(--dur-base) var(--ease-out);
  }

  .drop svg {
    width: 26px;
    height: 26px;
    fill: none;
    stroke: currentcolor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.75;
  }

  /* Lit while something is over it, which is the whole of the feedback a drop
     needs: the cursor is already carrying the file. */
  .drop.over {
    border-color: var(--accent);
    border-style: solid;
    background: color-mix(in srgb, var(--accent) 8%, var(--surface-2));
  }

  .drop.busy {
    cursor: default;
  }

  .drop:disabled {
    opacity: 0.7;
  }

  @media (hover: hover) {
    .drop:hover:not(:disabled) {
      border-color: var(--line-strong);
      background: var(--surface-3);
    }
  }
</style>
