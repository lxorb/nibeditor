<script lang="ts">
  /** The foot of the panel (docs/ai-sidebar.md 4.1), Codex's composer: what is queued
   *  and the rewind over it, then one rounded box holding the chips that go with the
   *  next message (the note in front and the selection, Codex's IDE context), the
   *  field, and a row under the words - "+" (files, web search, dictation, `@` and `/`)
   *  and the mode at its start, Codex's permissions; the context ring, the model and its
   *  effort, and one round button at its end, the arrow, and the stop while an answer
   *  arrives.
   *
   *  Keyboard first. Enter sends, and queues behind a running answer; Ctrl+Enter sends
   *  into the running answer; Escape stops it; Shift+Tab steps the mode, Alt+P opens the
   *  model, Alt+T steps the effort, Ctrl+O opens every row, Ctrl+N starts a new chat.
   *  Each is a row of the keyboard registry, so it can be changed in Settings. `@` lists
   *  what can go along, `/` the commands; a picture pasted or dropped is a chip. */
  import { cubicOut } from 'svelte/easing'
  import { fly } from 'svelte/transition'
  import { i18n, t } from '../../i18n.svelte'
  import Cross from '../../Cross.svelte'
  import { links } from '../../link-index.svelte'
  import { DIVIDER, menu } from '../../menu.svelte'
  import { dur } from '../../motion'
  import { shortcuts } from '../../shortcuts.svelte'
  import { withinSpace } from '../../space-paths'
  import { views } from '../../views.svelte'
  import { workspace, type Entry } from '../../workspace.svelte'
  import { estimateText } from '../chat/usage'
  import { canTranscribe } from '../hears'
  import { chat } from './chat.svelte'
  import { dictation } from './dictate.svelte'
  import type { Front } from './gather'
  import { hostHere } from './host'
  import MentionMark from './MentionMark.svelte'
  import ModeMark from './ModeMark.svelte'
  import { type Mention, mentionAt, ranked, type Row, sameMention } from './mentions'
  import ModelPicker from './ModelPicker.svelte'
  import { minutes, tokens } from './numbers'
  import Queue from './Queue.svelte'
  import Ring from './Ring.svelte'
  import type { PanelCommand } from '../commands/types'
  import Rewinding from '../review/Rewinding.svelte'
  import { commandIn, commandsFor, matching, rowNamed } from './seams'
  import Suggest from './Suggest.svelte'
  import { MODES, FIRST_MODE, modeWord } from '../modes'

  let field = $state<HTMLTextAreaElement>()
  let caret = $state(0)
  let lit = $state(0)
  /** The menu put away with Escape, until the text changes again. */
  let hushed = $state('')
  let commands = $state<readonly PanelCommand[]>([])
  let picker = $state<HTMLInputElement>()
  const here = hostHere()

  const head = $derived(chat.head)
  const busy = $derived(chat.busy)
  const space = $derived(workspace.activeSpace)

  // ── What goes along on its own ─────────────────────────

  /** The note in front, while it is a note of this space. */
  const front = $derived.by((): (Front & { key: string }) | null => {
    const tab = workspace.panelTab
    const root = space?.root
    if (tab?.kind !== 'note' || !tab.path || !root) return null
    const path = withinSpace(root, tab.path)
    if (path === null) return null
    return { key: `note:${path}`, path, name: tab.shown, text: tab.note.latest }
  })

  const selection = $derived(views.chosen > 0 ? views.selectedText() : '')
  const selectionKey = $derived(`selection:${selection.slice(0, 60)}`)
  const frontOn = $derived(!!front && !chat.dropped.includes(front.key))
  const selectionOn = $derived(!!selection.trim() && !chat.dropped.includes(selectionKey))

  /** What the panel says is around the field, read at the moment of sending. */
  function around() {
    const on = front && !chat.dropped.includes(front.key) ? front : null
    const picked = views.chosen > 0 ? views.selectedText() : ''
    const pickedOn = !!picked.trim() && !chat.dropped.includes(`selection:${picked.slice(0, 60)}`)
    return {
      front: on ? { path: on.path, name: on.name, text: on.text } : null,
      selection: pickedOn ? picked : '',
    }
  }
  chat.around = around

  /** The chips that go with the next send: the selection as one where it is on. */
  function sentChips(): Mention[] {
    const chips = chat.chips.filter((one) => one.kind !== 'picture' || chat.model?.images !== false)
    return selectionOn && !chips.some((one) => one.kind === 'selection')
      ? [...chips, { kind: 'selection', id: 'selection', label: 'selection' }]
      : chips
  }

  // ── The ring's ≈ ──────────────────────────────────────

  const next = $derived.by(() => {
    let sum = estimateText(chat.text)
    if (frontOn && front && head?.mode !== 'approve')
      sum += Math.min(12_000, estimateText(front.text))
    if (selectionOn) sum += estimateText(selection)
    for (const chip of chat.chips) {
      if (chip.text) sum += estimateText(chip.text)
      if (chip.image) sum += 1_600
    }
    return sum
  })

  // ── `@` and `/` ───────────────────────────────────────

  const mention = $derived(mentionAt(chat.text, caret))
  const slash = $derived(/^\/[\w-]*$/.test(chat.text) ? chat.text.slice(1) : null)

  /** Every folder of the space, from the tree the file list draws. */
  function folders(): Entry[] {
    const out: Entry[] = []
    const walk = (entry: Entry) => {
      for (const child of entry.children) {
        if (!child.is_dir) continue
        out.push(child)
        walk(child)
      }
    }
    if (workspace.tree) walk(workspace.tree)
    return out
  }

  /** Everything `@` can name here, the ones there is one of first. */
  function candidates(): Mention[] {
    const out: Mention[] = []
    if (views.chosen > 0)
      out.push({ kind: 'selection', id: 'selection', label: t('Selection'), word: 'selection' })
    for (const tab of workspace.tabs) {
      if (tab.kind === 'web') out.push({ kind: 'tab', id: tab.id, label: tab.shown, word: 'tab' })
    }
    out.push({ kind: 'web', id: 'web', label: t('Web search'), word: 'web' })
    out.push({ kind: 'scratchpad', id: 'scratchpad', label: t('Scratchpad'), word: 'scratchpad' })
    for (const note of workspace.notes) {
      out.push({ kind: 'note', id: note.path, label: note.name.replace(/\.(?:md|markdown)$/i, '') })
    }
    for (const folder of folders())
      out.push({ kind: 'folder', id: folder.path, label: `${folder.name}/` })
    for (const { tag } of links.spaceTags) out.push({ kind: 'tag', id: tag, label: `#${tag}` })
    for (const one of chat.heads) {
      if (one.id !== head?.id && one.title)
        out.push({ kind: 'thread', id: one.id, label: one.title })
    }
    return out
  }

  const found = $derived(mention && hushed !== chat.text ? ranked(candidates(), mention.query) : [])

  /** Whether the `/` menu is open, which is when its rows are asked for: each time,
   *  since commands written as notes are found in the background (6.5). */
  const slashing = $derived(slash !== null)

  $effect(() => {
    if (slashing) void commandsFor(chat).then((rows) => (commands = rows))
  })

  const commandRows = $derived(
    slash !== null && hushed !== chat.text ? matching(commands, slash) : [],
  )

  const rows = $derived.by((): Row[] => {
    if (commandRows.length) {
      const kind = chat.provider?.kind
      return commandRows.map((one) => {
        const why = kind ? one.available(kind) : true
        return {
          key: one.name,
          label: `/${one.name}`,
          hint:
            one.description ??
            [one.args, ...one.synonyms.map((word) => `/${word}`)].filter(Boolean).join('  '),
          ...(why === true ? {} : { dim: why }),
        }
      })
    }
    return found.map((one) => ({
      key: `${one.kind}:${one.id}`,
      label: one.label,
      mark: one.kind,
      ...(one.kind === 'note' ? { hint: folderIn(one.id) } : {}),
    }))
  })

  /** Reads values for their own sake, so the effect around them follows them. */
  const follows = (..._values: unknown[]) => undefined

  // A new list starts on its first row.
  $effect(() => {
    follows(rows)
    lit = 0
  })

  /** A note's folder inside the space, or nothing for one at its root. */
  function folderIn(path: string): string {
    const root = space?.root
    const inside = root ? withinSpace(root, path) : null
    const at = inside?.lastIndexOf('/') ?? -1
    return inside && at > 0 ? inside.slice(0, at) : ''
  }

  /** A popover is put away by a press anywhere else, and by Escape wherever the
   *  keyboard is in the foot. */
  function outside(event: PointerEvent) {
    if (!chat.popover) return
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('.pop, .tray, .picker .chip, .knob')) return
    chat.popover = null
  }

  function footKey(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !chat.popover) return
    event.preventDefault()
    event.stopPropagation()
    chat.popover = null
    chat.focus()
  }

  function addChip(chip: Mention) {
    if (!chat.chips.some((one) => sameMention(one, chip))) chat.chips = [...chat.chips, chip]
  }

  function pick(index: number, complete = false) {
    const command = commandRows[index]
    if (command) {
      // Tab, a row that needs its words first (`/goal <condition>`), or one not offered
      // here: the name into the field, for the reader to go on from.
      const offered = command.available(chat.provider?.kind ?? 'compatible') === true
      if (complete || !offered || command.args?.startsWith('<')) {
        chat.text = `/${command.name} `
        place(chat.text.length)
        return
      }
      chat.text = ''
      void command.run({ args: '', thread: chat.thread, panel: chat })
      return
    }
    const chosen = found[index]
    const at = mention
    if (!chosen || !at) return
    addChip(chosen)
    // The `@` and its letters leave the field, and the space before them with them
    // where the words go on after, so the chip stands for them without a gap.
    const before = chat.text.slice(0, at.from)
    const after = chat.text.slice(caret)
    const joined = before.endsWith(' ') && after.startsWith(' ') ? before.slice(0, -1) : before
    chat.text = joined + after
    place(joined.length)
  }

  function place(at: number) {
    requestAnimationFrame(() => {
      field?.focus()
      field?.setSelectionRange(at, at)
      caret = at
    })
  }

  /** A typed command, `/name args`, run where one is named; false where none is. */
  async function runTyped(): Promise<boolean> {
    const typed = commandIn(chat.text)
    if (!typed) return false
    if (!commands.length) commands = await commandsFor(chat)
    const named = rowNamed(commands, typed.name)
    if (named?.row.available(chat.provider?.kind ?? 'compatible') !== true) return false
    chat.text = ''
    void named.row.run({
      args: typed.args,
      thread: chat.thread,
      panel: chat,
      ...(named.typed ? { typed: named.typed } : {}),
    })
    return true
  }

  async function submit() {
    if (await runTyped()) return
    chat.chips = sentChips()
    chat.submit(around())
  }

  // ── Keys ──────────────────────────────────────────────

  function onKey(event: KeyboardEvent) {
    if (event.isComposing) return
    if (rows.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        lit = (lit + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length
        return
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault()
        pick(lit, event.key === 'Tab')
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        hushed = chat.text
        return
      }
    }
    const run = (action: () => void) => {
      event.preventDefault()
      event.stopPropagation()
      action()
    }
    if (shortcuts.pressed('ai.mode', event)) return run(() => chat.nextMode())
    if (shortcuts.pressed('ai.model', event))
      return run(() => (chat.popover = chat.popover === 'model' ? null : 'model'))
    if (shortcuts.pressed('ai.effort', event)) return run(() => chat.setEffort('next'))
    if (shortcuts.pressed('ai.steer', event)) return run(() => chat.steer(around()))
    if (shortcuts.pressed('ai.unfold', event)) return run(() => chat.toggleFolded())
    if (shortcuts.pressed('ai.new', event)) return run(() => chat.newThread())
    if (shortcuts.pressed('ai.stop', event) && (busy || chat.popover)) {
      return run(() => {
        if (chat.popover) chat.popover = null
        else chat.stop()
      })
    }
    if (event.key === 'Enter' && !event.shiftKey) return run(() => void submit())
    const empty = !chat.text.trim()
    // Up on an empty field: the last message, to change and send again.
    if (event.key === 'ArrowUp' && empty && !event.altKey && !event.ctrlKey && !event.metaKey)
      return run(() => chat.startEdit())
    // Escape: out of an edit; on an empty field of a thread with messages, twice is the
    // rewind sheet, so the first is held for the second rather than leaving the panel.
    if (event.key === 'Escape' && chat.editing) return run(() => chat.cancelEdit())
    if (event.key === 'Escape' && empty && head?.kept) {
      const now = Date.now()
      if (now - escaped < 500) {
        escaped = 0
        return run(() => chat.rewind())
      }
      escaped = now
      return run(() => undefined)
    }
  }

  function onInput() {
    caret = field?.selectionStart ?? 0
  }

  // ── Pictures and files ────────────────────────────────

  /** A file as a chip: a picture as itself, a text file as its words. */
  function take(file: File) {
    const reader = new FileReader()
    if (file.type.startsWith('image/')) {
      reader.onload = () => {
        const url = typeof reader.result === 'string' ? reader.result : ''
        const data = url.slice(url.indexOf(',') + 1)
        addChip({
          kind: 'picture',
          id: crypto.randomUUID(),
          label: file.name || t('Picture'),
          image: { mime: file.type, data },
        })
      }
      reader.readAsDataURL(file)
      return
    }
    if (file.size > 2_000_000) return
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      // Words a person can read, which is what a model can be sent; anything else stays.
      if (text.includes('\u0000')) return
      addChip({ kind: 'words', id: file.name, label: file.name, text })
    }
    reader.readAsText(file)
  }

  function onPaste(event: ClipboardEvent) {
    const files = [...(event.clipboardData?.files ?? [])]
    if (!files.length) return
    event.preventDefault()
    files.forEach(take)
  }

  function onDrop(event: DragEvent) {
    const files = [...(event.dataTransfer?.files ?? [])]
    if (!files.length) return
    event.preventDefault()
    files.forEach(take)
  }

  // ── Mode ──────────────────────────────────────────────

  /** The modes as rows, the one in force ticked, Codex's approval menu. The key that
   *  steps them is the button's tooltip rather than a hint on every row, where it would
   *  say the same thing thrice. */
  function modeMenu(event: MouseEvent) {
    menu.show(
      event,
      MODES.map((mode) => ({
        label: t(modeWord(mode)),
        checked: head?.mode === mode,
        run: () => chat.setMode(mode),
      })),
    )
  }

  // ── "+" ───────────────────────────────────────────────

  const searching = $derived(chat.chips.some((one) => one.kind === 'web'))

  function toggleWeb() {
    if (searching) chat.chips = chat.chips.filter((one) => one.kind !== 'web')
    else addChip({ kind: 'web', id: 'web', label: t('Web search'), word: 'web' })
  }

  /** Codex's "+": files first, then what else can go along, then what the field's own
   *  keys do, for whoever has not met `@` and `/` yet. */
  function plusMenu(event: MouseEvent) {
    menu.show(event, [
      { label: t('Add photos and files'), asks: true, run: () => picker?.click() },
      DIVIDER,
      { label: t('Web search'), checked: searching, run: toggleWeb },
      ...(canTranscribe() ? [{ label: t('Dictate'), run: () => void dictation.toggle(true) }] : []),
      { label: t('Mention'), run: () => typeAt('@') },
      { label: t('Commands'), disabled: !!chat.text.trim(), run: () => typeAt('/') },
    ])
  }

  /** A key's character typed for the reader where the caret is, opening its list. */
  function typeAt(mark: string) {
    const at = field?.selectionStart ?? chat.text.length
    const before = chat.text.slice(0, at)
    const typed = mark === '@' && before && !/\s$/.test(before) ? ` ${mark}` : mark
    chat.text = before + typed + chat.text.slice(at)
    place(at + typed.length)
  }

  function picked(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    for (const file of input.files ?? []) take(file)
    input.value = ''
    chat.focus()
  }

  // ── The round button ──────────────────────────────────

  /** What the one round button is now, Codex's: the stop while an answer arrives and
   *  the field is empty, dictation's stop while it listens, and the arrow otherwise. */
  const button = $derived.by((): 'stop' | 'listening' | 'hearing' | 'send' => {
    if (busy && !chat.text.trim()) return 'stop'
    if (dictation.state !== 'idle') return dictation.state
    return 'send'
  })

  // ── Focus ─────────────────────────────────────────────

  // Only in the place used last, where the panel is in two (host.ts).
  $effect(() => {
    if (chat.focusAsked && chat.host === here) requestAnimationFrame(() => field?.focus())
  })

  /** The open thread itself, the live one the engine writes into, for the review's bar:
   *  asked again whenever the panel draws another thread. */
  const thread = $derived(chat.head ? chat.thread : null)

  /** When Escape was last pressed on an empty field, for Esc Esc. */
  let escaped = 0

  // ── The goal ──────────────────────────────────────────

  /** The goal's chip while it is being worked toward or is paused (6.5): ◎, how long,
   *  its turns of its budget, its tokens; the last reason a press away. */
  const goal = $derived(
    head?.goal && (head.goal.state === 'pursuing' || head.goal.state === 'paused')
      ? head.goal
      : null,
  )
  let reasoning = $state(false)
  let now = $state(Date.now())

  $effect(() => {
    if (!goal) return
    const clock = setInterval(() => (now = Date.now()), 30_000)
    return () => clearInterval(clock)
  })

  async function clearGoal() {
    const named = rowNamed(await commandsFor(chat), 'goal')
    await named?.row.run({ args: 'clear', thread: chat.thread, panel: chat })
  }
