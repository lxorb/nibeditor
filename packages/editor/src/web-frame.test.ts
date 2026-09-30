import { providers } from '@nib/markdown/providers'
import { describe, expect, test } from 'vitest'
import {
  FRAME_REFERRER,
  frameHeight,
  framePermissions,
  frameSandbox,
  framedPage,
  htmlFrameDocument,
} from './web-frame'

describe('what a card may actually have', () => {
  test('every provider gets the sandbox its row asked for', () => {
    // The table is the policy, and nothing here narrows what it says. A row that
    // stopped surviving this is a row whose frame would not work.
    for (const provider of providers()) {
      expect(frameSandbox(provider.sandbox), provider.id).toBe(provider.sandbox)
      expect(framePermissions(provider.allow), provider.id).toBe(provider.allow ?? '')
    }
  })

  test('and nothing a card asked for beyond the list', () => {
    // A note can be pasted, synced or shared. One that arrived with a wider
    // sandbox written into it gets only what is allowed here.
    expect(frameSandbox('allow-scripts allow-top-navigation allow-modals allow-downloads')).toBe(
      'allow-scripts',
    )
    expect(frameSandbox('allow-top-navigation-by-user-activation')).toBe('')
    expect(framePermissions('camera; microphone; geolocation; fullscreen')).toBe('fullscreen')
    expect(framePermissions('payment')).toBe('')
  })

  test('an empty sandbox is a sandbox, not a missing one', () => {
    // `sandbox=""` takes everything away; leaving the attribute off takes nothing
    // away at all, which is why the caller always writes one.
    expect(frameSandbox(undefined)).toBe('')
    expect(frameSandbox('nonsense')).toBe('')
  })
})

describe('the referrer a frame sends', () => {
  test('is the origin, because no referrer at all is a video that will not play', () => {
    // YouTube answers an embedder that sends none with "Error 153" where the
    // video should be. The origin says which site and never which note.
    expect(FRAME_REFERRER).toBe('origin')
  })
})

describe('the document a block of the note’s own HTML runs in', () => {
  test('carries the block, and the one script that says how tall it turned out', () => {
    const made = htmlFrameDocument('<div id="dial"></div>\n<script>run()</script>')
    expect(made).toContain('<div id="dial"></div>')
    expect(made).toContain('<script>run()</script>')
    // The reporter last, so a block whose own script throws still says how much
    // room it needs, and a block ending in a script has already run.
    expect(made.indexOf('nib-html-frame')).toBeGreaterThan(made.indexOf('<div id="dial">'))
    expect(made).toContain('postMessage')
  })

  test('and says nothing else about the block', () => {
    // No base, no stylesheet of the app's, nothing that could reach out: what
    // keeps the block harmless is the sandbox around it, not a rewrite of it.
    const made = htmlFrameDocument('<p>words</p>')
    expect(made).not.toContain('<base')
    expect(made).not.toContain('http')
  })
})

describe('how tall an interactive block may say it is', () => {
  const said = (height: unknown) => frameHeight({ nib: 'nib-html-frame', height })

  test('what it asked for, within reason', () => {
    expect(said(320)).toBe(320)
    expect(said(240.2)).toBe(241)
    // A frame reporting nothing is one nobody can press again, and one asking for
    // ten thousand pixels is a note that pushed the page off the screen.
    expect(said(0)).toBe(40)
    expect(said(99999)).toBe(2400)
  })

  test('and nothing at all from a message that is not one of ours', () => {
    expect(frameHeight({ height: 300 })).toBe(null)
    expect(frameHeight({ nib: 'nib-run', height: 300 })).toBe(null)
    expect(said('300')).toBe(null)
    expect(said(Number.NaN)).toBe(null)
    expect(said(Number.POSITIVE_INFINITY)).toBe(null)
    expect(frameHeight(null)).toBe(null)
    expect(frameHeight('nib-html-frame')).toBe(null)
  })
})

describe('the page a card may frame', () => {
  test('one asked for over https, and only that', () => {
    expect(framedPage('https://www.youtube-nocookie.com/embed/a')).toBe(
      'https://www.youtube-nocookie.com/embed/a',
    )
    for (const address of [
      'http://x.test/a',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'blob:https://x.test/a',
      'about:blank',
      '/local/page',
      '',
    ]) {
      expect(framedPage(address), address).toBe(null)
    }
  })

  test('and never one on the page’s own origin, however it is spelled', () => {
    const own = 'https://nibeditor.com'
    for (const address of [
      'https://nibeditor.com/',
      'https://NIBEDITOR.com/v1/me',
      'https://nibeditor.com:443/anything?at=1',
    ]) {
      expect(framedPage(address, own), address).toBe(null)
    }

    // Somebody else's origin is somebody else's, a published site under the same
    // name included: its sandbox grants it its own origin and never this one.
    expect(framedPage('https://www.youtube.com/embed/a', own)).toBe(
      'https://www.youtube.com/embed/a',
    )
    expect(framedPage('https://field.nibeditor.com/', own)).toBe('https://field.nibeditor.com/')
  })
})
