import { beforeAll, describe, expect, it } from 'vitest'

import { type Registrable, registrable, typedSite } from './sites'

let list: Registrable

beforeAll(async () => {
  list = await registrable()
})

const site = (typed: string) => typedSite(typed, list)

describe('a site typed in', () => {
  it('is the registrable domain of whatever address it was', () => {
    expect(site('https://mail.google.com/mail/u/0/#inbox')).toBe('google.com')
    expect(site('mail.google.com')).toBe('google.com')
    expect(site('  Mail.Google.COM  ')).toBe('google.com')
    expect(site('news.bbc.co.uk')).toBe('bbc.co.uk')
    expect(site('moodle-app2.let.ethz.ch')).toBe('ethz.ch')
    expect(site('http://user:secret@shop.example:8443/cart?x=1')).toBe('shop.example')
    expect(site('example.com.')).toBe('example.com')
  })

  it('takes a wildcard the way Chrome writes one', () => {
    expect(site('*.bank.example')).toBe('bank.example')
    expect(site('[*.]bank.example')).toBe('bank.example')
  })

  it('keeps two people’s pages on a shared host apart', () => {
    expect(site('emil.github.io')).toBe('emil.github.io')
  })

  it('writes an international name the way the address does', () => {
    expect(site('https://münchen.de/rathaus')).toBe('xn--mnchen-3ya.de')
  })

  it('keeps an address or this machine as its own site', () => {
    expect(site('localhost:8080')).toBe('localhost')
    expect(site('http://127.0.0.1:5173/')).toBe('127.0.0.1')
    expect(site('[::1]')).toBe('[::1]')
  })

  it('refuses what is not a site', () => {
    for (const typed of [
      '',
      '   ',
      'gmail',
      'co.uk',
      'com',
      'two words.com',
      'javascript:alert(1)',
      'ftp://files.example/',
      'file:///C:/notes',
      'https://',
    ]) {
      expect(site(typed), typed).toBeNull()
    }
  })
})