</script>

<svelte:window onpointerdown={outside} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="foot" onkeydown={footKey}>
  <Queue />

  {#if thread}
    <Rewinding {thread} panel={chat} />
  {/if}

  {#if chat.editing}
    <div class="editing" transition:fly={{ y: 6, duration: dur(130), easing: cubicOut }}>
      <svg viewBox="0 0 13 13" aria-hidden="true"><path d="M8.7 2.3l2 2-6 6-2.6.6.6-2.6z" /></svg>
      <button
        class="drop"
        aria-label={t('Cancel')}
        title={t('Cancel')}
        onclick={() => chat.cancelEdit()}><Cross small /></button
      >
    </div>
  {/if}

  {#if goal}
    <div
      class="goal"
      class:paused={goal.state === 'paused'}
      transition:fly={{ y: 6, duration: dur(150), easing: cubicOut }}
    >
      <button
        class="what"
        title={goal.condition}
        aria-expanded={reasoning}
        onclick={() => (reasoning = !reasoning)}
      >
        <span class="mark">◎</span>
        <span class="condition">{goal.condition}</span>
        <span class="meta"
          >{minutes(now - goal.started, i18n.language)} · {goal.turns}/{goal.budget.turns} · {tokens(
            goal.tokens,
            i18n.language,
          )}</span
        >
      </button>
      <button
        class="drop"
        aria-label={t('Remove')}
        title={t('Remove')}
        onclick={() => void clearGoal()}><Cross small /></button
      >
    </div>
    {#if reasoning && goal.reason}
      <p class="reason">{goal.reason}</p>
    {/if}
  {/if}

  <div class="box-wrap">
    {#if rows.length}
      <Suggest
        {rows}
        active={lit}
        onpick={(index: number) => pick(index)}
        onlight={(index: number) => (lit = index)}
      />
    {/if}
    <!-- One box, Codex's: a press anywhere in it that is not a control is a press in
         the field. -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="composer nib-field"
      onclick={(event) => {
        if (event.target === event.currentTarget) field?.focus()
      }}
    >
      {#if frontOn || selectionOn || chat.chips.length > 0}
        <div class="chips">
          {#if front && frontOn}
            <span class="chip implicit" title={front.path}>
              <MentionMark kind="note" />
              <span class="name">{front.name}</span>
              <button
                class="drop"
                aria-label={t('Remove')}
                title={t('Remove')}
                onclick={() => chat.drop(front.key)}><Cross small /></button
              >
            </span>
          {/if}
          {#if selectionOn}
            <span class="chip implicit" title={selection.slice(0, 400)}>
              <MentionMark kind="selection" />
              <span class="name quoted">{selection.trim().slice(0, 40)}</span>
              <button
                class="drop"
                aria-label={t('Remove')}
                title={t('Remove')}
                onclick={() => chat.drop(selectionKey)}><Cross small /></button
              >
            </span>
          {/if}
          {#each chat.chips as chip (`${chip.kind}:${chip.id}`)}
            <span
              class="chip"
              class:refused={chip.kind === 'picture' && chat.model?.images === false}
              title={chip.kind === 'picture' && chat.model?.images === false
                ? t('This model takes no pictures')
                : chip.label}
              transition:fly={{ y: 6, duration: dur(130), easing: cubicOut }}
            >
              {#if chip.image}
                <img
                  class="thumb"
                  alt=""
                  draggable="false"
                  src={`data:${chip.image.mime};base64,${chip.image.data}`}
                />
              {:else}
                <MentionMark kind={chip.kind} />
              {/if}
              <span class="name">{chip.label}</span>
              <button
                class="drop"
                aria-label={t('Remove')}
                title={t('Remove')}
                onclick={() => (chat.chips = chat.chips.filter((one) => !sameMention(one, chip)))}
                ><Cross small /></button
              >
            </span>
          {/each}
        </div>
      {/if}

      <textarea
        bind:this={field}
        bind:value={chat.text}
        data-entry
        rows="1"
        placeholder={t('Ask anything, @ to add, / for more')}
        aria-label={t('Ask about this space')}
        onkeydown={onKey}
        oninput={onInput}
        onclick={onInput}
        onkeyup={onInput}
        onpaste={onPaste}
        ondrop={onDrop}></textarea>

      <div class="controls">
        <button
          class="nib-glyph plus"
          title={t('Add')}
          aria-label={t('Add')}
          aria-haspopup="menu"
          disabled={!head}
          onclick={plusMenu}
        >
          <svg viewBox="0 0 13 13" aria-hidden="true"><path d="M6.5 2.5v8M2.5 6.5h8" /></svg>
        </button>
        <!-- How much the agent may do without asking, Codex's permissions beside "+". -->
        <button
          class="mode"
          title={shortcuts.tooltip(t('Next mode'), 'ai.mode')}
          aria-haspopup="menu"
          onclick={modeMenu}
          disabled={!head}
        >
          <ModeMark mode={head?.mode ?? FIRST_MODE} />
          <span>{t(modeWord(head?.mode ?? FIRST_MODE))}</span>
          <svg class="caret" viewBox="0 0 13 13"><path d="M3.8 5.2l2.7 2.7 2.7-2.7" /></svg>
        </button>
        <span class="gap"></span>
        <Ring {next} />
        <ModelPicker />
        {#if button === 'stop'}
          <button class="go" title={t('Stop')} aria-label={t('Stop')} onclick={() => chat.stop()}>
            <svg viewBox="0 0 13 13"
              ><rect class="square" x="4" y="4" width="5" height="5" rx="0.8" /></svg
            >
          </button>
        {:else if button === 'send'}
          <button
            class="go"
            title={t('Send')}
            aria-label={t('Send')}
            disabled={!chat.text.trim() && !chat.chips.length}
            onclick={() => void submit()}
          >
            <svg viewBox="0 0 13 13"><path d="M6.5 10.6V2.6M3.2 5.9l3.3-3.3 3.3 3.3" /></svg>
          </button>
        {:else}
          <!-- Dictating: its stop while it listens, and a breath while what was said is
               turned into words. -->
          <button
            class="go"
            class:listening={button === 'listening'}
            class:hearing={button === 'hearing'}
            title={t('Listening')}
            aria-label={t('Listening')}
            aria-pressed="true"
            disabled={button === 'hearing'}
            onclick={() => void dictation.toggle()}
          >
            <svg viewBox="0 0 13 13"
              ><rect class="square" x="4" y="4" width="5" height="5" rx="0.8" /></svg
            >
          </button>
        {/if}
      </div>
    </div>
    <input class="files" type="file" multiple bind:this={picker} onchange={picked} tabindex="-1" />
  </div>
</div>

<style>
  /* The composer's column: the panel's width at a side, a reading measure down the
     middle of a tab (`--column`, set by the panel). */
  .foot {
    position: relative;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    max-width: calc(var(--column, 100%) + 2 * var(--space-4));
    margin-inline: auto;
    padding: var(--space-1) var(--space-1) var(--space-2);
  }

  /* The conversation fades out under the top of the foot, Codex's sticky composer,
     rather than being cut off at a line. */
  .foot::before {
    content: '';
    position: absolute;
    inset-inline: 0;
    bottom: 100%;
    height: var(--space-4);
    background: linear-gradient(to top, var(--ground), transparent);
    pointer-events: none;
  }

  :global(.ask.wide) .foot {
    padding-inline: var(--space-4);
  }

  .editing {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 2px 2px 6px;
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .editing svg {
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linejoin: round;
  }

  .goal {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    padding-inline-end: 2px;
    border: 1px solid var(--accent-line);
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
  }

  .goal.paused {
    border-color: var(--line);
    background: var(--surface-2);
  }

  .goal .what {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 3px 6px;
    border: 0;
    background: none;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: start;
    cursor: default;
  }

  .goal .mark {
    flex: none;
    color: var(--accent);
  }

  .goal.paused .mark {
    color: var(--muted);
  }

  .condition {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .goal .meta {
    flex: none;
    margin-inline-start: auto;
    color: var(--muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .reason {
    margin: 0;
    padding: 0 6px;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
  }

  .box-wrap {
    position: relative;
  }

  /* The box, Codex's: rounded, the chips, the words and the controls all inside it.
     A field (`.nib-field`), so it answers the keyboard as every box in the app does. */
  .composer {
    flex-direction: column;
    align-items: stretch;
    gap: 2px;
    min-height: 0;
    padding: var(--space-2) var(--space-1) var(--space-1);
    border-radius: var(--radius-lg);
    background: var(--surface);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    min-width: 0;
    padding: 0 var(--space-1) 2px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    max-width: 100%;
    height: 20px;
    padding: 0 2px 0 5px;
    border: 1px solid var(--line);
    border-radius: var(--radius-row);
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    transition:
      opacity var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }

  /* Offered by the panel rather than added by hand: quieter until pointed at. */
  .chip.implicit {
    border-style: dashed;
    opacity: 0.7;
  }

  .chip.implicit:hover {
    opacity: 1;
  }

  .chip.refused {
    border-color: var(--danger);
    opacity: 0.6;
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The selection, quoted: what it is says itself. */
  .quoted::before {
    content: '\201C';
  }

  .quoted::after {
    content: '\201D';
  }

  .thumb {
    width: 14px;
    height: 14px;
    border-radius: 2px;
    object-fit: cover;
  }

  .drop :global(svg) {
    width: 8px;
    height: 8px;
    stroke-width: 1.4;
  }

  .drop {
    display: grid;
    place-items: center;
    width: 14px;
    height: 14px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--muted);
    font-size: var(--text-sm);
    line-height: 1;
    cursor: default;
  }

  @media (hover: hover) {
    .drop:hover {
      background: var(--surface-hover);
      color: var(--text-strong);
    }
  }

  /* Grows to a few lines and then scrolls: a message is sometimes a paragraph, and the
     conversation above it is what the room is for. */
  .composer textarea {
    flex: none;
    width: 100%;
    min-height: 1.45em;
    max-height: 12rem;
    padding: 2px var(--space-2) 4px;
    color: var(--text-strong);
    font-size: var(--text-row);
    line-height: 1.45;
    resize: none;
    field-sizing: content;
  }

  .controls {
    container-type: inline-size;
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
  }

  .gap {
    flex: 1;
  }

  .plus {
    width: var(--row-height-sm);
    height: var(--row-height-sm);
    border-radius: 50%;
  }

  .plus svg {
    stroke-width: 1.4;
  }

  /* The mode, always said, since a mode is never none and one of them acts on its own:
     its mark, its name and the caret of a menu, as the model is said beside it. */
  .mode {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: var(--row-height-sm);
    padding: 0 4px 0 var(--space-1);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .mode:hover:not(:disabled) {
      background: var(--surface-hover);
      color: var(--text-strong);
    }
  }

  /* A narrow side keeps the model's name whole and says the mode by its mark alone,
     its name a hover away (the tooltip and the menu). */
  @container (max-width: 17rem) {
    .mode span {
      display: none;
    }
  }

  .mode .caret {
    width: 11px;
    height: 11px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* The one round button: filled while it can do something, its glyph changing with
     what that is. */
  .go {
    flex: none;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    margin-inline-start: 2px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--text-strong);
    color: var(--bg);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      scale var(--dur-fast) var(--ease-out);
  }

  .go:disabled {
    background: var(--surface-hover);
    color: var(--muted);
  }

  .go:active:not(:disabled) {
    scale: 0.92;
  }

  .go svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .go .square {
    fill: currentColor;
    stroke: none;
  }

  /* Listening: the accent, and a ring breathing out of it. */
  .go.listening {
    background: var(--accent);
    color: var(--accent-ink);
    animation: listen calc(var(--dur-slow) * 4) var(--ease-out) infinite;
  }

  .go.hearing {
    animation: breathe calc(var(--dur-slow) * 3) var(--ease-in-out) infinite;
  }

  @keyframes listen {
    0% {
      box-shadow: 0 0 0 0 var(--accent-line);
    }
    100% {
      box-shadow: 0 0 0 7px transparent;
    }
  }

  @keyframes breathe {
    50% {
      opacity: 0.45;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .go.listening,
    .go.hearing {
      animation: none;
    }
  }

  .files {
    display: none;
  }

  :global([data-touch]) .composer textarea {
    font-size: var(--text-base);
  }
</style>
