import { describe, expect, test } from 'vitest'
import type { ModelInfo } from '../chat/types'
import type { Provider } from '../providers'
import { type Offered, routed } from './route'

const model = (id: string, name = id): ModelInfo => ({
  id,
  name,
  window: null,
  efforts: ['auto'],
  images: false,
  fast: false,
})

const CLAUDE: Provider = { id: 'claude-code', kind: 'claude-code', name: '', model: '' }
const CODEX: Provider = { id: 'codex', kind: 'codex', name: '', model: '' }

const OFFERED: Offered[] = [
  { provider: CLAUDE, models: [model('opus', 'Opus 5.5'), model('sonnet'), model('haiku')] },
  {
    provider: CODEX,
    models: [model('gpt-6-astra', 'GPT-6 Astra'), model('gpt-6.1-sol'), model('gpt-6-luna')],
  },
]

describe('which model a helper runs on', () => {
  test('Opus asking for Astra gets OpenAI’s Astra', () => {
    expect(routed('astra', OFFERED, CLAUDE)).toEqual({ provider: CODEX, model: 'gpt-6-astra' })
    expect(routed('gpt-6-astra', OFFERED, CLAUDE)).toEqual({
      provider: CODEX,
      model: 'gpt-6-astra',
    })
  })

  test('Astra asking for Opus gets Claude’s, by id or by name', () => {
    expect(routed('opus', OFFERED, CODEX)).toEqual({ provider: CLAUDE, model: 'opus' })
    expect(routed('Opus 5.5', OFFERED, CODEX)).toEqual({ provider: CLAUDE, model: 'opus' })
  })

  test('nothing asked is the asking agent’s own provider and its default model', () => {
    expect(routed('', OFFERED, CODEX)).toEqual({ provider: CODEX, model: '' })
    expect(routed('  ', OFFERED, null)).toEqual({ provider: CLAUDE, model: '' })
  })

  test('the asking agent’s provider is asked first where two have the word', () => {
    const both: Offered[] = [
      { provider: CLAUDE, models: [model('opus')] },
      { provider: CODEX, models: [model('opus-compatible')] },
    ]
    expect(routed('opus', both, CODEX)).toEqual({ provider: CLAUDE, model: 'opus' })
    expect(routed('compat', both, CLAUDE)).toEqual({ provider: CODEX, model: 'opus-compatible' })
  })

  test('a word nobody has is refused with the models there are', () => {
    const said = routed('gemini', OFFERED, CLAUDE)
    expect(said).toEqual({
      refused:
        'no model called "gemini" is offered. Models: opus, sonnet, haiku, gpt-6-astra, gpt-6.1-sol, gpt-6-luna',
    })
    expect(routed('x', [], null)).toEqual({ refused: 'no model called "x" is offered' })
    expect(routed('', [], null)).toEqual({ refused: 'there is no AI provider set up' })
  })
})
