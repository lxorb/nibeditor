import { describe, expect, test } from 'vitest'
import manifest from '../../../even.app.json'

/** The manifest, held to the rules `evenhub pack` holds it to.
 *
 *  This file exists because none of them was checked anywhere and one of them was
 *  wrong: the microphone permission was written as `microphone`, which is what it
 *  is called everywhere except in the CLI, and the pack failed at the end of a
 *  release with
 *
 *      permissions.1.name: each permission must be an object with name
 *      (g2-microphone, phone-microphone, album, location, network, camera)
 *
 *  Every rule below is one the CLI enforces, and every one of them is silent until
 *  a release. A test is a cheaper place to find out than a release is. */
describe('the manifest a build is packed from', () => {
  /** The permission names the CLI takes, read off its own error message on
   *  2026-09-09. There is no published list. */
  const ALLOWED = ['g2-microphone', 'phone-microphone', 'album', 'location', 'network', 'camera']

  test('names every permission the way the CLI names it', () => {
    for (const one of manifest.permissions) {
      expect(ALLOWED, one.name).toContain(one.name)
    }
  })

  test('says what each permission is for, in a sentence a reader is shown', () => {
    for (const one of manifest.permissions) {
      expect(one.desc.length, one.name).toBeGreaterThan(10)
      expect(one.desc.endsWith('.'), one.name).toBe(true)
    }
  })

  test('asks for both microphones, because it listens through both', () => {
    // The WebView's own recogniser listens on the phone's microphone, and where
    // there is none the glasses' microphone is opened instead. A review checks that
    // every permission asked for is used, and both of these are; see voice.ts.
    const names = manifest.permissions.map((one) => one.name)

    expect(names).toContain('g2-microphone')
    expect(names).toContain('phone-microphone')
  })

  test('whitelists every origin the plugin talks to, and nothing else', () => {
    const network = manifest.permissions.find((one) => one.name === 'network')

    // One entry per full origin: no wildcards, no bare hostnames. The phone app
    // blocks anything not on it before the request leaves the WebView.
    //
    // One origin, and `api.openai.com` is deliberately not it. The account's key is
    // written and never read back, so the plugin has no key to send and Nib makes
    // that request; see services/sync/src/ask. A permission's description has to
    // stay true, and "sign in and keep your notes in step" is now the whole of what
    // the network is for.
    expect(network?.whitelist).toEqual(['https://orden.so'])
    for (const origin of network?.whitelist ?? []) {
      expect(origin, origin).toMatch(/^https:\/\/[a-z0-9.-]+$/)
    }
  })

  test('only the network permission carries a whitelist', () => {
    for (const one of manifest.permissions) {
      if (one.name === 'network') continue
      expect('whitelist' in one, one.name).toBe(false)
    }
  })

  test('keeps the nine keys the CLI schema takes, and no others', () => {
    // Extra keys are dropped silently, which is worth knowing before inventing one.
    expect(Object.keys(manifest).sort()).toEqual([
      'edition',
      'entrypoint',
      'min_app_version',
      'min_sdk_version',
      'name',
      'package_id',
      'permissions',
      'supported_languages',
      'version',
    ])
  })

  test('has a package id of the shape the CLI demands', () => {
    // Reverse domain: no hyphens, no underscores.
    expect(manifest.package_id).toMatch(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/)
  })

  test('is the one edition there is', () => {
    expect(manifest.edition).toBe('202601')
  })

  test('has a name short enough, and one the portal will not read as impersonation', () => {
    expect(manifest.name.length).toBeLessThanOrEqual(20)
    // A name with "Even" in it is rejected, in any case.
    expect(manifest.name.toLowerCase()).not.toContain('even')
  })

  test('has a plain three part version, which is what a bump publishes', () => {
    // No prefix and no pre-release: the workflow sees the bump and publishes.
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  test('points at the page the plugin is, not at the editor', () => {
    expect(manifest.entrypoint).toBe('even.html')
  })

  test('lists only languages the platform has a code for', () => {
    // Swiss German has none, so it is not listed even though the app speaks it.
    const CODES = ['en', 'de', 'fr', 'es', 'it', 'zh', 'ja', 'ko']
    for (const one of manifest.supported_languages) expect(CODES, one).toContain(one)
  })
})
