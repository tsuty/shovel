import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notifyTurnEnd, onTurnEnd, TURN_END_DEBOUNCE_MS } from '@renderer/main-window/turnEnd'

describe('turnEnd', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('待ち時間の後に購読者へ通知する', () => {
    const listener = vi.fn()
    const off = onTurnEnd(listener)
    notifyTurnEnd()
    expect(listener).not.toHaveBeenCalled()
    vi.advanceTimersByTime(TURN_END_DEBOUNCE_MS)
    expect(listener).toHaveBeenCalledTimes(1)
    off()
  })

  it('立て続けのターン終了は1回にまとめる', () => {
    const listener = vi.fn()
    const off = onTurnEnd(listener)
    notifyTurnEnd()
    vi.advanceTimersByTime(TURN_END_DEBOUNCE_MS - 1)
    notifyTurnEnd()
    vi.advanceTimersByTime(TURN_END_DEBOUNCE_MS)
    expect(listener).toHaveBeenCalledTimes(1)
    off()
  })

  it('購読をやめた後は通知しない', () => {
    const listener = vi.fn()
    onTurnEnd(listener)()
    notifyTurnEnd()
    vi.advanceTimersByTime(TURN_END_DEBOUNCE_MS)
    expect(listener).not.toHaveBeenCalled()
  })
})
