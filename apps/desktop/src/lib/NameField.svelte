<script lang="ts">
  /** A name, editable where it is written.
   *
   *  One field for every name the app renames: a row in the file list, and the
   *  space's name in the header over it. It is the row it sits in - the row's
   *  font, the row's colour, the row's ground, no box of its own and nothing that
   *  moves the words by a pixel - so renaming happens where the name is, with the
   *  mark and the indentation and the twist still beside it. That is what Finder,
   *  Explorer and VS Code all do; nib used to put a full-width field over the
   *  whole row instead, which is what this replaces.
   *
   *  What is not here is what a commit means. Renaming a note rewrites every link
   *  to it, renaming a space tells the account, and a row that is being made
   *  writes a file that was never there - so the host says what to do with the
   *  name, and this says what a name may be. The rules are naming.ts, which is
   *  pure and asked on every keystroke.
   *
   *  Enter commits, Escape restores, and so does a blur: a name that cannot be
   *  written and a name nobody changed are both nothing to do, which is what makes
   *  clicking away safe to treat as a commit. Tab is swallowed, because a rename
   *  that lost the focus halfway through is a rename nobody asked for.
   *
   *  The thing the field sits in is what wears the red hairline while the name
   *  cannot be written, since that is what the reader is looking at; `wrong` is
   *  bound out for it. An empty field is not wrong, only unfinished. */

  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from './i18n.svelte'
  import { dur } from './motion'
  import { type NameFault, nameFault, nameToCommit } from './naming'
  import { caretAtEnd, selectAll, selectStem } from './select-all'

  interface Props {
    /** What the field starts with: the name as the row shows it, without the
     *  extension a document is not known by. Empty for a row being made. */
    value: string
    /** What the commit puts back on the end; nothing for a folder or a space. */
    extension?: string
    /** The names already beside it, its own left out; see naming.ts. */
    taken?: readonly string[]
    /** The caret goes to the end rather than the name arriving selected: a name
     *  that is settled and waiting for a title after it. */
    appending?: boolean
    /** The name to write, extension and all. */
    oncommit: (name: string) => void
    /** Nothing to write: Escape, or a name that cannot be. */
    oncancel: () => void
    /** Whether the name cannot be written, for the row to say so. */
    wrong?: boolean
  }

  /* eslint-disable prefer-const, no-useless-assignment -- `wrong` is bindable: a
     $props() pattern cannot be split, and what reads it is the row outside */
  let {
    value,
    extension = '',
    taken = [],
    appending = false,
    oncommit,
    oncancel,
    wrong = $bindable(false),
  }: Props = $props()
  /* eslint-enable prefer-const, no-useless-assignment */

  /** What has been typed. Held here rather than read back off the row, and taken
   *  from the name the row shows once rather than followed: a fresh listing
   *  arriving from sync mid-word would otherwise put the old name back under the
   *  caret. Which is what the warning below is about, and the whole point. */
  // svelte-ignore state_referenced_locally
  let typed = $state(value)

  const fault = $derived(nameFault({ typed, extension, taken }))

  /** Whether the name will not do. Not the same as an empty field: a name nobody
   *  has finished typing is not a mistake. Bound out so the row can wear the
   *  hairline, and said on the field itself for a reader who is listening rather
   *  than looking. */
  const amiss = $derived(fault !== null && fault !== 'empty')

  $effect(() => {
    wrong = amiss

    // And nothing is wrong once the field has gone. The flag belongs to the row,
    // which outlives the field and is renamed again: a hairline left behind would
    // turn up in red on the next name somebody typed.
    return () => {
      wrong = false
    }
  })

  /** Why the name will not do, in the words the bubble shows. Nothing for an
   *  empty field: a name nobody has finished typing is not a mistake. */
  function reasonFor(reason: NameFault | null): string | null {
    switch (reason) {
      case 'separator':
        return t('A name cannot hold a slash')
      case 'illegal':
        return t('A name cannot hold that character')
      case 'trailing':
        return t('A name cannot end with a dot')
      case 'reserved':
        return t('Windows keeps this name for itself')
      case 'taken':
        return t('That name is taken')
      case 'empty':
      case null:
        return null
    }
  }

  const reason = $derived(reasonFor(fault))

  /** Once. Enter commits and the field goes, and a node on its way out can still
   *  fire the blur that would commit or restore a second time. */
  let settled = false

  function leave() {
    if (settled) return
    settled = true

    const name = nameToCommit({ typed, extension, taken, was: value })
    if (name === null) oncancel()
    else oncommit(name)
  }

  function escape() {
    if (settled) return
    settled = true
    oncancel()
  }

  /** How the field arrives, which is one of the three ways select-all.ts has.
   *
   *  A name that is settled takes the caret at the end, with a title to be typed
   *  after it. A name that carries its own extension - a picture, whose name is the
   *  file's own and so shown with the extension on it - keeps that out of the
   *  selection, the way Finder and Explorer do. Everything else is selected whole: a
   *  note, a canvas, a page note, a website and a PDF are all shown without the
   *  extension they keep, so there is nothing to leave out, and the dot in a folder
   *  called `v1.2` is part of the name rather than in front of an extension. */
  function caret(node: HTMLInputElement) {
    if (appending) return caretAtEnd(node)

    const carries = extension !== '' && value.toLowerCase().endsWith(extension.toLowerCase())
    return carries ? selectStem(node) : selectAll(node)
  }
</script>

<span class="naming" class:wrong={amiss}>
  <input
    bind:value={typed}
    spellcheck="false"
    autocapitalize="off"
    autocorrect="off"
    enterkeyhint="done"
    aria-label={t('Name')}
    aria-invalid={amiss}
    use:caret
    onblur={leave}
    onkeydown={(event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        leave()
      } else if (event.key === 'Escape') {
        // Kept off the window, where Escape closes whatever is open over the
        // note: what is open here is a name being typed.
        event.preventDefault()
        event.stopPropagation()
        escape()
      } else if (event.key === 'Tab') {
        event.preventDefault()
      }
    }}
  />

  {#if reason}
    <span
      class="nib-bubble reason"
      aria-live="polite"
      transition:fly={{ y: -4, duration: dur(120), easing: cubicOut }}>{reason}</span
    >
  {/if}
</span>

<style>
  /* The name's own slot in the row, and what the sentence is placed against. Not
     `.nib-row-label`: that clips whatever overflows, and the sentence has to leave
     the row to be read. */
  .naming {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
  }

  /* Nothing but the words. Everything a browser gives a field is taken off it, so
     the name is drawn exactly where the label drew it: same font, same colour,
     same ground, and no padding to shift it by.

     The corner is said here and not on the focus: what says the name is editable
     is the app's own answer for a box with a caret in it, which is the halo in the
     themes package, and this is the corner it is drawn round. A hairline of its
     own used to be drawn here at 1px where every other field in the app draws 3. */
  input {
    width: 100%;
    min-width: 0;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
  }

  /* While the name cannot be written the row wears a hairline in red and the halo
     goes: two answers in two colours around one name is the app arguing with
     itself. */
  .wrong input:focus {
    box-shadow: none;
  }

  /* Under the name, at the left edge of it, over the rows below. The card itself
     is `.nib-bubble` in the themes package, which the `i` after a setting's name
     shows its sentence in too. */
  .reason {
    position: absolute;
    top: calc(100% + 4px);
    inset-inline-start: 0;
    z-index: 6;
  }
</style>
