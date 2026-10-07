<script lang="ts">
  /** What the others see of the account, in Settings > Account under its name: the
   *  face, pronouns, a few words, a status that clears itself, Do not disturb, the
   *  accent the initial sits on, and Appear offline. Each row is kept as it is changed,
   *  the way every setting is; there is nothing to confirm.
   *
   *  A picture comes from a press on Change, a file dropped or pasted on the row, or the
   *  camera, and goes through the avatar sheet, which is the one way a face is made.
   *  Fetched with the Account pane, so nobody who never opens it downloads any of it.
   *  See docs/chats.md 4.9. */
  import { account } from '../account.svelte'
  import { ACCENTS, accentColour } from '../accents'
  import { chooseFiles, PICTURES } from '../choose-files'
  import { key, message, t } from '../i18n.svelte'
  import Select from '../Select.svelte'
  import Swatches from '../Swatches.svelte'
  import { theme } from '../theme.svelte'
  import { viewport } from '../viewport.svelte'
  import Avatar from './Avatar.svelte'
  import AvatarSheet from './AvatarSheet.svelte'
  import type { Status } from './face'
  import { changeProfile, removeFace } from './mine'
  import { CLEARS, type Clears, clearsAt, stands } from './status'

  const user = $derived(account.user)
  const status = $derived(user && stands(user.status, Date.now()) ? (user.status ?? null) : null)

  let source = $state<{ file: Blob } | { camera: true } | null>(null)
  let clears = $state<Clears>('today')
  let wrong = $state<string | null>(null)

  /** Whether there is a camera to offer: a computer's webcam, shown in the sheet through
   *  the browser's own question, or a phone's own camera app, through the picker. */
  const camera = typeof navigator !== 'undefined' && (viewport.touch || !!navigator.mediaDevices)

  const CLEAR_WORDS: Record<Clears, string> = {
    '30m': key('30 minutes'),
    '1h': key('1 hour'),
    '4h': key('4 hours'),
    today: key('Today'),
    week: key('This week'),
    never: key('Never'),
  }

  const accents = $derived(
    ACCENTS.map((one) => ({
      value: one.id,
      label: t(one.name),
      colour: accentColour(one.id, theme.current),
    })),
  )

  async function kept(work: () => Promise<void>) {
    wrong = null
    try {
      await work()
    } catch (error) {
      wrong = message(error, 'that did not work')
    }
  }

  /** The status as it would stand with these changes, ending when `clears` says. */
  function withStatus(changes: Partial<Omit<Status, 'until'>>) {
    const next = {
      emoji: status?.emoji ?? '',
      text: status?.text ?? '',
      quiet: status?.quiet ?? false,
      ...changes,
    }
    const empty = !next.emoji.trim() && !next.text.trim() && !next.quiet
    void kept(() =>
      changeProfile({
        status: empty ? null : { ...next, until: clearsAt(clears, new Date()) },
      }),
    )
  }

  async function choose(fromCamera = false) {
    const [file] = await chooseFiles({ accept: PICTURES, camera: fromCamera })
    if (file) source = { file }
  }

  /** A phone takes the picture with its own camera app, which is what somebody holding
   *  one expects; a computer shows its camera in the sheet. */
  function takePhoto() {
    if (viewport.touch) void choose(true)
    else source = { camera: true }
  }

  function given(files: FileList | null | undefined) {
    const file = [...(files ?? [])].find((one) => one.type.startsWith('image/'))
    if (file) source = { file }
  }
</script>

