<script lang="ts">
  /** The sheet one rewrite happens in: the four verbs, what came back, and the two
   *  answers to it.
   *
   *  A diff rather than the new text on its own, because the question a reader has is
   *  "what did it change", not "what does it say now" - and the one place in the app
   *  that already answers that question is the version history, so this is the same
   *  rows in the same colours. See diff.ts and History.svelte.
   *
   *  The sheet is the app's one sheet; the shapes inside it are its. See
   *  Sheet.svelte, and ai/rewriting.svelte.ts for what the buttons do. */
  import { fade } from 'svelte/transition'
  import { rewriting } from './ai/rewriting.svelte'
  import { languageNames, VERBS } from './ai/rewrite'
  import { diffCount, lineDiff, trimmed } from './diff'
  import { t } from './i18n.svelte'
  import { dur } from './motion'
  import { scrollbar } from './scrollbar'
  import Select from './Select.svelte'
  import Sheet from './Sheet.svelte'
  import { viewport } from './viewport.svelte'

  const answer = $derived(rewriting.after.trim())
  const difference = $derived(answer ? lineDiff(rewriting.before, answer) : [])
  const changes = $derived(trimmed(difference))
  const counted = $derived(diffCount(difference))
</script>

<Sheet open={rewriting.open} title={t('Rewrite')} onclose={() => rewriting.close()}>
  <!-- The four, as one choice. A row of pills rather than four rows, because they
       are four answers to one question and not four things to do. -->
  <div class="card">
    <div class="verbs">
      {#each VERBS as verb (verb.id)}
        <button
          class="nib-chip"
          class:is-on={rewriting.verb === verb.id}
          onclick={() => rewriting.run(verb.id)}
        >
          {t(verb.label)}
        </button>
      {/each}
    </div>

    {#if rewriting.verb === 'translate'}
      <div class="row" transition:fade={{ duration: dur(130) }}>
        <span class="name">{t('Language')}</span>
        <div class="pick">
          <Select
            value={rewriting.language}
            options={languageNames().map((one) => ({ value: one.id, label: one.name }))}
            onchange={(value: string) => {
              rewriting.language = value
              rewriting.run('translate')
            }}
            label={t('Language')}
            plain={viewport.touch}
          />
        </div>
      </div>
    {/if}
  </div>

  {#if rewriting.trouble}
    <p class="wrong">{rewriting.trouble}</p>
  {/if}

  {#if changes.length}
    <p class="hint">
      <ins>+{counted.added}</ins>
      <del>-{counted.removed}</del>
    </p>
    <div class="diff" use:scrollbar>
      {#each changes as row, at (at)}
        <div class="change {row.change}">{row.text || ' '}</div>
      {/each}
    </div>
  {:else if rewriting.running}
    <p class="hint">{t('Rewriting…')}</p>
  {:else if rewriting.verb && !rewriting.trouble}
    <!-- The model handed back what was already there. Said rather than shown as an
         empty box, which reads as a broken one. -->
    <p class="hint">{t('No changes')}</p>
  {/if}

  {#if answer}
    <div class="answers">
      <button class="nib-button is-quiet" onclick={() => rewriting.close()}>{t('Discard')}</button>
      <button class="nib-button" disabled={rewriting.running} onclick={() => rewriting.accept()}>
        {t('Replace')}
      </button>
    </div>
  {/if}
</Sheet>

<style>
  /* The four verbs, wrapping on a narrow sheet rather than shrinking. */
  .verbs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-1) 0;
  }

  /* The one that is running or ran is `.nib-chip.is-on` in the themes package. */

  .pick {
    flex: none;
    width: 11rem;
  }

  /* The change, in the rows the version history draws it in. Monospaced, because
     what a rewrite did to a line is read against the line above it. */
  .diff {
    max-height: 34vh;
    overflow: auto;
    margin: 0 var(--space-2);
    padding: var(--space-2) 0;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.6;
  }

  /* One line of the change. Not `.line`, which the sheet draws as a hairline
     between a card's rows: two rules for one name put every row of the diff on
     top of the one above it. */
  .change {
    padding: 0 var(--space-3);
    color: var(--muted-strong);
    white-space: pre-wrap;
  }

  .change.added {
    background: color-mix(in srgb, var(--success) 14%, transparent);
    color: var(--text-strong);
  }

  .change.removed {
    background: color-mix(in srgb, var(--danger) 14%, transparent);
    color: var(--text-strong);
  }

  /* The tally, in the two colours the rows wear. */
  ins,
  del {
    margin-inline-end: var(--space-2);
    text-decoration: none;
  }

  ins {
    color: var(--success);
  }

  del {
    color: var(--danger);
  }

  /* Throw it away on the left, keep it on the right, which is where every dialog
     in the world puts the two. */
  .answers {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: 0 var(--space-2);
  }
</style>
