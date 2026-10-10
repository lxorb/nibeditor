<script lang="ts">
  /** A chat's head (docs/chats.md 4.15): its name and topic, who is in it, and what is
   *  pinned, and what pings for it. The topic is written in place by whoever may set it; the
   *  faces open the members, active first; the pin opens the pinned messages, each a jump;
   *  the bell is the chat's level and mute (../Bell.svelte, 4.11); the glass searches the
   *  chat, in the palette with the chat filled in. */
  import type { Message, Notify } from '@nib/chats'
  import { may } from '@nib/chats'
  import { LONGEST_TOPIC } from '@nib/chats/limits'
  import { amount, t } from '../../i18n.svelte'
  import Avatar from '../../people/Avatar.svelte'
  import Bell from '../Bell.svelte'
  import { showProfile } from '../../people/card.svelte'
  import { people } from '../../people/people.svelte'
  import { shortcuts } from '../../shortcuts.svelte'
  import type { ChatPage } from './chat.svelte'
  import Float from './Float.svelte'
  import ChatMark from './ChatMark.svelte'
  import Glyph from './Glyph.svelte'
  import { firstLine } from './body'
  import { accountOf, faceOf, nameOf } from './people'
  import type { Box } from './place'
  import { store } from './source.svelte'
  import { tip } from './tips.svelte'

  const { page, space }: { page: ChatPage; space: string | null } = $props()

  let writing = $state(false)
  let topic = $state('')
  let showing = $state<{ what: 'members' | 'pins'; at: Box } | null>(null)
  let pinned = $state.raw<Message[]>([])

  const meta = $derived(page.view.meta)
  const canTopic = $derived(may(page.view.role, 'topic', meta.posting))
  const ids = $derived(
    page.members.flatMap((one) => {
      const id = accountOf(one.who)
      return id ? [id] : []
    }),
  )
  /** Active first, then away, then the rest; by name within each. */
  const members = $derived(
    [...page.members].sort((a, b) => {
      const rank = (who: typeof a.who) => {
        const id = accountOf(who)
        const presence = id ? people.of(id)?.presence : undefined
        return presence === 'active' ? 0 : presence === 'away' ? 1 : 2
      }
      return (
        rank(a.who) - rank(b.who) ||
        nameOf(a.who, page.members, space).localeCompare(nameOf(b.who, page.members, space))
      )
    }),
  )

  $effect(() => {
    const list = ids
    return people.watch(() => list)
  })

  function boxOf(element: Element): Box {
    const box = element.getBoundingClientRect()
    return { left: box.left, top: box.top, right: box.right, bottom: box.bottom }
  }

  async function showPins(element: Element) {
    pinned = await page.pinned()
    showing = { what: 'pins', at: boxOf(element) }
  }

  function startTopic() {
    if (!canTopic) return
    topic = meta.topic
    writing = true
  }

  function keepTopic() {
    writing = false
    if (topic.trim() !== meta.topic) page.topic(topic.trim())
  }
</script>

