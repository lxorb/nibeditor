<script lang="ts">
  /** What syncing is doing, and the two decisions it needs.
   *
   *  Three things, in the order somebody asks for them. What happens when the
   *  same note was written in two places, which is the one real choice; whatever
   *  is waiting for an answer, which is the only thing here that is urgent; and
   *  what the last few passes did, which is what somebody reads when syncing
   *  looks stuck.
   *
   *  And, at the foot, the one rescue: a space put back to how it read at a
   *  moment. It is last because it is the thing nobody wants and somebody
   *  occasionally needs, and it says what it would change before it changes
   *  anything. */

  import { fade } from 'svelte/transition'

  import { account } from './account.svelte'
  import { api } from './api'
  import { i18n, plural, t } from './i18n.svelte'
  import { KEEP_MONTH, KEEP_YEAR, modes, rollbackSteps } from './modes.svelte'
  import { dur } from './motion'
  import Select from './Select.svelte'
  import { record } from './sync/record.svelte'
  import type { Answer, Clash } from './sync/conflicts'
  import { sync } from './sync.svelte'
  import { workspace } from './workspace.svelte'

  let days = $state(1)

  /** How far back this account can be asked to go, in days: as far as it keeps and
   *  no further. Setting the horizon above to a year is what puts the year in this
   *  row; see `rollbackSteps` in modes.svelte.ts. */
  const back = $derived(rollbackSteps(modes.keepVersions))

  /** Which of them is chosen. Held to the list rather than kept in step by an
   *  effect: turning the horizon down from a year must not leave the field asking
   *  for a year, and a derived cannot be out of date the way a written copy can. */
  const chosen = $derived(back.includes(days) ? days : (back.at(-1) ?? 1))
  let asked = $state<{ notes: number; paths: string[]; more: boolean } | null>(null)
  let rolling = $state(false)
  let rolled = $state<number | null>(null)
  let wrong = $state<string | null>(null)

  const rules = [
    { value: 'both', label: t('Keep both copies') },
    { value: 'newest', label: t('Let the newest win') },
    { value: 'ask', label: t('Ask me each time') },
  ]

  const spaceId = $derived(
    workspace.activeSpace ? sync.remoteIdFor(workspace.activeSpace.root) : null,
  )

  /** A moment, as shortly as it can be said: a pass from today is a time, and
   *  almost every pass worth reading is from today. The same rule the history
   *  sheet reads by; see History.svelte. */
  const when = (stamp: number) => {
    const at = new Date(stamp)
    const now = new Date()
    const today =
      at.getFullYear() === now.getFullYear() &&
      at.getMonth() === now.getMonth() &&
      at.getDate() === now.getDate()

    return today
      ? i18n.when(at, { timeStyle: 'short' })
      : i18n.when(at, { dateStyle: 'short', timeStyle: 'short' })
  }

  function moment(): number {
    return Date.now() - chosen * 24 * 60 * 60 * 1000
  }

  async function look() {
    const token = account.accountToken
    if (!token || !spaceId) return

    wrong = null
    rolled = null

    try {
      const said = await api.rollback(token, spaceId, moment(), '', true)
      asked = {
        // What it would change in all, which is more than one request puts back
        // where a space is big; the pane says the number, the loop does the rest.
        notes: said.notes + (said.left ?? 0),
        paths: said.paths ?? [],
        more: said.more === true,
      }
    } catch (error) {
      wrong = error instanceof Error ? error.message : t('That did not work.')
    }
  }

  /** How many times it will ask. The server puts back four hundred notes per
   *  request, so this is forty thousand notes, which is more than a space holds;
   *  a ceiling all the same, because a loop that talks to a server should have
   *  one. */
  const ROUNDS = 100

  async function roll() {
    const token = account.accountToken
    if (!token || !spaceId || rolling) return

    rolling = true
    wrong = null
    rolled = 0

    try {
      // Until there is nothing left. The server answers how many it wrote and
      // whether more is waiting, because it is bounded in writes per request -
      // and an answer of four hundred used to read as the whole space when it was
      // the first four hundred of twelve.
      let put = 0
      for (let round = 0; round < ROUNDS; round++) {
        const done = await api.rollback(token, spaceId, moment())
        put += done.notes
        rolled = put

        if (!done.partial || done.notes === 0) break
      }

      asked = null
      // The notes are on the account; this is what brings them down here.
      sync.nudge()
    } catch (error) {
      wrong = error instanceof Error ? error.message : t('That did not work.')
    } finally {
      rolling = false
    }
  }

  async function settle(clash: Clash, answer: Answer) {
    await record.settle(clash, answer)
    sync.nudge()
  }

  function shortPath(path: string): string {
    return path.split(/[\\/]/).slice(-2).join('/')
  }

  /** How far back the account keeps a note's history. Two words rather than a
   *  number of days: the question a reader is answering is how far back they want
   *  to be able to go. */
  const horizons = [
    { value: String(KEEP_MONTH), label: t('A month') },
    { value: String(KEEP_YEAR), label: t('A year') },
  ]
