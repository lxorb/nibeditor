/** `@nib` in a chat (docs/chats.md 4.14, decision 7.7): the reader's own agent, asked on
 *  the reader's own machine. The question goes to the AI sidebar with the chat attached
 *  (its unread part, or its newest messages), and the answer comes back into the
 *  composer it was asked from as a draft, sent with Enter or not at all. Nothing anybody
 *  else writes ever starts it: only the reader's own Enter in their own composer does. */

/** Asks the reader's agent, and offers its answer to the chat's composer (or one
 *  message's replies'). */
export async function askNib(chat: string, question: string, parent?: string): Promise<void> {
  const [{ chat: panel }, { revealChat }, { draftReply }] = await Promise.all([
    import('../../ai/sidebar/chat.svelte'),
    import('../../ai/sidebar/reveal'),
    import('../../ai/commands/chats'),
  ])
  revealChat()
  await draftReply(panel, panel.ensure(), chat, question, parent)
}
