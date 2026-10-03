/** nib's one scale, what each API is sent for it, and what a refusal teaches. */

import { describe, expect, test } from 'vitest'
import {
  nearest,
  nextEffort,
  ordered,
  refusesEffort,
  refusesReasoning,
  supportedIn,
  takesNoEffort,
  wireEffort,
  within,
} from './effort'

describe('the scale', () => {
  test('keeps its own order, auto first, each level once', () => {
    expect(ordered(['max', 'low', 'high', 'low'])).toEqual(['auto', 'low', 'high', 'max'])
  })

  test('Alt+T steps up through the model’s levels and wraps', () => {
    const levels = ordered(['low', 'medium', 'high'])
    expect(nextEffort('auto', levels)).toBe('low')
    expect(nextEffort('medium', levels)).toBe('high')
    expect(nextEffort('high', levels)).toBe('auto')
    expect(nextEffort('max', levels)).toBe('auto')
  })

  test('a level the model does not have becomes the nearest it does, the lower of two', () => {
    expect(nearest('max', ['auto', 'low', 'high', 'xhigh'])).toBe('xhigh')
    expect(nearest('medium', ['auto', 'low', 'high'])).toBe('low')
    expect(nearest('minimal', ['auto'])).toBe('auto')
    expect(within('high', ['auto', 'high'])).toBe('high')
    expect(within('off', ['auto', 'low', 'medium'])).toBe('low')
  })
})

describe('what is sent', () => {
  test('auto is nothing at all, everywhere', () => {
    expect(wireEffort('anthropic', 'auto')).toBeNull()
    expect(wireEffort('responses', 'auto')).toBeNull()
    expect(wireEffort('completions', 'auto')).toBeNull()
  })

  test('off is OpenAI’s none, and Claude has neither off nor minimal', () => {
    expect(wireEffort('responses', 'off')).toBe('none')
    expect(wireEffort('responses', 'xhigh')).toBe('xhigh')
    expect(wireEffort('anthropic', 'off')).toBeNull()
    expect(wireEffort('anthropic', 'minimal')).toBeNull()
    expect(wireEffort('anthropic', 'max')).toBe('max')
  })
})

describe('a refusal, in OpenAI’s own words (recorded 2026-10-03)', () => {
  const unsupportedValue =
    "Unsupported value: 'max' is not supported with the 'gpt-5.4-mini' model. Supported values are: 'none', 'low', 'medium', 'high', and 'xhigh'."
  const unsupportedParameter =
    "Unsupported parameter: 'reasoning.effort' is not supported with this model."

  test('a level the model does not take names the levels it does', () => {
    expect(refusesEffort(unsupportedValue, 'reasoning.effort')).toBe(true)
    expect(takesNoEffort(unsupportedValue, 'unsupported_value')).toBe(false)
    expect(supportedIn(unsupportedValue)).toEqual(['auto', 'off', 'low', 'medium', 'high', 'xhigh'])
  })

  test('a model that takes no effort at all says so as a parameter', () => {
    expect(refusesEffort(unsupportedParameter, 'reasoning.effort')).toBe(true)
    expect(takesNoEffort(unsupportedParameter, 'unsupported_parameter')).toBe(true)
    expect(supportedIn(unsupportedParameter)).toBeNull()
  })

  test('a refusal about something else is not about effort', () => {
    expect(refusesEffort('Incorrect API key provided.')).toBe(false)
    expect(refusesReasoning('Incorrect API key provided.')).toBe(false)
    expect(
      refusesReasoning("Unsupported parameter: 'reasoning.summary'", 'reasoning.summary'),
    ).toBe(true)
  })
})
