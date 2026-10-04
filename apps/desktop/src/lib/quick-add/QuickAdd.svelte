<script lang="ts">
  /** Quick add's field: one line, its recognised words drawn as chips where they were
   *  typed, and a row of controls under it that show what was understood and pick it
   *  for somebody who would rather click (docs/tasks.md 5.6).
   *
   *  The line is a plain input whose letters are drawn by the layer under it, so a chip
   *  can wear the accent's tint without the field becoming a rich-text editor: the input
   *  keeps the caret, the selection and every key a text field has. A chip pressed is
   *  words again (Todoist's undo), and Backspace into one takes it apart by changing its
   *  words.
   *
   *  Enter adds and keeps the field for the next task, Shift+Enter opens a line for the
   *  description, Ctrl+Enter adds and opens the note at the task, Escape closes. What
   *  happens to the task is the caller's (`onsubmit`): the sheet writes it, the global
   *  window hands it to the app. */
  import type { Priority } from '@nib/markdown/task-line'
  import { parseQuickAdd, type QuickFields } from '@nib/bases/language'
  import { todayOf } from '@nib/bases'
  import Bell from 'lucide/dist/esm/icons/bell.mjs'
  import Calendar from 'lucide/dist/esm/icons/calendar.mjs'
  import Flag from 'lucide/dist/esm/icons/flag.mjs'
  import Inbox from 'lucide/dist/esm/icons/inbox.mjs'
  import Repeat from 'lucide/dist/esm/icons/repeat.mjs'
  import Timer from 'lucide/dist/esm/icons/timer.mjs'
  import { onMount, tick } from 'svelte'
  import { t } from '../i18n.svelte'
  import type { MenuEntry } from '../menu-item'
  import type { Entry, Prefill } from './entry'
  import { carried, piecesOf, type Span, without } from './field'
  import Glyph from './Glyph.svelte'
  import { dayWords, durationLabel, priorityTone } from './labels'
  import Picker from './Picker.svelte'
  import { dayRows, durationRows, priorityRows, remindRows, whereRows } from './pickers'

  const {
    langs,
    notes = [],
    prefill = {},
    smart = true,
    onsubmit,
    onclose,
    onpicking,
  }: {
    /** The app's language first; English is always read too. */
    langs: readonly string[]
    /** The space's notes by name, for `>` and the where control. */
    notes?: readonly string[]
    prefill?: Prefill
    /** Whether typed words are read as fields at all (Settings, Smart dates). */
    smart?: boolean
    onsubmit: (entry: Entry, open: boolean) => void | Promise<void>
    onclose: () => void
    /** A picker opened or put away: the global window grows to hold it. */
    onpicking?: (open: boolean) => void
  } = $props()

  let text = $state('')
  let description = $state<string | null>(null)
  /** Spans turned back into words. */
  let keep = $state<Span[]>([])
  /** What the controls picked, over whatever the words say. `null` takes a field away. */
  let picked = $state<{
    due?: string | null
    time?: string | null
    priority?: Priority
    remind?: QuickFields['remind']
    duration?: number | null
    note?: string | null
  }>({})

  let input = $state<HTMLInputElement>()
  let mirror = $state<HTMLElement>()
  let words = $state<HTMLTextAreaElement>()
  let asking = $state<{ rows: MenuEntry[]; at: DOMRect } | null>(null)

  /** The line as last seen, so the spans turned back follow an edit. */
  let seen = ''

  const today = $derived(todayOf())
  const read = $derived(
    smart
      ? parseQuickAdd(text, langs, new Date(), { keep, notes })
      : { text: text.trim(), fields: { tags: [], remind: [] }, chips: [] },
  )
  const pieces = $derived(piecesOf(text, read.chips))

  /** The fields as they will be written: the prefill, then the words, then the picks. */
  const fields = $derived.by((): QuickFields => {
    const out: QuickFields = {
      ...read.fields,
      tags: [...(prefill.tags ?? []), ...read.fields.tags],
    }
    if (out.due === undefined && prefill.due !== undefined) out.due = prefill.due
    if (picked.due === null) delete out.due
    else if (picked.due !== undefined) out.due = picked.due
    if (picked.time === null) delete out.time
    else if (picked.time !== undefined) out.time = picked.time
    if (picked.duration === null) delete out.duration
    else if (picked.duration !== undefined) out.duration = picked.duration
    if (picked.priority !== undefined) out.priority = picked.priority
    if (picked.remind !== undefined) out.remind = picked.remind
    out.tags = [...new Set(out.tags)]
    return out
  })

  const note = $derived(
    picked.note === null ? undefined : (picked.note ?? read.note ?? prefill.note),
  )

  onMount(() => input?.focus())

  // The spans turned back into words move with the words around them.
  $effect(() => {
    const now = text
    if (now === seen) return
    keep = carried(keep, seen, now)
    seen = now
  })

  /** The layer of letters follows the field as a long line scrolls in it. */
  function follow() {
    if (input && mirror) mirror.scrollLeft = input.scrollLeft
  }

  /** A press on a chip makes it words again: Todoist's undo of a misread. */
  function pressed(event: PointerEvent) {
    if (!mirror) return
    for (const chip of mirror.querySelectorAll<HTMLElement>('[data-chip]')) {
      const box = chip.getBoundingClientRect()
      if (
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        event.clientY >= box.top &&
        event.clientY <= box.bottom
      ) {
        const from = Number(chip.dataset.from)
        keep = [...keep, { from, to: from + chip.textContent.length }]
        return
      }
    }
  }

  /** A control's pick wins over the words that said the same field: those words go,
   *  rather than staying in the task as words. */
  function dropChip(kind: string) {
    const chip = read.chips.find((one) => one.kind === kind)
    if (!chip) return
    text = without(text, chip)
  }

  function ask(event: MouseEvent, rows: MenuEntry[]) {
    const target = event.currentTarget
    if (!(target instanceof HTMLElement)) return
    asking = { rows, at: target.getBoundingClientRect() }
  }

  // Said as it changes, so a window no taller than its field can make room for the list.
  $effect(() => onpicking?.(asking !== null))

  const anchor = () => asking?.at ?? input?.getBoundingClientRect() ?? new DOMRect()

  function askDay(event: MouseEvent) {
    ask(
      event,
      dayRows(
        fields,
        today,
        (when) => {
          dropChip('when')
          picked = {
            ...picked,
            due: when.due,
            ...(when.time === undefined ? {} : { time: when.time }),
          }
          input?.focus()
        },
        anchor,
      ),
    )
  }

  function askPriority(event: MouseEvent) {
    ask(
      event,
      priorityRows(fields.priority ?? 4, (priority) => {
        dropChip('priority')
        picked = { ...picked, priority }
        input?.focus()
      }),
    )
  }

  function askRemind(event: MouseEvent) {
    ask(
      event,
      remindRows(fields.remind, fields, today, (remind) => {
        picked = { ...picked, remind }
        input?.focus()
      }),
    )
  }

  function askDuration(event: MouseEvent) {
    ask(
      event,
      durationRows(fields.duration, (duration) => {
        dropChip('duration')
        picked = { ...picked, duration }
        input?.focus()
      }),
    )
  }

  function askWhere(event: MouseEvent) {
    ask(
      event,
      whereRows(note, notes.slice(0, 12), (chosen) => {
        dropChip('where')
        picked = { ...picked, note: chosen ?? null }
        input?.focus()
      }),
    )
  }

  async function submit(open: boolean) {
    const words = read.text
    if (!words) return
    const entry: Entry = { text: words, fields }
    if (description?.trim()) entry.description = description
    if (note !== undefined) entry.note = note
    const heading = picked.note === undefined ? read.heading : undefined
    if (heading !== undefined) entry.heading = heading

    text = ''
    seen = ''
    keep = []
    picked = {}
    description = null
    input?.focus()
    await onsubmit(entry, open)
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onclose()
      return
    }
    if (event.key !== 'Enter' || event.isComposing) return
    if (event.shiftKey && event.currentTarget === input) {
      event.preventDefault()
      description ??= ''
      // The line is drawn on the next turn, and only then can it take the caret.
      void tick().then(() => words?.focus())
      return
    }
    if (event.shiftKey) return
    event.preventDefault()
    void submit(event.ctrlKey || event.metaKey)
  }

  /** Backspace on an empty description takes the line away again. */
  function wordsKey(event: KeyboardEvent) {
    if (event.key === 'Backspace' && description === '') {
      event.preventDefault()
      description = null
      input?.focus()
      return
    }
    onkeydown(event)
  }
