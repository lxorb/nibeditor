import { describe, expect, test } from 'vitest'
import { ATTACHMENT_FOLDERS, attachmentFolder, isAttachmentFolder } from './attachments'

const SPACE = '/Notes'

describe('the three folders a picture can go in', () => {
  test('are the only names the setting takes', () => {
    for (const one of ATTACHMENT_FOLDERS) expect(isAttachmentFolder(one), one).toBe(true)

    expect(isAttachmentFolder('vault')).toBe(false)
    expect(isAttachmentFolder(true)).toBe(false)
    expect(isAttachmentFolder(undefined)).toBe(false)
  })
})

describe("the space's assets folder", () => {
  test('is named plainly for a note at the top of the space', () => {
    expect(attachmentFolder('space', '/Notes/Read me.md', SPACE)).toBe('assets')
  })

  test('is reached from wherever in the space the note sits', () => {
    expect(attachmentFolder('space', '/Notes/Work/Plan.md', SPACE)).toBe('../assets')
    expect(attachmentFolder('space', '/Notes/Work/2026/Q1.md', SPACE)).toBe('../../assets')
  })

  test('is worked out the same from a path a platform writes with backslashes', () => {
    expect(
      attachmentFolder('space', String.raw`C:\Nib\Notes\Work\Plan.md`, String.raw`C:\Nib\Notes`),
    ).toBe('../assets')
  })

  test('falls back to one beside a note that is in no space at all', () => {
    // A note no space holds has no space to keep a folder in.
    expect(attachmentFolder('space', '/elsewhere/Notes.md', SPACE)).toBe('assets')
    expect(attachmentFolder('space', '/elsewhere/Notes.md', null)).toBe('assets')
  })

  test('is not claimed by a space that merely starts the same way', () => {
    expect(attachmentFolder('space', '/Notebook/a.md', SPACE)).toBe('assets')
  })
})

describe('beside the note', () => {
  test('is the note’s own folder, which needs no name', () => {
    expect(attachmentFolder('note', '/Notes/Work/Plan.md', SPACE)).toBe('')
  })
})

describe('a folder named after the note', () => {
  test('takes the name and leaves the extension', () => {
    expect(attachmentFolder('named', '/Notes/Read me.md', SPACE)).toBe('Read me')
    expect(attachmentFolder('named', '/Notes/Work/Plan.markdown', SPACE)).toBe('Plan')
  })

  test('reads a backslash path too', () => {
    expect(
      attachmentFolder('named', String.raw`C:\Nib\Notes\Plan.md`, String.raw`C:\Nib\Notes`),
    ).toBe('Plan')
  })
})
