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
      'id -un; sudo -n true && echo sudo-ok; node --version; python3 --version; git --version; gh --version; uv --version; rg --version; jq --version; [ -x /usr/local/bin/sandbox-shim ] && echo shim-ok; echo "path=$PATH"',
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
    expect(text).toContain('shim-ok')
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

describe.runIf(URL)('a browser on the owner’s computer', () => {
  test('xdg-open, sensible-browser and $BROWSER say the address up the link, and only the web', async () => {
    await healthy(URL)
    const session = 's_open'
    const link = await linked(URL, SECRET)
    link.send({ t: 'open', session, cols: 200, rows: 50 })
    link.send({
      t: 'in',
      session,
      data: bytes(
        [
          'echo "browser=$BROWSER program=$TERM_PROGRAM"',
          "xdg-open 'https://example.com/a?b=1'; echo open=$?",
          'sensible-browser https://github.com/login/device; echo sensible=$?',
          'python3 -c "import webbrowser; webbrowser.open(\'https://docs.python.org/\')"',
          'xdg-open /etc/passwd; echo file=$?',
          'echo done-$((40+2))\r',
        ].join('; '),
      ),
    })
    await until(() => link.text(session).includes('done-42'), 60_000)
    const text = link.text(session)
    const opened = link.frames.flatMap((frame) =>
      frame.t === 'open' ? [{ session: frame.session, url: frame.url }] : [],
    )
    link.close()

    expect(text).toContain('browser=nib-open program=nib')
    expect(text).toContain('open=0')
    expect(text).toContain('sensible=0')
    expect(text).toMatch(/file=[1-9]/)
    expect(opened).toEqual([
      { session, url: 'https://example.com/a?b=1' },
      { session, url: 'https://github.com/login/device' },
      { session, url: 'https://docs.python.org/' },
    ])
  })

  test('a sign-in callback is made on the machine, where the program listens', async () => {
    await healthy(URL)
    const session = 's_callback'
    const link = await linked(URL, SECRET)
    link.send({ t: 'open', session, cols: 200, rows: 50 })
    link.send({
      t: 'in',
      session,
      data: bytes(
        '(cd /tmp && python3 -m http.server 8765 --bind 127.0.0.1 >/dev/null 2>&1 &); sleep 1; echo up-$((40+2))\r',
      ),
    })
    await until(() => link.text(session).includes('up-42'), 30_000)
    const url = 'http://localhost:8765/?code=abc'
    link.send({ t: 'callback', session, url })
    await until(() => link.frames.some((frame) => frame.t === 'called'), 15_000)
    expect(link.frames.find((frame) => frame.t === 'called')).toEqual({
      t: 'called',
      session,
      url,
      status: 200,
    })
    link.close()
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
