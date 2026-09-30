/** A command line and what a terminal printed, as words. Pure; see terminal.ts. */

/** The program a command line starts, as a list of allowed programs names it: the
 *  first word, without its folder or its ending, in lower case. */
export function programOf(command: string): string {
  const first = /^\s*(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(command)
  const word = first?.[1] ?? first?.[2] ?? first?.[3] ?? ''
  const name = word.split(/[\\/]/).pop() ?? ''
  return name.replace(/\.(exe|cmd|bat|com|ps1|sh)$/i, '').toLowerCase()
}

/** Whether a line starts only its first program: no second command after a `;`, an
 *  `&` or a `|`, nothing run inside it with backticks or `$(`, and no file written or
 *  read with `>` or `<`. Only such a line can be let through for being on an agent's
 *  list; `git status; rm -rf ~` starts `git` and is not one. */
export function startsOnlyOne(command: string): boolean {
  return !/[;&|`<>]|\$\(/.test(command)
}

/** What a terminal printed, as words: the escapes that colour and move things on a
 *  screen taken out, a carriage return taken out, and nothing else changed. */
export function plainOf(printed: string): string {
  let out = ''

  for (let at = 0; at < printed.length; at++) {
    const code = printed.charCodeAt(at)
    if (code === 27) {
      const next = printed[at + 1]
      if (next === '[') {
        // Control sequence: parameters, then one final character.
        at += 2
        while (at < printed.length && !/[@-~]/.test(printed[at] ?? '')) at++
      } else if (next === ']') {
        // Operating system command, ended by a bell or by ESC \.
        at += 2
        while (at < printed.length) {
          if (printed.charCodeAt(at) === 7) break
          if (printed.charCodeAt(at) === 27 && printed[at + 1] === '\\') {
            at++
            break
          }
          at++
        }
      } else at++
      continue
    }

    if (code === 10 || code === 9 || code >= 32) out += printed[at] ?? ''
  }

  return out
}
