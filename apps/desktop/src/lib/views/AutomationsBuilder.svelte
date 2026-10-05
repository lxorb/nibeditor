<script lang="ts">
  /** A base's automations, Notion's (docs/tasks.md 5.13), each with a switch: when a row
   *  is added, or when a property changes (to a value, where one is said), set
   *  properties, move the note into a folder, and tell the reader. They run wherever
   *  nib runs (runner.svelte.ts); each fires once per change, and what it writes is one
   *  undo with the edit that fired it. */
  import { type Automation, readAutomations, withAutomations } from '@nib/bases'
  import Cross from '../Cross.svelte'
  import { t } from '../i18n.svelte'
  import Select from '../Select.svelte'
  import { bare, knownProperties } from './columns'
  import type { Kit } from './kit'

  const { kit }: { kit: Kit } = $props()

  const live = $derived(kit.live)
  const automations = $derived(live.base ? readAutomations(live.base) : [])
  const keys = $derived(
    live.base
      ? knownProperties(live.base, 'notes', live.rows)
          .filter((one) => one.startsWith('note.'))
          .map(bare)
      : [],
  )
  const ADDED = ''

  function write(next: Automation[]) {
    kit.change((base) => withAutomations(base, next))
  }

  function change(at: number, automation: Automation) {
    write(automations.map((one, index) => (index === at ? automation : one)))
  }

  function add() {
    write([...automations, { when: { added: true }, set: {}, kept: {} }])
  }

  /** An automation without one of its optional keys, where the words are empty. */
  function said(automation: Automation, key: 'move' | 'notify', words: string): Automation {
    const next = { ...automation }
    if (words.trim()) next[key] = words.trim()
    else Reflect.deleteProperty(next, key)
    return next
  }
</script>

{#each automations as automation, at (at)}
  {@const when = automation.when}
  {@const sets = Object.entries(automation.set)}
  <div class="automation" class:off={automation.off}>
    <div class="row">
      <button
        type="button"
        class="switch"
        role="switch"
        aria-checked={!automation.off}
        aria-label={t('On')}
        onclick={() => {
          const next = { ...automation }
          if (automation.off) Reflect.deleteProperty(next, 'off')
          else next.off = true
          change(at, next)
        }}><span class="nib-switch" class:on={!automation.off} aria-hidden="true"></span></button
      >
      <Select
        label={t('Automations')}
        value={'added' in when ? ADDED : when.property}
        options={[
          { value: ADDED, label: t('Row added') },
          ...keys.map((one) => ({ value: one, label: one })),
        ]}
        onchange={(next: string) =>
          change(at, {
            ...automation,
            when: next === ADDED ? { added: true } : { property: next },
          })}
      />
      {#if 'property' in when}
        <input
          class="nib-field"
          value={when.is ?? ''}
          aria-label={t('Value')}
          placeholder="="
          onchange={(event) => {
            const is = event.currentTarget.value.trim()
            change(at, {
              ...automation,
              when: is ? { property: when.property, is } : { property: when.property },
            })
          }}
        />
      {:else}
        <span></span>
      {/if}
      <button
        type="button"
        class="nib-glyph"
        title={t('Remove')}
        aria-label={t('Remove')}
        onclick={() => write(automations.filter((_, index) => index !== at))}
        ><Cross small /></button
      >
    </div>

    {#each sets as [key, value] (key)}
      <div class="row then">
        <span class="mark" aria-hidden="true">→</span>
        <Select
          label={t('Property')}
          value={key}
          options={(keys.includes(key) ? keys : [key, ...keys]).map((one) => ({
            value: one,
            label: one,
          }))}
          onchange={(next: string) =>
            change(at, {
              ...automation,
              set: Object.fromEntries(sets.map(([k, v]) => (k === key ? [next, v] : [k, v]))),
            })}
        />
        <input
          class="nib-field"
          {value}
          aria-label={t('Value')}
          onchange={(event) =>
            change(at, {
              ...automation,
              set: { ...automation.set, [key]: event.currentTarget.value },
            })}
        />
        <button
          type="button"
          class="nib-glyph"
          title={t('Remove')}
          aria-label={t('Remove')}
          onclick={() =>
            change(at, {
              ...automation,
              set: Object.fromEntries(sets.filter(([k]) => k !== key)),
            })}><Cross small /></button
        >
      </div>
    {/each}
    <div class="row then">
      <span class="mark" aria-hidden="true">→</span>
      <button
        type="button"
        class="nib-row is-short adder"
        onclick={() => {
          const key = keys.find((one) => !(one in automation.set)) ?? 'status'
          change(at, { ...automation, set: { ...automation.set, [key]: '' } })
        }}
      >
        <span class="nib-row-label">{t('Add')}</span>
      </button>
    </div>
    <div class="row then">
      <span class="mark" aria-hidden="true">→</span>
      <input
        class="nib-field"
        value={automation.move ?? ''}
        aria-label={t('Move to')}
        placeholder={t('Move to')}
        onchange={(event) => change(at, said(automation, 'move', event.currentTarget.value))}
      />
      <input
        class="nib-field"
        value={automation.notify ?? ''}
        aria-label={t('Notifications')}
        placeholder={t('Notifications')}
        onchange={(event) => change(at, said(automation, 'notify', event.currentTarget.value))}
      />
    </div>
  </div>
{/each}

<button type="button" class="nib-row is-short adder" onclick={add}>
  <span class="nib-row-label">{t('Add')}</span>
</button>

<style>
  .automation {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--line);
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .automation.off {
    opacity: 0.55;
  }

  .row {
    display: grid;
    grid-template-columns: auto minmax(0, 1.2fr) minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
  }

  .switch {
    display: grid;
    place-items: center;
    padding: 0;
    border: none;
    background: none;
  }

  .mark,
  .switch {
    width: 40px;
  }

  .mark {
    color: var(--muted);
    text-align: center;
  }

  .then .adder {
    grid-column: 2 / 4;
  }

  .adder .nib-row-label {
    color: var(--muted);
  }
</style>
