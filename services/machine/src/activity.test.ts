import { expect, test } from 'vitest'
import { cpuMicros, netBytes } from './activity'

function files(map: Record<string, string>): (file: string) => string {
  return (file) => {
    const text = map[file]
    if (text === undefined) throw new Error(`ENOENT ${file}`)
    return text
  }
}

test("CPU is the cgroup's own count where there is one", () => {
  const read = files({
    '/sys/fs/cgroup/cpu.stat': 'usage_usec 1234567\nuser_usec 1000000\nsystem_usec 234567\n',
    '/proc/stat': 'cpu  1 1 1 1 1 1 1 1 0 0\n',
  })
  expect(cpuMicros(read)).toBe(1234567)
})

test("and the kernel's ticks otherwise, idle and waiting left out", () => {
  const read = files({ '/proc/stat': 'cpu  100 20 30 5000 70 1 2 3 0 0\ncpu0 ...\n' })
  expect(cpuMicros(read)).toBe((100 + 20 + 30 + 1 + 2 + 3) * 10_000)
})

test('neither readable is no figure rather than a wrong one', () => {
  expect(cpuMicros(files({}))).toBeNull()
  expect(netBytes(files({}))).toBeNull()
})

test("the network is every interface's bytes in and out, loopback left out", () => {
  const read = files({
    '/proc/net/dev': [
      'Inter-|   Receive                                                |  Transmit',
      ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
      '    lo: 9999999     100    0    0    0     0          0         0  9999999     100    0    0    0     0       0          0',
      '  eth0: 1000      10    0    0    0     0          0         0    500       5    0    0    0     0       0          0',
      '  eth1: 20      1    0    0    0     0          0         0    30       1    0    0    0     0       0          0',
      '',
    ].join('\n'),
  })
  expect(netBytes(read)).toBe(1000 + 500 + 20 + 30)
})
