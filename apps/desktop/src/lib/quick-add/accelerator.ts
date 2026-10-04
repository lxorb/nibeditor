/** A key of the shortcut registry's as the system's global shortcut plugin reads one:
 *  quick add's key from any app is the same key the app answers to inside, written two
 *  ways (docs/tasks.md 5.6). */

/** A key as the registry writes it (`Ctrl-Alt-Space`) as the system's shortcut plugin
 *  reads one (`Control+Alt+Space`). Null for none. */
export function accelerator(key: string | null): string | null {
  if (!key || key.includes(' ')) return null
  const parts = key.split(/-(?!$)/)
  const names: Record<string, string> = {
    Mod: 'CommandOrControl',
    Ctrl: 'Control',
    Alt: 'Alt',
    Shift: 'Shift',
    Meta: 'Super',
  }
  return parts
    .map((part, index) =>
      index < parts.length - 1
        ? (names[part] ?? part)
        : part.length === 1
          ? part.toUpperCase()
          : part,
    )
    .join('+')
}