</script>

<div class="quick">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="line" onpointerdown={pressed}>
    <div class="letters" bind:this={mirror} aria-hidden="true">
      {#each pieces as piece (piece.from)}{#if piece.chip}<span
            class="chip"
            data-chip={piece.chip}
            data-from={piece.from}>{piece.text}</span
          >{:else}{piece.text}{/if}{/each}&#8203;
    </div>
    <input
      bind:this={input}
      bind:value={text}
      class="field"
      {onkeydown}
      oninput={follow}
      onscroll={follow}
      onselect={follow}
      onkeyup={follow}
      placeholder={t('Add task')}
      aria-label={t('Add task')}
      spellcheck="false"
      autocomplete="off"
    />
  </div>

  {#if description !== null}
    <textarea
      bind:this={words}
      bind:value={description}
      class="words"
      rows="2"
      onkeydown={wordsKey}
      aria-label={t('Description')}></textarea>
  {/if}

  <div class="controls">
    <button type="button" class="control" onclick={askWhere}>
      <Glyph icon={Inbox} />
      <span>{note ? (note.split('/').at(-1) ?? note) : t('Inbox')}</span>
    </button>
    <span class="gap"></span>
    <button
      type="button"
      class="control"
      class:set={fields.due !== undefined}
      onclick={askDay}
      aria-label={fields.due === undefined ? t('Date') : undefined}
    >
      <Glyph icon={fields.recurrence ? Repeat : Calendar} />
      {#if fields.due !== undefined}<span>{dayWords(fields.due, today, fields.time)}</span>{/if}
    </button>
    <button
      type="button"
      class="control"
      class:set={(fields.priority ?? 4) < 4}
      style:color={priorityTone(fields.priority ?? 4)}
      onclick={askPriority}
      aria-label={t('Priority')}
    >
      <Glyph icon={Flag} />
    </button>
    <button
      type="button"
      class="control"
      class:set={fields.remind.length > 0}
      onclick={askRemind}
      aria-label={t('Reminder')}
    >
      <Glyph icon={Bell} />
      {#if fields.remind.length > 1}<span>{fields.remind.length}</span>{/if}
    </button>
    <button
      type="button"
      class="control"
      class:set={fields.duration !== undefined}
      onclick={askDuration}
      aria-label={fields.duration === undefined ? t('Duration') : undefined}
    >
      <Glyph icon={Timer} />
      {#if fields.duration !== undefined}<span>{durationLabel(fields.duration)}</span>{/if}
    </button>
    <button type="button" class="add" disabled={!read.text} onclick={() => void submit(false)}
      >{t('Add')}</button
    >
  </div>
</div>

{#if asking}
  <Picker rows={asking.rows} at={asking.at} onclose={() => (asking = null)} />
{/if}

<style>
  .quick {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
  }

  /* The field and the layer of letters under it are one box: the same font, the same
     padding, the same width, so every letter the layer draws sits under the one the
     field holds. */
  .line {
    position: relative;
  }

  .letters,
  .field {
    box-sizing: border-box;
    width: 100%;
    padding: var(--space-1) var(--space-1);
    border: none;
    font-family: var(--font-ui);
    font-size: var(--text-base);
    line-height: 1.5;
    letter-spacing: normal;
    white-space: pre;
  }

  .letters {
    position: absolute;
    inset: 0;
    overflow: hidden;
    color: var(--text-strong);
    pointer-events: none;
  }

  .field {
    position: relative;
    background: none;
    color: transparent;
    caret-color: var(--text-strong);
    outline: none;
  }

  /* The palette's line: a hairline under the words that turns when the keyboard
     lands, which is the answer a box you type into gives (base.css, Fields), and not
     the halo as well. */
  .line {
    border-bottom: 1px solid var(--line);
    transition: border-color var(--dur-fast) var(--ease-out);
  }

  .line:focus-within {
    border-bottom-color: var(--accent);
  }

  input.field:focus,
  textarea.words:focus {
    box-shadow: none;
  }

  .field::placeholder {
    color: var(--muted);
  }

  .field::selection {
    background: var(--accent-soft);
    color: transparent;
  }

  /* The accent's tint, padded by a shadow rather than by padding, which would move
     every letter after it away from the field's own. */
  .chip {
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
    box-shadow: 0 0 0 1px var(--accent-soft);
    color: var(--accent);
    transition:
      background var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }

  .words {
    box-sizing: border-box;
    width: 100%;
    min-height: 2.6em;
    padding: var(--space-1);
    border: none;
    border-top: 1px solid var(--line);
    background: none;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    resize: none;
    outline: none;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .gap {
    flex: 1;
  }

  .control {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-height: var(--row-height-sm);
    padding: 0 var(--space-2);
    border: 1px solid transparent;
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .control:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .control:active {
    background: var(--surface-press);
  }

  .control.set {
    color: var(--accent);
  }

  .add {
    min-height: var(--row-height-sm);
    margin-inline-start: var(--space-2);
    padding: 0 var(--space-3);
    border: none;
    border-radius: var(--radius-row);
    background: var(--accent);
    color: var(--accent-ink);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    transition: opacity var(--dur-fast) var(--ease-out);
  }
</style>
