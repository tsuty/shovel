import type { SessionUpdate } from '@agentclientprotocol/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AfterTurnTracker } from '@main/acp/afterTurn'

const chunk = { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'x' } } as SessionUpdate
const usage = { sessionUpdate: 'usage_update', used: 1, size: 2 } as SessionUpdate

function setup(): { tracker: AfterTurnTracker; calls: string[] } {
  const calls: string[] = []
  const tracker = new AfterTurnTracker(1000, { onStart: () => calls.push('start'), onSettle: () => calls.push('settle') })
  return { tracker, calls }
}

describe('AfterTurnTracker', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('starts on work outside a turn and settles after a quiet second', () => {
    const { tracker, calls } = setup()
    tracker.update(chunk)
    vi.advanceTimersByTime(900)
    tracker.update(chunk)
    vi.advanceTimersByTime(900)
    expect(calls).toEqual(['start'])
    vi.advanceTimersByTime(100)
    expect(calls).toEqual(['start', 'settle'])
  })

  it('ignores updates during a turn', () => {
    const { tracker, calls } = setup()
    tracker.turnStarted()
    tracker.update(chunk)
    vi.advanceTimersByTime(2000)
    expect(calls).toEqual([])
    tracker.turnEnded()
    tracker.update(chunk)
    expect(calls).toEqual(['start'])
  })

  it('ignores meta updates', () => {
    const { tracker, calls } = setup()
    tracker.update(usage)
    vi.advanceTimersByTime(2000)
    expect(calls).toEqual([])
  })

  it('settles before the next turn starts', () => {
    const { tracker, calls } = setup()
    tracker.update(chunk)
    tracker.turnStarted()
    expect(calls).toEqual(['start', 'settle'])
    vi.advanceTimersByTime(2000)
    expect(calls).toEqual(['start', 'settle'])
  })

  it('does nothing after dispose', () => {
    const { tracker, calls } = setup()
    tracker.update(chunk)
    tracker.dispose()
    vi.advanceTimersByTime(2000)
    tracker.update(chunk)
    tracker.flush()
    expect(calls).toEqual(['start'])
  })
})
