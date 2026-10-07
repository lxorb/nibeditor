<script lang="ts">
  /** The chat itself: its rows in a measured window (docs/chats.md 4.15, 4.17).
   *
   *  Only the rows near the screen are in the page, about sixty, with two boxes standing
   *  in for the rest; every row starts at a height guessed from what it says and is
   *  measured once drawn (window.ts, estimate.ts). Where the reader is looking is held
   *  still across everything that moves rows: history paging in above, a picture's row
   *  settling, an edit. At the bottom it stays at the bottom as messages arrive; scrolled
   *  up, a pill says how many are below. It opens at the New line, with a pill above
   *  while that line is off screen, and reads to where the reader has looked.
   *
   *  Keyboard first: Tab from the composer lands on the rows, ↑ and ↓ walk them, and R,
   *  Q, E, P, S, Delete and + act on the lit one (4.16). A screen reader hears it as a
   *  log, arrivals spoken politely. */
  import type { Message } from '@nib/chats'
  import { may } from '@nib/chats'
  import { onMount, untrack } from 'svelte'
  import { fade } from 'svelte/transition'
  import { amount, t } from '../../i18n.svelte'
  import { dur } from '../../motion'
  import { longPress } from '../../longpress'
  import { menu } from '../../menu.svelte'
  import type { ChatPage } from './chat.svelte'
  import { estimate } from './estimate'
  import Glyph from './Glyph.svelte'
  import HoverBar from './HoverBar.svelte'
  import { messageMenu } from './message-menu'
  import MessageRow from './MessageRow.svelte'
  import { dayLine } from './when'
  import { type Anchor, anchorAt, anchored, Heights } from './window'

  const {
    page,
    space,
    onreply,
    onquote,
    onedit,
    onpicker,
    onfiles,
    oncompose,
  }: {
    page: ChatPage
    space: string | null
    onreply: (message: Message) => void
    onquote: (message: Message) => void
    onedit: (message: Message) => void
    onpicker: (message: Message, from: HTMLElement) => void
    onfiles: (message: Message, index: number) => void
    /** The keyboard back to the composer. */
    oncompose: () => void
  } = $props()

  /** Rows kept beyond either edge, in pixels. */
  const OVERSCAN = 700
  /** Rows from either end at which the next page is asked for. */
  const NEAR = 25

  let scroller = $state<HTMLElement>()
  let content = $state<HTMLElement>()
  let top = $state(0)
  let room = $state(0)
  let width = $state(0)
  /** Bumped when a row's measured height changed the window. */
  let version = $state(0)
  /** Whether the reader is at the bottom, which keeps them there. */
  let stuck = $state(true)
  let lit = $state<string | null>(null)
  let hovered = $state<{ id: string; top: number } | null>(null)

  /** Heights as drawn, by row, kept across windows. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- measurements, read when a window is built
  const measured = new Map<string, number>()
  /** The row being read and where it sits, for holding still. */
  let anchor: Anchor | null = null
  /** Where the next settle should put the reader, once. */
  let target: { key: string; where: 'line' | 'centre' } | null = null
  /** Messages newer than this rise in as they arrive. */
  let arrivedAfter = $state(Number.MAX_SAFE_INTEGER)

  const role = $derived(page.view.role)
  const canPost = $derived(may(role, 'post', page.view.meta.posting))
  const column = $derived(Math.max(160, width - 72))

  const layout = $derived.by(() => {
    const items = page.items
    const across = width
    return untrack(() => {
      const keys = items.map((item) => item.key)
      return {
        items,
        keys,
        heights: new Heights(items.map((item) => measured.get(item.key) ?? estimate(item, across))),
        index: new Map(keys.map((key, at) => [key, at])),
      }
    })
  })

  /** The rows in the page and the two boxes standing in for the rest. `_measured` is
   *  how many times a height was measured, which the window's own numbers cannot say
   *  to anything that draws from them. */
  function windowAt(_measured: number, at: number, shown: number) {
    const { heights } = layout
    const { from, to } = heights.span(at, shown, OVERSCAN)
    return { from, to, above: heights.top(from), below: heights.total - heights.top(to) }
  }

  const span = $derived(windowAt(version, top, room))

  // One observer for every row in the page: a height that changed is written into the
  // window, and the reader held still across it.
  const observer = new ResizeObserver((entries) => {
    let changed = false
    for (const entry of entries) {
      const node = entry.target as HTMLElement
      const key = node.dataset.key
      if (key === undefined) continue
      const height = entry.borderBoxSize[0]?.blockSize ?? node.offsetHeight
      if (measured.get(key) === height) continue
      measured.set(key, height)
      const at = layout.index.get(key)
      if (at !== undefined && layout.heights.set(at, height) !== 0) changed = true
    }
    if (changed) version += 1
  })

  function measure(node: HTMLElement, key: string) {
    node.dataset.key = key
    observer.observe(node)
    return {
      update(next: string) {
        node.dataset.key = next
      },
      destroy() {
        observer.unobserve(node)
      },
    }
  }

  onMount(() => () => observer.disconnect())

  /** Puts the scroll where it belongs after anything moved: a target asked for, the
   *  bottom while stuck to it, or the anchored row where it was. */
  function settle() {
    const box = scroller
    if (!box || !page.ready) return
    const { heights, index, keys } = layout
    if (target) {
      const at = index.get(target.key)
      if (at !== undefined) {
        const rowTop = heights.top(at)
        const y =
          target.where === 'centre'
            ? rowTop - room / 2 + heights.heightOf(at) / 2
            : rowTop - Math.min(120, room * 0.25)
        box.scrollTop = Math.max(0, y)
        stuck = box.scrollTop + box.clientHeight >= box.scrollHeight - 4
        anchor = { key: target.key, offset: rowTop - box.scrollTop }
        target = null
      }
    } else if (stuck) {
      box.scrollTop = box.scrollHeight
    } else {
      const y = anchored(heights, keys, anchor)
      if (y !== null && Math.abs(y - box.scrollTop) >= 1) box.scrollTop = y
    }
    top = box.scrollTop
  }

  /** Settles once whatever was measured or held has been drawn. */
  function settleAfter(_measured: number, _held: unknown) {
    untrack(settle)
  }

  $effect(() => settleAfter(version, layout))

  // The first page in: at the New line where there is one, else at the bottom.
  let opened = false
  $effect(() => {
    if (!page.ready || opened) return
    opened = true
    untrack(() => {
      arrivedAfter = page.entry?.lastSeq ?? 0
      if (layout.index.has('new')) {
        target = { key: 'new', where: 'line' }
        stuck = false
      }
      settle()
    })
  })

  // A jump: to the row, in the middle, tinted.
  $effect(() => {
    const id = page.flashed
    if (!id) return
    untrack(() => {
      target = { key: id, where: 'centre' }
      settle()
    })
    const done = setTimeout(() => (page.flashed = null), 1400)
    return () => clearTimeout(done)
  })

  function onscroll() {
    const box = scroller
    if (!box) return
    top = box.scrollTop
    stuck = box.scrollTop + box.clientHeight >= box.scrollHeight - 4
    anchor = anchorAt(layout.heights, layout.keys, top)
    hovered = null
  }

  // The next page as either end comes near.
  $effect(() => {
    const { from, to } = span
    const count = layout.items.length
    if (!page.ready) return
    untrack(() => {
      if (from < NEAR && page.before) void page.older()
      if (to > count - NEAR && page.after) void page.newer()
    })
  })

  /** The newest message on screen, told as read while the window is in front. */
  function readOnScreen() {
    if (typeof document === 'undefined' || document.hidden || !document.hasFocus()) return
    const last = layout.heights.at(top + room - 8)
    for (let at = Math.min(last, layout.items.length - 1); at >= 0; at--) {
      const item = layout.items[at]
      if (item?.kind === 'message' && !item.pending) {
        if (!page.after || at < layout.items.length - 1) page.seen(item.message.seq)
        return
      }
    }
  }

  /** Reads to the screen once a window is drawn. */
  function readAfter(_shown: unknown, _held: unknown) {
    untrack(readOnScreen)
  }

  $effect(() => readAfter(span, layout))

  /** The New line's row, and the messages under it, for the pill above. */
  const newAt = $derived(layout.index.get('new'))
  const newAbove = $derived(lineAbove(version, top))
  const unreadBelow = $derived(unreadUnder(version, top, stuck))

  function lineAbove(_measured: number, at: number): boolean {
    return newAt !== undefined && layout.heights.top(newAt) < at - 8
  }

  function unreadUnder(_measured: number, at: number, bottom: boolean): number {
    if (bottom) return 0
    const last = layout.heights.at(at + room)
    let count = 0
    for (let row = last + 1; row < layout.items.length; row++) {
      const item = layout.items[row]
      if (item?.kind === 'message' && item.message.seq > (page.entry?.readSeq ?? 0)) count += 1
    }
    return count
  }

  /** Ctrl+J: to the New line. */
  export function toNew(): void {
    if (newAt === undefined) return
    target = { key: 'new', where: 'line' }
    settle()
  }

  /** To the bottom, and everything read: Escape's, and the pill's below. */
  export async function toBottom(): Promise<void> {
    if (page.after) await page.bottom()
    stuck = true
    lit = null
    settle()
  }

  /** The keyboard on the rows, the newest lit: Tab from the composer. */
  export function focusRows(): void {
    const last = [...layout.items].reverse().find((item) => item.kind === 'message')
    lit = last?.key ?? null
    scroller?.focus()
  }

  const messages = $derived(
    layout.items.flatMap((item) => (item.kind === 'message' ? [item.message] : [])),
  )
  const litMessage = $derived(messages.find((one) => one.id === lit) ?? null)

  function step(by: number) {
    const at = messages.findIndex((one) => one.id === lit)
    const next =
      messages[Math.min(messages.length - 1, Math.max(0, (at === -1 ? messages.length : at) + by))]
    if (!next) return
    lit = next.id
    target = { key: next.id, where: 'centre' }
    const row = layout.index.get(next.id)
    // Only scrolled to when it is not already on screen.
    if (row !== undefined) {
      const rowTop = layout.heights.top(row)
      if (rowTop >= top && rowTop + layout.heights.heightOf(row) <= top + room) target = null
    }
    if (target) settle()
  }

  function onKey(event: KeyboardEvent) {
    if (event.target !== scroller || event.altKey || event.ctrlKey || event.metaKey) return
    const one = litMessage
    const act = (run: () => void) => {
      event.preventDefault()
      run()
    }
    switch (event.key) {
      case 'ArrowUp':
        return act(() => step(-1))
      case 'ArrowDown':
        return act(() => step(1))
      case 'Escape':
        return act(() => {
          void toBottom()
          oncompose()
        })
    }
    if (!one || one.deleted) return
    const mine = one.author === page.me
    switch (event.key.toLowerCase()) {
      case 'r':
        return canPost ? act(() => onreply(one)) : undefined
      case 'q':
        return canPost ? act(() => onquote(one)) : undefined
      case 'e':
        return mine ? act(() => onedit(one)) : undefined
      case 'p':
        return act(() => page.pin(one))
      case 's':
        return act(() => page.save(one))
      case 'delete':
      case 'backspace':
        return mine ? act(() => page.remove(one.id)) : undefined
      case '+':
        return canPost
          ? act(() => {
              const row = content?.querySelector(`[data-message="${one.id}"]`)
              if (row instanceof HTMLElement) onpicker(one, row)
            })
          : undefined
    }
  }

  function showMenu(event: MouseEvent, message: Message) {
    menu.show(
      event,
      messageMenu(page, message, role, {
        reply: () => onreply(message),
        quote: () => onquote(message),
        edit: () => onedit(message),
      }),
    )
  }

  /** The row under the pointer, for the one hover bar. */
  function pointing(event: PointerEvent) {
    if (event.pointerType !== 'mouse') return
    const row = (event.target as Element | null)?.closest('[data-message]')
    if (!(row instanceof HTMLElement) || !content) return
    const id = row.dataset.message
    if (!id || hovered?.id === id) return
    const message = messages.find((one) => one.id === id)
    if (
      !message ||
      message.deleted ||
      layout.items.some((one) => one.key === id && one.kind === 'message' && one.pending)
    ) {
      hovered = null
      return
    }
    const slot = row.parentElement
    hovered = { id, top: (slot?.offsetTop ?? 0) + (row.classList.contains('head') ? 12 : 2) }
  }

  const hoveredMessage = $derived(hovered ? messages.find((one) => one.id === hovered?.id) : null)

  function longPressed(event: MouseEvent) {
    const row = (event.target as Element | null)?.closest('[data-message]')
    const id = row instanceof HTMLElement ? row.dataset.message : undefined
    const message = messages.find((one) => one.id === id)
    if (message) showMenu(event, message)
  }
