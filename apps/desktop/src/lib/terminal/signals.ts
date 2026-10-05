/** What a program in a terminal says to the terminal rather than to the screen: put this
 *  on the clipboard, and look at me.
 *
 *  - **OSC 52**, a program writing the clipboard: vim's and tmux's yank, Claude Code's
 *    copy, anything over SSH or on an online machine, where the program has no other
 *    way to the clipboard of the computer in front of the person. Writing only, as
 *    Windows Terminal, kitty, Alacritty and WezTerm have it: a program asking to *read*
 *    the clipboard (`?`) is never answered, since that would hand whatever the person
 *    copied last - a password - to whatever printed the question. And only while the
 *    terminal is on screen in a window that has the keyboard, which sessions.svelte.ts
 *    decides: a file `cat` in a terminal nobody looks at puts nothing anywhere.
 *  - **A notification**: OSC 9 (iTerm2's, `9;<message>` - but not ConEmu's numbered
 *    `9;<n>;...`, of which `9;9` is the folder, read in spec.ts), OSC 777 (`notify;
 *    <title>;<body>`: urxvt's, Ghostty's, WezTerm's), and the bell. Claude Code sends
 *    the first two when its notification channel says so; Codex the first.
 *
 *  Pure: the payload in, what it says out. */

/** The most a program may put on the clipboard at once: a long log's worth. */
export const MOST_COPY = 1024 * 1024

/** What an OSC 52 payload (`<where>;<base64>`) writes to the clipboard, or null where it
 *  writes nothing: a read, an empty or broken payload, or too much. `where` - `c`, `p`,
 *  `s`, a digit or nothing - is the system's one clipboard here, whichever is named. */
export function clipboardWrite(data: string): string | null {
  const split = data.indexOf(';')
  if (split < 0) return null
  const where = data.slice(0, split)
  const payload = data.slice(split + 1)
  if (!/^[cpqs0-7]*$/.test(where) || payload === '?' || payload === '') return null
  // Base64 grows a third; past this it would decode to more than may be copied.
  if (payload.length > Math.ceil((MOST_COPY * 4) / 3) + 4) return null
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload.replace(/\s/g, ''))) return null
  try {
    const binary = atob(payload.replace(/\s/g, ''))
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  } catch {
    return null
  }
}

/** A notification a program asked for: its title, where it gave one, and its words. */
export interface Notice {
  title: string | null
  body: string
}

/** The longest words a notification carries; a system cuts it shorter anyway. */
const LONGEST = 256

const cut = (words: string) => words.trim().slice(0, LONGEST)

/** An OSC 9 payload as a notification, or null for ConEmu's numbered sequences - the
 *  folder, a progress bar, a sleep - and for nothing at all. */
export function osc9Notice(data: string): Notice | null {
  if (/^\d+(;|$)/.test(data)) return null
  const body = cut(data)
  return body ? { title: null, body } : null
}

/** An OSC 777 payload as a notification: only `notify;<title>;<body>`. */
export function osc777Notice(data: string): Notice | null {
  const [kind, title = '', ...rest] = data.split(';')
  if (kind !== 'notify') return null
  const body = cut(rest.join(';'))
  const named = cut(title)
  if (!body && !named) return null
  return { title: named || null, body }
}
