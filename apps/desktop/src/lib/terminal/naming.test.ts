import { describe, expect, test } from 'vitest'
import {
  folderName,
  Front,
  programMark,
  programTitle,
  shellMark,
  terminalMark,
  terminalName,
} from './naming'

describe('a terminal is called', () => {
  const parts = {
    given: null,
    title: null,
    program: null,
    shell: 'PowerShell',
    folder: 'C:\\Users\\me\\quaestur',
  }

  test('what the reader named it, over everything', () => {
    expect(terminalName({ ...parts, given: 'server', title: 'Fix login', program: 'node' })).toBe(
      'server',
    )
  })

  test('else the title its program set', () => {
    expect(terminalName({ ...parts, title: 'Fix login', program: 'claude' })).toBe('Fix login')
  })

  test('else the program in front, and the folder', () => {
    expect(terminalName({ ...parts, program: 'node' })).toBe('node · quaestur')
  })

  test('else the shell, and the folder, or the shell alone', () => {
    expect(terminalName(parts)).toBe('PowerShell · quaestur')
    expect(terminalName({ ...parts, folder: null })).toBe('PowerShell')
  })
})

describe('a folder', () => {
  test('is its last part, whichever separator wrote it', () => {
    expect(folderName('C:\\Users\\me\\quaestur')).toBe('quaestur')
    expect(folderName('/home/me/quaestur/')).toBe('quaestur')
  })

  test('a drive and the root are themselves', () => {
    expect(folderName('C:\\')).toBe('C:')
    expect(folderName('/')).toBe('/')
    expect(folderName(null)).toBe(null)
  })
})

describe('a title', () => {
  test('loses the glyph Claude Code turns in front of it', () => {
    expect(programTitle('✳ Fix the login form')).toBe('Fix the login form')
    expect(programTitle('⠐ Fix the login form')).toBe('Fix the login form')
    expect(programTitle('✳ Claude Code')).toBe('Claude Code')
  })

  test('keeps what is words, quotes and brackets included', () => {
    expect(programTitle('"notes.md" (~/work) - VIM')).toBe('"notes.md" (~/work) - VIM')
    expect(programTitle('me@box: ~/work')).toBe('me@box: ~/work')
  })

  test("is not a console's own path", () => {
    expect(programTitle('C:\\WINDOWS\\system32\\cmd.exe')).toBe(null)
    expect(programTitle('C:\\WINDOWS\\system32\\cmd.exe - node  server.js')).toBe(null)
    expect(programTitle('Administrator: C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe(null)
  })

  test('is cut where it stops being a name', () => {
    expect(programTitle('x'.repeat(300))).toHaveLength(120)
    expect(programTitle('   ')).toBe(null)
  })
})

describe('whose a title is', () => {
  test("the shell's at its start and at its prompt", () => {
    const front = new Front(false)
    expect(front.titled('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe(false)
    expect(front.titled('me@box: ~')).toBe(false)
    expect(front.title).toBe(null)
  })

  test("a program's once a look finds one in front", () => {
    const front = new Front(false)
    front.entered()
    expect(front.titled('✳ Claude Code')).toBe(true)
    expect(front.title).toBe(null)

    front.looked('claude')
    expect(front.title).toBe('Claude Code')
    // Said again every second while it works, and taken at once now.
    expect(front.titled('⠂ Fix the parser')).toBe(false)
    expect(front.title).toBe('Fix the parser')
  })

  test("nobody's when the look finds the shell: it was the shell's own", () => {
    const front = new Front(false)
    front.entered()
    front.titled('me@box: ~/work')
    front.looked(null)
    expect(front.title).toBe(null)
    expect(front.program).toBe(null)
  })

  test('gone with the program: a prompt mark, the shell in front, a blank title', () => {
    const marked = new Front(false)
    marked.entered()
    marked.looked('claude')
    marked.titled('Fix the parser')
    marked.prompted()
    expect([marked.title, marked.program]).toEqual([null, null])

    const looked = new Front(false)
    looked.entered()
    looked.looked('claude')
    looked.titled('Fix the parser')
    looked.looked(null)
    expect(looked.title).toBe(null)

    const blanked = new Front(false)
    blanked.entered()
    blanked.looked('claude')
    blanked.titled('Fix the parser')
    blanked.titled('')
    expect(blanked.title).toBe(null)
    expect(blanked.program).toBe('claude')
  })

  test("another program in front does not inherit the last one's title", () => {
    const front = new Front(false)
    front.entered()
    front.looked('vim')
    front.titled('notes.md - VIM')
    front.looked('node')
    expect(front.title).toBe(null)
  })

  test('in WSL, whose programs Windows cannot list, from Enter to the next prompt', () => {
    const front = new Front(true)
    expect(front.titled('me@box: ~')).toBe(false)
    expect(front.title).toBe(null)

    front.entered()
    expect(front.titled('notes.md - VIM')).toBe(false)
    expect(front.title).toBe('notes.md - VIM')
    expect(front.worthLooking).toBe(false)

    front.prompted()
    expect(front.title).toBe(null)
  })

  test('a look is worth it only while something may be in front', () => {
    const front = new Front(false)
    expect(front.worthLooking).toBe(false)
    front.entered()
    expect(front.worthLooking).toBe(false)
    front.looked('node')
    expect(front.worthLooking).toBe(true)
    front.prompted()
    expect(front.worthLooking).toBe(false)
  })
})

describe('the mark', () => {
  test('is the program in front where it has one of its own', () => {
    expect(programMark('claude')).toBe('claude')
    expect(programMark('Python3.12')).toBe('python')
    expect(programMark('py')).toBe('python')
    expect(programMark('nvim')).toBe('vim')
    expect(programMark('docker-compose')).toBe('docker')
    expect(programMark('cargo')).toBe(null)
  })

  test("else the shell's own", () => {
    expect(shellMark('pwsh')).toBe('powershell')
    expect(shellMark('vs-pwsh:abc')).toBe('powershell')
    expect(shellMark('cmd')).toBe('cmd')
    expect(shellMark('wsl:Ubuntu')).toBe('shell')
    expect(shellMark('/bin/zsh')).toBe('shell')
    expect(terminalMark('pwsh', 'cargo')).toBe('powershell')
    expect(terminalMark('pwsh', 'git')).toBe('git')
  })
})
