import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { Cgroups, memoryMax, shellCommand, userOf, type User } from './limits'

const NIB: User = { name: 'nib', uid: 1000, gid: 1000, home: '/home/nib', shell: '/bin/bash' }

test('as root, a shell runs as the user, under the process limit, as a login shell', () => {
  expect(shellCommand('/bin/bash', NIB, 4096, () => true)).toEqual({
    file: '/usr/bin/setpriv',
    args: [
      '--reuid=1000',
      '--regid=1000',
      '--init-groups',
      '--',
      '/bin/sh',
      '-c',
      '/usr/bin/prlimit --nproc=4096 --pid $$ 2>/dev/null; exec "$@"',
      'nib-shell',
      '/bin/bash',
      '-l',
    ],
  })
})

test('as anybody else, it runs as them, still under the limit', () => {
  expect(shellCommand('/bin/zsh', null, 64, () => true)).toEqual({
    file: '/bin/sh',
    args: [
      '-c',
      '/usr/bin/prlimit --nproc=64 --pid $$ 2>/dev/null; exec "$@"',
      'nib-shell',
      '/bin/zsh',
      '-l',
    ],
  })
})

test('where the tools are missing, the shell runs plainly rather than not at all', () => {
  expect(shellCommand('/bin/sh', NIB, 64, () => false)).toEqual({ file: '/bin/sh', args: ['-l'] })
})

test('the user is read from the password file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nibd-passwd-'))
  const passwd = join(dir, 'passwd')
  writeFileSync(
    passwd,
    'root:x:0:0:root:/root:/bin/bash\nnib:x:1000:1000::/home/nib:/usr/bin/fish\n',
  )
  expect(userOf('nib', passwd)).toEqual({ ...NIB, shell: '/usr/bin/fish' })
  expect(userOf('nobody', passwd)).toBeNull()
  expect(userOf('nib', join(dir, 'missing'))).toBeNull()
  rmSync(dir, { recursive: true })
})

test('with no cgroup filesystem to write, there is no cgroup, and nothing fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nibd-cgroup-'))
  expect(Cgroups.open(4096, dir)).toBeNull()
  rmSync(dir, { recursive: true })
})

test('the sessions get the machine’s memory less what nibd keeps for itself', () => {
  const gib = 1024 * 1024 * 1024
  expect(memoryMax('MemTotal:        4194304 kB\nMemFree:  100 kB\n')).toBe(4 * gib - gib / 2)
  expect(memoryMax('MemTotal:         524288 kB\n')).toBeNull()
  expect(memoryMax('nothing here')).toBeNull()
})
