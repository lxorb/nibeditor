/** The model lists Claude Code (`list_models`, measured on 2.1.280) and Codex
 *  (`model/list`, 0.160.0) answer, as the popover reads them. */

import { describe, expect, test } from 'vitest'
import { modelsIn } from './models'

describe('Claude Code’s list', () => {
  test('is its aliases, with their efforts and the [1m] window', () => {
    const models = modelsIn('claude-code', {
      models: [
        {
          value: 'default',
          resolvedModel: 'claude-opus-5-5[1m]',
          displayName: 'Default (recommended)',
          supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
          supportsFastMode: true,
        },
        { value: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku' },
        { displayName: 'no value' },
      ],
    })
    expect(models).toEqual([
      {
        id: 'default',
        name: 'Default (recommended)',
        window: 1_000_000,
        efforts: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
        images: true,
        fast: false,
      },
      { id: 'haiku', name: 'Haiku', window: null, efforts: ['auto'], images: true, fast: false },
    ])
  })
})

describe('Codex’s list', () => {
  test('is its shown models, their efforts on nib’s scale, pictures and Fast', () => {
    const models = modelsIn('codex', {
      data: [
        {
          id: 'gpt-6.1-sol',
          model: 'gpt-6.1-sol',
          displayName: 'GPT-6.1-Sol',
          hidden: false,
          supportedReasoningEfforts: [
            { reasoningEffort: 'none' },
            { reasoningEffort: 'low' },
            { reasoningEffort: 'xhigh' },
            { reasoningEffort: 'ultra' },
          ],
          inputModalities: ['text', 'image'],
          serviceTiers: [{ id: 'priority', name: 'Fast' }],
        },
        { id: 'hidden-one', model: 'hidden-one', hidden: true },
      ],
    })
    expect(models).toEqual([
      {
        id: 'gpt-6.1-sol',
        name: 'GPT-6.1-Sol',
        window: null,
        efforts: ['auto', 'off', 'low', 'xhigh'],
        images: true,
        fast: true,
      },
    ])
  })

  test('says nothing of an answer that is not a list', () => {
    expect(modelsIn('codex', null)).toEqual([])
    expect(modelsIn('claude-code', 'models')).toEqual([])
  })
})
