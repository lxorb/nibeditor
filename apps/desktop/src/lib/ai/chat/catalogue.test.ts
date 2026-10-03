/** Each provider's own list, read: nothing about a model is written down in nib. */

import { beforeEach, describe, expect, test } from 'vitest'
import {
  anthropicModels,
  compatibleModels,
  openaiModels,
  planModels,
  unlisted,
  windowIn,
  withLearnt,
} from './catalogue'
import { forgetLearnt, learn } from './learned'

beforeEach(() => forgetLearnt())

describe('Claude’s list', () => {
  test('says the window, the efforts, thinking, pictures and compaction from its capabilities', () => {
    const [opus, haiku] = anthropicModels({
      data: [
        {
          id: 'claude-opus-5-5',
          display_name: 'Claude Opus 5.5',
          max_input_tokens: 1_000_000,
          max_tokens: 128_000,
          capabilities: {
            image_input: { supported: true },
            thinking: { supported: true, types: { adaptive: { supported: true } } },
            effort: {
              supported: true,
              low: { supported: true },
              medium: { supported: true },
              high: { supported: true },
              xhigh: { supported: true },
              max: { supported: true },
            },
            compaction: { supported: true },
          },
        },
        {
          id: 'claude-haiku-4-5',
          display_name: 'Claude Haiku 4.5',
          max_input_tokens: 200_000,
          capabilities: { image_input: { supported: true }, effort: { supported: false } },
        },
      ],
    })
    expect(opus).toEqual({
      id: 'claude-opus-5-5',
      name: 'Claude Opus 5.5',
      window: 1_000_000,
      efforts: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
      images: true,
      fast: false,
      output: 128_000,
      thinking: true,
      compaction: true,
    })
    expect(haiku).toMatchObject({
      window: 200_000,
      efforts: ['auto'],
      thinking: false,
      compaction: false,
    })
  })
})

describe('OpenAI’s list', () => {
  test('is names, the ones for talking to, every level until one is refused', () => {
    const models = openaiModels({
      data: [{ id: 'gpt-5.5' }, { id: 'text-embedding-3-large' }, { id: 'whisper-1' }],
    })
    expect(models.map((one) => one.id)).toEqual(['gpt-5.5'])
    expect(models[0]?.efforts).toContain('max')
    expect(models[0]?.window).toBeNull()
  })

  test('what a refusal taught comes back with it', () => {
    learn('openai', 'gpt-5.4-mini', { refused: ['max', 'minimal'], window: 400_000 })
    const [model] = openaiModels({ data: [{ id: 'gpt-5.4-mini' }] })
    if (!model) throw new Error('listed')
    const known = withLearnt('openai', model)
    expect(known.efforts).not.toContain('max')
    expect(known.efforts).not.toContain('minimal')
    expect(known.window).toBe(400_000)
    learn('openai', 'gpt-4.1-mini', { reasons: false })
    expect(
      unlisted({ id: 'openai', kind: 'openai', name: 'OpenAI', model: '' }, 'gpt-4.1-mini').efforts,
    ).toEqual(['auto'])
  })
})

describe('a ChatGPT plan’s catalogue', () => {
  test('is the rows meant to be listed, in its own order, with what each row says', () => {
    const models = planModels({
      models: [
        {
          slug: 'gpt-6.1-sol',
          display_name: 'GPT-6.1 Sol',
          visibility: 'list',
          context_window: 400_000,
          supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }, { effort: 'max' }],
          input_modalities: ['text', 'image'],
        },
        { slug: 'hidden', visibility: 'hide' },
        { slug: 'gpt-6-luna', display_name: 'GPT-6 Luna', visibility: 'list' },
      ],
    })
    expect(models.map((one) => one.id)).toEqual(['gpt-6.1-sol', 'gpt-6-luna'])
    expect(models[0]).toMatchObject({
      name: 'GPT-6.1 Sol',
      window: 400_000,
      efforts: ['auto', 'low', 'high', 'max'],
      images: true,
      fast: false,
    })
  })
})

describe('a compatible server’s list', () => {
  test('reads whichever context field the server fills in, and offers effort only where advertised', () => {
    const [router, studio, bare] = compatibleModels({
      data: [
        {
          id: 'anthropic/claude-sonnet-5',
          name: 'Sonnet',
          context_length: 1_000_000,
          supported_parameters: ['tools', 'reasoning'],
          architecture: { input_modalities: ['text', 'image'] },
        },
        { id: 'qwen3', max_context_length: 32_768 },
        { id: 'llama' },
      ],
    })
    expect(router).toMatchObject({ name: 'Sonnet', window: 1_000_000, images: true })
    expect(router?.efforts).toContain('high')
    expect(studio).toMatchObject({ window: 32_768, efforts: ['auto'] })
    expect(bare).toMatchObject({ window: null, efforts: ['auto'], images: false })
  })
})

describe('a window a refusal names', () => {
  test('is read in the shapes the providers write it', () => {
    expect(
      windowIn(
        "This model's maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens.",
      ),
    ).toBe(128_000)
    expect(windowIn('prompt is too long: 210000 tokens > 200000 maximum')).toBe(200_000)
    expect(windowIn('Incorrect API key provided.')).toBeNull()
  })
})
