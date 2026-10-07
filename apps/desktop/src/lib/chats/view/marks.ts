/** The names a message calls, drawn as names (docs/chats.md 3, #36): `@Lucile` in the
 *  accent's tint, and stronger where it is the reader who is called, Slack's highlight.
 *  Done on the drawn words rather than in the markdown, because the renderer is the
 *  notes' and knows nothing of people; nothing inside code or a link is a mention, as
 *  `mentionsIn` reads it. An action, on the element the HTML was put into. */

/** Who a body may call: each label they answer to, and whether that is the reader. */
export interface Callable {
  label: string
  me: boolean
}

const SKIP = new Set(['CODE', 'PRE', 'A', 'KBD'])

/** Wraps every `@label` in the element's text in a mention mark. */
export function markMentions(root: HTMLElement, callable: readonly Callable[]): void {
  if (!root.textContent.includes('@')) return
  const labels = [...callable, { label: 'here', me: true }, { label: 'everyone', me: true }]
    .filter((one) => one.label)
    .sort((a, b) => b.label.length - a.label.length)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      for (let up = node.parentElement; up && up !== root; up = up.parentElement) {
        if (SKIP.has(up.tagName) || up.classList.contains('mention')) {
          return NodeFilter.FILTER_REJECT
        }
      }
      return node.nodeValue?.includes('@') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
  })
  const texts: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text)

  for (const text of texts) {
    let rest: Text = text
    for (;;) {
      const value = rest.nodeValue ?? ''
      const found = firstCall(value, labels)
      if (!found) break
      const after = rest.splitText(found.at)
      const tail = after.splitText(found.length)
      const mark = document.createElement('span')
      mark.className = found.me ? 'mention is-me' : 'mention'
      mark.textContent = after.nodeValue
      after.replaceWith(mark)
      rest = tail
    }
  }
}

/** The first `@label` in a run of text that is not inside a word. */
function firstCall(
  value: string,
  labels: readonly Callable[],
): { at: number; length: number; me: boolean } | null {
  for (let at = value.indexOf('@'); at !== -1; at = value.indexOf('@', at + 1)) {
    if (at > 0 && /[\p{L}\p{N}_]/u.test(value.charAt(at - 1))) continue
    const written = value.slice(at + 1).toLowerCase()
    for (const one of labels) {
      const label = one.label.toLowerCase()
      if (!written.startsWith(label)) continue
      if (/[\p{L}\p{N}_]/u.test(written.charAt(label.length))) continue
      return { at, length: label.length + 1, me: one.me }
    }
  }
  return null
}
