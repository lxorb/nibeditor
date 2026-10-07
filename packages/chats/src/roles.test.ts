import { describe, expect, it } from 'vitest'
import { type Action, may, mayEvent } from './roles'
import type { Event, Posting, Role } from './types'

/** 4.6's table, row by row: read, write and owner, with writers posting and without. */
const TABLE: [Action, Posting, [boolean, boolean, boolean]][] = [
  ['read', 'writers', [true, true, true]],
  ['read', 'owner', [true, true, true]],
  ['post', 'writers', [false, true, true]],
  ['post', 'owner', [false, false, true]],
  ['edit-own', 'writers', [false, true, true]],
  ['edit-own', 'owner', [false, true, true]],
  ['delete-own', 'owner', [false, true, true]],
  ['pin', 'writers', [false, true, true]],
  ['topic', 'writers', [false, true, true]],
  ['delete-any', 'writers', [false, false, true]],
  ['posting', 'writers', [false, false, true]],
  ['slowmode', 'writers', [false, false, true]],
]

const ROLES: Role[] = ['read', 'write', 'owner']

describe('who may do what', () => {
  it.each(TABLE)('%s where %s post', (action, posting, answers) => {
    expect(ROLES.map((role) => may(role, action, posting))).toEqual(answers)
  })

  it('gives nobody without a role anything', () => {
    for (const [action, posting] of TABLE) expect(may(null, action, posting)).toBe(false)
  })
})

describe('who may send an event', () => {
  const target = '01K6Z8Q3V8A0000000000000AB'
  const post: Event = { kind: 'post', id: 'e1', message: 'm1', body: 'hi' }
  const react: Event = { kind: 'react', id: 'e2', target, emoji: '👍', on: true }
  const edit: Event = { kind: 'edit', id: 'e3', target, body: 'hello' }
  const erase: Event = { kind: 'delete', id: 'e4', target }
  const topic: Event = { kind: 'meta', id: 'e5', topic: 'Chapters' }
  const both: Event = { kind: 'meta', id: 'e6', topic: 'Chapters', posting: 'owner' }
  const nothing: Event = { kind: 'meta', id: 'e7' }

  it('lets a reader send nothing, a reaction included', () => {
    for (const event of [post, react, edit, erase, topic]) {
      expect(mayEvent('read', event, true, 'writers')).toBe(false)
    }
  })

  it('lets a writer post and react unless only the owner posts', () => {
    expect(mayEvent('write', post, false, 'writers')).toBe(true)
    expect(mayEvent('write', react, false, 'writers')).toBe(true)
    expect(mayEvent('write', post, false, 'owner')).toBe(false)
    expect(mayEvent('write', react, false, 'owner')).toBe(false)
  })

  it('lets nobody edit somebody else’s message, the owner included', () => {
    expect(mayEvent('write', edit, true, 'writers')).toBe(true)
    expect(mayEvent('owner', edit, false, 'writers')).toBe(false)
  })

  it('lets the owner delete anybody’s message, a writer only their own', () => {
    expect(mayEvent('write', erase, true, 'writers')).toBe(true)
    expect(mayEvent('write', erase, false, 'writers')).toBe(false)
    expect(mayEvent('owner', erase, false, 'writers')).toBe(true)
  })

  it('asks for the strictest key a settings change sets', () => {
    expect(mayEvent('write', topic, false, 'writers')).toBe(true)
    expect(mayEvent('write', both, false, 'writers')).toBe(false)
    expect(mayEvent('owner', both, false, 'writers')).toBe(true)
  })

  it('takes a settings change that sets nothing from nobody', () => {
    expect(mayEvent('owner', nothing, false, 'writers')).toBe(false)
  })
})
