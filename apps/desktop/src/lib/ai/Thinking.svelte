<script lang="ts">
  /** Three dots while an answer's first words are on their way: something is happening,
   *  and nothing needs saying about it. */
</script>

<div class="thinking" aria-hidden="true"><span></span><span></span><span></span></div>

<style>
  .thinking {
    display: flex;
    gap: 4px;
    padding: var(--space-1) 0;
  }

  .thinking span {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--muted);
    animation: pulse calc(var(--dur-slow) * 4) var(--ease-out) infinite;
  }

  .thinking span:nth-child(2) {
    animation-delay: calc(var(--dur-slow) * 0.6);
  }

  .thinking span:nth-child(3) {
    animation-delay: calc(var(--dur-slow) * 1.2);
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 0.25;
    }
    40% {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .thinking span {
      animation: none;
      opacity: 0.6;
    }
  }
</style>
