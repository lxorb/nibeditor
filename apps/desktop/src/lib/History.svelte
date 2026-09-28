<script lang="ts">
  import { account } from './account.svelte'
  import { api } from './api'
  import { closeOnBack } from './backstack.svelte'
  import { diffCount, lineDiff, trimmed } from './diff'
  import { overlays } from './overlays'
  import { KEEP_YEAR, modes } from './modes.svelte'
  import { recovery } from './recovery.svelte'
  import { scrollbar } from './scrollbar'
  import { readableSize } from './usage.svelte'
  import { sync } from './sync.svelte'
  import { t } from './i18n.svelte'
  import { when } from './when'
  import { fade, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { invoke } from './tauri'
  import { type Tab, workspace } from './workspace.svelte'
  import { LAYER } from './motion'
  import { trap } from './trap'

  interface Snapshot {
    taken_at: number
    size: number
    path: string
  }

  /** One version, wherever it is kept.
   *
   *  Two places keep them and the reader wants one list: the device's own, which
   *  is instant and goes back to before the note was ever synced, and the
   *  account's, which is the only one another machine can see. `by` is the device
   *  that wrote an account version, which is the whole of what a row has to say
   *  about where it came from. */
  interface Version {
    at: number
    size: number
    /** The device's handle on it, or null for one the account holds. */
    path: string | null
    by: string
  }

  let { open = $bindable(false) }: { open?: boolean } = $props()

  let versions = $state<Version[]>([])
  let selected = $state<Version | null>(null)
  let preview = $state('')
  /** Which tab the version on show was read for. A version belongs to one note,
   *  and the sheet stays open while tabs can be switched under it, so restoring
   *  puts it back into the note it came from rather than into whatever is on
   *  screen by then. Null while nothing has been read. */
  let previewOf = $state<Tab | null>(null)
  /** Whether the version is shown as itself or as what it would change. The
   *  changes are what somebody looking for a lost paragraph wants first. */
  let comparing = $state(true)

  // Each read carries a flag its own effect clears on the way out, so a list or
  // a version that arrives after the note has changed - or after the sheet has
  // been shut - cannot land on top of a newer one.
  $effect(() => {
    if (!open) return

    const path = workspace.active?.path
    if (!path) {
      versions = []
      return
    }

    let current = true

    void listed(path)
      .then((found) => {
        if (!current) return
        versions = found
        selected = found[0] ?? null
      })
      .catch(() => {
        if (current) versions = []
      })

    return () => {
      current = false
    }
  })

  /** Both histories as one list, newest first.
   *
   *  A save the device kept and then pushed is one moment, and it is in both
   *  lists; the device's copy wins, because reading it costs nothing. Anything
   *  the account holds that this machine does not - written on the phone, or
   *  written here before the disk was wiped - comes after it in time order like
   *  any other version. */
  async function listed(path: string): Promise<Version[]> {
    const mine = await invoke<Snapshot[]>('list_snapshots', { path }).catch(() => [])
    const here: Version[] = mine.map((one) => ({
      at: one.taken_at,
      size: one.size,
      path: one.path,
      by: '',
    }))

    const token = account.accountToken
    const id = sync.tracked(path)?.id
    if (!token || !id) return here

    const theirs = await api.noteVersions(token, id).catch(() => ({ versions: [] }))
    const fromAccount = theirs.versions
      .filter((one) => !here.some((ours) => Math.abs(ours.at - one.at) < TOGETHER))
      .map((one) => ({ at: one.at, size: one.size, path: null, by: one.by }))

    return [...here, ...fromAccount].sort((one, other) => other.at - one.at)
  }

  /** How close two versions have to be to be the same save seen twice. A push
   *  follows the save that caused it by a pass at most. */
  const TOGETHER = 60 * 1000

  $effect(() => {
    const tab = workspace.active
    if (!selected) {
      preview = ''
      previewOf = null
      return
    }

    let current = true

    void read(selected, tab?.path ?? '')
      .then((body) => {
        if (!current) return
        preview = body
        // The version and the note it is a version of, set together, so a
        // restore cannot pair one note's words with another note's tab.
        previewOf = tab ?? null
      })
      .catch(() => {
        if (!current) return
        preview = ''
        previewOf = null
      })

    return () => {
      current = false
    }
  })

  /** One version's words, from wherever that version is kept. */
  async function read(version: Version, notePath: string): Promise<string> {
    // The note is named as well as the version, because the browser keeps its
    // versions in one store and the desktop keeps each note's in a folder.
    if (version.path !== null) {
      return await invoke<string>('read_snapshot', { path: version.path, notePath })
    }

    const token = account.accountToken
    const id = sync.tracked(notePath)?.id
    if (!token || !id) return ''

    const said = await api.noteVersion(token, id, version.at)
    return said.content
  }

  /** What this version would change, against the note as it stands now. One diff
   *  read two ways: the lines and how many of them there are are the same walk
   *  over the whole document, and walking it twice is a whole document twice. */
  const difference = $derived(lineDiff(preview, workspace.active?.note.text ?? ''))
  const changes = $derived(trimmed(difference))
  const counted = $derived(diffCount(difference))

  /** One row of the list: a version, or the month a run of them is in. */
  interface Row {
    month?: string
    version?: Version
  }

  /** The list as it is drawn: the versions, and - where the account keeps a year
   *  of them - a heading at each change of month.
   *
   *  Only for a year. A month of history is one month, so a heading over the
   *  whole of the list would say nothing; a year is twelve of them, and the
   *  thinning means the far end is one row a week, which is a long way to scroll
   *  without a word saying where you are. The same `.nib-section` label every
   *  other list in the app cuts itself up with; see docs/design.md. */
  const rows = $derived.by((): Row[] => {
    if (modes.keepVersions < KEEP_YEAR) return versions.map((version) => ({ version }))

    const out: Row[] = []
    let said = ''

    for (const version of versions) {
      const month = new Date(version.at).toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
      })

      if (month !== said) {
        out.push({ month })
        said = month
      }

      out.push({ version })
    }

    return out
  })

  /** Restoring is itself an edit, so the words being replaced are kept first:
   *  putting an old version back is one more version, and undoable like any. */
  async function restore() {
    // The tab the version on show was read for, not whichever is active now: the
    // two are the same until somebody switches notes with the sheet open.
    const tab = previewOf
    if (!preview || !tab?.path) return

    await recovery.keep(tab.path, tab.note.text)
    workspace.replace(preview, tab)
    open = false
  }

  $effect(() => (open ? overlays.show(() => (open = false)) : undefined))
  $effect(() => closeOnBack(open, () => (open = false)))
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="nib-scrim scrim"
    transition:fade={{ duration: LAYER.fade }}
    onclick={() => (open = false)}
  ></div>

  <!-- Named and said to be a dialog, like every other layer: the keyboard was
       already trapped in here, and a trap with nothing saying what it is trapped in
       is a reader who cannot tell why Tab stopped going anywhere. -->
  <div
    class="sheet"
    use:trap
    role="dialog"
    aria-modal="true"
    aria-label={t('Version history')}
    transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
  >
    {#if !workspace.active?.path}
      <p class="empty">{t('Save this note first; there is nothing to compare against yet.')}</p>
    {:else if !versions.length}
      <p class="empty">{t('No earlier versions yet. One is kept each time you save.')}</p>
    {:else}
      <ul class="versions" use:scrollbar>
        {#each rows as row (row.month ?? row.version?.at)}
          {#if row.month}
            <li class="month"><p class="nib-section">{row.month}</p></li>
          {:else if row.version}
            {@const version = row.version}
            <li>
              <button
                class:active={selected?.at === version.at}
                onclick={() => (selected = version)}
              >
                <span>{when(version.at, 'medium')}</span>
                <!-- Where it came from, said only where that is worth saying: a
                     version this machine kept needs no label, and one the account
                     holds is worth knowing the device for. -->
                {#if version.by}
                  <em>{version.by}</em>
                {/if}
                <kbd>{readableSize(version.size)}</kbd>
              </button>
            </li>
          {/if}
        {/each}
      </ul>

      <div class="preview">
        <!-- Two faces of one version: what it would change, and what it says.
             A pair of tabs rather than a switch, because both are a way of
             reading the same thing. -->
        <div class="faces">
          <button class:on={comparing} onclick={() => (comparing = true)}>{t('Changes')}</button>
          <button class:on={!comparing} onclick={() => (comparing = false)}>{t('Text')}</button>

          {#if comparing && changes.length}
            <span class="tally">
              <ins>+{counted.added}</ins><del>-{counted.removed}</del>
            </span>
          {/if}
        </div>

        {#if !comparing}
          <pre>{preview}</pre>
        {:else if changes.length}
          <div class="diff" use:scrollbar>
            {#each changes as row, at (at)}
              <div class="row {row.change}">
                <span class="gutter">{row.before ?? row.after ?? ''}</span>
                <span class="text">{row.text || ' '}</span>
              </div>
            {/each}
          </div>
        {:else}
          <!-- The version the note already says. Said here rather than in the
               tally, so an empty box never reads as a broken one. -->
          <div class="diff same"><p class="empty">{t('No changes')}</p></div>
        {/if}

        <button class="nib-button" onclick={() => void restore()}>
          {t('Restore this version')}
        </button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .sheet {
    position: fixed;
    top: 10vh;
    left: 50%;
    translate: -50% 0;
    width: min(46rem, calc(100vw - 3rem));
    height: 70vh;
    z-index: 51;
    display: flex;
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }

  .empty {
    margin: auto;
    padding: var(--space-5);
    color: var(--muted);
    font-size: var(--text-sm);
    text-align: center;
  }

  .versions {
    width: 15rem;
    flex: none;
    margin: 0;
    padding: var(--space-2);
    list-style: none;
    overflow-y: auto;
    border-inline-end: 1px solid var(--line);
  }

  /* The month a run of versions is in. The app's own section label, so a year of
     history is cut up the way every other long list here is; the first one needs
     no space above it. */
  .versions .month p {
    margin: var(--space-3) 0 var(--space-1);
  }

  .versions .month:first-child p {
    margin-top: 0;
  }

  .versions button {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: 7px 9px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: start;
    cursor: default;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .versions button:hover {
    background: var(--item-hover-bg-color);
  }

  /* Each version has to be read off disk before it can be shown, so the row
     answers first. */
  .versions button:active {
    background: var(--press);
  }

  .versions button.active {
    background: var(--accent-soft);
    color: var(--text-strong);
  }

  .versions kbd {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--muted);
  }

  /* The device a version came from, where the account is what kept it. Quiet
     and in the middle, so the list still reads as a column of times. */
  .versions em {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-style: normal;
    font-size: var(--text-xs);
    color: var(--muted);
    text-align: end;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preview {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding: var(--space-4);
    gap: var(--space-3);
  }

  pre {
    flex: 1;
    margin: 0;
    padding: var(--space-3);
    overflow: auto;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.6;
    color: var(--muted-strong);
    white-space: pre-wrap;
  }

  /* Which face of the version is showing. The same shape as the tabs elsewhere
     in the app: a word that lights up rather than a control with a label. */
  .faces {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .faces button {
    padding: 4px 9px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .faces button:hover {
    background: var(--item-hover-bg-color);
  }

  .faces button:active {
    background: var(--press);
  }

  .faces button.on {
    background: var(--accent-soft);
    color: var(--text-strong);
  }

  .tally {
    margin-inline-start: auto;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .tally ins,
  .tally del {
    text-decoration: none;
  }

  .tally ins {
    color: var(--success);
  }

  .tally del {
    margin-inline-start: var(--space-2);
    color: var(--danger);
  }

  /* A line of the diff. The colour is the whole signal, so the gutter stays
     quiet and the sign is the tint of the line rather than a character. */
  .diff {
    flex: 1;
    overflow: auto;
    padding: var(--space-2) 0;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.6;
  }

  .diff.same {
    display: flex;
  }

  .row {
    display: flex;
    gap: var(--space-3);
    padding: 0 var(--space-3);
    color: var(--muted-strong);
    white-space: pre-wrap;
  }

  .gutter {
    flex: none;
    width: 2.5em;
    text-align: end;
    color: var(--muted);
    user-select: none;
  }

  .text {
    min-width: 0;
    flex: 1;
  }

  .row.added {
    background: color-mix(in srgb, var(--success) 14%, transparent);
    color: var(--text-strong);
  }

  .row.removed {
    background: color-mix(in srgb, var(--danger) 14%, transparent);
    color: var(--text-strong);
  }

  /* Putting a version back is `.nib-button` in the themes package, which says its
     size under a finger too; here it only keeps to its own width. */
  .nib-button {
    align-self: flex-start;
  }

  :global([data-touch]) .sheet {
    top: auto;
    bottom: 0;
    left: 0;
    translate: none;
    width: 100%;
    max-height: 88dvh;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    padding-bottom: var(--touch-bottom);
  }

  /* A version is a row in a list like any other, and the button that puts one
     back is the one thing here to press. */
  :global([data-touch]) .versions button {
    min-height: var(--touch-row);
    gap: var(--touch-gap);
    padding: 0 var(--touch-pad);
    font-size: var(--touch-text);
  }

  /* The two faces of a version - what it would change, and what it says - are
     the other thing here to press. */
  :global([data-touch]) .faces button {
    min-height: var(--touch-target);
    padding: 0 var(--space-3);
    font-size: var(--touch-text);
  }
</style>
