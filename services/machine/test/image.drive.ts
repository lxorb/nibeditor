/** The image booted with nothing in the cloud (test/image.sh starts it): `nibd` answers
 *  on its link, a session is a login shell of the machine's user with the tools of 4.2,
 *  the agents run from the home, and - on the traced machine - a session reads the
 *  agents' files while strace watches `nibd` for image.sh to read. */

import { describe, expect, test } from 'vitest'
import { bytes, healthy, linked, until } from './link'

const URL = process.env.NIBD_URL ?? ''
const TRACED = process.env.NIBD_TRACED_URL ?? ''
const SECRET = process.env.NIBD_SECRET ?? ''

/** Everything a session printed for a command typed into it, up to a marker after it. */
async function ran(url: string, session: string, command: string): Promise<string> {
  const link = await linked(url, SECRET)
  link.send({ t: 'open', session, cols: 200, rows: 50 })
  link.send({ t: 'in', session, data: bytes(`${command}; echo done-$((40+2))\r`) })
  await until(() => link.text(session).includes('done-42'), 360_000)
  const text = link.text(session)
  link.close()
  return text
}

describe.runIf(URL)('the image', () => {
  test('answers on the link with a login shell of the machine user, with its tools', async () => {
    await healthy(URL)
    const text = await ran(
      URL,
      's_tools',
      'id -un; sudo -n true && echo sudo-ok; node --version; python3 --version; git --version; gh --version; uv --version; rg --version; jq --version; echo "path=$PATH"',
    )
    expect(text).toMatch(/[\r\n]nib\r\n/)
    expect(text).toContain('sudo-ok')
    expect(text).toMatch(/v22\.\d+\.\d+/)
    expect(text).toMatch(/Python 3\.\d+/)
    expect(text).toMatch(/git version/)
    expect(text).toMatch(/gh version/)
    expect(text).toMatch(/uv \d+\.\d+/)
    expect(text).toMatch(/ripgrep/)
    expect(text).toMatch(/jq-/)
    expect(text).toMatch(/path=\/home\/nib\/\.local\/bin:/)
  })

  test('runs Claude Code and Codex from the home once the first boot installed them', async () => {
    const text = await ran(
      URL,
      's_agents',
      'for i in $(seq 300); do [ -x ~/.local/bin/claude ] && [ -x ~/.local/bin/codex ] && break; sleep 1; done; claude --version; codex --version',
    )
    expect(text).toMatch(/\d+\.\d+\.\d+ \(Claude Code\)/)
    expect(text).toMatch(/codex-cli \d+\.\d+/)
  })
})

describe.runIf(TRACED)('the traced machine', () => {
  test('a session reads the agents files, as a person would', async () => {
    await healthy(TRACED)
    const text = await ran(
      TRACED,
      's_traced',
      'cat ~/.claude/.credentials.json ~/.codex/auth.json; ls -la ~/.claude ~/.codex; cd ~/.claude',
    )
    expect(text).toContain('not-a-real-token')
  })
})
