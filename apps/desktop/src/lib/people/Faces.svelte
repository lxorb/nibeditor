<script lang="ts">
  /** A few people as faces overlapping, the way a shared thing says who is in it: the
   *  switcher's row of a shared space. Each face is asked of the people store, which
   *  asks the service once for all of them; a face it does not know yet is nothing
   *  rather than a placeholder that turns into somebody. See docs/chats.md 4.9. */
  import Avatar from './Avatar.svelte'
  import { people } from './people.svelte'

  const { ids, most = 3 }: { ids: readonly string[]; most?: number } = $props()

  const shown = $derived(
    ids
      .slice(0, most)
      .map((id) => ({ id, person: people.of(id) }))
      .filter((one) => one.person !== undefined),
  )
</script>

<span class="faces" aria-hidden="true">
  {#each shown as { id, person } (id)}
    {#if person}
      <span class="one">
        <Avatar
          face={{ name: person.name, avatar: person.avatar, accent: person.accent, key: id }}
          size={16}
        />
      </span>
    {/if}
  {/each}
</span>

<style>
  .faces {
    flex: none;
    display: inline-flex;
    align-items: center;
  }

  /* Each over the one before, ringed in the ground so the edge between two reads. */
  .one {
    display: inline-flex;
    border-radius: 50%;
    box-shadow: 0 0 0 1.5px var(--avatar-ring, var(--surface));
  }

  .one + .one {
    margin-inline-start: -5px;
  }
</style>
