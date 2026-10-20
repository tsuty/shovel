import { describe, expect, it } from 'vitest'
import { mergeConfigOptions } from '@main/acp/configOptions'
import type { ConfigOption } from '@shared/types/session'

function select(configId: string, currentValue: string): ConfigOption {
  return { configId, category: configId, label: configId, kind: 'select', currentValue, options: [] }
}

describe('mergeConfigOptions', () => {
  it('replaces options with the same configId and keeps the rest in order', () => {
    const current = [select('mode', 'default'), select('model', 'opus'), select('effort', 'high')]
    const merged = mergeConfigOptions(current, [select('mode', 'plan')])
    expect(merged.map((o) => [o.configId, o.currentValue])).toEqual([
      ['mode', 'plan'],
      ['model', 'opus'],
      ['effort', 'high']
    ])
  })

  it('appends options that were not in the cache', () => {
    const merged = mergeConfigOptions([select('mode', 'default')], [select('model', 'sonnet')])
    expect(merged.map((o) => o.configId)).toEqual(['mode', 'model'])
  })
})
