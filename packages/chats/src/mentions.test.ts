import { describe, expect, it } from 'vitest'
import { mentionsIn } from './mentions'
import type { Member } from './types'

const LUCILE: Member = { who: 'user:lucile', name: 'Lucile' }
const MARTIN: Member = { who: 'user:martin', name: 'Lucile Martin' }
const MIA: Member = { who: 'user:mia', name: 'Mia Keller', nick: 'Mimi' }
const BOT: Member = { who: 'program:ci', name: 'CI' }
const MEMBERS = [LUCILE, MARTIN, MIA, BOT]

describe('mentions', () => {
  it('finds people by their name, in any case', () => {
    expect(mentionsIn('@Lucile can you look?', MEMBERS)).toEqual(['user:lucile'])
    expect(mentionsIn('thanks @lucile', MEMBERS)).toEqual(['user:lucile'])
  })

  it('takes the longest name that fits', () => {
    expect(mentionsIn('@Lucile Martin and @Lucile', MEMBERS)).toEqual([
      'user:martin',
      'user:lucile',
    ])
  })

  it('finds a person by their nickname in the space as by their name', () => {
    expect(mentionsIn('@Mimi, @Mia Keller', MEMBERS)).toEqual(['user:mia'])
  })

  it('names each person once, in the order they are first called', () => {
    expect(mentionsIn('@CI then @Lucile then @CI', MEMBERS)).toEqual(['program:ci', 'user:lucile'])
  })

  it('reads @here and @everyone before any member who took the word as a name', () => {
    const here: Member = { who: 'user:here', name: 'here' }
    expect(mentionsIn('@here and @everyone', [...MEMBERS, here])).toEqual(['here', 'everyone'])
  })

  it('ends a name where a word would go on', () => {
    expect(mentionsIn('@Lucile2 @Luciles', MEMBERS)).toEqual([])
    expect(mentionsIn("@Lucile's draft, (@Lucile).", MEMBERS)).toEqual(['user:lucile'])
  })

  it('reads no mention inside an address or after another @', () => {
    expect(mentionsIn('mail lucile@Lucile.ch or @@Lucile', MEMBERS)).toEqual([])
  })

  it('reads no mention inside code', () => {
    expect(mentionsIn('`@Lucile` and ``@here``', MEMBERS)).toEqual([])
    expect(mentionsIn('```\n@Lucile\n```\n@CI', MEMBERS)).toEqual(['program:ci'])
    expect(mentionsIn('~~~ts\n@everyone\n~~~', MEMBERS)).toEqual([])
    expect(mentionsIn('```\n@Lucile never closed', MEMBERS)).toEqual([])
  })

  it('finds nobody where nobody is called', () => {
    expect(mentionsIn('no one here', MEMBERS)).toEqual([])
    expect(mentionsIn('@', MEMBERS)).toEqual([])
    expect(mentionsIn('@Nobody', MEMBERS)).toEqual([])
  })

  it('ignores a member with no name to be called by', () => {
    expect(mentionsIn('@ hello', [{ who: 'user:x', name: ' ' }])).toEqual([])
  })
})
