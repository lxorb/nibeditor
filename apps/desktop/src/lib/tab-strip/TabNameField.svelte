<script lang="ts">
  /** A tab's name, typed where it is written: Windows Terminal's rename, over the name
   *  in the strip, with the mark still beside it.
   *
   *  NameField's shape - the tab's own font, colour and ground, no box but the halo every
   *  field with a caret wears - and not NameField itself, because what that one guards
   *  is a file's name: a slash, a reserved word, a name taken beside it. A terminal's
   *  name is no file's, so anything typed goes, and nothing typed is a name given back:
   *  the tab is called by whatever runs in it again. What a commit means is the tab's
   *  kind's; see terminal/rename.ts.
   *
   *  Enter commits and so does a blur; Escape leaves the name as it was. The keyboard goes
   *  back to the pane after either, which is where somebody renaming a terminal is about
   *  to type. Fetched with the first rename; see Tabs.svelte. */

  import { focusEditor } from '../focus'
  import { t } from '../i18n.svelte'
  import { selectAll } from '../select-all'
  import type { Tab } from '../workspace/documents.svelte'

  const { tab }: { tab: Tab } = $props()

  /** What the field starts with: the name the tab is showing. Taken once, so a program
   *  retitling the tab mid-word does not put its title under the caret. */
  // svelte-ignore state_referenced_locally
  const was = tab.shown
  let typed = $state(was)

  /** Once: Enter takes the field away, and a field on its way out still blurs. */
  let settled = false

  function leave(commit: boolean) {
    if (settled) return
    settled = true
    tab.naming = false

    // The name it was showing, typed back unchanged, is not a name of its own: a
    // program's title would otherwise be frozen by a press of Enter.
    if (commit && typed.trim() !== was.trim()) {
      void import('../terminal/rename').then(({ renameTerminal }) => renameTerminal(tab, typed))
    }
    focusEditor()
  }
</script>

<input
  class="field"
  bind:value={typed}
  spellcheck="false"
  autocapitalize="off"
  autocorrect="off"
  enterkeyhint="done"
  aria-label={t('Name')}
  use:selectAll
  onblur={() => leave(true)}
  onpointerdown={(event) => event.stopPropagation()}
  onkeydown={(event) => {
    // The strip's own keys - the arrows along it, Delete closing a tab - are the
    // field's while it is up.
    event.stopPropagation()
    if (event.key === 'Enter') {
      event.preventDefault()
      leave(true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      leave(false)
    } else if (event.key === 'Tab') {
      event.preventDefault()
    }
  }}
/>

<style>
  /* Where the name is: after the mark, before the room the close button keeps, at the
     height the name is set at - the tab's own padding, restated. */
  .field {
    position: absolute;
    top: var(--tab-top, 5px);
    bottom: var(--tab-top, 5px);
    inset-inline: calc(3px + 8px + var(--icon-md) + 6px) calc(3px + 8px + 16px + 4px);
    margin: auto 0;
    height: 1.6em;
    min-width: 0;
    padding: 0 2px;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-row);
  }
</style>