<header class="head">
  <span class="mark"><ChatMark path={page.entry?.path} /></span>
  <h2 class="name">{page.entry?.name ?? ''}</h2>
  {#if writing}
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="topic-field"
      bind:value={topic}
      maxlength={LONGEST_TOPIC}
      aria-label={t('Topic')}
      autofocus
      onblur={keepTopic}
      onkeydown={(event) => {
        if (event.key === 'Enter') keepTopic()
        else if (event.key === 'Escape') {
          event.stopPropagation()
          writing = false
        }
      }}
    />
  {:else}
    <button
      type="button"
      class="topic"
      class:empty={!meta.topic}
      disabled={!canTopic}
      onclick={startTopic}>{meta.topic || (canTopic ? t('Topic') : '')}</button
    >
  {/if}
  <span class="grow"></span>
  <button
    type="button"
    class="people"
    aria-label={t('Members')}
    use:tip={() => t('Members')}
    onclick={(event) => (showing = { what: 'members', at: boxOf(event.currentTarget) })}
  >
    <span class="faces" aria-hidden="true">
      {#each members.slice(0, 3) as one (one.who)}
        <span class="face"><Avatar face={faceOf(one.who, page.members, space)} size={20} /></span>
      {/each}
    </span>
    <span class="count">{amount(page.members.length)}</span>
  </button>
  <button
    type="button"
    class="nib-glyph"
    aria-label={t('Pinned')}
    use:tip={() => t('Pinned')}
    onclick={(event) => void showPins(event.currentTarget)}><Glyph name="pin" /></button
  >
  <Bell
    notify={page.entry?.notify ?? null}
    mutedUntil={page.entry?.mutedUntil ?? null}
    members={page.entry?.members ?? page.members.length}
    onchange={(notify: Notify | null, mutedUntil: number | null) =>
      void store().notifyFor(page.id, notify, mutedUntil)}
  />
  <button
    type="button"
    class="nib-glyph"
    aria-label={t('Search this chat')}
    use:tip={() => shortcuts.tooltip(t('Search this chat'), 'chat.search')}
    onclick={() => page.search()}><Glyph name="search" /></button
  >
</header>

<Float
  at={showing?.at ?? null}
  end
  width="280px"
  label={showing?.what === 'pins' ? t('Pinned') : t('Members')}
  onclose={() => (showing = null)}
>
  <div class="list nib-scrolls">
    {#if showing?.what === 'members'}
      {#each members as one (one.who)}
        {@const id = accountOf(one.who)}
        <button
          type="button"
          class="nib-row"
          onclick={(event) => {
            if (id) showProfile(id, event.currentTarget, space)
          }}
        >
          <span class="nib-row-mark">
            <Avatar
              face={faceOf(one.who, page.members, space)}
              size={24}
              presence={id ? (people.of(id)?.presence ?? null) : null}
            />
          </span>
          <span class="nib-row-label">{nameOf(one.who, page.members, space)}</span>
          {#if id && people.of(id)?.status?.emoji}
            <span class="nib-row-meta">{people.of(id)?.status?.emoji}</span>
          {/if}
        </button>
      {/each}
    {:else if showing?.what === 'pins'}
      {#each pinned as one (one.id)}
        <button
          type="button"
          class="pin"
          onclick={() => {
            showing = null
            void page.jump(one.id)
          }}
        >
          <strong>{nameOf(one.author, page.members, space)}</strong>
          <span>{firstLine(one.body) || '…'}</span>
        </button>
      {:else}
        <p class="none"><Glyph name="pin" /></p>
      {/each}
    {/if}
  </div>
</Float>

<style>
  .head {
    --glyph-size: 16px;
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 44px;
    padding: 0 var(--space-2) 0 var(--space-4);
    border-bottom: 1px solid var(--line);
    font-family: var(--font-ui);
  }

  .mark {
    color: var(--muted);
  }

  .name {
    margin: 0;
    color: var(--text-strong);
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    white-space: nowrap;
  }

  .topic,
  .topic-field {
    min-width: 0;
    max-width: 50%;
    flex: 0 1 auto;
    padding: 2px var(--space-2);
    border: 1px solid transparent;
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: var(--text-sm);
    text-align: start;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .topic-field {
    flex: 1;
    max-width: none;
    border-color: var(--accent-line);
    background: var(--bg);
    color: var(--text);
    outline: none;
  }

  @media (hover: hover) {
    .topic:hover:not(:disabled) {
      border-color: var(--line);
    }
  }

  .topic.empty {
    opacity: 0.6;
  }

  .grow {
    flex: 1;
  }

  .people {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    height: var(--row-height);
    padding: 0 var(--space-2);
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    transition: background var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .people:hover {
      background: var(--surface-hover);
    }
  }

  /* The first few people, each over the one before, ringed in the ground as the
     switcher's faces are (people/Faces.svelte). */
  .faces {
    display: inline-flex;
  }

  .face {
    display: inline-flex;
    border-radius: 50%;
    box-shadow: 0 0 0 1.5px var(--bg);
  }

  .face + .face {
    margin-inline-start: -6px;
  }

  .list {
    overflow-y: auto;
    padding: var(--space-1);
  }

  .pin {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    padding: var(--space-2);
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--text);
    font: inherit;
    font-size: var(--text-sm);
    text-align: start;
  }

  @media (hover: hover) {
    .pin:hover {
      background: var(--surface-hover);
    }
  }

  .pin span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted-strong);
  }

  .none {
    --glyph-size: 20px;
    display: grid;
    place-items: center;
    margin: var(--space-4) 0;
    color: var(--muted);
    opacity: 0.5;
  }
</style>
