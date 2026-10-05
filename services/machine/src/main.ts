/** `nibd` started: its settings from the environment the entrypoint gave it, the server,
 *  and the save on SIGTERM.
 *
 *  The secret is read once and taken out of the environment before any shell starts,
 *  so no session inherits it. Every session gets a small environment of its own
 *  rather than `nibd`'s, and its login shell builds the rest. */

import { existsSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { Cgroups, PIDS_MAX, userOf } from './limits'
import { Nibd } from './nibd'
import { serve } from './server'

const PORT = 7680

/** What every shell is given from `nibd`'s environment: the language, the time zone, and
 *  the certificates the entrypoint put in place for the host's HTTPS (4.2, 4.8). */
const PASSED = [
  'PATH',
  'LANG',
  'LC_ALL',
  'TZ',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'REQUESTS_CA_BUNDLE',
  'CURL_CA_BUNDLE',
  'GIT_SSL_CAINFO',
]

function numberOf(value: string | undefined, fallback: number): number {
  const number = Number(value)
  return value && Number.isSafeInteger(number) && number > 0 ? number : fallback
}

function main(): void {
  const env = process.env
  const secret = env.NIBD_SECRET ?? ''
  delete env.NIBD_SECRET

  const root = process.getuid?.() === 0
  const user = root ? userOf(env.NIBD_USER ?? 'nib') : null
  const home = user?.home ?? homedir()
  const shell = user?.shell ?? env.SHELL ?? (existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh')
  const name = user?.name ?? userInfo().username
  const pidsMax = numberOf(env.NIBD_PIDS_MAX, PIDS_MAX)

  const sessionEnv: Record<string, string> = {
    HOME: home,
    USER: name,
    LOGNAME: name,
    SHELL: shell,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    LANG: 'C.UTF-8',
  }
  for (const key of PASSED) {
    const value = env[key]
    if (value) sessionEnv[key] = value
  }

  const nibd = new Nibd({
    state: env.NIBD_STATE ?? '/var/lib/nibd',
    home,
    shell,
    user,
    env: sessionEnv,
    pidsMax,
    cgroups: root ? Cgroups.open(pidsMax) : null,
    activityEvery: numberOf(env.NIBD_ACTIVITY_MS, 30_000),
    homeEvery: numberOf(env.NIBD_HOME_MS, 60 * 60_000),
  })

  const server = serve(nibd, secret)
  server.listen(numberOf(env.NIBD_PORT, PORT), env.NIBD_HOST ?? '0.0.0.0')

  let stopping = false
  const stop = (): void => {
    if (stopping) return
    stopping = true
    // The host gives a stopping machine a grace period; the screens are worth more of
    // it than anything else, so they go first, and the exit does not wait on sockets.
    setTimeout(() => process.exit(0), 8000).unref()
    void nibd.saveAll().finally(() => {
      nibd.stop()
      process.exit(0)
    })
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}

main()
