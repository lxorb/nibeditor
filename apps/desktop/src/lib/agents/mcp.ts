/** The line a reader pastes into an agent's client to give it nib: the installed app's
 *  own binary as its MCP server, `nib mcp` (src-tauri/src/mcp). Settings > Agents shows
 *  it with the program's path, which the crate answers through the `mcp_program`
 *  command: the installed exe, or an AppImage's own path.
 *
 *  Claude Code's line adds nib at user scope, so it is there in every folder the client
 *  starts in rather than only the one it was added from; `json` is the entry a client
 *  configured by file takes (Claude Desktop's `claude_desktop_config.json`, Cursor's
 *  `mcp.json`). See docs/agent-native.md 10. */

/** The clients a line is written for. */
export type McpClient = 'claude' | 'codex' | 'json'

/** Whether a path is a Windows one: a drive, or a share. */
function onWindows(program: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(program) || program.startsWith('\\\\')
}

/** The program as the shell it is pasted into reads one word: in double quotes on
 *  Windows, where no path holds one; in single quotes elsewhere when it needs any. */
function quoted(program: string): string {
  if (onWindows(program)) return `"${program}"`
  return /^[\w@%+=:,./-]+$/.test(program) ? program : `'${program.replaceAll("'", `'\\''`)}'`
}

/** The line, or the entry, that adds nib to a client. */
export function mcpLine(program: string, client: McpClient = 'claude'): string {
  if (client === 'json') {
    return JSON.stringify({ mcpServers: { nib: { command: program, args: ['mcp'] } } }, null, 2)
  }
  const add = client === 'claude' ? 'claude mcp add --scope user' : 'codex mcp add'
  return `${add} nib -- ${quoted(program)} mcp`
}
