import { normalizeSystemPrompt } from '@shared/systemPrompt'

describe('normalizeSystemPrompt', () => {
  it('trims surrounding whitespace but keeps inner lines', () => {
    expect(normalizeSystemPrompt('\n  line 1\n\n  line 2  \n')).toBe('line 1\n\n  line 2')
  })

  it('returns undefined for empty or whitespace-only input', () => {
    expect(normalizeSystemPrompt('')).toBeUndefined()
    expect(normalizeSystemPrompt(' \n\t ')).toBeUndefined()
    expect(normalizeSystemPrompt(undefined)).toBeUndefined()
  })
})
