import { describe, expect, test } from 'vitest'
import { pokeSpace } from '../src/hub/poke'
import { testEnv } from './harness'

describe('a poke', () => {
  test('never fails the write it is about', async () => {
    const env = testEnv()
    const waited: Promise<unknown>[] = []
    await expect(
      pokeSpace(env, { waitUntil: (promise) => waited.push(promise) }, 'space', 1),
    ).resolves.toBeUndefined()
    await Promise.all(waited)
  })
})
