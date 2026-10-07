<script lang="ts">
  /** A new poll (docs/chats.md 4.8): a question, two to ten answers (a new field
   *  appears as the last one is written in), one answer or several, and when it ends.
   *  Discord's shape in the app's sheet. */
  import type { Poll } from '@nib/chats'
  import { FEWEST_ANSWERS, LONGEST_ANSWER, LONGEST_QUESTION, MOST_ANSWERS } from '@nib/chats/limits'
  import { t } from '../../i18n.svelte'
  import Sheet from '../../Sheet.svelte'
  import { segmented } from '../../slide'
  import { stretch } from './when'

  const { onsend, onclose }: { onsend: (poll: Poll) => void; onclose: () => void } = $props()

  const HOUR = 60 * 60 * 1000
  const ENDS = [
    { label: stretch(1, 'hour'), after: HOUR },
    { label: stretch(1, 'day'), after: 24 * HOUR },
    { label: stretch(3, 'day'), after: 72 * HOUR },
    { label: stretch(1, 'week'), after: 7 * 24 * HOUR },
    { label: t('Never'), after: null },
  ] as const

  let question = $state('')
  const answers = $state<string[]>(['', ''])
  let several = $state(false)
  let ends = $state<number | null>(24 * HOUR)

  const filled = $derived(answers.map((one) => one.trim()).filter(Boolean))
  const ready = $derived(question.trim().length > 0 && filled.length >= FEWEST_ANSWERS)

  function typed(index: number, value: string) {
    answers[index] = value
    const last = answers.at(-1) ?? ''
    if (last.trim() && answers.length < MOST_ANSWERS) answers.push('')
  }

  function send() {
    if (!ready) return
    onsend({
      question: question.trim(),
      answers: filled,
      several,
      ...(ends === null ? {} : { ends: Date.now() + ends }),
    })
  }
</script>

<Sheet open title={t('Poll')} {onclose}>
  <div class="poll">
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="nib-field"
      bind:value={question}
      maxlength={LONGEST_QUESTION}
      placeholder={t('Question')}
      aria-label={t('Question')}
      autofocus
    />
    {#each answers as answer, index (index)}
      <input
        class="nib-field"
        value={answer}
        maxlength={LONGEST_ANSWER}
        placeholder={t('Answer')}
        aria-label={t('Answer')}
        oninput={(event) => typed(index, event.currentTarget.value)}
        onkeydown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) send()
        }}
      />
    {/each}
    <button
      type="button"
      class="row"
      role="switch"
      aria-checked={several}
      onclick={() => (several = !several)}
    >
      <span>{t('Several answers')}</span>
      <span class="nib-switch" class:on={several} aria-hidden="true"></span>
    </button>
    <div class="nib-segmented" role="radiogroup" aria-label={t('Poll')} use:segmented>
      {#each ENDS as one (one.label)}
        <button
          type="button"
          class:on={ends === one.after}
          aria-pressed={ends === one.after}
          onclick={() => (ends = one.after)}>{one.label}</button
        >
      {/each}
    </div>
    <button type="button" class="nib-button send" disabled={!ready} onclick={send}
      >{t('Send')}</button
    >
  </div>
</Sheet>

<style>
  .poll {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4) var(--space-4);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    margin-top: var(--space-1);
    padding: var(--space-1) 0;
    border: none;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: start;
  }

  .send {
    align-self: flex-end;
    margin-top: var(--space-2);
  }
</style>