</script>

<svelte:window onfocus={readOnScreen} />

<div class="timeline">
  <!-- The rows take the keyboard as one list, the arrows walking them (4.16). -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="scroller nib-scrolls"
    bind:this={scroller}
    bind:clientHeight={room}
    bind:clientWidth={width}
    {onscroll}
    onkeydown={onKey}
    onpointermove={pointing}
    onpointerleave={() => (hovered = null)}
    use:longPress={longPressed}
    role="log"
    aria-live="polite"
    aria-label={page.entry?.name ?? ''}
    tabindex="0"
  >
    <div class="content" bind:this={content}>
      <div style:height="{span.above}px"></div>
      {#each layout.items.slice(span.from, span.to) as item (item.key)}
        <div class="slot" use:measure={item.key}>
          {#if item.kind === 'day'}
            <div class="day" role="separator"><span>{dayLine(item.at)}</span></div>
          {:else if item.kind === 'new'}
            <div class="new" role="separator"><span>{t('New')}</span></div>
          {:else}
            <MessageRow
              message={item.message}
              head={item.head}
              pending={item.pending}
              seen={item.seen}
              {page}
              {space}
              {column}
              lit={lit === item.key}
              flashed={page.flashed === item.key}
              {arrivedAfter}
              {canPost}
              {onreply}
              onreact={onpicker}
              onmenu={showMenu}
              {onfiles}
            />
          {/if}
        </div>
      {/each}
      <div style:height="{span.below}px"></div>
      {#if hoveredMessage && hovered}
        <HoverBar
          message={hoveredMessage}
          top={hovered.top}
          {canPost}
          onreact={(emoji: string) => page.react(hoveredMessage, emoji)}
          onpicker={(from: HTMLElement) => onpicker(hoveredMessage, from)}
          onreply={() => onreply(hoveredMessage)}
          onquote={() => onquote(hoveredMessage)}
          onmenu={(event: MouseEvent) => showMenu(event, hoveredMessage)}
        />
      {/if}
    </div>
  </div>

  {#if newAbove}
    <button
      type="button"
      class="jump above nib-pill is-pressable"
      onclick={toNew}
      transition:fade={{ duration: dur(130) }}
    >
      <Glyph name="up" />
      <span>{t('New')}</span>
    </button>
  {/if}
  {#if !stuck && (unreadBelow > 0 || page.after)}
    <button
      type="button"
      class="jump below nib-pill is-pressable"
      aria-label={t('New')}
      onclick={() => void toBottom()}
      transition:fade={{ duration: dur(130) }}
    >
      <Glyph name="down" />
      {#if unreadBelow > 0}<span>{amount(unreadBelow)}</span>{/if}
    </button>
  {/if}
</div>

<style>
  .timeline {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
  }

  .scroller {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-anchor: none;
  }

  .content {
    position: relative;
    padding-bottom: var(--space-2);
  }

  .day,
  .new {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4) var(--space-1);
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
  }

  .day::before,
  .day::after,
  .new::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--line);
  }

  .new {
    padding-top: var(--space-1);
    color: var(--accent);
  }

  .new::after {
    background: var(--accent-line);
    order: -1;
  }

  /* Where the two pills sit; what they look like is `.nib-pill` in the themes package. */
  .jump {
    --glyph-size: 14px;
    position: absolute;
    left: 50%;
    translate: -50% 0;
  }

  .jump.above {
    top: var(--space-2);
  }

  .jump.below {
    bottom: var(--space-3);
  }
</style>
