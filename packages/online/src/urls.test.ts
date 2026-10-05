import { describe, expect, it } from 'vitest'
import {
  callbacksIn,
  hostOf,
  isCallbackOf,
  isLoopbackUrl,
  isWebUrl,
  LONGEST_URL,
  loopbackOrigin,
} from './urls'

/** Claude Code's sign-in, as its binary builds it (read 2026-10-05). */
const CLAUDE =
  'https://claude.ai/oauth/authorize?code=true&client_id=9d1c&response_type=code' +
  '&redirect_uri=http%3A%2F%2Flocalhost%3A54545%2Fcallback&scope=user%3Ainference&state=abc'

describe('what a machine may open', () => {
  it.each([
    'https://github.com/login/device',
    'http://example.com',
    CLAUDE,
    'http://localhost:3000/',
  ])('the web: %s', (url) => {
    expect(isWebUrl(url)).toBe(true)
  })

  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'mailto:a@b.c',
    'ms-settings:privacy',
    'vscode://file/x',
    'not a url',
    '',
    `https://a.b/${'x'.repeat(LONGEST_URL)}`,
  ])('nothing else: %s', (url) => {
    expect(isWebUrl(url)).toBe(false)
  })

  it('is not fooled by a non-string', () => {
    expect(isWebUrl(42)).toBe(false)
    expect(isWebUrl(null)).toBe(false)
  })

  it('shows an address by its host', () => {
    expect(hostOf('https://github.com/login/device')).toBe('github.com')
    expect(hostOf('http://localhost:1455/x')).toBe('localhost:1455')
  })
})

describe('the loopback callback', () => {
  it.each([
    ['http://localhost:54545/callback?code=x', 'http://localhost:54545'],
    ['http://127.0.0.1:1455/auth/callback', 'http://127.0.0.1:1455'],
    ['http://[::1]:8080/', 'http://[::1]:8080'],
    ['http://LOCALHOST:9/', 'http://localhost:9'],
  ])('is a loopback origin with a port: %s', (url, origin) => {
    expect(loopbackOrigin(url)).toBe(origin)
    expect(isLoopbackUrl(url)).toBe(true)
  })

  it.each([
    'http://localhost/callback',
    'https://localhost:443/x',
    'http://example.com:54545/callback',
    'http://localhost.evil.com:1/x',
    'http://10.0.0.1:80/',
    'http://169.254.169.254:80/latest',
  ])('is nothing else: %s', (url) => {
    expect(loopbackOrigin(url)).toBeNull()
  })

  it('finds the callback an opened address names, by any parameter', () => {
    expect(callbacksIn(CLAUDE)).toEqual(['http://localhost:54545'])
    expect(callbacksIn('https://a.b/?cb=http://127.0.0.1:1/x&r=http://127.0.0.1:1/y')).toEqual([
      'http://127.0.0.1:1',
    ])
    expect(callbacksIn('https://github.com/login/device')).toEqual([])
    expect(callbacksIn('nonsense')).toEqual([])
  })

  it('takes only a landing on the origin the opened address named', () => {
    expect(isCallbackOf(CLAUDE, 'http://localhost:54545/callback?code=1&state=abc')).toBe(true)
    expect(isCallbackOf(CLAUDE, 'http://localhost:54546/callback?code=1')).toBe(false)
    expect(isCallbackOf(CLAUDE, 'https://claude.ai/oauth/authorize')).toBe(false)
    expect(isCallbackOf('https://github.com/', 'http://localhost:54545/callback')).toBe(false)
  })
})
