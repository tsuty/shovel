import { describe, expect, it } from 'vitest'
import { highestPercent, parsePlanUsage, parseResets } from '../../src/shared/planUsage'

const NOW = Date.UTC(2026, 10, 17, 3, 0)

describe('parsePlanUsage', () => {
  it('0% のとき session にリセット日時が無い', () => {
    const text = [
      'You are currently using your subscription to power your Claude Code usage',
      '',
      'Current session: 0% used',
      'Current week (all models): 0% used · resets Nov 22, 7pm (UTC)'
    ].join('\n')
    expect(parsePlanUsage(text, NOW)).toEqual({
      meters: [
        { kind: 'session', label: null, percent: 0, resetsAt: null },
        { kind: 'week', label: 'all models', percent: 0, resetsAt: Date.UTC(2026, 10, 22, 19, 0) }
      ]
    })
  })

  it('Team プランのモデル別の週の行も読む', () => {
    const text = [
      'You are currently using your subscription to power your Claude Code usage',
      '',
      'Current session: 2% used · resets Nov 17, 6:59am (UTC)',
      'Current week (all models): 0% used · resets Nov 22, 6:59pm (UTC)',
      'Current week (Fable): 0% used · resets Nov 22, 7pm (UTC)'
    ].join('\r\n')
    const usage = parsePlanUsage(text, NOW)
    expect(usage?.meters).toEqual([
      { kind: 'session', label: null, percent: 2, resetsAt: Date.UTC(2026, 10, 17, 6, 59) },
      { kind: 'week', label: 'all models', percent: 0, resetsAt: Date.UTC(2026, 10, 22, 18, 59) },
      { kind: 'week', label: 'Fable', percent: 0, resetsAt: Date.UTC(2026, 10, 22, 19, 0) }
    ])
  })

  it('知らない行は無視し、1行も読めなければ null', () => {
    expect(parsePlanUsage('You are using an API key\nsomething else', NOW)).toBeNull()
    expect(parsePlanUsage('', NOW)).toBeNull()
  })

  it('最も高い使用率', () => {
    const usage = parsePlanUsage('Current session: 61% used · resets Oct 29, 7:30pm (UTC)\nCurrent week (all models): 4% used', NOW)
    expect(highestPercent(usage!)).toBe(61)
  })
})

describe('parseResets', () => {
  it('12時台の am/pm', () => {
    expect(parseResets('Nov 22, 12am (UTC)', NOW)).toBe(Date.UTC(2026, 10, 22, 0, 0))
    expect(parseResets('Nov 22, 12:30pm (UTC)', NOW)).toBe(Date.UTC(2026, 10, 22, 12, 30))
  })

  it('年をまたぐときは翌年にする', () => {
    const dec = Date.UTC(2026, 11, 30, 0, 0)
    expect(parseResets('Jan 3, 10am (UTC)', dec)).toBe(Date.UTC(2027, 0, 3, 10, 0))
  })

  it('少し過去のリセット日時はその年のまま', () => {
    expect(parseResets('Nov 16, 10am (UTC)', NOW)).toBe(Date.UTC(2026, 10, 16, 10, 0))
  })

  it('IANA のタイムゾーンを読む', () => {
    expect(parseResets('Nov 22, 7pm (Asia/Tokyo)', NOW)).toBe(Date.UTC(2026, 10, 22, 10, 0))
  })

  it('読めない形式・知らないタイムゾーンは null', () => {
    expect(parseResets('next week', NOW)).toBeNull()
    expect(parseResets('Nov 22, 7pm (Nowhere/Land)', NOW)).toBeNull()
  })
})
