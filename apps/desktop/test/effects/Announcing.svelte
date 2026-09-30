<!-- The live region and two effects that write into it, as App.svelte had them:
     the sync light becoming words, and a second source of words beside it - a
     tab's save dot, when there was one. The stores that feed them there are props here, so a test can flip a
     pass from running to failed without building a workspace and an account to
     do it with - what is under test is `said`, and the page around it.

     The second paragraph is the page itself: something with nothing to do with
     the region that a test can change and look for. A page that has thrown
     `effect_update_depth_exceeded` is fully drawn and never updates again, so
     "the region says the right thing" is only half the question. -->
<script lang="ts">
  import { said } from '../../src/lib/said.svelte'

  interface Props {
    /** What a syncing pass is doing, as `sync.status` says it. */
    status: 'idle' | 'syncing' | 'error'
    /** A second thing to say, the way a tab's save dot once said whether the note
     *  in front was on the disk. */
    saving: 'idle' | 'saving' | 'saved'
  }

  const { status, saving }: Props = $props()

  $effect(() => {
    if (status === 'syncing') said.say('Syncing')
    else if (status === 'error') said.say('Sync failed')
  })

  $effect(() => {
    if (saving === 'saving') said.say('Saving')
    else if (saving === 'saved') said.say('Saved')
  })
</script>

<p data-said role="status" aria-live="polite">{said.words}</p>
<p data-saving>{saving}</p>
