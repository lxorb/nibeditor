<script lang="ts">
  import { unarchive } from './archive'
  import { t } from './i18n.svelte'
  import { arrive, leave } from './slide'

  const { path }: { path: string } = $props()
</script>

<!-- An archived note still opens: from a link, a bookmark, the archive, or the trail
     behind the tab. So it has to say what it is, because the one thing a reader would
     otherwise notice is that it has gone from the file list - and they would look for it
     rather than for the reason.

     A row of the pane rather than a layer over the note, which is the find bar's own rule
     and for its reason: it is a strip of controls between the strip and what is being
     read, so no shadow and no corner. Writing stays allowed underneath it. An archived
     note is put away, not sealed, and a reader who opened one to add a line should not
     have to take it out of the archive first. -->
<div class="banner" in:arrive out:leave>
  <p>{t('Archived')}</p>

  <button class="nib-button is-quiet" onclick={() => void unarchive(path)}>
    {t('Unarchive')}
  </button>
</div>

<style>
  .banner {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    background: var(--surface);
    border-bottom: 1px solid var(--line);
  }

  p {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }

  /* The word is the section heading's own, so the strip reads as a label on the note
     rather than as a warning about it. The button is the quiet one beside it: the note is
     fine, and nothing here is urgent. */
  .nib-button {
    flex: none;
    padding: 0 var(--space-3);
    font-size: var(--text-xs);
  }

  :global([data-touch]) .nib-button {
    min-height: var(--touch-target);
    padding: 0 var(--space-4);
    font-size: var(--text-sm);
  }
</style>
