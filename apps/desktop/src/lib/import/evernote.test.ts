import { describe, expect, test } from 'vitest'

import { readEvernote } from './evernote'
import { md5 } from './md5'
import type { ImportPlan } from './plan'
import { sourceOf, type Source } from './sources'

/** Four bytes, so the hash in the fixture is the hash of something real. */
const PICTURE = Uint8Array.from([1, 2, 3, 4])
const BASE64 = 'AQIDBA=='
const HASH = md5(PICTURE)

function enex(notes: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">
<en-export export-date="20260101T090000Z" application="Evernote">
${notes}
</en-export>`
}

function file(path: string, body: string): Source {
  return sourceOf(path, new TextEncoder().encode(body))
}

function noteAt(plan: ImportPlan, path: string): string {
  const found = plan.files.find((one) => one.path === path)
  if (found?.kind !== 'note') throw new Error(`no note at ${path}`)
  return found.text
}

const NOTE = `  <note>
    <title>Trip to Iceland</title>
    <content><![CDATA[<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
<en-note><div>We flew on <b>Monday</b>.</div><div><ul><li>Warm socks</li></ul></div>
<div><en-media type="image/png" hash="${HASH}"/></div></en-note>]]></content>
    <created>20260102T120000Z</created>
    <updated>20260304T130000Z</updated>
    <tag>travel</tag>
    <tag>two words</tag>
    <resource>
      <data encoding="base64">${BASE64}</data>
      <mime>image/png</mime>
      <resource-attributes>
        <file-name>glacier.png</file-name>
      </resource-attributes>
    </resource>
  </note>`

describe('an Evernote export', () => {
  test('becomes a note with its words, its dates and its tags', async () => {
    const plan = await readEvernote([file('Travel.enex', enex(NOTE))])

    const text = noteAt(plan, 'Trip to Iceland.md')
    expect(text).toContain('date: 2026-01-02')
    expect(text).toContain('updated: 2026-03-04')
    expect(text).toContain('tags: [travel, two-words]')
    expect(text).toContain('We flew on **Monday**.')
    expect(text).toContain('- Warm socks')
  })

  test('the picture in the note is the picture that was in the note', async () => {
    const plan = await readEvernote([file('Travel.enex', enex(NOTE))])

    const picture = plan.files.find((one) => one.kind === 'file')
    expect(picture?.path).toBe('assets/glacier.png')
    expect(picture?.kind === 'file' && [...picture.bytes]).toEqual([1, 2, 3, 4])
    expect(noteAt(plan, 'Trip to Iceland.md')).toContain('![](assets/glacier.png)')
  })

  test('a file that is not a picture becomes a link to the file', async () => {
    const paper = `  <note>
    <title>Paper</title>
    <content><![CDATA[<en-note><div><en-media type="application/pdf" hash="${HASH}"/></div></en-note>]]></content>
    <resource>
      <data encoding="base64">${BASE64}</data>
      <mime>application/pdf</mime>
      <resource-attributes><file-name>report.pdf</file-name></resource-attributes>
    </resource>
  </note>`

    const plan = await readEvernote([file('Work.enex', enex(paper))])

    expect(noteAt(plan, 'Paper.md')).toContain('[report.pdf](assets/report.pdf)')
  })

  test('a checkbox is a task', async () => {
    const list = `  <note>
    <title>Packing</title>
    <content><![CDATA[<en-note><div><en-todo checked="true"/>Passport</div><div><en-todo/>Socks</div></en-note>]]></content>
  </note>`

    const text = noteAt(await readEvernote([file('A.enex', enex(list))]), 'Packing.md')

    expect(text).toContain('- [x] Passport')
    expect(text).toContain('- [ ] Socks')
  })

  // Evernote draws a checklist as one checkbox per line, each in a div of its own.
  // Read as a list per line, the lines came out a blank line apart - one loose list,
  // spaced like paragraphs - where the note had been a checklist.
  test('checkboxes one under another are one checklist', async () => {
    const list = `  <note>
    <title>Packing</title>
    <content><![CDATA[<en-note><div><en-todo checked="true"/>Passport</div>
<div><en-todo/>Socks</div><div><en-todo/>Charger</div><div>After the list.</div></en-note>]]></content>
  </note>`

    const text = noteAt(await readEvernote([file('A.enex', enex(list))]), 'Packing.md')

    expect(text).toContain('- [x] Passport\n- [ ] Socks\n- [ ] Charger\n')
    expect(text).toContain('After the list.')
  })

  test('encrypted text is marked and counted rather than quietly dropped', async () => {
    const secret = `  <note>
    <title>Secret</title>
    <content><![CDATA[<en-note><div>Before</div><div><en-crypt cipher="AES">gibberish</en-crypt></div></en-note>]]></content>
  </note>`

    const plan = await readEvernote([file('A.enex', enex(secret))])

    expect(noteAt(plan, 'Secret.md')).toContain('…')
    expect(plan.lost[0]?.values).toEqual({ count: 1 })
    expect(plan.lost[0]?.text).toContain('encrypted')
  })

  test('an attachment with no name of its own is named after its bytes', async () => {
    const unnamed = `  <note>
    <title>Shot</title>
    <content><![CDATA[<en-note><en-media type="image/jpeg" hash="${HASH}"/></en-note>]]></content>
    <resource><data encoding="base64">${BASE64}</data><mime>image/jpeg</mime></resource>
  </note>`

    const plan = await readEvernote([file('A.enex', enex(unnamed))])

    expect(plan.files.find((one) => one.kind === 'file')?.path).toBe(
      `assets/${HASH.slice(0, 16)}.jpg`,
    )
  })

  test('two notebooks become two folders, and one becomes none', async () => {
    const several = await readEvernote([
      file('Travel.enex', enex(NOTE)),
      file('Work.enex', enex(NOTE)),
    ])

    expect(several.files.filter((one) => one.kind === 'note').map((one) => one.path)).toEqual([
      'Travel/Trip to Iceland.md',
      'Work/Trip to Iceland.md',
    ])
    // A note in a folder still points at the picture, which is a level up.
    expect(noteAt(several, 'Travel/Trip to Iceland.md')).toContain('![](../assets/glacier.png)')

    const one = await readEvernote([file('Travel.enex', enex(NOTE))])
    expect(one.files.some((file_) => file_.path === 'Trip to Iceland.md')).toBe(true)
  })

  test('two notes with one title are stepped apart', async () => {
    const twice = `${NOTE}\n${NOTE}`
    const plan = await readEvernote([file('A.enex', enex(twice))])

    const notes = plan.files.filter((one) => one.kind === 'note').map((one) => one.path)
    expect(notes).toEqual(['Trip to Iceland.md', 'Trip to Iceland 2.md'])
  })

  test('a note with no title at all still gets a name', async () => {
    const bare = `  <note>
    <content><![CDATA[<en-note><div>Some words that will do</div></en-note>]]></content>
  </note>`

    const plan = await readEvernote([file('A.enex', enex(bare))])

    expect(plan.files[0]?.path).toBe('Some words that will do.md')
  })
})
