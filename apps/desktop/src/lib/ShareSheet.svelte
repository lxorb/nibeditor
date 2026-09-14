<script lang="ts">
  /** Who else is in a space: the people and what each may do, the address field
   *  that puts somebody new in, the one link, and whoever is waiting to be let
   *  in. One sheet, because they are one question.
   *
   *  Two cards, in the order the question is actually asked: people first, since
   *  naming somebody is what sharing usually means, and the link second, since it
   *  is one switch about everybody at once. That is Proton Drive's shape; the
   *  clarity inside each row - a face, a name, an address under it, and what they
   *  may do as a menu at the far end - is Google's. Both are drawn in nib's own
   *  rows, tokens and motion, so it is one design on a desktop and under a thumb
   *  rather than two.
   *
   *  Nothing here is confirmed: every change is asked of the server as it is made,
   *  so there is no Done button. The cross, Escape, back and the scrim all close
   *  it. Drawn in the box every space sheet is drawn in; see Sheet.svelte. */
  import { fade, scale } from 'svelte/transition'
  import { accentFor } from './accents'
  import { fileMark } from './file-mark'
  import { t } from './i18n.svelte'
  import { initial } from './icons'
  import { shownName } from './note-name'
  import { nameOf } from './space-paths'
  import { isShared, share } from './sharing.svelte'
  import { theme } from './theme.svelte'
  import { called } from './person'
  import type { GivenRole, Member, Sharing } from './api'
  import Copyable from './Copyable.svelte'
  import FileMark from './FileMark.svelte'
  import Select from './Select.svelte'
  import Sheet from './Sheet.svelte'
  import SpaceMark from './SpaceMark.svelte'
  import { dur } from './motion'

  /** What somebody may do, as the two words a person reads rather than the two
   *  the wire uses. */
  const ROLES = $derived([
    { value: 'write', label: t('can edit') },
    { value: 'read', label: t('can view') },
  ])

  const who = $derived(share.who)
  const link = $derived(who?.link ?? null)

  /** The one file this sheet is about, where it is about one file rather than the
   *  whole space. */
  const item = $derived(share.item)

  /** What the head says it is about: the file's name, else the space's. The same
   *  words and the same shape for both - a smaller thing to share is not a
   *  different sheet. */
  const subject = $derived(item ? shownName(nameOf(item.path)) : (share.space?.name ?? ''))

  /** Whether the space this file sits in is already shared with somebody, which
   *  is what the hint under the head is about. */
  const alreadyInTheSpace = $derived(!!share.space && isShared(share.space.root))

  /** Somebody waiting to be let in, of either kind. */
  type Waiting = Sharing['requests'][number]

  /** What to call somebody in a list where a guest has no account to name them.
   *  A guest is given a name by their device and may change it, so there is
   *  always one; a member without an account yet is named by their address. */
  function name(person: Member | Waiting): string {
    return person.email ? called({ name: person.name, email: person.email }) : (person.name ?? '')
  }

  /** The line under the name. For a member it is the address, which is who they
   *  actually are, and whether anybody has opened the space under it yet. For a
   *  guest it is the word: a link is how they got here, and anything they typed
   *  about themselves is what they said rather than what was proved. */
  function subtitle(person: Member): string {
    if (person.guest) return person.email ? `${person.email} · ${t('Guest')}` : t('Guest')
    return person.pending ? `${person.email} · ${t('Invited')}` : (person.email ?? '')
  }

  /** What names a row, whichever kind of person it is. The same key the store
   *  says a request is about, so the row being changed is the row that shows it. */
  const keyOf = (person: Member | Waiting) => `person:${person.guest ?? person.email ?? ''}`

  /** The colour of the square with their initial in it. Derived from whatever
   *  names them, so a person is one colour on every device; see accents.ts. */
  const colourOf = (person: Member | Waiting) =>
    accentFor(person.email ?? person.guest ?? '', theme.current)

  /** Everything that can be done to one person, in one menu at the end of their
   *  row: what they may do, the invitation again if they have not opened it, and
   *  taking them out. One control per row rather than a picker and a cross.  */
  function menuFor(person: Member) {
    return [
      ...ROLES,
      ...(person.pending && person.email ? [{ value: 'resend', label: t('Resend') }] : []),
      { value: 'remove', label: t('Remove'), danger: true },
    ]
  }

  function chose(person: Member, choice: string) {
    if (choice === 'remove') void share.remove(person)
    else if (choice === 'resend') void share.resend(person)
    else void share.setRole(person, choice as GivenRole)
  }

  /** Turning the link on hands out reading and asks the owner first, which is the
   *  careful half of both choices; the row and the switch under it are how it is
   *  opened up. Turning it off revokes it, so the address stops opening anything. */
  function toggleLink() {
    if (share.busy) return
    if (link) void share.revoke()
    else void share.setLink('read', 'approval')
  }

  function toggleAsking() {
    if (!link || share.busy) return
    void share.setLink(link.role, link.mode === 'approval' ? 'open' : 'approval')
  }