{#if user}
  <h3>{t('Profile')}</h3>
  <div class="card">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="nib-setting setting"
      ondragover={(event) => event.preventDefault()}
      ondrop={(event) => {
        event.preventDefault()
        given(event.dataTransfer?.files)
      }}
      onpaste={(event) => given(event.clipboardData?.files)}
    >
      <Avatar
        face={{
          name: account.name ?? '',
          avatar: user.avatar ?? null,
          accent: user.accent ?? null,
          key: user.id,
        }}
        size={32}
      />
      <span class="name">{t('Picture')}</span>
      <button class="nib-chip" onclick={() => void choose()}>{t('Change')}</button>
      {#if camera}
        <button
          class="nib-glyph"
          title={t('Take photo')}
          aria-label={t('Take photo')}
          onclick={takePhoto}
        >
          <svg viewBox="0 0 16 16"
            ><path d="M2 5.5h2.5L6 3.5h4l1.5 2H14v7H2z" /><circle cx="8" cy="9" r="2.3" /></svg
          >
        </button>
      {/if}
      {#if user.avatar}
        <button class="nib-chip is-quiet" onclick={() => void kept(removeFace)}
          >{t('Remove')}</button
        >
      {/if}
    </div>

    <label class="nib-setting setting">
      <span class="name">{t('Pronouns')}</span>
      <input
        class="inline"
        value={user.pronouns ?? ''}
        maxlength="40"
        spellcheck="false"
        onchange={(event) =>
          void kept(() => changeProfile({ pronouns: event.currentTarget.value }))}
      />
    </label>

    <label class="nib-setting setting tall">
      <span class="name">{t('Bio')}</span>
      <textarea
        class="inline"
        rows="3"
        maxlength="190"
        value={user.bio ?? ''}
        onchange={(event) => void kept(() => changeProfile({ bio: event.currentTarget.value }))}
      ></textarea>
    </label>

    <div class="nib-setting setting">
      <span class="name">{t('Status')}</span>
      <input
        class="inline emoji"
        value={status?.emoji ?? ''}
        maxlength="16"
        aria-label={t('Emoji')}
        onchange={(event) => withStatus({ emoji: event.currentTarget.value.trim() })}
      />
      <input
        class="inline"
        value={status?.text ?? ''}
        maxlength="100"
        aria-label={t('Status')}
        onchange={(event) => withStatus({ text: event.currentTarget.value })}
      />
    </div>

    <div class="nib-setting setting">
      <span class="name">{t('Clear after')}</span>
      <Select
        value={clears}
        options={CLEARS.map((one) => ({ value: one, label: t(CLEAR_WORDS[one]) }))}
        label={t('Clear after')}
        plain
        onchange={(value: string) => {
          clears = value as Clears
          if (status) withStatus({})
        }}
      />
    </div>

    <div
      class="nib-setting setting pressable"
      role="switch"
      tabindex="0"
      aria-checked={status?.quiet ?? false}
      onclick={() => withStatus({ quiet: !(status?.quiet ?? false) })}
      onkeydown={(event) => {
        if (event.key !== ' ' && event.key !== 'Enter') return
        event.preventDefault()
        withStatus({ quiet: !(status?.quiet ?? false) })
      }}
    >
      <span class="name">{t('Do not disturb')}</span>
      <span class="nib-switch" class:on={status?.quiet ?? false} aria-hidden="true"></span>
    </div>

    <div class="nib-setting setting">
      <span class="name">{t('Accent')}</span>
      <Swatches
        options={accents}
        label={t('Accent')}
        chosen={user.accent ?? ''}
        onchoose={(value: string) => void kept(() => changeProfile({ accent: value }))}
      />
    </div>

    <div
      class="nib-setting setting pressable"
      role="switch"
      tabindex="0"
      aria-checked={user.hidden ?? false}
      onclick={() => void kept(() => changeProfile({ hidden: !(user.hidden ?? false) }))}
      onkeydown={(event) => {
        if (event.key !== ' ' && event.key !== 'Enter') return
        event.preventDefault()
        void kept(() => changeProfile({ hidden: !(user.hidden ?? false) }))
      }}
    >
      <span class="name">{t('Appear offline')}</span>
      <span class="nib-switch" class:on={user.hidden ?? false} aria-hidden="true"></span>
    </div>
  </div>
  {#if wrong}<p class="wrong">{wrong}</p>{/if}

  {#if source}
    <AvatarSheet {source} onclose={() => (source = null)} />
  {/if}
{/if}

<style>
  /* The settings pane's own shapes, carried here the way Security.svelte carries
     them: the pane's are scoped to it. See SettingsPanel.svelte. */
  h3 {
    margin: var(--space-3) 0 calc(-1 * var(--space-2));
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--muted-strong);
  }

  .card {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .setting .name {
    flex: 1;
    min-width: 0;
  }

  .tall {
    align-items: flex-start;
    padding-block: var(--space-2);
  }

  .inline {
    flex: none;
    width: 12rem;
    padding: 6px 9px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: end;
    outline: none;
    resize: none;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);
  }

  textarea.inline {
    text-align: start;
  }

  .inline:focus {
    background: var(--bg);
  }

  .inline.emoji {
    width: 3rem;
    text-align: center;
  }

  .pressable {
    cursor: default;
  }

  .wrong {
    margin: var(--space-2) 0 0;
    color: var(--danger);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }
</style>