</script>

<h3>{t('When the same note was written twice')}</h3>

<div class="card">
  <div class="nib-setting setting">
    <span class="name">{t('On two devices')}</span>
    <div class="pick">
      <Select
        value={modes.conflicts}
        options={rules}
        onchange={(value: string) => modes.setConflicts(value)}
        label={t('On two devices')}
      />
    </div>
  </div>
</div>

<p class="hint">
  {t('Nothing is ever thrown away: what does not win is kept as a version.')}
</p>

<!-- How long the account keeps them. What happens in between - one an hour for
     the first month, one a day for the next two, one a week after that - is said
     in the line under it and in docs/sync.md. -->
<h3>{t('History on the account')}</h3>

<div class="card">
  <div class="nib-setting setting">
    <span class="name">{t('Keep versions')}</span>
    <div class="pick">
      <Select
        value={String(modes.keepVersions)}
        options={horizons}
        onchange={(value: string) => modes.setKeepVersions(Number(value))}
        label={t('Keep versions')}
      />
    </div>
  </div>
</div>

<p class="hint">
  {t(
    'Everything from the last day, then one an hour, one a day after a month, one a week after three.',
  )}
</p>

{#if record.clashes.length}
  <h3>{t('Waiting for you')}</h3>

  <div class="card" transition:fade={{ duration: dur(130) }}>
    {#each record.clashes as clash (clash.path)}
      <div class="clash">
        <span class="name">{shortPath(clash.path)}</span>
        <span class="hint">{when(clash.at)}</span>
        <div class="answers">
          <button class="pill" onclick={() => void settle(clash, 'mine')}>
            {t('Keep mine')}
          </button>
          <button class="pill" onclick={() => void settle(clash, 'theirs')}>
            {t('Take theirs')}
          </button>
          <button class="pill" onclick={() => void settle(clash, 'both')}>
            {t('Keep both')}
          </button>
        </div>
      </div>
    {/each}
  </div>
{/if}

<h3>{t('What synced')}</h3>

{#if !record.passes.length}
  <p class="hint">{t('Nothing yet. A pass that moves nothing is not written down.')}</p>
{:else}
  <div class="card">
    {#each record.passes.slice(0, 20) as pass (pass.at)}
      <div class="pass" class:bad={!!pass.failed}>
        <span class="at">{when(pass.at)}</span>
        <span class="what">
          {#if pass.failed}
            {pass.failed}
          {:else}
            {[
              pass.pulled ? t('{count} down', { count: pass.pulled }) : '',
              pass.pushed ? t('{count} up', { count: pass.pushed }) : '',
              pass.clashed ? t('{count} waiting', { count: pass.clashed }) : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          {/if}
        </span>
        <span class="where">{pass.space}</span>
      </div>
    {/each}
  </div>

  <div class="card">
    <button class="action" onclick={() => record.clear()}>{t('Clear the list')}</button>
  </div>
{/if}

<h3>{t('Go back')}</h3>

<div class="card">
  <div class="nib-setting setting">
    <span class="name">{t('This space, as it was')}</span>
    <div class="pick">
      <Select
        value={String(chosen)}
        options={back.map((one) => ({
          value: String(one),
          label: plural(one, { one: '{count} day ago', other: '{count} days ago' }),
        }))}
        onchange={(value: string) => {
          days = Number(value)
          asked = null
        }}
        label={t('This space, as it was')}
      />
    </div>
  </div>
</div>

{#if asked}
  <p class="note" transition:fade={{ duration: dur(130) }}>
    {asked.notes
      ? plural(asked.notes, {
          one: '{count} note would go back to what it said then.',
          other: '{count} notes would go back to what they said then.',
        })
      : t('Nothing has changed since then.')}
  </p>
{/if}

{#if rolled !== null}
  <p class="note">
    {plural(rolled, { one: '{count} note went back.', other: '{count} notes went back.' })}
  </p>
{/if}

{#if wrong}
  <p class="hint bad">{wrong}</p>
{/if}

<div class="card">
  {#if asked?.notes}
    <button class="action danger" disabled={rolling} onclick={() => void roll()}>
      {rolling ? t('Going back') : t('Go back')}
    </button>
  {:else}
    <button class="action" disabled={!spaceId} onclick={() => void look()}>
      {t('What would change?')}
    </button>
  {/if}
</div>

<p class="hint">
  {t('The account keeps a month of versions of every note that syncs.')}
</p>

<style>
  /* The settings pane's own shapes. A section in its own component does not
     inherit the panel's styles - those are scoped to it - so the ones this pane
     uses are here with the panel's values, the way McpSetup and RecentlyDeleted
     carry theirs. See SettingsPanel.svelte. */
  h3 {
    margin: var(--space-3) 0 calc(-1 * var(--space-2));
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--muted-strong);
  }

  /* The pane's first heading sits under the section's title, or at the top of
     the sheet on a phone, where there is no title above it. The title is the
     panel's, so that half of the selector is global. */
  h3:first-child,
  :global(h2) + h3 {
    margin-top: 0;
  }

  /* A run of rows. Plain on a desktop; a phone draws the box around it. */
  .card {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  /* Name on the left, control on the right, one line each. */

  .setting .name {
    flex: 1;
    min-width: 0;
  }

  /* Wide enough for the longest choice the pane offers. */
  .pick {
    flex: none;
    width: 14rem;
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

  .hint.bad {
    color: var(--danger);
  }

  /* A phone draws the box, the touch rows, and the hairlines between them. The
     sheet is the panel's, so that half of the selector is global and the rows
     are this pane's. */
  :global(.sheet.phone) .card {
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    overflow: hidden;
  }

  /* A pass sits inside the phone's box like a row, so it takes the same
     padding: a line that runs to the edge is a line with its ends cut off. */
  :global(.sheet.phone) .pass,
  :global(.sheet.phone) .clash {
    padding: var(--space-2) var(--touch-pad);
    font-size: var(--touch-text);
  }

  :global(.sheet.phone) .setting {
    position: relative;
    gap: var(--touch-gap);
    min-height: var(--touch-row);
    padding: var(--space-2) var(--touch-pad);
    font-size: var(--touch-text);
  }

  :global(.sheet.phone) .pill {
    min-height: var(--touch-target);
    padding: 0 var(--space-4);
    font-size: var(--touch-text);
  }

  :global(.sheet.phone) .action {
    position: relative;
    min-height: var(--touch-row);
    padding: var(--space-2) var(--touch-pad);
    color: var(--accent);
    font-size: var(--touch-text);
  }

  :global(.sheet.phone) .action.danger {
    color: var(--danger);
  }

  /* One waiting note: what it is, when it happened, and the three answers. The
     answers are a row of their own, because on a phone three verbs do not fit
     beside a file name. */
  .clash {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    width: 100%;
    padding: var(--space-2) 0;
  }

  .clash .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .answers {
    display: flex;
    gap: var(--space-2);
    width: 100%;
  }

  /* The three answers, each the small round action the panel uses at the end of
     a row: three of them read as a choice rather than as three rows. */
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

  /* One pass: when, what moved, and which space. The middle column takes the
     room, so a failure reads as a sentence rather than as a column. */
  .pass {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    width: 100%;
    min-height: 26px;
    font-size: var(--text-sm);
    color: var(--muted-strong);
  }

  .pass .at {
    flex: none;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }

  .pass .what {
    flex: 1;
    min-width: 0;
  }

  .pass .where {
    flex: none;
    max-width: 40%;
    overflow: hidden;
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pass.bad .what {
    color: var(--danger);
  }
</style>