</script>

<Sheet open={share.open} title={t('Share {name}', { name: subject })} onclose={() => share.close()}>
  {#snippet mark()}
    <!-- What the sheet is about wears its own mark: the space's badge, or - for one
         file of it - the mark that file wears on its row in the tree, chosen icon
         and all. Same box either way; see FileMark.svelte. -->
    {#if item}
      <FileMark mark={fileMark(item.path)} path={item.path} />
    {:else}
      <SpaceMark id={share.spaceId} name={share.space?.name ?? ''} />
    {/if}
  {/snippet}

  {#if share.error}
    <p class="wrong">{share.error}</p>
  {/if}

  {#if item && alreadyInTheSpace}
    <!-- Two levels, one sentence, so neither is a surprise: this note can be
         handed to one person, and everybody already in the space has it whatever
         this sheet says. Only where the space actually is shared - a line that is
         always there is a line nobody reads. -->
    <p class="note">{t('Everyone in the space already has it.')}</p>
  {/if}

  <!-- ── The people ───────────────────────────────────────────────
       The field first, because putting somebody in is what the sheet is opened
       for. It is there from the first frame, before the list it belongs to has
       arrived: it is where the keyboard lands, it is what somebody came here to
       type in, and a field that appears a moment later is a field somebody has
       already started typing past. -->
  <div class="card">
    <form
      class="nib-field compose"
      class:bad={share.wrongAddress}
      onsubmit={(event) => {
        event.preventDefault()
        void share.invite()
      }}
    >
      <input
        data-lands
        bind:value={share.email}
        oninput={() => (share.wrongAddress = false)}
        type="text"
        inputmode="email"
        placeholder={t('Add people by email')}
        aria-label={t('Add people by email')}
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
      />
      <div class="pick">
        <Select
          value={share.role}
          options={ROLES}
          onchange={(role: string) => (share.role = role as GivenRole)}
          label={t('Role')}
          plain
        />
      </div>
      {#if share.email.trim()}
        <!-- Enter does this too; the button is for a thumb, which has no
               Enter, and for anybody who wants to see where the press goes. -->
        <button
          type="submit"
          class="send"
          aria-label={t('Invite')}
          title={t('Invite')}
          disabled={share.busy}
          transition:scale={{ duration: dur(130), start: 0.6 }}
        >
          <svg class="nib-mirror" viewBox="0 0 14 14"><path d="M2.5 7h9M7.6 3l4 4-4 4" /></svg>
        </button>
      {/if}
    </form>

    {#if share.wrongAddress}
      <p class="hint bad" transition:fade={{ duration: dur(130) }}>
        {t('enter a valid email address')}
      </p>
    {/if}

    {#if !who}
      <!-- The shape of the rows while they are on their way, so the card is
           already the size it is about to be and they arrive in place rather than
           pushing the link under them down as they land. -->
      <div aria-hidden="true">
        {#each [0, 1, 2] as row (row)}
          <div class="row person">
            <span class="bone face"></span>
            <span class="name">
              <span class="bone words"></span>
              <span class="bone under"></span>
            </span>
            <span class="bone control"></span>
          </div>
        {/each}
      </div>
    {:else}
      <!-- Somebody has followed a link that asks first. At the top of the card,
           because it is the one thing here that is waiting on an answer. -->
      {#if who.requests.length}
        <h3>{t('Waiting')}</h3>
        {#each who.requests as person (keyOf(person))}
          <div
            class="row person asking"
            class:waiting={share.waiting(keyOf(person))}
            transition:fade={{ duration: dur(130) }}
          >
            <span
              class="nib-badge"
              style:--badge-fill={colourOf(person)}
              style:--badge-ink="#fff"
              aria-hidden="true">{initial(name(person))}</span
            >
            <span class="name">
              {name(person)}
              <small>{person.email ?? t('Guest')}</small>
            </span>
            <button class="pill" disabled={share.busy} onclick={() => void share.accept(person)}>
              {t('Accept')}
            </button>
            <button
              class="pill quiet"
              disabled={share.busy}
              onclick={() => void share.decline(person)}
            >
              {t('Decline')}
            </button>
          </div>
        {/each}
      {/if}

      <h3>{t('Who has access')}</h3>

      <div class="row person">
        <span
          class="nib-badge"
          style:--badge-fill={accentFor(who.owner.email, theme.current)}
          style:--badge-ink="#fff"
          aria-hidden="true">{initial(called(who.owner))}</span
        >
        <span class="name">
          <span class="named">{called(who.owner)} <small class="you">{t('(you)')}</small></span>
          <small>{who.owner.email}</small>
        </span>
        <span class="fixed">{t('Owner')}</span>
      </div>

      {#each who.members as person (keyOf(person))}
        <div
          class="row person"
          class:waiting={share.waiting(keyOf(person))}
          transition:fade={{ duration: dur(130) }}
        >
          <!-- Somebody who has not opened the space yet wears their colour
               faintly: they are in the list, and they are not here. -->
          <span
            class="nib-badge"
            style:--badge-fill={person.pending ? 'var(--surface-3)' : colourOf(person)}
            style:--badge-ink={person.pending ? colourOf(person) : '#fff'}
            aria-hidden="true">{initial(name(person))}</span
          >
          <span class="name">
            {name(person)}
            <small>{subtitle(person)}</small>
          </span>
          <div class="pick">
            <Select
              value={person.role}
              options={menuFor(person)}
              onchange={(choice: string) => chose(person, choice)}
              label={t('Role')}
              plain
              disabled={share.busy}
            />
          </div>
        </div>
      {/each}
    {/if}
  </div>

  {#if who}
    <!-- ── The link ───────────────────────────────────────────────
         One switch about everybody at once. What it hands out and whether it
         asks first stay where they are while it is off, greyed: the card does
         not change shape as it is turned on, it comes to life. -->
    <div class="card">
      <div
        class="row card-head"
        role="switch"
        tabindex="0"
        aria-checked={!!link}
        aria-label={t('Link')}
        onclick={toggleLink}
        onkeydown={(event) => {
          if (event.key !== ' ' && event.key !== 'Enter') return
          event.preventDefault()
          toggleLink()
        }}
      >
        <span class="name">{t('Link')}</span>
        <span class="dot" class:on={!!link} aria-hidden="true"></span>
        <span class="nib-switch" class:on={!!link} aria-hidden="true"></span>
      </div>

      <hr class="line" />

      <div class="linkbody" class:off={!link}>
        <div class="row">
          <span class="nib-badge" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18M12 3c2.6 2.6 2.6 15.4 0 18M12 3c-2.6 2.6-2.6 15.4 0 18" />
            </svg>
          </span>
          <span class="name">{t('Anyone with the link')}</span>
          <div class="pick">
            <Select
              value={link?.role ?? 'read'}
              options={ROLES}
              onchange={(role: string) =>
                void share.setLink(role as GivenRole, link?.mode ?? 'approval')}
              label={t('Role')}
              plain
              disabled={!link || share.busy}
            />
          </div>
        </div>

        <div
          class="row"
          role="switch"
          tabindex={link ? 0 : -1}
          aria-checked={link?.mode === 'approval'}
          aria-label={t('Ask first')}
          onclick={toggleAsking}
          onkeydown={(event) => {
            if (event.key !== ' ' && event.key !== 'Enter') return
            event.preventDefault()
            toggleAsking()
          }}
        >
          <span class="under" aria-hidden="true"></span>
          <span class="name asks">{t('Ask first')}</span>
          <span class="nib-switch" class:on={link?.mode === 'approval'} aria-hidden="true"></span>
        </div>

        <div class="row">
          <Copyable value={link?.url ?? ''} word={t('Copy link')} disabled={!link} />
        </div>

        <button
          class="action danger"
          disabled={!link || share.busy}
          onclick={() => link && void share.reset(link.role, link.mode)}
        >
          {t('Reset link')}
        </button>
      </div>
    </div>
  {/if}
</Sheet>

<style>
  /* ── The field that puts somebody in ─────────────────────────────
     The app's one field shape, with three things inside it: what is typed, what
     they will be allowed to do, and the press that sends it. Proton keeps the
     role inside the field and so does this - the two belong to one another, and
     a second control beside the field would read as a second question. */
  .compose {
    padding: 3px 3px 3px var(--space-3);
    gap: var(--space-1);
  }

  /* The box takes the border and the ring; this is only the words in it. The
     height comes from the row scale rather than from padding, so what a thumb
     lands on is a row and not the 34px this was on every screen. */
  .compose input {
    flex: 1;
    min-width: 0;
    min-height: var(--row-height);
    padding: 0;
    border: none;
    background: none;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  .compose input::placeholder {
    color: var(--muted);
  }

  /* What was typed is not an address, said by the field as well as under it. */
  .compose.bad {
    border-color: var(--danger);
  }

  /* The press that sends it: quiet until there is something to send, which is
     when it appears at all. */
  .send {
    flex: none;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: var(--radius-row);
    background: var(--accent);
    color: #fff;
    cursor: default;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .send svg {
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .send:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .send:disabled {
    opacity: 0.5;
  }

  /* ── The people ──────────────────────────────────────────────────
     A row with two lines of words in it, so it is as tall as they are rather
     than as tall as one of them. */
  .person {
    padding: var(--space-1) 0;
  }

  /* Somebody waiting on an answer, which is the one row here that is a question.
     The accent behind it, at the strength a picked row wears. */
  .asking {
    margin: 0 calc(-1 * var(--space-1)) 2px;
    padding: var(--space-1);
    border-radius: var(--radius-row);
    background: var(--accent-soft);
  }

  /* A row waiting on the server it was told to change. Not disabled-looking:
     every button in the sheet is already disabled while one is in flight, and
     this is which of them the answer is about. */
  .waiting {
    opacity: 0.55;
  }

  /* Which of these people is reading the sheet, beside their name rather than
     under it. */
  .named {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
    min-width: 0;
  }

  .you {
    color: var(--muted);
  }

  /* The owner, whose role is the space rather than a choice. */
  .fixed {
    flex: none;
    padding-inline-end: var(--space-1);
    color: var(--muted);
  }

  /* What somebody may do, as a word and a chevron at the end of their row rather
     than a boxed control in every one of them; the box is `Select`'s `plain`. As
     wide as the words need and no wider, so the names keep the room. */
  .pick {
    flex: none;
    max-width: 50%;
  }

  /* ── The link ────────────────────────────────────────────────────  */

  /* The word a card is headed by is as wide as the word, so the dot sits beside
     it rather than at the far end with the switch. */
  .card-head .name {
    flex: none;
  }

  /* Whether it is live, beside the word rather than spelled out: the switch
     already says which way it is, and this is what catches the eye. */
  .dot {
    flex: none;
    width: 6px;
    height: 6px;
    margin-inline-end: auto;
    border-radius: 50%;
    background: var(--line-strong);
    transition: background var(--dur-base) var(--ease-out);
  }

  .dot.on {
    background: var(--success);
  }

  /* Everything the link is: shown while there is no link, so turning it on fills
     the card in rather than growing it. */
  .linkbody {
    display: flex;
    flex-direction: column;
    width: 100%;
    transition: opacity var(--dur-base) var(--ease-out);
  }

  .linkbody.off {
    opacity: 0.45;
    pointer-events: none;
  }

  /* A switch under the row it qualifies, which is why the words are quieter than
     the sentence above them and start where they start rather than at the card's
     own edge. */
  .asks {
    color: var(--muted-strong);
  }

  .under {
    flex: none;
    width: var(--row-height-sm);
  }

  /* ── While the answer is on its way ──────────────────────────────
     Plain blocks where the field, the faces and the words will be: enough that
     the sheet is the right size and the wait reads as a wait rather than as an
     empty list. */
  .bone {
    display: block;
    height: 9px;
    border-radius: 4px;
    background: var(--surface-3);
    animation: bone-breathe 1400ms var(--ease-in-out) infinite;
  }

  .bone.face {
    flex: none;
    width: var(--row-height-sm);
    height: var(--row-height-sm);
    border-radius: calc(var(--row-height-sm) * 0.32);
  }

  .bone.words {
    width: 42%;
  }

  .bone.under {
    width: 58%;
    height: 8px;
    margin-top: 4px;
    opacity: 0.7;
  }

  .bone.control {
    flex: none;
    width: 64px;
    height: 12px;
    border-radius: 4px;
  }

  @keyframes bone-breathe {
    50% {
      opacity: 0.45;
    }
  }

  /* Still, where movement is turned down: the blocks are the shape of the
     answer, and they say that on their own. */
  @media (prefers-reduced-motion: reduce) {
    .bone {
      animation: none;
    }
  }

  /* ── Under a thumb ───────────────────────────────────────────────
     The same sheet, at the size a finger needs: the field takes the width and
     puts the role and the press on a line of their own under what is typed. */
  :global([data-touch]) .compose {
    padding: var(--space-1) var(--space-1) var(--space-1) var(--touch-gap);
  }

  :global([data-touch]) .compose input {
    font-size: var(--touch-text);
  }

  :global([data-touch]) .compose .pick {
    max-width: 40%;
  }

  :global([data-touch]) .send {
    width: var(--touch-target);
    height: var(--touch-target);
    border-radius: var(--radius-md);
  }

  :global([data-touch]) .send svg {
    width: var(--icon-md);
    height: var(--icon-md);
  }

  :global([data-touch]) .pick {
    max-width: 45%;
  }
</style>
