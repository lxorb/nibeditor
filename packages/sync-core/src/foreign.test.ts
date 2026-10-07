import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { foreignCopy, inForeignCopy } from './foreign'

describe('foreignCopy', () => {
  test.each([
    // Proton Drive, Windows: six random characters and the kind's letter.
    ['Hackathon List (# Name clash 2026-10-05 k3x9qaC #).md', 'Proton', 'Hackathon List.md'],
    ['Plan (# Edit conflict 2026-10-05 a1b2c3C #).md', 'Proton', 'Plan.md'],
    ['Plan (# Delete conflict 2026-10-05 a1b2c3C #).md', 'Proton', 'Plan.md'],
    ['Plan (# Temporary renamed 2026-10-05 a1b2c3R #).md', 'Proton', 'Plan.md'],
    ['Plan.md (# Deleted 2026-10-05 a1b2c3D #)', 'Proton', 'Plan.md'],
    ['Assets (# Name clash 2026-10-05 a1b2c3C #)', 'Proton', 'Assets'],
    // Proton Drive, Mac: "Name Clash" and seven characters; and an early build.
    ['Plan (# Name Clash 2026-10-05 Ab3dE9x #).md', 'Proton', 'Plan.md'],
    ['Plan (# Name Clash 823da3ff #).md', 'Proton', 'Plan.md'],
    // Dropbox, with and without the person, and the second one of a day.
    ["Plan (Emil's conflicted copy 2026-10-05).md", 'Dropbox', 'Plan.md'],
    ["Plan (Emil Vinu's conflicted copy 2026-10-05 (1)).md", 'Dropbox', 'Plan.md'],
    ['Plan (conflicted copy 2026-10-05).md', 'Dropbox', 'Plan.md'],
    // Nextcloud and ownCloud.
    ['mydata (conflicted copy 2018-04-10 093612).txt', 'Nextcloud', 'mydata.txt'],
    ['mydata_conflict-20180410-093612.txt', 'ownCloud', 'mydata.txt'],
    // Syncthing.
    ['notes.sync-conflict-20231012-143052-CEIVOCO.md', 'Syncthing', 'notes.md'],
    ['Makefile.sync-conflict-20231012-143052-ABCDEF7', 'Syncthing', 'Makefile'],
    // Seafile.
    ['test.txt (SFConflict name@example.com 2015-03-07-11-30-28)', 'Seafile', 'test.txt'],
    // OneDrive, on a computer with the name Windows gave it.
    ['Report-DESKTOP-4F2K9QX.md', 'OneDrive', 'Report.md'],
    ['Report-LAPTOP-487LQ0T.md', 'OneDrive', 'Report.md'],
    ['Report-LAPTOP-487LQ0TA', 'OneDrive', 'Report'],
  ])('%s is a %s copy of %s', (name, tool, original) => {
    expect(foreignCopy(name)).toEqual({ tool, original })
  })

  test.each([
    // What people call their own notes.
    'Plan.md',
    'Plan (1).md',
    'Plan 2.md',
    'Copy of Plan.md',
    'Plan - Copy.md',
    'Plan-final.md',
    'Plan-A.md',
    'Notes-V2.md',
    'Meeting (conflicted).md',
    'Conflicted copy of my thoughts.md',
    'Why conflicted copy 2026-10-05 matters.md',
    'Name clash.md',
    'Name clash between two modules (#42).md',
    'Proton (# notes #).md',
    'Issue (# Name clash #).md',
    'sync-conflict notes.md',
    'notes.sync-conflict.md',
    'notes_conflict.md',
    'conflict-20180410.md',
    '2026-10-05.md',
    'SFConflict.md',
    // A computer somebody named: a word, and a note can end in one.
    'Report-JOHNS-SURFACE.txt',
    'Trip-DESKTOP.md',
    'Trip-desktop-4f2k9qx.md',
    'Report-DESKTOP-4F2K9QX-notes.md',
    // nib's own copy is a note.
    'Plan (from another device 2026-09-12).md',
    // Close, but not the tool's spelling.
    'Plan (# Name clash 2026-10-05 #).md',
    'Plan (# Name clash 2026-10-05 a1b2 #).md',
    'notes.sync-conflict-2023-143052-CEIVOCO.md',
  ])('%s is somebody’s own', (name) => {
    expect(foreignCopy(name)).toBeNull()
  })

  test('a name of words, digits and brackets is never taken for one', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9 ()'\-_.]{1,40}$/),
        (name) => foreignCopy(name) === null,
      ),
    )
  })

  test('the original is the name without the mark, whatever was around it', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z][A-Za-z ]{0,20}$/),
        fc.constantFrom('.md', '.canvas', '.png', ''),
        (stem, ending) => {
          const copy = `${stem} (# Name clash 2026-10-05 a1b2c3C #)${ending}`
          return foreignCopy(copy)?.original === `${stem}${ending}`
        },
      ),
    )
  })
})

describe('inForeignCopy', () => {
  test('a copy, or anything inside one, either separator', () => {
    expect(inForeignCopy('Work/Plan (# Name clash 2026-10-05 a1b2c3C #).md')).toBe(true)
    expect(inForeignCopy('Work (# Name clash 2026-10-05 a1b2c3C #)/Plan.md')).toBe(true)
    expect(inForeignCopy('C:\\Nib\\Work (# Name clash 2026-10-05 a1b2c3C #)\\Plan.md')).toBe(true)
  })

  test('a note of somebody’s own, at any depth', () => {
    expect(inForeignCopy('Work/Plan (1)/Plan 2.md')).toBe(false)
    expect(inForeignCopy('')).toBe(false)
  })
})
